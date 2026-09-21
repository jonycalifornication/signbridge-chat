import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { resolveFrameSize } from './frame-size.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Headless Render CLI
 * Usage: node render.js --glosses="alaqan hello" --output="output.webm" --avatar="Aibek" --background="green"
 */

const FRAME = resolveFrameSize();

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
  --url="http://..."       Mirrored avatar page (default: "http://localhost:3003/avatar/current/embed.html")
  --width=N                Frame width (default: ${FRAME.width})
  --height=N               Frame height (default: ${FRAME.height})

Requires the render server to be running, since it serves the avatar mirror.
        `);
        return;
    }

    const glosses = (args.glosses || 'alaqan').split(' ');
    const output = args.output || 'output.webm';
    const avatar = args.avatar || 'Aibek';
    const background = args.background || 'green';
    const serverUrl = args.url || 'http://localhost:3003/avatar/current/embed.html';
    // Тот же кадр, что у сервера: ширина рассчитана на разведённые руки.
    const width = parseInt(args.width) || FRAME.width;
    const height = parseInt(args.height) || FRAME.height;

    console.log(`[Headless] Starting render process...`);
    console.log(`[Headless] Glosses: ${glosses.join(', ')}`);
    console.log(`[Headless] Avatar: ${avatar}`);
    console.log(`[Headless] Output: ${output}`);

    const hasGPU = fs.existsSync('/dev/nvidia0');
    console.log(`[Headless] GPU mode: ${hasGPU ? 'NVIDIA (EGL)' : 'ANGLE SwiftShader (CPU)'}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--enable-webgl',
            ...(hasGPU
                ? ['--use-gl=angle', '--use-angle=gl-egl']
                : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']),
            ...(hasGPU ? ['--enable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '--ozone-platform=headless'] : []),
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

        console.log(`[Headless] Navigating to the mirrored avatar page...`);
        try {
            await page.goto(serverUrl, { waitUntil: 'networkidle0', timeout: 30000 });
        } catch (e) {
            throw new Error(`Failed to reach ${serverUrl}. Make sure the render server is running (node src/server/index.js).`);
        }

        // Inject our video pipeline into the avatar's own page.
        const muxerPath = path.join(__dirname, '../../node_modules/webm-muxer/build/webm-muxer.js');
        if (fs.existsSync(muxerPath)) {
            await page.addScriptTag({ path: muxerPath });
        } else {
            await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/npm/webm-muxer@5.0.2/build/webm-muxer.js' });
        }
        await page.addScriptTag({ path: path.join(__dirname, 'inject-renderer.js') });

        console.log(`[Headless] Waiting for renderer ready state...`);
        await page.waitForFunction(() => window.headlessRendererReady === true, { timeout: 30000 });

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
