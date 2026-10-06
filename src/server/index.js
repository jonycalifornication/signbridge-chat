import './load-env.js'; // must stay first: modules below read config at import time

import { tasksInFlight as countTasksInFlight } from './task-slots.js';

import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';
import { exec, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import os from 'os';
import {
    buildRenderPlan,
    estimateFallbackTimeoutMs,
    estimateRenderTimeoutMs,
    renderPlanToGlossPreview
} from '../headless/render-plan.js';
import { resolveFrameSize, SUBTITLE_STRIP_HEIGHT } from '../headless/frame-size.js';
import { validateRequest, getAllKeys, createKey, deleteKey } from './api-keys.js';
import {
    AVATAR_URL,
    MIRROR_ROOT,
    candidateMatchesCurrent,
    isMirrorReady,
    mirrorEntryUrl,
    mirrorStatus,
    promoteMirror,
    readMirrorManifest,
    rollbackMirror,
    syncMirror
} from './avatar-mirror.js';

const execPromise = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number.parseInt(process.env.PORT, 10) || 3003;

/**
 * How puppeteer reaches this very server. The avatar mirror is served from here,
 * so the render page is same-origin with the API proxy below, and `localhost` is
 * a secure context — which WebCodecs requires.
 */
const SELF_URL = (process.env.SELF_URL || `http://localhost:${port}`).replace(/\/+$/, '');

/**
 * Base URL the mirrored avatar page should use for its API calls. It points at
 * our own proxy (see `/avatar-api`), never straight at the product server.
 */
const AVATAR_PAGE_API_URL = `${SELF_URL}/avatar-api/v1`;

app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Temporary directory for videos
const TEMP_DIR = path.join(__dirname, '../../temp_videos');
const CACHE_DIR = path.join(__dirname, '../../video_cache');
// Inside data/, never mounted as a single file: docker creates a *directory*
// when a bind-mount source is missing, and on a fresh server sessions.json is
// git-ignored — so a file mount silently turns into a directory and every chat
// is lost. The same trap already bit api_keys.json once.
const DATA_DIR = path.join(__dirname, '../../data');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

[TEMP_DIR, CACHE_DIR, DATA_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

app.use('/api/v1/video/cache', express.static(CACHE_DIR));

// ── Avatar mirror ─────────────────────────────────────────────────────
// The mirrored avatar build is served from this box so a render never hits the
// GPU-less product server. Puppeteer opens /avatar/current/embed.html.
app.use('/avatar', express.static(MIRROR_ROOT, {
    setHeaders: (res) => res.set('Cache-Control', 'no-store'),
}));

// Vite bakes root-absolute paths into its modulepreload hints (`/assets/…`),
// even though the real imports next to them are relative. Serving the mirror's
// assets at the root as well keeps those hints working instead of turning every
// render into a handful of 404s that drown out real errors. `current` is a
// directory that gets renamed on promote, so this path always tracks the live
// build; `candidate` is the fallback used while a fresh build is being vetted.
app.use('/assets', express.static(path.join(MIRROR_ROOT, 'current', 'assets')));
app.use('/assets', express.static(path.join(MIRROR_ROOT, 'candidate', 'assets')));

/**
 * Only the render page (same machine) may use the avatar API proxy — it carries
 * our API key, and port 3003 is published in docker-compose.
 */
function loopbackOnly(req, res, next) {
    const address = req.socket.remoteAddress || '';
    const isLoopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
    if (!isLoopback) {
        return res.status(403).json({ error: 'Forbidden: avatar API proxy is loopback-only' });
    }
    next();
}

/**
 * Avatar API proxy.
 *
 * Split by weight, on purpose:
 *   - `/translate/` and the CMS lookups go to the avatar gateway, so glossing,
 *     key validation and per-key metering stay where they belong. That is one
 *     light request per video on the product server.
 *   - `/files/download` (dozens of VRMA files per video) goes straight to the
 *     storage backend, so the heavy traffic never crosses the product server.
 *     Absolute S3 `file_url`s bypass this proxy entirely anyway.
 */
const AVATAR_API_BASE = `${AVATAR_URL}/api/v1`;
const AVATAR_FILES_BASE = (process.env.AVATAR_FILES_URL || process.env.BACKEND_URL || AVATAR_URL).replace(/\/+$/, '') + '/api/v1';
const AVATAR_API_KEY = process.env.AVATAR_API_KEY || '';

function avatarUpstreamFor(subPath) {
    return subPath.startsWith('/files/') ? AVATAR_FILES_BASE : AVATAR_API_BASE;
}

// The widget pings this before translating; answer locally instead of letting it
// hit the avatar's SPA fallback, which returns HTML with a misleading 200.
app.get('/avatar-api/health', loopbackOnly, (req, res) => {
    res.json({ status: 'ok', service: 'avatar-api-proxy' });
});

app.all('/avatar-api/v1/*', loopbackOnly, async (req, res) => {
    const subPath = req.params[0] ? `/${req.params[0]}` : '/';
    const query = new URLSearchParams(req.query).toString();
    const upstream = `${avatarUpstreamFor(subPath)}${subPath}${query ? `?${query}` : ''}`;

    try {
        const headers = { 'X-API-Key': AVATAR_API_KEY };
        const options = { method: req.method, headers };

        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(req.body);
        }

        const upstreamRes = await fetch(upstream, options);
        const body = Buffer.from(await upstreamRes.arrayBuffer());
        const contentType = upstreamRes.headers.get('content-type');

        res.status(upstreamRes.status);
        if (contentType) res.set('Content-Type', contentType);
        res.send(body);
    } catch (err) {
        console.error(`[AvatarProxy] ${req.method} ${subPath} failed:`, err.message);
        res.status(502).json({ error: 'Avatar upstream unavailable', detail: err.message });
    }
});

if (fs.existsSync(SESSIONS_FILE) && fs.statSync(SESSIONS_FILE).isDirectory()) {
    console.error(`[Storage] ${SESSIONS_FILE} is a directory, not a file — chat history cannot be saved.`);
    console.error('[Storage] Remove it (a stale docker bind-mount) and restart.');
} else if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
}

const tasks = new Map();

// Кто мы среди воркеров: задача живёт в ПАМЯТИ того процесса, который её
// начал, поэтому опрос статуса должен вернуться туда же. Проще всего сказать
// об этом в самом идентификаторе: nginx читает префикс и выбирает адрес.
// Пусто (один рендерер) — идентификаторы прежние, маршрутизация не нужна.
const WORKER_ID = String(process.env.WORKER_ID || '').trim();

// Соседние воркеры (по одному на видеокарту). Нужны затем, что раздать задачи
// снаружи нечем: запрос на создание живёт миллисекунды, а работа идёт потом,
// внутри воркера, и балансировщик её не видит — четыре запроса подряд уходили
// на одного и того же. Поэтому занятость знает только сам воркер, и занятый
// передаёт задачу свободному соседу.
const WORKER_PEERS = String(process.env.WORKER_PEERS || '')
    .split(',')
    .map((x) => x.trim().replace(/\/+$/, ''))
    .filter(Boolean);

const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100 MB

// Пауза записи и хвост в конце. Потолок — защита от опечатки: пауза в тысячу
// секунд молча съела бы таймаут рендера и вернула бы ошибку вместо видео.
const MAX_PAUSE_SECONDS = 30;
// Столько же, сколько было зашито в inject-renderer до параметризации, чтобы
// клиенты без tail_seconds получали ровно прежнее видео.
const DEFAULT_TAIL_SECONDS = 2;

// Кадр видео. Ширина — не косметика: в неё упираются разведённые руки, и
// обрезанный жест читается неправильно. См. src/headless/frame-size.js.
const FRAME = resolveFrameSize();

/**
 * Per-gloss playback data from a caller that already did its own glossing
 * (the speech-to-avatar case).
 *
 *   tokens[i].word  — the original word behind gloss i. Hands sign the gloss,
 *                     lips speak the word: "БАРУ" is signed, "барады" is spoken.
 *   speeds[i]       — timeScale multiplier for animation i, so a gesture can be
 *                     stretched or compressed to fit an external timeline.
 *   pauses[i]       — seconds of silence to hold AFTER gloss i, replacing the
 *                     avatar's usual inter-gesture gap. The caller's recording
 *                     has real pauses in it; without them every sentence after
 *                     the first drifts ahead of the speech, and an hour-long
 *                     lecture carries over a hundred of them. Unlike speeds,
 *                     a pause is the length of the RECORDING, so it is not
 *                     divided by the gesture rate.
 *
 * All three are positional and must line up with the sequence the backend
 * returns.
 * The avatar drops tokens entirely on a length mismatch (a desynchronised
 * mouth is worse than a gloss-shaped one), so we check it here and say so
 * instead of letting it fail quietly.
 */
function normalizePlaybackHints(body) {
    const tokens = Array.isArray(body?.tokens)
        ? body.tokens.map(t => ({
            gloss: typeof t?.gloss === 'string' ? t.gloss : '',
            word: typeof t?.word === 'string' ? t.word.trim() : '',
        }))
        : [];

    const speeds = Array.isArray(body?.speeds)
        ? body.speeds.map(v => {
            const n = Number(v);
            // Same bounds setPlaybackSpeed() clamps to in the avatar.
            return Number.isFinite(n) && n > 0 ? Math.max(0.1, Math.min(n, 5)) : 1;
        })
        : [];

    const pauses = Array.isArray(body?.pauses)
        ? body.pauses.map(v => {
            const n = Number(v);
            // Отрицательная и мусорная пауза — это 0: «нет паузы», а не сдвиг
            // назад. Верхняя граница отсекает опечатку в тысячу секунд, которая
            // молча съела бы таймаут рендера.
            return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PAUSE_SECONDS) : 0;
        })
        : [];

    // Хвост записи после последнего жеста. По умолчанию столько же, сколько
    // было зашито в inject-renderer, — поведение прежних клиентов не меняется.
    const rawTail = Number(body?.tail_seconds);
    const tailSeconds = Number.isFinite(rawTail) && rawTail >= 0
        ? Math.min(rawTail, MAX_PAUSE_SECONDS)
        : DEFAULT_TAIL_SECONDS;

    // Тишина ПЕРЕД первым жестом. Пауз в записи бывает и до первого
    // предложения: лектор молчит, пока включается проектор. Без неё видео
    // начинается с жеста, а речь — через четыре секунды, и весь файл смещён
    // относительно оригинала с первого кадра. Умолчание 0: прежние клиенты
    // получают прежнее видео.
    const rawLead = Number(body?.lead_seconds);
    const leadSeconds = Number.isFinite(rawLead) && rawLead > 0
        ? Math.min(rawLead, MAX_PAUSE_SECONDS)
        : 0;

    // Субтитры: 'glosses' — подпись жестом, 'text' — оригинальным словом.
    // Умолчание — никаких: подпись меняет картинку, и включать её без спроса
    // значило бы отдать другому клиенту не то видео, за которым он пришёл.
    const subtitles = body?.subtitles === 'glosses' || body?.subtitles === 'text'
        ? body.subtitles
        : null;

    return {
        tokens,
        speeds,
        pauses,
        leadSeconds,
        tailSeconds,
        subtitles,
        alreadyGlossed: body?.already_glossed === true,
    };
}

/**
 * Hash helper for caching.
 *
 * Playback hints are part of the identity of a video: the same glosses with
 * different speeds or different spoken words are a different render, and
 * leaving them out would serve a stale file.
 */
function getCacheKey(config) {
    const str = JSON.stringify({
        glosses: config.glosses,
        avatar: config.avatar || 'Aibek',
        background: config.background || 'white',
        mode: config.mode || 'normal',
        alreadyGlossed: config.alreadyGlossed === true,
        tokens: config.tokens?.length ? config.tokens.map(t => t.word) : null,
        speeds: config.speeds?.length ? config.speeds : null,
        // Те же глоссы с другими паузами — другое видео, и отдать прежний файл
        // значит вернуть рассинхрон, за которым клиент и пришёл.
        pauses: config.pauses?.length ? config.pauses : null,
        leadSeconds: config.leadSeconds ?? null,
        tailSeconds: config.tailSeconds ?? null,
        // Кадр другого размера — другое видео. Без этого после смены ширины
        // на старый текст вернулся бы старый, узкий файл из кэша.
        frame: `${FRAME.width}x${FRAME.height}`,
        // Подпись на кадре — часть картинки: то же видео без неё это другой
        // файл, и отдать его из кэша значит отдать не то, о чём просили.
        subtitles: config.subtitles ?? null,
    });
    return crypto.createHash('md5').update(str).digest('hex');
}

/**
 * Where the server-side render plan is built. This is the one light request per
 * video that legitimately belongs on the avatar gateway: it validates our key,
 * meters usage and performs text→gloss on its side.
 */
function resolveRenderPlanApiConfig() {
    const rawApiUrl = process.env.RENDER_PLAN_API_URL || `${AVATAR_URL}/api/v1`;

    return {
        apiUrl: rawApiUrl.replace(/\/+$/, ''),
        apiKey: AVATAR_API_KEY,
        languageId: process.env.RENDER_PLAN_LANGUAGE_ID || 'KSL',
        fetchTimeoutMs: Number(process.env.RENDER_PLAN_FETCH_TIMEOUT_MS) || 10000,
    };
}

function hasRendererGPU() {
    // ЛЮБАЯ карта, а не именно нулевая. Контейнер, привязанный к карте 1 через
    // NVIDIA_VISIBLE_DEVICES, видит устройство /dev/nvidia1 — и прежняя
    // проверка молча уводила его на программный рендер. Замер: тот же ролик
    // 184 с вместо 40, и таймаут считался по «процессорной» формуле.
    try {
        return fs.readdirSync('/dev').some((name) => /^nvidia\d+$/.test(name));
    } catch {
        return false;
    }
}

function resolveEncoderMaxQueueSize(hasGPU) {
    const fallback = hasGPU ? 256 : 30;
    const rawValue = process.env.RENDER_ENCODER_MAX_QUEUE_SIZE || process.env.ENCODER_MAX_QUEUE_SIZE;
    const parsed = Number.parseInt(rawValue, 10);

    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(parsed, 256));
}

/**
 * Сверять ли КАЖДЫЙ снятый кадр с холстом (`FRAME_AUDIT=1`).
 *
 * По умолчанию выключено, и это не осторожность, а замер. Проверка читает
 * кадр обратно из видеопамяти дважды, и обратное чтение стоит дороже всей
 * остальной записи: 136-193 кадра в секунду без неё против 32-33 с ней
 * (1920×1536, H.264, ANGLE/EGL, 300 кадров, два прогона). На боксе это
 * видно так же: 1306 кадров за 70 с вместо обычных 0.41 с рендера на
 * секунду видео. Пятикратная цена превращает пятиминутный кусок в рендер
 * длиннее своего же таймаута.
 *
 * Выборочно проверять нельзя: провал попадается раз на 30 000 кадров, и
 * проверка каждого тридцатого ловила бы его раз в девятьсот записей. Либо
 * каждый кадр, либо никакой — поэтому это прибор, который включают на один
 * осознанный долгий прогон, чтобы ответить, рвётся ли снимок, а не постоянно
 * работающий сторож.
 */
function resolveFrameAudit() {
    const raw = String(process.env.FRAME_AUDIT || process.env.RENDER_FRAME_AUDIT || '').trim();
    return raw === '1' || raw.toLowerCase() === 'true';
}

async function prepareRenderPlan(glosses, hasGPU, onProgress = null, mode = 'normal', alreadyGlossed = false) {
    const renderText = Array.isArray(glosses) ? glosses.join(' ') : String(glosses || '');
    let renderPlan = null;
    let renderTimeoutMs = estimateFallbackTimeoutMs(renderText, { hasGPU });

    try {
        if (onProgress) onProgress(8, 'Строим план жестов...');
        const planOptions = { ...resolveRenderPlanApiConfig(), mode, alreadyGlossed };
        renderPlan = await buildRenderPlan(renderText, planOptions);
        renderTimeoutMs = estimateRenderTimeoutMs(renderPlan, { hasGPU });
        console.log(`[Server] Render plan ready: ${JSON.stringify(renderPlan.stats)}, timeout=${Math.round(renderTimeoutMs / 1000)}s`);
    } catch (planErr) {
        console.warn(`[Server] Render plan unavailable, falling back to browser planning: ${planErr.message}`);
        console.log(`[Server] Fallback render timeout: ${Math.round(renderTimeoutMs / 1000)}s`);
    }

    return { renderPlan, renderTimeoutMs };
}

/**
 * Prune cache to stay under limit (LRU)
 */
/** Готовое видео в кеше: mp4 у новых рендеров, webm у снятых раньше. */
function cachedVideo(cacheKey) {
    for (const ext of ['mp4', 'webm']) {
        const candidate = path.join(CACHE_DIR, `${cacheKey}.${ext}`);
        if (fs.existsSync(candidate)) return candidate;
    }
    return null;
}

async function pruneCache() {
    try {
        const files = await fs.promises.readdir(CACHE_DIR);
        if (files.length === 0) return;

        const fileStats = await Promise.all(
            files.map(async (file) => {
                const filePath = path.join(CACHE_DIR, file);
                const stats = await fs.promises.stat(filePath);
                return { path: filePath, size: stats.size, mtime: stats.mtime };
            })
        );

        fileStats.sort((a, b) => a.mtime - b.mtime);
        let currentSize = fileStats.reduce((sum, f) => sum + f.size, 0);

        for (const file of fileStats) {
            if (currentSize <= MAX_CACHE_SIZE) break;
            await fs.promises.unlink(file.path);
            currentSize -= file.size;
            console.log(`[Cache] Pruned old file to save space. Current size: ${Math.round(currentSize/1024/1024)}MB`);
        }
    } catch (e) { console.error('[Cache] Prune error:', e); }
}



/**
 * Advanced Semaphore for queuing
 */
class Semaphore {
    constructor(max) {
        this.max = max;
        this.active = 0;
        this.waiting = [];
    }
    async acquire(onWait) {
        if (this.active < this.max) {
            this.active++;
            console.log(`[Semaphore] ACQUIRE: Slot taken. Active: ${this.active}, Waiting: ${this.waiting.length}`);
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this.waiting.push({ resolve, onWait });
            console.log(`[Semaphore] QUEUED: Limit reached. Task added to queue. In queue: ${this.waiting.length}`);
            this.notify();
        });
    }
    /** Есть ли свободный слот прямо сейчас. Для передачи задачи соседу. */
    get free() {
        return this.active < this.max && this.waiting.length === 0;
    }

    release() {
        this.active--;
        console.log(`[Semaphore] RELEASE: Slot freed. Active: ${this.active}, Remaining in queue: ${this.waiting.length}`);
        if (this.waiting.length > 0) {
            this.active++;
            const { resolve } = this.waiting.shift();
            console.log(`[Semaphore] NEXT: Resolving next task from queue.`);
            resolve();
            this.notify();
        }
    }

    notify() {
        this.waiting.forEach((item, index) => {
            if (item.onWait) item.onWait(index + 1);
        });
    }
}

// Рендер идёт ПО ОДНОМУ. Карта в боксе одна, и два параллельных рендера её не
// делят, а выстраиваются в очередь внутри драйвера: пропускная способность та
// же, а время каждого удваивается. На пятиминутных кусках лекции это и убивало
// работу — замер 01.10: кусок в 301 с видео при соседе рядом писался 527 с,
// а тот, кому достался ещё и третий конкурент, упёрся в потолок 600 с и умер
// целиком. По одному: тот же кусок — порядка 270 с, и запас до потолка
// двукратный.
const renderSemaphore = new Semaphore(1);

// --- Rate Limiter (per-IP) ---
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000;
const RATE_LIMIT_MAX = 10;

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const entry = rateLimitMap.get(ip);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW) {
        rateLimitMap.set(ip, { start: now, count: 1 });
        return next();
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now - entry.start > RATE_LIMIT_WINDOW) rateLimitMap.delete(ip);
    }
}, RATE_LIMIT_WINDOW);

/**
 * API Key Middleware
 */
async function apiKeyAuth(req, res, next) {
    return next(); // BYPASS

    const isValid = await validateRequest(req);
    if (!isValid) {
        return res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key/Domain' });
    }
    next();
}

const MUXER_LOCAL_PATH = path.join(__dirname, '../../node_modules/webm-muxer/build/webm-muxer.js');
const MUXER_CDN_URL = 'https://cdn.jsdelivr.net/npm/webm-muxer@5.0.2/build/webm-muxer.js';
// Второй мукс — mp4. Видео отдаём в нём: mp4 открывает что угодно, включая
// телефоны и монтажные программы, а webm половина из них не берёт вовсе.
// Перекодировки это не стоит — H.264 кодирует тот же браузерный энкодер, что
// писал VP8 (на боксе поддержаны avc1.4d0028 и avc1.640028).
const MP4_MUXER_LOCAL_PATH = path.join(__dirname, '../../node_modules/mp4-muxer/build/mp4-muxer.js');
const MP4_MUXER_CDN_URL = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/build/mp4-muxer.js';
const INJECT_RENDERER_PATH = path.join(__dirname, '../headless/inject-renderer.js');
const SUBTITLES_PATH = path.join(__dirname, '../headless/subtitles.js');

/**
 * Put our video pipeline inside the avatar's page.
 *
 * `inject-renderer.js` is intentionally import-free so it can be injected as a
 * plain script with no build step. The muxer is served from node_modules when
 * available so a render does not depend on a CDN; the CDN stays as a fallback
 * for setups that have not installed it yet.
 */
async function injectRenderer(page) {
    if (fs.existsSync(MUXER_LOCAL_PATH)) {
        await page.addScriptTag({ path: MUXER_LOCAL_PATH });
    } else {
        console.warn('[Server] webm-muxer not found in node_modules — falling back to CDN. Run `npm install`.');
        await page.addScriptTag({ url: MUXER_CDN_URL });
    }

    if (fs.existsSync(MP4_MUXER_LOCAL_PATH)) {
        await page.addScriptTag({ path: MP4_MUXER_LOCAL_PATH });
    } else {
        console.warn('[Server] mp4-muxer not found in node_modules — falling back to CDN. Run `npm install`.');
        await page.addScriptTag({ url: MP4_MUXER_CDN_URL });
    }

    // Субтитры лежат отдельным файлом, а не внутри рендера: так их можно
    // прогнать и посмотреть глазами, не запуская рендер целиком.
    await page.addScriptTag({ path: SUBTITLES_PATH });
    await page.addScriptTag({ path: INJECT_RENDERER_PATH });
}

/**
 * Core Video Generation Logic
 */
async function generateVideoCore(glosses, avatar, background, userAgent, onProgress = null, planning = {}) {
    let browser;
    try {
        if(onProgress) onProgress(5, 'Прогреваем видеопроцессоры...');

        // Which copy of the mirrored avatar to render with. Always 'current',
        // except for the smoke render that vets a freshly synced 'candidate'.
        const mirrorVariant = planning.mirrorVariant || 'current';
        if (!isMirrorReady(mirrorVariant)) {
            throw new Error(
                `Avatar mirror "${mirrorVariant}" is empty. Run a sync first ` +
                '(npm run avatar:sync, or POST /admin/avatar/sync).'
            );
        }

        const hasGPU = hasRendererGPU();
        console.log(`[Server] GPU mode: ${hasGPU ? 'NVIDIA (EGL)' : 'ANGLE SwiftShader (CPU)'}`);
        const encoderMaxQueueSize = resolveEncoderMaxQueueSize(hasGPU);
        console.log(`[Server] Encoder queue limit: ${encoderMaxQueueSize}`);
        const preparedPlan = planning.renderPlan || typeof planning.renderTimeoutMs === 'number'
            ? {
                renderPlan: planning.renderPlan || null,
                renderTimeoutMs: typeof planning.renderTimeoutMs === 'number'
                    ? planning.renderTimeoutMs
                    : estimateRenderTimeoutMs(planning.renderPlan, { hasGPU })
            }
            : await prepareRenderPlan(glosses, hasGPU, onProgress, planning.mode || 'normal', planning.alreadyGlossed === true);
        const { renderPlan, renderTimeoutMs } = preparedPlan;

        browser = await puppeteer.launch({
            headless: "new",
            protocolTimeout: renderTimeoutMs + 60000,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--allow-running-insecure-content',
                '--enable-webgl',
                // Use ANGLE+EGL when NVIDIA GPU is available, otherwise ANGLE+SwiftShader.
                ...(hasGPU
                    ? ['--use-gl=angle', '--use-angle=gl-egl']
                    : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
                // Required for headless GPU rendering
                ...(hasGPU ? ['--enable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '--ozone-platform=headless'] : []),
                '--enable-gpu-rasterization',
                '--enable-zero-copy',
                '--ignore-gpu-blocklist',
                `--unsafely-treat-insecure-origin-as-secure=${SELF_URL}`
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
        });

        // Браузер наружу: отмена задачи закрывает именно его — `evaluate`
        // тогда падает, рендер прекращается, слот освобождается.
        if (typeof planning.onBrowserReady === 'function') planning.onBrowserReady(browser);

        const page = await browser.newPage();
        
        if (onProgress) {
            await page.exposeFunction('reportProgress', (percent, msg) => {
                onProgress(percent, msg);
            });
        }
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        console.log(`[Server] Frame: ${FRAME.width}x${FRAME.height}`);
        await page.setViewport({ width: FRAME.width, height: FRAME.height });

        page.on('console', msg => console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[Browser Error] ${err.message}`));
        page.on('requestfailed', request => {
            console.log(`[Browser Blocked] ${request.failure()?.errorText || 'Failed'}: ${request.method()} ${request.url()}`);
        });

        // Render inside the avatar's own embed page (served from our local
        // mirror), then inject our renderer into it. The avatar stays untouched:
        // we only call its public API from the injected script.
        const rendererUrl = `${mirrorEntryUrl(SELF_URL, mirrorVariant)}?${new URLSearchParams({
            apiUrl: AVATAR_PAGE_API_URL,
            apiKey: AVATAR_API_KEY,
            languageId: process.env.RENDER_PLAN_LANGUAGE_ID || 'KSL',
            // Просим аватар включить preserveDrawingBuffer: мы снимаем каждый
            // кадр с холста уже после отрисовки, а без флага содержимое буфера
            // в этот момент не определено — в видео пропадали целые меши
            // (пиджак, рукава) на 5% кадров. Обычному просмотру флаг не нужен
            // и стоит памяти, поэтому его просит только запись.
            record: '1',
        }).toString()}`;

        console.log(`[Server] Navigating to mirrored avatar page: ${mirrorEntryUrl(SELF_URL, mirrorVariant)}`);
        if(onProgress) onProgress(10, 'Материализуем 3D-аватар из матрицы 🕶');
        await page.goto(rendererUrl, { waitUntil: 'networkidle0', timeout: 30000 });

        console.log(`[Server] Injecting muxer and headless renderer...`);
        await injectRenderer(page);

        console.log(`[Server] Waiting for the injected renderer...`);
        await page.waitForFunction(() => window.headlessRendererReady === true, { timeout: 30000 });

        if(onProgress) onProgress(20, 'Анализируем текст и подбираем жесты 🧠');
        console.log(`[Server] Starting recording...`);
        
        let renderTimer;
        let dataUrl;
        try {
            dataUrl = await Promise.race([
                page.evaluate(async (config) => {
                    return await window.startHeadlessRender(config);
                }, {
                    glosses,
                    avatar,
                    background,
                    renderPlan,
                    // The gateway was already called once, server-side. Hand the
                    // response over so the page does not translate a second time.
                    translateResponse: renderPlan?.response || null,
                    languageId: renderPlan?.languageId || null,
                    // Positional per-gloss data: lips speak tokens[i].word while the
                    // hands sign the gloss; speeds[i] scales that gesture.
                    tokens: planning.tokens || [],
                    speeds: planning.speeds || [],
                    // pauses[i] — тишина ПОСЛЕ жеста i, не делится на rate.
                    pauses: planning.pauses || [],
                    // Тишина до первого жеста — тем же механизмом, что хвост.
                    leadSeconds: typeof planning.leadSeconds === 'number' ? planning.leadSeconds : 0,
                    tailSeconds: typeof planning.tailSeconds === 'number'
                        ? planning.tailSeconds
                        : DEFAULT_TAIL_SECONDS,
                    subtitles: planning.subtitles || null,
                    renderProfile: { hasGPU, encoderMaxQueueSize, frameAudit: resolveFrameAudit() }
                }),
                new Promise((_, reject) => {
                    renderTimer = setTimeout(
                        () => reject(new Error(`Render timeout: exceeded ${Math.round(renderTimeoutMs / 1000)} seconds`)),
                        renderTimeoutMs
                    );
                })
            ]);
        } finally {
            clearTimeout(renderTimer);
        }

        if (!dataUrl || typeof dataUrl !== 'string') {
            throw new Error('Render failed: no data returned from browser');
        }

        if(onProgress) onProgress(80, 'Упаковываем магию в пиксели...');

        const base64Data = dataUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');

        // Контейнер выбирает страница (mp4, если браузер умеет H.264), и
        // называет его в самом dataURL. Расширение файла должно совпасть:
        // по нему и плеер, и наш же срез подписи понимают, что внутри.
        const mime = /^data:([^;,]+)/.exec(dataUrl)?.[1] || 'video/webm';
        const ext = mime === 'video/mp4' ? 'mp4' : 'webm';

        const requestId = Date.now() + Math.floor(Math.random() * 1000);
        const videoPath = path.join(TEMP_DIR, `render_${requestId}.${ext}`);

        await fs.promises.writeFile(videoPath, buffer);

        console.log(`[Server] Готово: ${path.basename(videoPath)}, ${Math.round(buffer.length / 1048576)} МБ`);
        return { videoPath, ext, mime };

    } finally {
        if (browser) await browser.close();
    }
}

/**
 * v1: Synchronous Backend Endpoint (Retro-compatibility)
 */
app.post('/api/v1/video/generate', rateLimit, apiKeyAuth, async (req, res) => {
    const { glosses, avatar, background, mode } = req.body;
    const hints = normalizePlaybackHints(req.body);

    if (!glosses || (!Array.isArray(glosses) && typeof glosses !== 'string')) {
        return res.status(400).json({ error: 'glosses missing' });
    }

    console.log(`[Server v1] Received render request`);
    const userAgent = req.headers['user-agent'] || '';

    let acquired = false;
    try {
        const cacheKey = getCacheKey({ glosses, avatar, background, mode, ...hints });
        // В кеше может лежать и mp4 (новые рендеры), и webm (всё, что сняли до
        // перехода). Ищем оба: старый файл отдать можно, перерисовывать его
        // ради контейнера незачем.
        const cached = cachedVideo(cacheKey);
        if (cached) {
            console.log(`[Cache v1] Hit for key: ${cacheKey}`);
            return res.download(cached, `animation${path.extname(cached)}`);
        }

        await renderSemaphore.acquire();
        acquired = true;
        const result = await generateVideoCore(glosses, avatar, background, userAgent, null, { mode, ...hints });

        // Save to cache after successful v1 render too
        await fs.promises
            .copyFile(result.videoPath, path.join(CACHE_DIR, `${cacheKey}.${result.ext}`))
            .catch(() => {});
        await pruneCache();

        res.download(result.videoPath, `animation.${result.ext}`, async () => {
            try {
                if (fs.existsSync(result.videoPath)) await fs.promises.unlink(result.videoPath);
            } catch (cleanupErr) {
                console.error('[Server v1] Cleanup error:', cleanupErr);
            }
        });
    } catch (error) {
        console.error('[Server v1] Render error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (acquired) renderSemaphore.release();
    }
});


/**
 * Preview gloss availability without launching the video renderer.
 */
app.post('/api/v1/video/preview', rateLimit, apiKeyAuth, async (req, res) => {
    const { glosses, mode } = req.body;
    const hints = normalizePlaybackHints(req.body);

    if (!glosses || (!Array.isArray(glosses) && typeof glosses !== 'string')) {
        return res.status(400).json({ error: 'glosses missing or invalid' });
    }

    try {
        const planOptions = { ...resolveRenderPlanApiConfig(), mode: mode || 'normal', alreadyGlossed: hints.alreadyGlossed };
        const renderPlan = await buildRenderPlan(glosses, planOptions);
        const renderPreview = renderPlanToGlossPreview(renderPlan);

        if (!renderPreview || !Array.isArray(renderPreview.glossTokens)) {
            return res.status(502).json({ error: 'Gloss preview unavailable' });
        }

        res.json({ status: 'ready', ...renderPreview });
    } catch (error) {
        console.error('[Server preview] Gloss preview error:', error);
        res.status(500).json({ error: error.message });
    }
});



/**
 * v2: Asynchronous Task Creation
 */
/**
 * Сколько задач у нас в работе.
 *
 * Считаем по списку задач, а не по семафору: слот захватывается ПОЗЖЕ, уже
 * внутри фоновой работы, и в момент создания следующей задачи семафор ещё
 * показывает «свободно». На четырёх одновременных запросах это и приводило к
 * тому, что все четыре оставались у одного воркера.
 */
function tasksInFlight() {
    return countTasksInFlight(tasks);
}

/** Свободны ли мы прямо сейчас — для себя и для соседей. */
function workerIsFree() {
    return renderSemaphore.free && tasksInFlight() < renderSemaphore.max;
}

// Кэш «номер воркера → адрес». Нужен, чтобы ответить на опрос чужой задачи:
// адрес соседа мы знаем, а какой у него номер — спрашиваем и запоминаем.
const peerAddressById = new Map();
let peerMapRefreshedAt = 0;

async function refreshPeerMap(maxAgeMs = 60000) {
    if (Date.now() - peerMapRefreshedAt < maxAgeMs && peerAddressById.size > 0) return;
    await Promise.all(
        WORKER_PEERS.map(async (base) => {
            try {
                const resp = await fetch(`${base}/internal/slots`, { signal: AbortSignal.timeout(1500) });
                if (!resp.ok) return;
                const data = await resp.json();
                if (data?.worker) peerAddressById.set(data.worker, base);
            } catch {
                /* сосед не ответил — в следующий раз */
            }
        }),
    );
    peerMapRefreshedAt = Date.now();
}

/** Адрес воркера, которому принадлежит задача, или null (наша/неизвестно). */
async function ownerOf(taskId) {
    const prefix = String(taskId || '').split('-')[0];
    if (!prefix || !/^w\d+$/.test(prefix) || prefix === WORKER_ID) return null;
    await refreshPeerMap();
    return peerAddressById.get(prefix) || null;
}

/**
 * Переслать ответ соседа как свой — поток в поток.
 *
 * Нужно затем, что задача живёт в памяти того, кто её начал, а опрос может
 * прийти к любому: адреса контейнеров меняются при пересборке, и полагаться
 * на маршрутизацию снаружи оказалось нельзя — после одной пересборки все
 * опросы задач w0 стали отвечать «task not found», хотя задача была жива.
 */
async function pipeFromOwner(req, res, url) {
    const upstream = await fetch(url, {
        headers: { accept: req.get('accept') || '*/*' },
        signal: AbortSignal.timeout(1200000),
    });
    res.status(upstream.status);
    for (const name of ['content-type', 'content-length', 'content-disposition', 'cache-control']) {
        const value = upstream.headers.get(name);
        if (value) res.setHeader(name, value);
    }
    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    req.on('close', () => reader.cancel().catch(() => {}));
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
    }
    res.end();
}

/**
 * Свободен ли этот воркер. Спрашивают только соседи, по внутренней сети;
 * nginx наружу /internal не отдаёт.
 */
app.get('/internal/slots', async (_req, res) => {
    res.json({
        worker: WORKER_ID || null,
        free: workerIsFree(),
        active: renderSemaphore.active,
        inFlight: tasksInFlight(),
        queued: renderSemaphore.waiting.length,
        // Занятость карты: по ней сосед решает, стоит ли отдавать работу.
        gpu: await gpuLoad(),
    });
});

/**
 * Найти свободного соседа. Возвращает его адрес или null.
 *
 * Опрашиваем всех разом и берём первого ответившего «свободен»: опрос дешёвый,
 * а последовательный обход добавлял бы к каждому куску секунды ожидания.
 */
/**
 * Загрузка СВОЕЙ видеокарты в процентах.
 *
 * Нужна, потому что карт четыре, а работают на них не только мы: на нулевой
 * живёт глоссер и временами обучает модель. Цикл съёмки на каждом кадре ждёт
 * `gl.finish()`, то есть встаёт в очередь за чужими вычислениями — замер
 * 02.10.2026: один и тот же кусок шёл 90 с на свободной карте и 452 с на той,
 * где считалось обучение. Раньше про это никто не знал: задачу раздавали по
 * числу соединений и по числу чужих задач, а не по занятости карты.
 *
 * Контейнер видит только свои карты (`NVIDIA_VISIBLE_DEVICES`), поэтому первая
 * строка `nvidia-smi` — это и есть та, на которой мы рисуем. Кэш на три
 * секунды: соседи спрашивают часто, а запуск nvidia-smi не бесплатный.
 */
let gpuLoadCache = { at: 0, value: null };

async function gpuLoad() {
    if (Date.now() - gpuLoadCache.at < 3000) return gpuLoadCache.value;
    let value = null;
    try {
        const { stdout } = await execPromise(
            'nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits',
            { timeout: 2000 },
        );
        const first = Number.parseInt(String(stdout).trim().split('\n')[0], 10);
        if (Number.isFinite(first)) value = first;
    } catch {
        /* нет nvidia-smi (CPU-рендер) — считаем, что про карту ничего не знаем */
    }
    gpuLoadCache = { at: Date.now(), value };
    return value;
}

/** Выше этого считаем, что на карте работает кто-то ещё. */
const GPU_BUSY_PERCENT = 45;
/** Насколько сосед должен быть свободнее, чтобы отдавать ему работу. */
const GPU_BETTER_BY = 20;

async function findFreePeer(maxGpuLoad = null) {
    if (WORKER_PEERS.length === 0) return null;
    const probes = WORKER_PEERS.map(async (base) => {
        try {
            const resp = await fetch(`${base}/internal/slots`, {
                signal: AbortSignal.timeout(1500),
            });
            if (!resp.ok) return null;
            const data = await resp.json();
            return data?.free ? { base, gpu: typeof data.gpu === 'number' ? data.gpu : null } : null;
        } catch {
            return null;
        }
    });
    const results = (await Promise.all(probes)).filter(Boolean);
    if (results.length === 0) return null;
    // Среди свободных берём того, у кого карта свободнее: «свободен» у соседа
    // значит «нет моих задач», а карту у него может занимать обучение.
    // Отдаём работу из-за занятой карты только тому, у кого она заметно
    // свободнее: иначе кусок будет кочевать по кругу между равными соседями.
    const eligible = maxGpuLoad === null
        ? results
        : results.filter((peer) => peer.gpu !== null && peer.gpu <= maxGpuLoad);
    if (eligible.length === 0) return null;
    const known = eligible.filter((peer) => peer.gpu !== null);
    if (known.length > 0) {
        known.sort((a, b) => a.gpu - b.gpu);
        const best = known[0].gpu;
        // Между одинаково свободными — случайный: иначе все занятые воркеры
        // разом отдадут работу одному и тому же, и он встанет с очередью.
        const tied = known.filter((peer) => peer.gpu <= best + 5);
        return tied[Math.floor(Math.random() * tied.length)].base;
    }
    return eligible[Math.floor(Math.random() * eligible.length)].base;
}

app.post('/api/v1/video/generate-async', rateLimit, apiKeyAuth, async (req, res) => {
    const { glosses, avatar, background, mode, sessionId, msgId } = req.body;
    const hints = normalizePlaybackHints(req.body);

    if (!glosses || (!Array.isArray(glosses) && typeof glosses !== 'string')) {
        return res.status(400).json({ error: 'glosses missing or invalid' });
    }

    // Input validation
    if (avatar && (typeof avatar !== 'string' || avatar.length > 50)) {
        return res.status(400).json({ error: 'invalid avatar' });
    }
    if (background && (typeof background !== 'string' || background.length > 50)) {
        return res.status(400).json({ error: 'invalid background' });
    }

    // Мы заняты, а сосед свободен — отдаём задачу ему и возвращаем ЕГО номер.
    // Номер несёт префикс воркера, поэтому опрос статуса потом придёт туда же.
    // Заголовок не даёт переданной задаче уехать дальше по кругу.
    if (!workerIsFree() && req.get('X-Render-Handoff') !== '1') {
        const peer = await findFreePeer();
        if (peer) {
            try {
                const forwarded = await fetch(`${peer}/api/v1/video/generate-async`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', 'X-Render-Handoff': '1' },
                    body: JSON.stringify(req.body),
                    signal: AbortSignal.timeout(15000),
                });
                if (forwarded.ok) {
                    const data = await forwarded.json();
                    console.log(`[Handoff] Задача передана соседу ${peer}: ${data.taskId}`);
                    return res.json(data);
                }
                console.warn(`[Handoff] Сосед ${peer} ответил ${forwarded.status} — берём себе`);
            } catch (err) {
                console.warn(`[Handoff] Сосед ${peer} недоступен (${err.message}) — берём себе`);
            }
        }
    }

    const taskId = WORKER_ID ? `${WORKER_ID}-${crypto.randomUUID()}` : crypto.randomUUID();
    const userAgent = req.headers['user-agent'] || '';

    // De-duplication check: if this msgId is already being processed, just return that taskId
    if (msgId) {
        for (const [id, t] of tasks.entries()) {
            if (t.msgId === msgId && t.status !== 'error') {
                console.log(`[Server] Found existing task ${id} for message ${msgId}. Re-attaching.`);
                return res.json({ taskId: id, status: 're-attached', ...(t.renderPreview || {}) });
            }
        }
    }

    // Prune old completed/error tasks if over limit
    const MAX_TASKS = 500;
    if (tasks.size >= MAX_TASKS) {
        for (const [id, t] of tasks.entries()) {
            if (t.status === 'error' || t.status === 'completed') {
                cleanupTask(id);
            }
            if (tasks.size < MAX_TASKS) break;
        }
        // Hard cap: reject if still at limit (all processing)
        if (tasks.size >= MAX_TASKS) {
            return res.status(503).json({ error: 'Server busy. Try again later.' });
        }
    }

    // Застолбить место СРАЗУ, до похода за планом рендера.
    //
    // План строится сетевым запросом к шлюзу и занимает секунды. Пока он
    // строился, задачи в списке не было — и следующий запрос видел воркер
    // свободным и тоже оставался здесь. На четырёх одновременных кусках все
    // четыре оседали у одного, а три карты простаивали.
    tasks.set(taskId, {
        status: 'processing',
        progress: 0,
        message: 'Готовим план рендера...',
        downloadUrl: null,
        sseResponse: null,
        msgId,
        sessionId,
    });

    const hasGPU = hasRendererGPU();
    let renderPlan;
    let renderTimeoutMs;
    try {
        ({ renderPlan, renderTimeoutMs } = await prepareRenderPlan(glosses, hasGPU, null, mode, hints.alreadyGlossed));
    } catch (err) {
        // План не построился — место освобождаем, иначе воркер будет считать
        // себя занятым до перезапуска.
        tasks.delete(taskId);
        throw err;
    }

    // tokens/speeds are positional: the avatar ignores tokens outright when the
    // count differs from the sequence, so tell the caller rather than shipping a
    // video whose mouth silently fell back to speaking glosses.
    const sequenceLength = renderPlan?.response?.sequence?.length ?? null;
    const hintWarnings = [];
    if (hints.tokens.length && sequenceLength !== null && hints.tokens.length !== sequenceLength) {
        hintWarnings.push(`tokens: got ${hints.tokens.length} for ${sequenceLength} glosses — ignored, lips will speak the glosses`);
    }
    if (hints.speeds.length && sequenceLength !== null && hints.speeds.length !== sequenceLength) {
        hintWarnings.push(`speeds: got ${hints.speeds.length} for ${sequenceLength} glosses — missing entries default to 1`);
    }
    if (hints.pauses.length && sequenceLength !== null && hints.pauses.length !== sequenceLength) {
        hintWarnings.push(`pauses: got ${hints.pauses.length} for ${sequenceLength} glosses — missing entries fall back to the usual gap`);
    }
    if (hintWarnings.length) console.warn(`[Server] Playback hints mismatch — ${hintWarnings.join('; ')}`);
    const renderPreview = renderPlan ? renderPlanToGlossPreview(renderPlan) : null;

    // Дополняем застолблённую запись тем, что стало известно из плана.
    // requestBody держим затем, что ждущую задачу можно отдать освободившемуся
    // соседу — а для этого нужно, из чего её пересоздать.
    tasks.set(taskId, {
        ...tasks.get(taskId),
        requestBody: req.body,
        // Были ли субтитры — нужно на выдаче: копию без подписи просят у той же
        // задачи, и срезать полосу можно только у того, у кого она есть.
        subtitles: hints.subtitles || null,
        status: 'processing',
        progress: 0,
        message: 'Задача создана...',
        downloadUrl: null,
        sseResponse: null,
        msgId,
        sessionId,
        renderPlan,
        renderTimeoutMs,
        renderPreview
    });


    res.json({
        taskId,
        status: 'queued',
        ...(renderPreview || {}),
        ...(hintWarnings.length ? { warnings: hintWarnings } : {}),
    });

    // Background processing
    (async () => {
        const task = tasks.get(taskId);
        let acquired = false;
        
        const onProgress = (pct, msg) => {
            // Процент не убывает. Этапы считают его независимо (страница — по
            // кадрам, сервер — по шагам), и любой их перехлёст на экране
            // выглядит как откат: «80, потом снова 75». Пусть лучше число
            // постоит на месте, чем поедет назад.
            task.progress = Math.max(task.progress ?? 0, pct);
            task.message = msg;
            if (task.sseResponse) {
                task.sseResponse.write(
                    `data: ${JSON.stringify({ progress: task.progress, message: msg })}\n\n`,
                );
            }
        };

        try {
            // --- Caching Layer ---
            const cacheKey = getCacheKey({ glosses, avatar, background, mode, ...hints });
            const cachePath = cachedVideo(cacheKey);

            if (cachePath) {
                console.log(`[Cache] Hit for key: ${cacheKey}`);
                task.finalFilePath = cachePath;
                task.downloadUrl = `/api/v1/video/cache/${path.basename(cachePath)}`;
                task.status = 'completed';
                task.progress = 100;
                task.message = 'Готово (из кэша)!';

                if (task.sseResponse) {

                    task.sseResponse.write(`data: ${JSON.stringify({ progress: 100, message: 'Готово (из кэша)!', downloadUrl: task.downloadUrl })}\n\n`);
                    task.sseResponse.end();
                }
                // Auto-update Project Persistence even on cache hit
                if (sessionId && msgId) {
                    updateSessionTaskResult(sessionId, msgId, task.downloadUrl);
                }
                return; // Early exit on cache hit
            }


            // --- Queue & Generation ---
            //
            // Пока стоим в очереди, приглядываем за соседями: освободился
            // кто-то раньше нас — отдаём работу ему. Иначе задача прилипала к
            // своему воркеру, и на хвосте одна карта работала, а соседние
            // простаивали. Клиент при этом ничего не замечает: номер задачи
            // прежний, а статус и файл мы проксируем тому, кто считает.
            //
            // Сторожим и второй случай: мы свободны, но на нашей карте считает
            // кто-то чужой (обучение глоссера живёт на нулевой). Тогда работу
            // тоже лучше отдать — соседу со свободной картой тот же кусок
            // достаётся впятеро быстрее.
            /** Отдать задачу соседу. true — отдали, дальше считать не надо. */
            const handOff = async (peer, why) => {
                if (!peer || task.movedTo || task.startedLocally) return false;
                try {
                    const resp = await fetch(`${peer}/api/v1/video/generate-async`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json', 'X-Render-Handoff': '1' },
                        body: JSON.stringify(task.requestBody || {}),
                        signal: AbortSignal.timeout(20000),
                    });
                    if (!resp.ok) return false;
                    const data = await resp.json();
                    task.movedTo = { base: peer, taskId: data.taskId };
                    task.message = 'Передано свободной карте...';
                    console.log(`[Миграция] Задача ${taskId} уехала к ${peer} (${why}): ${data.taskId}`);
                    // Отдав работу, мы выходим из фоновой функции и до её
                    // обычной уборки не доходим — запись оставалась в памяти
                    // до перезапуска. Срок тот же час, что у готовой задачи:
                    // он заведомо переживает чужой рендер, а переадресация
                    // нужна ровно пока клиент опрашивает и качает.
                    setTimeout(() => {
                        if (tasks.has(taskId)) cleanupTask(taskId);
                    }, 3600000);
                    return true;
                } catch (err) {
                    console.warn(`[Миграция] Не вышло отдать ${taskId}: ${err.message}`);
                    return false;
                }
            };

            const ourGpu = await gpuLoad();
            const gpuCrowded = typeof ourGpu === 'number' && ourGpu >= GPU_BUSY_PERCENT;

            // Карта занята чужой работой — спрашиваем соседей СРАЗУ, до того как
            // возьмём слот. Через сторожа ниже это не работает: он просыпается
            // раз в пять секунд, а свободный воркер начинает считать мгновенно
            // и ставит `startedLocally` — отдавать уже поздно. Именно так первая
            // версия этой правки и промолчала: задача честно осталась на карте,
            // где шло обучение, и считалась впятеро дольше.
            if (gpuCrowded && renderSemaphore.free && WORKER_PEERS.length > 0) {
                const peer = await findFreePeer(ourGpu - GPU_BETTER_BY);
                if (await handOff(peer, `карта занята на ${ourGpu}%`)) return;
            }

            let migration = null;
            if (!renderSemaphore.free && WORKER_PEERS.length > 0) {
                migration = setInterval(async () => {
                    if (task.status !== 'processing' || task.movedTo) return;
                    // Пока спрашивали соседей, могли начать считать сами —
                    // тогда отдавать нельзя: получится два рендера одного
                    // куска на двух картах.
                    if (await handOff(await findFreePeer(), 'освободился сосед')) {
                        clearInterval(migration);
                        migration = null;
                    }
                }, 5000);
            }

            await renderSemaphore.acquire((pos) => {
                onProgress(0, `Ждем очереди (вы #${pos} в списке)...`);
            });
            if (migration) { clearInterval(migration); migration = null; }
            // Пока ждали слот, задачу успели отдать соседу — считать не надо.
            if (task.movedTo) {
                renderSemaphore.release();
                return;
            }
            // Пока стояли в очереди, задачу могли отменить — тогда слот
            // отдаём сразу, не запуская браузер.
            if (task.cancelled) {
                renderSemaphore.release();
                return;
            }
            task.startedLocally = true;
            acquired = true;

            const result = await generateVideoCore(glosses, avatar, background, userAgent, onProgress, {
                renderPlan: task.renderPlan,
                renderTimeoutMs: task.renderTimeoutMs,
                mode: mode,
                onBrowserReady: (instance) => { task.browser = instance; },
                ...hints
            });
            
            // Save to Cache for next time
            try {
                await fs.promises.copyFile(result.videoPath, path.join(CACHE_DIR, `${cacheKey}.${result.ext}`));
                console.log(`[Cache] Saved new entry: ${cacheKey}`);
                await pruneCache();
            } catch (cacheErr) {
                console.error('[Cache] Save error:', cacheErr);
            }


            task.finalFilePath = result.videoPath;
            task.otherFilePath = null;
            task.downloadUrl = `/api/v1/video/cache/${cacheKey}.${result.ext}`;
            task.status = 'completed';
            
            // AUTO UPDATE SESSIONS FILE
            if (sessionId && msgId) {
                await updateSessionTaskResult(sessionId, msgId, task.downloadUrl);
            }

            if (task.sseResponse) {

                task.sseResponse.write(`data: ${JSON.stringify({ progress: 100, message: 'Готово!', downloadUrl: task.downloadUrl })}\n\n`);
                task.sseResponse.end();
            }
            
            // Auto cleanup memory after 1 hour if not downloaded
            setTimeout(() => {
                if(tasks.has(taskId)) {
                    cleanupTask(taskId);
                }
            }, 3600000);
            
        } catch (err) {
            console.error(`[Server v2] Task ${taskId} failed:`, err);
            task.status = 'error';
            // Отменённая задача падает закрытым браузером — человеку про это
            // знать незачем, он сам нажал «остановить».
            task.errorMessage = task.cancelled ? 'Отменено' : err.message;
            if (task.sseResponse) {
                task.sseResponse.write(`data: ${JSON.stringify({ error: err.message, progress: 0 })}\n\n`);
                task.sseResponse.end();
            }
            // Auto cleanup error tasks after 5 minutes
            setTimeout(() => {
                if (tasks.has(taskId)) cleanupTask(taskId);
            }, 300000);
        } finally {
            if (acquired) renderSemaphore.release();
        }
    })();
});



/**
 * v2: SSE Status Endpoint
 */
app.get('/api/v1/video/status/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    let task = tasks.get(taskId);

    // Задача уехала к соседу (освободился раньше нас) — спрашиваем у него.
    if (task?.movedTo) {
        return pipeFromOwner(req, res, `${task.movedTo.base}/api/v1/video/status/${task.movedTo.taskId}`)
            .catch(() => res.status(502).json({ error: 'owner_unreachable' }));
    }

    if (!task) {
        // Чужая задача: отвечает тот, у кого она есть. Снаружи запрос мог
        // прийти к любому воркеру, и это нормально.
        const owner = await ownerOf(taskId);
        if (owner) {
            return pipeFromOwner(req, res, `${owner}/api/v1/video/status/${taskId}`)
                .catch(() => res.status(502).json({ error: 'owner_unreachable' }));
        }
        return res.status(404).json({ error: 'Task not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable Nginx buffering


    task.sseResponse = res;

    // Defeat Vite/Nginx buffers with 2KB of empty padding in a comment
    res.write(`: ${'x'.repeat(2048)}\n\n`);

    // Send immediate current state
    const initialState = { 
        progress: task.progress, 
        message: task.message,
        downloadUrl: task.downloadUrl,
        status: task.status,
        error: task.errorMessage || null,
        worker: WORKER_ID || null
    };
    res.write(`data: ${JSON.stringify(initialState)}\n\n`);

    // Keep-alive ping to prevent proxy drops
    const pingInterval = setInterval(() => {
        if (task.status !== 'completed' && task.status !== 'error') {
            res.write(`: ping\n\n`);
        }
    }, 5000);

    // If task already finished, close connection after sending initial state
    if (task.status === 'completed' || task.status === 'error') {
        clearInterval(pingInterval);
        res.end();
        return;
    }

    // Handle client disconnect
    req.on('close', () => {
        clearInterval(pingInterval);
        task.sseResponse = null;
    });
});

async function cleanupTask(taskId) {
    const task = tasks.get(taskId);
    if (!task) return;
    try {
        // IMPORTANT: Never delete files from CACHE_DIR
        if (task.finalFilePath && task.finalFilePath.includes(TEMP_DIR) && fs.existsSync(task.finalFilePath)) {
            await fs.promises.unlink(task.finalFilePath);
        }
        if (task.otherFilePath && task.otherFilePath.includes(TEMP_DIR) && fs.existsSync(task.otherFilePath)) {
            await fs.promises.unlink(task.otherFilePath);
        }
        // Копия без подписи — такой же временный файл.
        if (task.cleanFilePath && task.cleanFilePath.includes(TEMP_DIR) && fs.existsSync(task.cleanFilePath)) {
            await fs.promises.unlink(task.cleanFilePath);
        }
    } catch(e) { console.error('Cleanup error:', e); }
    tasks.delete(taskId);
}


/**
 * Битрейт копии без подписи. Тот же, с которым пишет энкодер страницы
 * (`videoEncoder.configure` в `src/headless/inject-renderer.js`): копия должна
 * отличаться от оригинала ровно срезанной полосой, а не качеством.
 */
const CLEAN_COPY_BITRATE = '5M';
/**
 * Скорость пережима. `cpu-used 4` вместо умолчания libvpx (0) — вдвое быстрее
 * при той же картинке: замер на боксе, кусок 5.2 с, 6.8 → 4.7 с. Нулевое
 * умолчание здесь не ради качества, а по недосмотру: оно рассчитано на
 * архивное кодирование, а мы режем полосу у уже сжатого видео.
 */
const CLEAN_COPY_SPEED = ['-deadline', 'good', '-cpu-used', '4'];
/** Потоков на один ffmpeg. У VP8 их всё равно делят между token-партициями,
 *  выше восьми прироста нет. */
const CLEAN_COPY_THREADS = '8';
/**
 * На куски какой длины резать перед пережимом и сколько жать разом.
 *
 * Один ffmpeg упирается в несколько ядер и всё: у VP8 потоки делятся между
 * token-партициями. На боксе ядер 112, но Xeon 6238R медленный на поток
 * (2.2 ГГц), и пятиминутный кусок одним процессом жмётся минутами. Замер на
 * настоящем куске лекции (300.9 с, тот же бокс):
 *
 *   один ffmpeg               202 с
 *   сегментами параллельно     64 с
 *
 * Сегменты режутся БЕЗ перекодировки (`-c copy`) по ключевым кадрам — страница
 * ставит их раз в секунду, так что граница всегда есть, — жмутся параллельно и
 * склеиваются тоже без перекодировки; длительность на выходе совпала с
 * исходной (300.933 против 300.933 у цельного пережима).
 *
 * Потолок параллельности не про длину куска, а про то, чтобы не отобрать
 * машину у рендеров: 8 × 8 потоков это 64 ядра из 112.
 */
const CLEAN_COPY_SEGMENT_SECONDS = '40';
const CLEAN_COPY_PARALLEL = 8;

/** Запустить ffmpeg и дождаться. Наружу — последние строки stderr: без них
 *  «ffmpeg exited 1» не говорит ничего. */
function runFfmpeg(args) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
        // Пережим не должен отбирать процессор у рендеров: кадры им снимает
        // тот же CPU, и подвинуть их ради копии значило бы растянуть очередь.
        try { os.setPriority(proc.pid, 10); } catch { /* не дали — не страшно */ }
        let tail = '';
        proc.stderr.on('data', (chunk) => { tail = (tail + chunk).slice(-2000); });
        proc.on('error', reject);
        proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exited ${code}: ${tail.trim()}`));
        });
    });
}

/**
 * Копия этого же куска без подписи — та же картинка, у которой срезана верхняя
 * полоса субтитров.
 *
 * Зачем на сервере. Подпись вжигается в кадр, а в монтаж нужен тот же кусок
 * чистым. Отрендерить его заново — это ещё раз та же карта и те же минуты;
 * срезать полосу стоит одного пережима на CPU: замер на куске в 20 с — 3.1 с,
 * то есть пятиминутный отрезок режется примерно за 45 с, мимо очереди
 * рендеров и мимо GPU.
 *
 * Пережим честный: VP8 обрезать без него нельзя. Теряется одно поколение,
 * битрейт берём тот же, что у рендера.
 *
 * Считается ПО ТРЕБОВАНИЮ и один раз на задачу: пока копию не попросили, она
 * ничего не стоит, а два одновременных запроса ждут один и тот же пережим,
 * а не запускают два ffmpeg на один файл.
 */
function cleanCopy(task) {
    if (task.cleanCopyPromise) return task.cleanCopyPromise;
    const source = task.finalFilePath;
    const target = source.replace(/\.(webm|mp4)$/, '.clean.$1');
    const webm = source.endsWith('.webm');
    task.cleanCopyPromise = (async () => {
        if (!fs.existsSync(target)) {
            const started = Date.now();
            await cropOffSubtitles(source, target, webm);
            console.log(`[Clean] ${path.basename(target)} за ${((Date.now() - started) / 1000).toFixed(1)} с`);
        }
        task.cleanFilePath = target;
        return target;
    })().catch((err) => {
        // Следующая попытка начинается заново: половина файла на диске хуже,
        // чем его отсутствие.
        task.cleanCopyPromise = null;
        fs.promises.unlink(target).catch(() => {});
        throw err;
    });
    return task.cleanCopyPromise;
}

/** Аргументы одного пережима: срезать полосу и записать в target. */
function cropArgs(source, target, webm) {
    return [
        '-y', '-i', source,
        '-vf', `crop=iw:ih-${SUBTITLE_STRIP_HEIGHT}:0:${SUBTITLE_STRIP_HEIGHT}`,
        '-c:v', webm ? 'libvpx' : 'libx264',
        ...(webm ? ['-b:v', CLEAN_COPY_BITRATE] : ['-crf', '20']),
        ...CLEAN_COPY_SPEED,
        '-threads', CLEAN_COPY_THREADS,
        '-an', target,
    ];
}

/**
 * Срезать полосу субтитров — сегментами и параллельно.
 *
 * Нарезка и склейка идут БЕЗ перекодировки, пережимается только середина.
 * Если нарезка не удалась или сегмент вышел один (кусок короткий), жмём файл
 * целиком одним проходом: ради десяти секунд видео городить сегменты незачем,
 * а падать из-за них — тем более.
 */
async function cropOffSubtitles(source, target, webm) {
    const work = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clean-'));
    try {
        const ext = webm ? 'webm' : 'mp4';
        await runFfmpeg([
            '-y', '-i', source, '-c', 'copy', '-f', 'segment',
            '-segment_time', CLEAN_COPY_SEGMENT_SECONDS, '-reset_timestamps', '1',
            path.join(work, `seg%04d.${ext}`),
        ]);
        const segments = (await fs.promises.readdir(work))
            .filter((name) => name.startsWith('seg') && name.endsWith(`.${ext}`) && !name.includes('.out.'))
            .sort();
        if (segments.length < 2) {
            await runFfmpeg(cropArgs(source, target, webm));
            return;
        }
        const outputs = segments.map((name) => path.join(work, name.replace(`.${ext}`, `.out.${ext}`)));
        const queue = segments.map((name, i) => ({ from: path.join(work, name), to: outputs[i] }));
        const worker = async () => {
            for (;;) {
                const job = queue.shift();
                if (!job) return;
                await runFfmpeg(cropArgs(job.from, job.to, webm));
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(CLEAN_COPY_PARALLEL, segments.length) }, () => worker()),
        );
        const list = path.join(work, 'list.txt');
        await fs.promises.writeFile(list, outputs.map((out) => `file '${out}'`).join('\n'));
        await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', target]);
    } finally {
        await fs.promises.rm(work, { recursive: true, force: true }).catch(() => {});
    }
}

/**
 * Отмена задачи.
 *
 * До этого «остановить» на портале значило «перестать ждать»: клиент бросал
 * опрос, а карта продолжала считать кусок, который уже никому не нужен — до
 * конца рендера или до таймаута в двадцать минут. Теперь закрываем браузер
 * задачи: `evaluate` падает, рендер прекращается, слот семафора освобождается
 * и достаётся следующему в очереди.
 */
app.post('/api/v1/video/cancel/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks.get(taskId);

    if (task?.movedTo) {
        return pipeFromOwner(req, res, `${task.movedTo.base}/api/v1/video/cancel/${task.movedTo.taskId}`)
            .catch(() => res.status(502).json({ error: 'owner_unreachable' }));
    }
    if (!task) {
        const owner = await ownerOf(taskId);
        if (owner) {
            return pipeFromOwner(req, res, `${owner}/api/v1/video/cancel/${taskId}`)
                .catch(() => res.status(502).json({ error: 'owner_unreachable' }));
        }
        return res.status(404).json({ error: 'Task not found' });
    }
    if (task.status === 'completed') {
        return res.json({ status: 'already_done' });
    }

    task.cancelled = true;
    console.log(`[Server] Задача ${taskId} отменена`);
    if (task.browser) {
        try {
            await task.browser.close();
        } catch {
            /* уже закрыт */
        }
    }
    res.json({ status: 'ok' });
});

/**
 * v2: Final Download Endpoint 
 *
 * `?subtitles=0` — тот же кусок без подписи. У задачи без субтитров это просто
 * тот же файл: резать нечего, и отдать его молча честнее, чем 400 за лишний
 * параметр, — клиенту тогда не надо помнить, с подписью он рендерил или нет.
 */
app.get('/api/v1/video/download/:taskId', async (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks.get(taskId);
    // Запрос мог прийти к любому воркеру, а файл лежит у хозяина — запрос
    // уезжает к нему ВМЕСТЕ с параметрами, иначе сосед отдал бы подписанный.
    const query = req.originalUrl.includes('?') ? `?${req.originalUrl.split('?')[1]}` : '';

    if (task?.movedTo) {
        return pipeFromOwner(req, res, `${task.movedTo.base}/api/v1/video/download/${task.movedTo.taskId}${query}`)
            .catch(() => res.status(502).json({ error: 'owner_unreachable' }));
    }

    if (!task) {
        const owner = await ownerOf(taskId);
        if (owner) {
            return pipeFromOwner(req, res, `${owner}/api/v1/video/download/${taskId}${query}`)
                .catch(() => res.status(502).json({ error: 'owner_unreachable' }));
        }
    }

    if (!task || !task.finalFilePath) {
        return res.status(404).json({ error: 'File not ready or expired' });
    }

    const filename = `animation${path.extname(task.finalFilePath) || '.webm'}`;
    if (req.query.subtitles !== '0' || !task.subtitles) {
        return res.download(task.finalFilePath, filename);
    }

    try {
        const clean = await cleanCopy(task);
        res.download(clean, filename);
    } catch (err) {
        console.error(`[Clean] Срез подписи не вышел для ${taskId}:`, err.message);
        res.status(500).json({ error: 'clean_copy_failed' });
    }
});

/**
 * API Keys Admin Panel Routes
 */
app.get('/admin/keys', async (req, res) => {
    const keys = await getAllKeys();
    
    // Simple HTML UI for admin panel
    const html = `
    <!DOCTYPE html>
    <html lang="ru">
    <head>
        <meta charset="UTF-8">
        <title>Управление API Ключами</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f3f4f6; color: #1f2937; padding: 40px; }
            .container { max-width: 800px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
            h1 { margin-top: 0; color: #111827; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { text-align: left; padding: 12px; border-bottom: 1px solid #e5e7eb; }
            th { background: #f9fafb; font-weight: 600; }
            .badge { background: #e0e7ff; color: #4f46e5; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-family: monospace; }
            .btn { background: #4f46e5; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; text-decoration: none; display: inline-block; }
            .btn-danger { background: #ef4444; }
            .form-group { margin-bottom: 20px; display: flex; gap: 10px; }
            input[type="text"] { flex: 1; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>Управление API Ключами</h1>
            <p>Укажите домен сайта (например, <code>example.kz</code>). Для всех доменов используйте <code>*</code>.</p>
            
            <form id="createForm" class="form-group" onsubmit="createKey(event)">
                <input type="text" id="domain" placeholder="Домен (например: example.kz)" required>
                <button type="submit" class="btn">Сгенерировать ключ</button>
            </form>

            <table>
                <thead>
                    <tr>
                        <th>Домен (Origin/Referer)</th>
                        <th>API Ключ</th>
                        <th>Создан</th>
                        <th>Действия</th>
                    </tr>
                </thead>
                <tbody>
                    ${keys.map(k => `
                        <tr>
                            <td><strong>${k.domain}</strong></td>
                            <td><span class="badge">${k.apiKey}</span></td>
                            <td>${new Date(k.createdAt).toLocaleDateString()}</td>
                            <td><button onclick="deleteKey('${k.id}')" class="btn btn-danger">Удалить</button></td>
                        </tr>
                    `).join('')}
                    ${keys.length === 0 ? '<tr><td colspan="4" style="text-align:center; color:#6b7280;">Ключей пока нет</td></tr>' : ''}
                </tbody>
            </table>
        </div>

        <script>
            async function createKey(e) {
                e.preventDefault();
                const domain = document.getElementById('domain').value;
                try {
                    const res = await fetch('/admin/api/keys', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ domain })
                    });
                    if (res.ok) window.location.reload();
                    else {
                        const text = await res.text();
                        alert('Ошибка ' + res.status + ': ' + text);
                    }
                } catch (err) {
                    alert('Сетевая ошибка: ' + err.message);
                }
            }

            async function deleteKey(id) {
                if (!confirm('Точно удалить ключ? Виджет на этом домене перестанет работать.')) return;
                try {
                    const res = await fetch('/admin/api/keys/' + id, { method: 'DELETE' });
                    if (res.ok) window.location.reload();
                    else {
                        const text = await res.text();
                        alert('Ошибка ' + res.status + ': ' + text);
                    }
                } catch (err) {
                    alert('Сетевая ошибка: ' + err.message);
                }
            }
        </script>
    </body>
    </html>`;
    
    res.send(html);
});

app.post('/admin/api/keys', async (req, res) => {
    console.log('[Admin] POST /admin/api/keys called, body:', JSON.stringify(req.body));
    try {
        const key = await createKey(req.body.domain);
        console.log('[Admin] Key created successfully:', key.id, 'for domain:', key.domain);
        res.json(key);
    } catch (err) {
        console.error('[Admin] ERROR creating key:', err.message, err.stack);
        res.status(500).json({ error: 'Failed to create key: ' + err.message });
    }
});

app.delete('/admin/api/keys/:id', async (req, res) => {
    console.log('[Admin] DELETE /admin/api/keys/' + req.params.id);
    try {
        const success = await deleteKey(req.params.id);
        if (success) res.json({ success: true });
        else res.status(404).json({ error: 'Key not found' });
    } catch (err) {
        console.error('[Admin] ERROR deleting key:', err.message, err.stack);
        res.status(500).json({ error: 'Failed to delete key: ' + err.message });
    }
});

/**
 * Avatar mirror management.
 *
 * A sync never goes live on trust: the freshly downloaded build is vetted by a
 * real (tiny) render before it replaces the one production uses. A broken avatar
 * deploy therefore cannot break video generation — it just leaves the previous
 * mirror in place and reports the failure.
 */
const SMOKE_TEST_GLOSSES = process.env.AVATAR_SMOKE_GLOSSES || 'алақан';
let mirrorSyncInFlight = null;

async function smokeTestMirror(variant) {
    const started = Date.now();
    const result = await generateVideoCore(
        SMOKE_TEST_GLOSSES,
        undefined,
        'green',
        'avatar-mirror-smoke-test',
        null,
        { mirrorVariant: variant, mode: 'normal' },
    );

    const filePath = result.videoPath;
    const { size } = await fs.promises.stat(filePath);
    await fs.promises.unlink(filePath).catch(() => {});

    if (size < 1024) {
        throw new Error(`Smoke render produced only ${size} bytes`);
    }

    return { bytes: size, durationMs: Date.now() - started };
}

/**
 * Download the deployed avatar, smoke-test it, then promote it.
 * @param {object} [options]
 * @param {boolean} [options.force] - promote even when nothing changed
 * @param {boolean} [options.skipSmokeTest] - promote without rendering (manual override)
 */
async function refreshAvatarMirror({ force = false, skipSmokeTest = false } = {}) {
    if (mirrorSyncInFlight) return mirrorSyncInFlight;

    mirrorSyncInFlight = (async () => {
        const log = (msg) => console.log(`[AvatarMirror] ${msg}`);
        const manifest = await syncMirror({ onLog: log });

        if (!force && isMirrorReady('current') && candidateMatchesCurrent()) {
            log('Deployed avatar is unchanged — keeping the current mirror.');
            return { changed: false, promoted: false, manifest: readMirrorManifest('current') };
        }

        let smoke = null;
        if (!skipSmokeTest) {
            log('Smoke-testing the candidate mirror...');
            try {
                smoke = await smokeTestMirror('candidate');
                log(`Smoke test passed (${smoke.bytes} bytes in ${smoke.durationMs}ms).`);
            } catch (err) {
                log(`Smoke test FAILED: ${err.message}. Keeping the current mirror.`);
                return {
                    changed: true,
                    promoted: false,
                    error: err.message,
                    candidate: manifest,
                    manifest: readMirrorManifest('current'),
                };
            }
        }

        const promoted = promoteMirror();
        log(`Promoted new avatar build (synced ${promoted.syncedAt}).`);
        return { changed: true, promoted: true, smoke, manifest: promoted };
    })();

    try {
        return await mirrorSyncInFlight;
    } finally {
        mirrorSyncInFlight = null;
    }
}

/**
 * The admin surface manages API keys and can roll the avatar mirror back, so it
 * must not be reachable from the internet. Loopback is always allowed (SSH in,
 * or tunnel the port); anything else needs ADMIN_TOKEN. nginx no longer proxies
 * /admin/ at all, so this is defence in depth rather than the only lock.
 */
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function adminOnly(req, res, next) {
    const address = req.socket.remoteAddress || '';
    if (address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1') return next();

    if (ADMIN_TOKEN && req.headers['x-admin-token'] === ADMIN_TOKEN) return next();

    return res.status(403).json({
        error: ADMIN_TOKEN
            ? 'Forbidden: bad or missing X-Admin-Token'
            : 'Forbidden: admin is loopback-only. Set ADMIN_TOKEN to allow remote access.',
    });
}

app.use('/admin', adminOnly);

app.get('/admin/avatar/status', (req, res) => {
    res.json({ ...mirrorStatus(), syncInProgress: Boolean(mirrorSyncInFlight) });
});

app.post('/admin/avatar/sync', async (req, res) => {
    try {
        const result = await refreshAvatarMirror({
            force: req.body?.force === true,
            skipSmokeTest: req.body?.skipSmokeTest === true,
        });
        res.status(result.error ? 409 : 200).json(result);
    } catch (err) {
        console.error('[AvatarMirror] Sync failed:', err.message);
        res.status(502).json({ error: 'Avatar sync failed', detail: err.message });
    }
});

app.post('/admin/avatar/rollback', (req, res) => {
    try {
        res.json({ manifest: rollbackMirror() });
    } catch (err) {
        res.status(409).json({ error: err.message });
    }
});

/**
 * Chat Session Persistence API (Shared)
 */
async function getSessionsFromDisk() {
    try {
        const data = await fs.promises.readFile(SESSIONS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (e) {
        // Try backup if main file is corrupted
        const backupPath = SESSIONS_FILE + '.bak';
        try {
            const backupData = await fs.promises.readFile(backupPath, 'utf8');
            console.warn('[Storage] Main sessions.json corrupted, restored from backup');
            return JSON.parse(backupData);
        } catch (e2) {
            return [];
        }
    }
}

const MAX_SESSIONS = 1000;
const MAX_MESSAGES_PER_SESSION = 500;
const MAX_TITLE_LENGTH = 100;
const MAX_GLOSS_PREVIEW_LENGTH = 2000;
const MAX_GLOSS_TOKENS = 200;

function validateAndCapSessions(sessions) {
    if (!Array.isArray(sessions)) return [];
    const allowedGlossTokenKinds = new Set(['matched', 'dactyl', 'partial-dactyl', 'missing']);
    return sessions.slice(0, MAX_SESSIONS).map(s => {
        if (!s || typeof s !== 'object' || typeof s.id !== 'string') return null;
        return {
            id: s.id.slice(0, 60),
            title: (typeof s.title === 'string' ? s.title : '').slice(0, MAX_TITLE_LENGTH),
            messages: Array.isArray(s.messages)
                ? s.messages.slice(-MAX_MESSAGES_PER_SESSION).map(m => {
                    if (!m || typeof m !== 'object') return null;
                    return {
                        role: m.role === 'user' || m.role === 'assistant' ? m.role : 'user',
                        content: typeof m.content === 'string' ? m.content.slice(0, 2000) : undefined,
                        msgId: typeof m.msgId === 'string' ? m.msgId.slice(0, 60) : undefined,
                        glosses: typeof m.glosses === 'string' ? m.glosses.slice(0, 2000) : undefined,
                        glossPreview: typeof m.glossPreview === 'string' ? m.glossPreview.slice(0, MAX_GLOSS_PREVIEW_LENGTH) : undefined,
                        glossTokens: Array.isArray(m.glossTokens)
                            ? m.glossTokens.slice(0, MAX_GLOSS_TOKENS).map(t => {
                                if (!t || typeof t !== 'object') return null;
                                return {
                                    original: typeof t.original === 'string' ? t.original.slice(0, 100) : '',
                                    gloss: typeof t.gloss === 'string' ? t.gloss.slice(0, 100) : '',
                                    kind: typeof t.kind === 'string' && allowedGlossTokenKinds.has(t.kind) ? t.kind : undefined,
                                    matched: typeof t.matched === 'boolean' ? t.matched : false,
                                };
                            }).filter(Boolean)
                            : undefined,
                        videoUrl: typeof m.videoUrl === 'string' ? m.videoUrl.slice(0, 500) : undefined,
                        taskId: typeof m.taskId === 'string' ? m.taskId.slice(0, 60) : m.taskId === null ? null : undefined,
                        bgColor: typeof m.bgColor === 'string' ? m.bgColor.slice(0, 30) : undefined,
                        avatar: typeof m.avatar === 'string' ? m.avatar.slice(0, 50) : undefined,
                        mode: typeof m.mode === 'string' ? m.mode.slice(0, 20) : undefined,
                        error: typeof m.error === 'string' ? m.error.slice(0, 500) : undefined,
                        timestamp: typeof m.timestamp === 'number' ? m.timestamp : undefined,
                    };
                }).filter(Boolean)
                : []
        };
    }).filter(Boolean);
}

async function atomicWriteFile(filePath, data) {
    const tmpPath = filePath + '.tmp';
    const backupPath = filePath + '.bak';
    await fs.promises.writeFile(tmpPath, data);
    // Create backup of current file
    try { await fs.promises.copyFile(filePath, backupPath); } catch(e) { /* first write, no backup needed */ }
    // Use copyFile + unlink instead of rename — rename fails on Docker bind mounts (EBUSY)
    try {
        await fs.promises.rename(tmpPath, filePath);
    } catch(renameErr) {
        if (renameErr.code === 'EBUSY' || renameErr.code === 'EXDEV') {
            await fs.promises.copyFile(tmpPath, filePath);
            await fs.promises.unlink(tmpPath).catch(() => {});
        } else {
            throw renameErr;
        }
    }
}

let _writeQueue = Promise.resolve();
async function safeWriteSessions(incomingSessions) {
    _writeQueue = _writeQueue.then(async () => {
        // Validate and cap incoming data
        const validated = validateAndCapSessions(incomingSessions);
        
        // Merge: preserve videoUrl set by background tasks that client may not know about
        try {
            const diskData = await fs.promises.readFile(SESSIONS_FILE, 'utf8');
            const diskSessions = JSON.parse(diskData);
            for (const diskSession of diskSessions) {
                const incoming = validated.find(s => s.id === diskSession.id);
                if (incoming) {
                    for (const diskMsg of (diskSession.messages || [])) {
                        if (diskMsg.videoUrl && diskMsg.msgId) {
                            const incomingMsg = incoming.messages.find(m => m.msgId === diskMsg.msgId);
                            if (incomingMsg && !incomingMsg.videoUrl) {
                                incomingMsg.videoUrl = diskMsg.videoUrl;
                                incomingMsg.timestamp = diskMsg.timestamp;
                                incomingMsg.taskId = null;
                            }
                        }
                    }
                }
            }
        } catch(e) {
            console.warn('[Storage] Merge skipped (disk read failed):', e.message);
        }
        await atomicWriteFile(SESSIONS_FILE, JSON.stringify(validated, null, 2));
    }).catch(e => console.error('[Storage] Write error:', e));
    return _writeQueue;
}

// Atomic update for tasks
async function updateSessionTaskResult(sessionId, msgId, videoUrl) {
    _writeQueue = _writeQueue.then(async () => {
        const data = await fs.promises.readFile(SESSIONS_FILE, 'utf8');
        const sessions = data ? JSON.parse(data) : [];
        
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            const msg = session.messages.find(m => m.msgId === msgId);
            if (msg) {
                msg.videoUrl = videoUrl;
                msg.timestamp = Date.now();
                msg.taskId = null;
                await atomicWriteFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
                console.log(`[Storage] Auto-updated message ${msgId} with video result.`);
            }
        }
    }).catch(e => console.error('[Storage] Auto-update error:', e));
    return _writeQueue;
}


app.get('/api/v1/sessions', async (req, res) => {
    const sessions = await getSessionsFromDisk();
    res.json(sessions);
});

app.post('/api/v1/sessions', async (req, res) => {
    try {
        const sessions = req.body;
        if (!Array.isArray(sessions)) {
            return res.status(400).json({ error: 'Data must be an array' });
        }
        await safeWriteSessions(sessions);
        res.json({ status: 'ok' });
    } catch (e) {
        console.error('[Server] Error saving sessions:', e);
        res.status(500).json({ error: e.message });
    }
});


// Periodic cleanup: keep TEMP_DIR under the cap (LRU)
//
// Было 500 МБ — меньше, чем одна лекция: кусок на 5 минут весит ~150 МБ, а их
// бывает четырнадцать, и файл третьего куска исчезал раньше, чем оператор
// доходил до него за копией без подписи. Задачу всё равно сносит свой час, так
// что потолок тут — про диск, а не про срок; на боксе его 300 ГБ.
const MAX_TEMP_SIZE = 20 * 1024 * 1024 * 1024; // 20 GB
setInterval(async () => {
    try {
        const files = await fs.promises.readdir(TEMP_DIR);
        if (files.length === 0) return;
        const fileStats = await Promise.all(
            files.map(async (file) => {
                const filePath = path.join(TEMP_DIR, file);
                try {
                    const stats = await fs.promises.stat(filePath);
                    return { path: filePath, name: file, size: stats.size, mtime: stats.mtime };
                } catch(e) { return null; }
            })
        );
        const valid = fileStats.filter(Boolean);
        valid.sort((a, b) => a.mtime - b.mtime); // oldest first
        let totalSize = valid.reduce((sum, f) => sum + f.size, 0);
        for (const file of valid) {
            if (totalSize <= MAX_TEMP_SIZE) break;
            try {
                await fs.promises.unlink(file.path);
                totalSize -= file.size;
                console.log(`[Cleanup] Deleted ${file.name} (LRU). Remaining: ${Math.round(totalSize/1024/1024)}MB`);
            } catch(e) {}
        }
    } catch(e) { console.error('[Cleanup] Error:', e); }
}, 600000); // Every 10 minutes

/**
 * Keep the mirrored avatar fresh.
 *
 * On boot we only sync when there is nothing to render with, so a restart never
 * blocks on the product server. Periodic refreshes are opt-in via
 * AVATAR_SYNC_INTERVAL_MS; both paths go through the smoke test.
 */
async function bootstrapAvatarMirror() {
    if (!isMirrorReady('current')) {
        console.log('[AvatarMirror] No mirror yet — fetching the deployed avatar...');
        try {
            await refreshAvatarMirror({ force: true });
        } catch (err) {
            console.error(`[AvatarMirror] Initial sync failed: ${err.message}`);
            console.error('[AvatarMirror] Video generation stays unavailable until a sync succeeds.');
        }
    } else {
        const manifest = readMirrorManifest('current');
        console.log(`[AvatarMirror] Serving mirror synced at ${manifest?.syncedAt || 'unknown time'} from ${AVATAR_URL}`);
    }

    const intervalMs = Number.parseInt(process.env.AVATAR_SYNC_INTERVAL_MS, 10);
    if (Number.isFinite(intervalMs) && intervalMs >= 60000) {
        console.log(`[AvatarMirror] Auto-sync every ${Math.round(intervalMs / 60000)} min`);
        setInterval(() => {
            refreshAvatarMirror().catch(err =>
                console.error(`[AvatarMirror] Scheduled sync failed: ${err.message}`));
        }, intervalMs);
    }
}

app.listen(port, '0.0.0.0', () => {
    console.log(`[Server] Video Renderer API listening at http://0.0.0.0:${port}`);
    console.log(`[Server] Avatar source: ${AVATAR_URL} (mirrored locally, never rendered on)`);
    if (!AVATAR_API_KEY) {
        console.error('[Server] ⚠️  AVATAR_API_KEY is empty — every gesture lookup will return 401 and');
        console.error('[Server]     videos will come out with moving lips and no signing. Set it in .env.');
    }
    bootstrapAvatarMirror();
});
