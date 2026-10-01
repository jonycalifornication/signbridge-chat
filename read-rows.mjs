/** Снять со стола вердикты по строкам: жесты против отведённого времени. */
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('/studio'));
const rows = await page.evaluate(() => {
    const out = [];
    const re = /жесты\s+([\d.]+)\s*с\s*·\s*отведено\s+([\d.]+)\s*с/;
    for (const el of document.querySelectorAll('*')) {
        if (el.children.length) continue;
        const m = (el.textContent || '').match(re);
        if (m) out.push({ gest: +m[1], slot: +m[2] });
    }
    return out;
});
console.log('строк с подписью «жесты · отведено»:', rows.length);
const over = rows.filter((r) => r.gest > r.slot + 0.01);
console.log('из них жесты ДЛИННЕЕ отведённого:', over.length);
for (const r of over.slice(0, 8)) console.log(`   жесты ${r.gest} с > отведено ${r.slot} с`);
await browser.disconnect();
