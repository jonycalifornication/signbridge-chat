/** После деплоя: нажать «Синхронизировать» в живом столе и проверить инвариант. */
import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('/studio'));
let plan = null, req = null;
page.on('request', (r) => {
    if (r.url().includes('/api/sync/plan') && r.method() === 'POST') req = JSON.parse(r.postData() || '{}');
});
page.on('response', async (r) => { if (r.url().includes('/api/sync/plan')) { try { plan = await r.json(); } catch {} } });

await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /^Синхронизировать/i.test(x.textContent.trim()));
    b?.click();
});
await new Promise((r) => setTimeout(r, 30000));
if (!plan) { console.log('ответа не поймал'); await browser.disconnect(); process.exit(1); }

const P = plan.pause_seconds, L = plan.letter_pause_seconds;
let cursor = 0, broken = 0, worst = 0, capped = 0;
for (const s of plan.sentences) {
    const g = s.glosses, n = s.gloss_count;
    const sl = plan.speeds.slice(cursor, cursor + n); cursor += n;
    let spent = 0;
    g.forEach((x, i) => {
        const own = (x.duration || 0) + Math.max(0, (x.letters || 0) - 1) * L + (i < g.length - 1 ? P : 0);
        spent += own / (sl[i] || 1);
    });
    if (s.fits && spent > s.spoken + 0.25) { broken++; worst = Math.max(worst, spent - s.spoken); }
    if (s.rate >= 3.99) capped++;
}
console.log('потолок в запросе:', req?.max_rate);
console.log('предложений:', plan.sentences.length,
            '| не влезает:', plan.sentences.filter((s) => !s.fits).length,
            '| на потолке:', capped);
console.log('«обещано, но не влезает»:', broken, broken ? `(максимум ${worst.toFixed(2)} с)` : '— ни одного');

const line = await page.evaluate(() => {
    const re = /жесты\s+([\d.]+)\s*с\s*·\s*отведено\s+([\d.]+)\s*с/;
    for (const el of document.querySelectorAll('*')) {
        if (el.children.length) continue;
        const m = (el.textContent || '').match(re);
        if (m) return el.textContent.trim();
    }
    return '(подписи нет)';
});
console.log('выбранное предложение на столе:', line);
const summary = await page.evaluate(() =>
    document.body.innerText.split('\n').find((l) => /уложились/i.test(l)) || '');
console.log('сводка:', summary);
await page.screenshot({ path: '/tmp/claude-1000/prod-after-fix.png' });
await browser.disconnect();
