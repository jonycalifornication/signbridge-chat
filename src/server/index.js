import express from 'express';
import cors from 'cors';
import puppeteer from 'puppeteer';
import { exec } from 'child_process';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const execPromise = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

// Temporary directory for videos
const TEMP_DIR = path.join(__dirname, '../../temp_videos');
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Task Store for v2 API
const tasks = new Map();

/**
 * Core Video Generation Logic
 */
async function generateVideoCore(glosses, avatar, background, userAgent, onProgress = null) {
    let browser;
    try {
        if(onProgress) onProgress(5, 'Прогреваем видеопроцессоры...');
        
        const appUrl = process.env.APP_URL || 'http://localhost:5173';
        
        browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--allow-running-insecure-content',
                '--enable-webgl',
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
        
        const dataUrl = await page.evaluate(async (config) => {
            return await window.startHeadlessRender(config);
        }, { glosses, avatar, background });

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
app.post('/api/v1/video/generate', async (req, res) => {
    const { glosses, avatar, background } = req.body;

    if (!glosses || (!Array.isArray(glosses) && typeof glosses !== 'string')) {
        return res.status(400).json({ error: 'glosses missing' });
    }

    console.log(`[Server v1] Received render request`);
    const userAgent = req.headers['user-agent'] || '';

    try {
        const result = await generateVideoCore(glosses, avatar, background, userAgent, null);
        const sendPath = result.sendWebM ? result.webmPath : result.mp4Path;
        const filename = result.sendWebM ? 'animation.webm' : 'animation.mp4';

        res.download(sendPath, filename, async (err) => {
            try {
                if (fs.existsSync(result.webmPath)) await fs.promises.unlink(result.webmPath);
                if (fs.existsSync(result.mp4Path)) await fs.promises.unlink(result.mp4Path);
            } catch (cleanupErr) {
                console.error('[Server v1] Cleanup error:', cleanupErr);
            }
        });
    } catch (error) {
        console.error('[Server v1] Render error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * v2: Asynchronous Task Creation
 */
app.post('/api/v1/video/generate-async', (req, res) => {
    const { glosses, avatar, background } = req.body;
    
    if (!glosses) {
        return res.status(400).json({ error: 'glosses missing' });
    }

    const taskId = crypto.randomUUID();
    const userAgent = req.headers['user-agent'] || '';

    // Initialize task
    tasks.set(taskId, {
        status: 'processing',
        progress: 0,
        message: 'Задача создана...',
        downloadUrl: null,
        sseResponse: null
    });

    res.json({ taskId, status: 'queued' });

    // Background processing
    (async () => {
        const task = tasks.get(taskId);
        
        const onProgress = (pct, msg) => {
            task.progress = pct;
            task.message = msg;
            if (task.sseResponse) {
                task.sseResponse.write(`data: ${JSON.stringify({ progress: pct, message: msg })}\n\n`);
            }
        };

        try {
            const result = await generateVideoCore(glosses, avatar, background, userAgent, onProgress);
            task.finalFilePath = result.sendWebM ? result.webmPath : result.mp4Path;
            task.otherFilePath = result.sendWebM ? result.mp4Path : result.webmPath;
            task.downloadUrl = `/api/v1/video/download/${taskId}`;
            task.status = 'completed';
            
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
            if (task.sseResponse) {
                task.sseResponse.write(`data: ${JSON.stringify({ error: err.message, progress: 0 })}\n\n`);
                task.sseResponse.end();
            }
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

    task.sseResponse = res;

    // Send immediate current state
    res.write(`data: ${JSON.stringify({ progress: task.progress, message: task.message })}\n\n`);

    // Handle client disconnect
    req.on('close', () => {
        task.sseResponse = null;
    });
});

function cleanupTask(taskId) {
    const task = tasks.get(taskId);
    if (!task) return;
    try {
        if (task.finalFilePath && fs.existsSync(task.finalFilePath)) fs.promises.unlink(task.finalFilePath);
        if (task.otherFilePath && fs.existsSync(task.otherFilePath)) fs.promises.unlink(task.otherFilePath);
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
    
    // We do NOT call cleanupTask here. 
    // The <video> element often makes multiple HTTP Range requests.
    // If we delete the file on the first request, playback breaks and subsequent downloads 404.
    // The task will be cleaned up automatically by the 1-hour setTimeout.
    res.download(task.finalFilePath, filename);
});

app.listen(port, '0.0.0.0', () => {
    console.log(`[Server] Video Renderer API listening at http://0.0.0.0:${port}`);
});
