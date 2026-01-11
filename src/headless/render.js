import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

    const glosses = (args.glosses || 'alaqan').split(' ');
    const output = args.output || 'output.webm';
    const avatar = args.avatar || 'Aibek';
    const background = args.background || 'green';
    const serverUrl = args.url || 'http://localhost:5173/headless-renderer.html';

    console.log(`[Headless] Starting render for glosses: ${glosses.join(', ')}`);
    console.log(`[Headless] Output: ${output}`);

    const browser = await puppeteer.launch({
        headless: "new",
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream']
    });

    try {
        const page = await browser.newPage();

        // Forward browser console logs to Node console
        page.on('console', msg => console.log(`[Browser] ${msg.text()}`));
        page.on('pageerror', err => console.error(`[Browser Error] ${err.toString()}`));

        // Set viewport to 720p
        await page.setViewport({ width: 1280, height: 720 });

        console.log(`[Headless] Navigating to ${serverUrl}...`);
        await page.goto(serverUrl, { waitUntil: 'networkidle0' });

        // Wait for the renderer to be ready
        await page.waitForFunction(() => window.rendererLoaded === true);

        console.log(`[Headless] Triggering render...`);
        const dataUrl = await page.evaluate(async (config) => {
            return await window.startHeadlessRender(config);
        }, { glosses, avatar, background });

        if (!dataUrl || typeof dataUrl !== 'string') {
            throw new Error('Render failed or returned invalid data');
        }

        console.log(`[Headless] Saving video to ${output}...`);
        const base64Data = dataUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');

        fs.writeFileSync(output, buffer);
        console.log(`[Headless] Done! Video saved successfully.`);

    } catch (error) {
        console.error(`[Headless] Error: ${error.message}`);
        process.exit(1);
    } finally {
        await browser.close();
    }
}

run();
