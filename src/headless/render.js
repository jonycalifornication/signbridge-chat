import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Headless Render CLI
 * Usage: node render.js --glosses="alaqan hello" --output="output.webm" --avatar="Aibek" --background="green"
 */

async function run() {
    const args = process.argv.slice(2).reduce((acc, arg) => {
        const [key, value] = arg.replace(/^--/, '').split('=');
        acc[key] = value;
        return acc;
    }, {});

    if (args.help || args.h) {
        console.log(`
Usage: node render.js [options]
Options:
  --glosses="word1 word2"  Space-separated glosses to animate (default: "alaqan")
  --output="filename.webm" Output filename (default: "output.webm")
  --avatar="Name"          Avatar name from config (default: "Aibek")
  --background="color"     Background color or "green"/"transparent" (default: "green")
  --url="http://..."       Renderer URL (default: "http://localhost:5173/headless-renderer.html")
  --width=1280             Viewport width (default: 1280)
  --height=720             Viewport height (default: 720)
        `);
        return;
    }

    const glosses = (args.glosses || 'alaqan').split(' ');
    const output = args.output || 'output.webm';
    const avatar = args.avatar || 'Aibek';
    const background = args.background || 'green';
    const serverUrl = args.url || 'http://localhost:5173/headless-renderer.html';
    const width = parseInt(args.width) || 1280;
    const height = parseInt(args.height) || 720;

    console.log(`[Headless] Starting render process...`);
    console.log(`[Headless] Glosses: ${glosses.join(', ')}`);
    console.log(`[Headless] Avatar: ${avatar}`);
    console.log(`[Headless] Output: ${output}`);

    const hasGPU = fs.existsSync('/dev/nvidia0');
    console.log(`[Headless] GPU mode: ${hasGPU ? 'NVIDIA (EGL)' : 'SwiftShader (CPU)'}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            hasGPU ? '--use-gl=egl' : '--use-gl=swiftshader',
            ...(hasGPU ? ['--enable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer'] : []),
            '--enable-gpu-rasterization',
            '--enable-zero-copy',
            '--ignore-gpu-blocklist',
            '--disable-web-security'
        ]
    });

    try {
        const page = await browser.newPage();

        // Forward browser console logs to Node console
        page.on('console', msg => {
            const text = msg.text();
            if (text.includes('[Headless]')) {
                console.log(`  ${text}`);
            }
        });
        
        page.on('pageerror', err => console.error(`[Browser Error] ${err.toString()}`));

        // Set viewport
        await page.setViewport({ width, height });

        console.log(`[Headless] Navigating to renderer...`);
        try {
            await page.goto(serverUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        } catch (e) {
            throw new Error(`Failed to reach ${serverUrl}. Make sure your dev server is running (npm run dev).`);
        }

        // Wait for the renderer to be ready
        console.log(`[Headless] Waiting for renderer ready state...`);
        await page.waitForFunction(() => window.rendererLoaded === true, { timeout: 10000 });

        console.log(`[Headless] Triggering animation and recording...`);
        const dataUrl = await page.evaluate(async (config) => {
            return await window.startHeadlessRender(config);
        }, { glosses, avatar, background });

        if (!dataUrl || typeof dataUrl !== 'string') {
            throw new Error('Render failed: no data returned from browser');
        }

        const base64Data = dataUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');

        // Check if output is .mp4 and if ffmpeg is available
        const isMp4 = output.toLowerCase().endsWith('.mp4');
        let tempWebm = output;
        
        if (isMp4) {
            tempWebm = output.replace(/\.mp4$/i, '.temp.webm');
        }

        fs.writeFileSync(tempWebm, buffer);

        if (isMp4) {
            try {
                console.log(`[Headless] Converting to MP4...`);
                // Try GPU-accelerated encoding first, fall back to CPU
                try {
                    execSync(`ffmpeg -i "${tempWebm}" -c:v h264_nvenc -preset p4 -cq 23 -pix_fmt yuv420p "${output}" -y`, { stdio: 'ignore' });
                    console.log(`[Headless] GPU-accelerated conversion complete (h264_nvenc).`);
                } catch {
                    console.log(`[Headless] GPU encoder unavailable, falling back to CPU (libx264).`);
                    execSync(`ffmpeg -i "${tempWebm}" -c:v libx264 -crf 23 -pix_fmt yuv420p "${output}" -y`, { stdio: 'ignore' });
                    console.log(`[Headless] CPU conversion complete.`);
                }
                fs.unlinkSync(tempWebm);
                console.log(`[Headless] Conversion complete.`);
            } catch (e) {
                console.error(`[Headless] FFmpeg conversion failed. Keeping WebM file instead.`);
                fs.renameSync(tempWebm, output.replace(/\.mp4$/i, '.webm'));
            }
        }

        console.log(`[Headless] Done! File saved to: ${output}`);

    } catch (error) {
        console.error(`[Headless] Error: ${error.message}`);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

run();
