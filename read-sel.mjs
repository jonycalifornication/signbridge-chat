import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('/studio'));
const info = await page.evaluate(() => {
    const lines = document.body.innerText.split('\n').map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => /^ПРЕДЛОЖЕНИЕ\s+\d+/.test(l));
    return { around: lines.slice(Math.max(0, i - 2), i + 8) };
});
console.log(info.around.join('\n'));
await browser.disconnect();
