/**
 * Avatar mirror.
 *
 * The avatar itself is owned by the signBridge-avatar project and lives on a
 * GPU-less product server that also serves the paying customers' embeds. We
 * must never render video there, and we must not fork its code either.
 *
 * So we keep a byte-for-byte copy of its *built* artifacts on this (GPU) box
 * and render from the copy:
 *
 *   1. `syncMirror()`   downloads the deployed build into `candidate/`
 *   2. a smoke render   is executed against `candidate/`
 *   3. `promoteMirror()` atomically swaps `candidate/` → `current/`
 *
 * Result: renders never touch the product server, a broken avatar deploy can
 * never reach production video generation, and `rollbackMirror()` puts the
 * previous build back instantly.
 *
 * Nothing here modifies the avatar — we only copy what its nginx already
 * serves publicly.
 *
 * @module server/avatar-mirror
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Root of the mirror tree (git-ignored, mounted as a docker volume). */
export const MIRROR_ROOT = path.join(__dirname, '../../avatar_mirror');

/** The page we drive with puppeteer — the avatar's own embed entry point. */
export const MIRROR_ENTRY = 'embed.html';

const MANIFEST_NAME = 'mirror.json';
const VARIANTS = ['current', 'candidate', 'previous'];

/** Where the avatar build is published. Only read during a sync, never per render. */
export const AVATAR_URL = (process.env.AVATAR_URL || 'https://widget.signbridge.kz').replace(/\/+$/, '');

/**
 * Root-relative files that are always fetched, on top of whatever `embed.html`
 * references. `widget.css` is loaded by the widget at runtime rather than from
 * a `<link>` tag, so tag scraping alone would miss it.
 */
const EXTRA_FILES = ['widget.css'];

/** @param {'current'|'candidate'|'previous'} variant */
export function mirrorDir(variant = 'current') {
    if (!VARIANTS.includes(variant)) {
        throw new Error(`Unknown mirror variant: ${variant}`);
    }
    return path.join(MIRROR_ROOT, variant);
}

/** True when the variant holds a usable copy of the avatar. */
export function isMirrorReady(variant = 'current') {
    try {
        return fs.existsSync(path.join(mirrorDir(variant), MIRROR_ENTRY));
    } catch {
        return false;
    }
}

/** @returns {object|null} manifest written by the last successful sync */
export function readMirrorManifest(variant = 'current') {
    try {
        const raw = fs.readFileSync(path.join(mirrorDir(variant), MANIFEST_NAME), 'utf8');
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/**
 * Absolute URL of the mirrored entry page as puppeteer should open it.
 * @param {string} selfUrl - this server's own base URL (e.g. http://localhost:3003)
 */
export function mirrorEntryUrl(selfUrl, variant = 'current') {
    return `${selfUrl.replace(/\/+$/, '')}/avatar/${variant}/${MIRROR_ENTRY}`;
}

// ── Reference discovery ───────────────────────────────────────────────

/**
 * Root-absolute `src="/…"` / `href="/…"` references in the built HTML.
 * The deployed embed.html points at `/assets/<hash>.js` and `/widget.js`.
 */
function extractHtmlRefs(html) {
    const refs = new Set();
    const attrRe = /(?:src|href)\s*=\s*["'](\/[^"']+\.(?:js|css|mjs))["']/gi;
    let match;
    while ((match = attrRe.exec(html)) !== null) {
        refs.add(match[1].replace(/^\/+/, ''));
    }
    return [...refs];
}

/**
 * Relative chunk imports inside a built ES module, e.g.
 *   import{x}from"./assets/config-B3kOplvZ.js"
 *   import("./assets/api-client-BkIuhFZs.js")
 * Vite emits these with content-hashed names, so they can only be discovered
 * by reading the code — there is no manifest on the public server.
 */
function extractJsRefs(code, fromRelPath) {
    const baseDir = path.posix.dirname(fromRelPath);
    const refs = new Set();
    const patterns = [
        /(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+\.(?:js|mjs))["']/g,
        /import\s*\(\s*["'](\.\.?\/[^"']+\.(?:js|mjs))["']\s*\)/g,
    ];

    for (const re of patterns) {
        let match;
        while ((match = re.exec(code)) !== null) {
            const resolved = path.posix.normalize(path.posix.join(baseDir, match[1]));
            if (!resolved.startsWith('..')) refs.add(resolved);
        }
    }
    return [...refs];
}

/** Reject anything that would escape the mirror directory. */
function assertSafeRelPath(relPath) {
    const normalized = path.posix.normalize(relPath);
    if (normalized.startsWith('..') || path.posix.isAbsolute(normalized)) {
        throw new Error(`Refusing unsafe mirror path: ${relPath}`);
    }
    return normalized;
}

// ── Sync ──────────────────────────────────────────────────────────────

async function fetchBuffer(url, timeoutMs = 30000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { signal: controller.signal, redirect: 'follow' });
        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }
        return {
            buffer: Buffer.from(await response.arrayBuffer()),
            contentType: response.headers.get('content-type') || '',
            etag: response.headers.get('etag') || null,
            lastModified: response.headers.get('last-modified') || null,
        };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * The avatar's `embed.html` references its assets root-absolutely (`/assets/…`).
 * We serve the mirror under `/avatar/<variant>/`, so those must become relative
 * or they would resolve against this server's root. `widget.js` already imports
 * its chunks relatively, so rewriting the HTML is enough.
 */
function rewriteHtmlToRelative(html) {
    return html.replace(
        /((?:src|href)\s*=\s*["'])\/(?!\/)/gi,
        '$1',
    );
}

/**
 * Download the currently deployed avatar build into `candidate/`.
 *
 * @param {object} [options]
 * @param {string} [options.avatarUrl] - defaults to AVATAR_URL
 * @param {(msg: string) => void} [options.onLog]
 * @returns {Promise<object>} the manifest that was written
 */
export async function syncMirror({ avatarUrl = AVATAR_URL, onLog = () => {} } = {}) {
    const source = avatarUrl.replace(/\/+$/, '');
    const target = mirrorDir('candidate');

    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });

    onLog(`Fetching ${source}/${MIRROR_ENTRY}`);
    const entry = await fetchBuffer(`${source}/${MIRROR_ENTRY}`);
    const entryHtml = entry.buffer.toString('utf8');

    if (!/id=["']avatar-widget-container["']/.test(entryHtml)) {
        throw new Error(
            `${source}/${MIRROR_ENTRY} does not look like the avatar embed page ` +
            '(no #avatar-widget-container). Refusing to mirror it.',
        );
    }

    fs.writeFileSync(path.join(target, MIRROR_ENTRY), rewriteHtmlToRelative(entryHtml), 'utf8');

    // Breadth-first crawl: HTML tags first, then transitive chunk imports.
    const queue = [...extractHtmlRefs(entryHtml), ...EXTRA_FILES];
    const done = new Set();
    const files = [{ path: MIRROR_ENTRY, bytes: entry.buffer.length, etag: entry.etag }];

    while (queue.length > 0) {
        const relPath = assertSafeRelPath(queue.shift());
        if (done.has(relPath)) continue;
        done.add(relPath);

        let asset;
        try {
            asset = await fetchBuffer(`${source}/${relPath}`);
        } catch (err) {
            // widget.css and friends are best-effort: a 404 must not abort a sync.
            if (EXTRA_FILES.includes(relPath)) {
                onLog(`Optional file missing, skipped: ${relPath} (${err.message})`);
                continue;
            }
            throw new Error(`Failed to mirror ${relPath}: ${err.message}`);
        }

        // An SPA fallback answers 200 with HTML for missing files — that would
        // silently poison the mirror with the dashboard page.
        if (/\.(js|mjs)$/.test(relPath) && /^\s*<!DOCTYPE html/i.test(asset.buffer.toString('utf8', 0, 64))) {
            throw new Error(`${relPath} returned an HTML page instead of JavaScript (SPA fallback?)`);
        }

        const destPath = path.join(target, relPath);
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.writeFileSync(destPath, asset.buffer);
        files.push({ path: relPath, bytes: asset.buffer.length, etag: asset.etag });

        if (/\.(js|mjs)$/.test(relPath)) {
            for (const ref of extractJsRefs(asset.buffer.toString('utf8'), relPath)) {
                if (!done.has(ref)) queue.push(ref);
            }
        }
    }

    const manifest = {
        source,
        entry: MIRROR_ENTRY,
        syncedAt: new Date().toISOString(),
        entryLastModified: entry.lastModified,
        fileCount: files.length,
        totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
        files: files.sort((a, b) => a.path.localeCompare(b.path)),
    };

    fs.writeFileSync(path.join(target, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf8');
    onLog(`Mirrored ${manifest.fileCount} files (${Math.round(manifest.totalBytes / 1024)} KB)`);

    return manifest;
}

/**
 * True when `candidate/` is byte-identical to `current/`, i.e. the avatar has
 * not been redeployed since the last promotion. Lets a scheduled sync skip the
 * smoke render entirely.
 */
export function candidateMatchesCurrent() {
    const current = readMirrorManifest('current');
    const candidate = readMirrorManifest('candidate');
    if (!current || !candidate) return false;
    if (current.fileCount !== candidate.fileCount) return false;

    const key = (m) => m.files.map(f => `${f.path}:${f.bytes}:${f.etag || ''}`).join('|');
    return key(current) === key(candidate);
}

/** Atomically make `candidate/` the live mirror, keeping the old one for rollback. */
export function promoteMirror() {
    const current = mirrorDir('current');
    const candidate = mirrorDir('candidate');
    const previous = mirrorDir('previous');

    if (!isMirrorReady('candidate')) {
        throw new Error('No candidate mirror to promote');
    }

    fs.rmSync(previous, { recursive: true, force: true });
    if (fs.existsSync(current)) {
        fs.renameSync(current, previous);
    }
    fs.renameSync(candidate, current);

    return readMirrorManifest('current');
}

/** Put the previous build back as the live mirror. */
export function rollbackMirror() {
    const current = mirrorDir('current');
    const previous = mirrorDir('previous');

    if (!isMirrorReady('previous')) {
        throw new Error('No previous mirror to roll back to');
    }

    const scratch = path.join(MIRROR_ROOT, `.rollback-${process.pid}`);
    fs.rmSync(scratch, { recursive: true, force: true });

    if (fs.existsSync(current)) fs.renameSync(current, scratch);
    fs.renameSync(previous, current);
    if (fs.existsSync(scratch)) fs.renameSync(scratch, previous);

    return readMirrorManifest('current');
}

/** Everything the admin panel needs to show the mirror's state. */
export function mirrorStatus() {
    return {
        source: AVATAR_URL,
        root: MIRROR_ROOT,
        variants: VARIANTS.reduce((acc, variant) => {
            acc[variant] = {
                ready: isMirrorReady(variant),
                manifest: readMirrorManifest(variant),
            };
            return acc;
        }, {}),
    };
}
