import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import {
    buildRenderPlan,
    estimateFallbackTimeoutMs,
    estimateRenderTimeoutMs,
    renderPlanToGlossPreview
} from '../headless/render-plan.js';
import { loadDictionaryFromText } from '../utils/gloss-dictionary.js';
import { validateRequest, getAllKeys, createKey, deleteKey } from './api-keys.js';

const execPromise = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3003;

app.use(cors());
app.use(express.json({ limit: '100kb' }));

// Temporary directory for videos
const TEMP_DIR = path.join(__dirname, '../../temp_videos');
const CACHE_DIR = path.join(__dirname, '../../video_cache');
const SESSIONS_FILE = path.join(__dirname, '../../sessions.json');

[TEMP_DIR, CACHE_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

app.use('/api/v1/video/cache', express.static(CACHE_DIR));

if (!fs.existsSync(SESSIONS_FILE)) {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
}

const tasks = new Map();

// Pre-load dictionaries from filesystem for server-side glossing
try {
    const EMERCOM_DIR = path.join(__dirname, '../../emercom');
    const kkCsv = fs.readFileSync(path.join(EMERCOM_DIR, 'kazakh.csv'), 'utf8');
    const ruCsv = fs.readFileSync(path.join(EMERCOM_DIR, 'russian.csv'), 'utf8');
    
    loadDictionaryFromText('kk', kkCsv);
    loadDictionaryFromText('ru', ruCsv);
    console.log('[Server] CSV Dictionaries pre-loaded successfully');
} catch (dictErr) {
    console.error('[Server] Failed to pre-load CSV dictionaries:', dictErr.message);
}


const MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * Hash helper for caching
 */
function getCacheKey(config) {
    const str = JSON.stringify({
        glosses: config.glosses,
        avatar: config.avatar || 'Aibek',
        background: config.background || 'white',
        mode: config.mode || 'normal'
    });
    return crypto.createHash('md5').update(str).digest('hex');
}

function resolveRenderPlanApiConfig(appUrl) {
    const rawApiUrl = process.env.RENDER_PLAN_API_URL || process.env.API_URL || process.env.VITE_API_URL || `${appUrl}/api/v1`;
    const apiUrl = rawApiUrl.startsWith('/')
        ? `${appUrl.replace(/\/+$/, '')}${rawApiUrl}`
        : rawApiUrl;

    return {
        apiUrl,
        apiKey: process.env.RENDER_PLAN_API_KEY || process.env.API_KEY || process.env.VITE_API_KEY || '',
        languageId: process.env.RENDER_PLAN_LANGUAGE_ID || process.env.VITE_LANGUAGE_ID || 'kz_KSL',
        fetchTimeoutMs: Number(process.env.RENDER_PLAN_FETCH_TIMEOUT_MS) || 10000,
    };
}

function hasRendererGPU() {
    return fs.existsSync('/dev/nvidia0');
}

function resolveEncoderMaxQueueSize(hasGPU) {
    const fallback = hasGPU ? 256 : 30;
    const rawValue = process.env.RENDER_ENCODER_MAX_QUEUE_SIZE || process.env.ENCODER_MAX_QUEUE_SIZE;
    const parsed = Number.parseInt(rawValue, 10);

    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(1, Math.min(parsed, 256));
}

async function prepareRenderPlan(glosses, appUrl, hasGPU, onProgress = null, mode = 'normal') {
    const renderText = Array.isArray(glosses) ? glosses.join(' ') : String(glosses || '');
    let renderPlan = null;
    let renderTimeoutMs = estimateFallbackTimeoutMs(renderText, { hasGPU });

    try {
        if (onProgress) onProgress(8, 'Строим план жестов...');
        const planOptions = { ...resolveRenderPlanApiConfig(appUrl), mode };
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

const renderSemaphore = new Semaphore(2);

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

/**
 * Core Video Generation Logic
 */
async function generateVideoCore(glosses, avatar, background, userAgent, onProgress = null, planning = {}) {
    let browser;
    try {
        if(onProgress) onProgress(5, 'Прогреваем видеопроцессоры...');
        
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        
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
            : await prepareRenderPlan(glosses, appUrl, hasGPU, onProgress, planning.mode || 'normal');
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
                `--unsafely-treat-insecure-origin-as-secure=${appUrl}`
            ],
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null
        });

        const page = await browser.newPage();
        
        if (onProgress) {
            await page.exposeFunction('reportProgress', (percent, msg) => {
                onProgress(percent, msg);
            });
        }
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');
        
        await page.setViewport({ width: 768, height: 1024 });

        page.on('console', msg => console.log(`[Browser Console] ${msg.type().toUpperCase()}: ${msg.text()}`));
        page.on('pageerror', err => console.error(`[Browser Error] ${err.message}`));
        page.on('requestfailed', request => {
            console.log(`[Browser Blocked] ${request.failure()?.errorText || 'Failed'}: ${request.method()} ${request.url()}`);
        });

        const rendererUrl = `${appUrl}/headless-renderer.html`;

        console.log(`[Server] Navigating to renderer: ${rendererUrl}`);
        if(onProgress) onProgress(10, 'Материализуем 3D-аватар из матрицы 🕶');
        await page.goto(rendererUrl, { waitUntil: 'networkidle0', timeout: 30000 });

        console.log(`[Server] Waiting for window.rendererLoaded...`);
        await page.waitForFunction(() => window.rendererLoaded === true, { timeout: 30000 });

        if(onProgress) onProgress(20, 'Анализируем текст и подбираем жесты 🧠');
        console.log(`[Server] Starting recording...`);
        
        let renderTimer;
        let dataUrl;
        try {
            dataUrl = await Promise.race([
                page.evaluate(async (config) => {
                    return await window.startHeadlessRender(config);
                }, { glosses, avatar, background, renderPlan, renderProfile: { hasGPU, encoderMaxQueueSize } }),
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

        const requestId = Date.now() + Math.floor(Math.random() * 1000);
        const webmPath = path.join(TEMP_DIR, `render_${requestId}.webm`);
        const mp4Path = path.join(TEMP_DIR, `render_${requestId}.mp4`);

        await fs.promises.writeFile(webmPath, buffer);

        console.log(`[Server] Using raw WebM output (skipping FFmpeg conversion).`);
        return { webmPath, mp4Path: null, sendWebM: true };

    } finally {
        if (browser) await browser.close();
    }
}

/**
 * v1: Synchronous Backend Endpoint (Retro-compatibility)
 */
app.post('/api/v1/video/generate', rateLimit, apiKeyAuth, async (req, res) => {
    const { glosses, avatar, background, mode } = req.body;

    if (!glosses || (!Array.isArray(glosses) && typeof glosses !== 'string')) {
        return res.status(400).json({ error: 'glosses missing' });
    }

    console.log(`[Server v1] Received render request`);
    const userAgent = req.headers['user-agent'] || '';

    let acquired = false;
    try {
        const cacheKey = getCacheKey({ glosses, avatar, background, mode });
        const cachePath = path.join(CACHE_DIR, `${cacheKey}.webm`);
        
        if (fs.existsSync(cachePath)) {
            console.log(`[Cache v1] Hit for key: ${cacheKey}`);
            return res.download(cachePath, 'animation.webm');
        }

        await renderSemaphore.acquire();
        acquired = true;
        const result = await generateVideoCore(glosses, avatar, background, userAgent, null, { mode });
        const sendPath = result.sendWebM ? result.webmPath : result.mp4Path;
        const filename = result.sendWebM ? 'animation.webm' : 'animation.mp4';

        // Save to cache after successful v1 render too
        await fs.promises.copyFile(result.webmPath, cachePath).catch(() => {});
        await pruneCache();

        res.download(sendPath, filename, async (err) => {
            try {
                if (result.webmPath && fs.existsSync(result.webmPath)) await fs.promises.unlink(result.webmPath);
                if (result.mp4Path && fs.existsSync(result.mp4Path)) await fs.promises.unlink(result.mp4Path);
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

    if (!glosses || (!Array.isArray(glosses) && typeof glosses !== 'string')) {
        return res.status(400).json({ error: 'glosses missing or invalid' });
    }

    try {
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        const planOptions = { ...resolveRenderPlanApiConfig(appUrl), mode: mode || 'normal' };
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
app.post('/api/v1/video/generate-async', rateLimit, apiKeyAuth, async (req, res) => {
    const { glosses, avatar, background, mode, sessionId, msgId } = req.body;

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

    const taskId = crypto.randomUUID();
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

    const appUrl = process.env.APP_URL || 'http://localhost:5173';
    const hasGPU = hasRendererGPU();
    const { renderPlan, renderTimeoutMs } = await prepareRenderPlan(glosses, appUrl, hasGPU, null, mode);
    const renderPreview = renderPlan ? renderPlanToGlossPreview(renderPlan) : null;

    // Initialize task
    tasks.set(taskId, {
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


    res.json({ taskId, status: 'queued', ...(renderPreview || {}) });

    // Background processing
    (async () => {
        const task = tasks.get(taskId);
        let acquired = false;
        
        const onProgress = (pct, msg) => {
            task.progress = pct;
            task.message = msg;
            if (task.sseResponse) {
                task.sseResponse.write(`data: ${JSON.stringify({ progress: pct, message: msg })}\n\n`);
            }
        };

        try {
            // --- Caching Layer ---
            const cacheKey = getCacheKey({ glosses, avatar, background, mode });
            const cachePath = path.join(CACHE_DIR, `${cacheKey}.webm`);
            
            if (fs.existsSync(cachePath)) {
                console.log(`[Cache] Hit for key: ${cacheKey}`);
                task.finalFilePath = cachePath;
                task.downloadUrl = `/api/v1/video/cache/${cacheKey}.webm`;
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
            await renderSemaphore.acquire((pos) => {
                onProgress(0, `Ждем очереди (вы #${pos} в списке)...`);
            });
            acquired = true;

            const result = await generateVideoCore(glosses, avatar, background, userAgent, onProgress, {
                renderPlan: task.renderPlan,
                renderTimeoutMs: task.renderTimeoutMs,
                mode: mode
            });
            
            // Save to Cache for next time
            try {
                await fs.promises.copyFile(result.webmPath, cachePath);
                console.log(`[Cache] Saved new entry: ${cacheKey}`);
                await pruneCache();
            } catch (cacheErr) {
                console.error('[Cache] Save error:', cacheErr);
            }


            task.finalFilePath = result.sendWebM ? result.webmPath : result.mp4Path;
            task.otherFilePath = result.sendWebM ? result.mp4Path : result.webmPath;
            task.downloadUrl = `/api/v1/video/cache/${cacheKey}.webm`;
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
            task.errorMessage = err.message;
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
app.get('/api/v1/video/status/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks.get(taskId);

    if (!task) {
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
        error: task.errorMessage || null
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
    } catch(e) { console.error('Cleanup error:', e); }
    tasks.delete(taskId);
}


/**
 * v2: Final Download Endpoint 
 */
app.get('/api/v1/video/download/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const task = tasks.get(taskId);

    if (!task || !task.finalFilePath) {
        return res.status(404).json({ error: 'File not ready or expired' });
    }

    const filename = task.finalFilePath.endsWith('.webm') ? 'animation.webm' : 'animation.mp4';
    res.download(task.finalFilePath, filename);
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


// Periodic cleanup: keep TEMP_DIR under 500MB (LRU)
const MAX_TEMP_SIZE = 500 * 1024 * 1024; // 500 MB
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

app.listen(port, '0.0.0.0', () => {
    console.log(`[Server] Video Renderer API listening at http://0.0.0.0:${port}`);
});
