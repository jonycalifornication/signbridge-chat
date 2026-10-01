/**
 * Подключиться к УЖЕ ОТКРЫТОМУ браузеру пользователя и нажать «Синхронизировать».
 *
 * Смысл: у нас спор про число, которого не видно на экране — какой потолок
 * реально уходит в запрос и какие ставки приходят обратно. Локальный стенд
 * это показал, но там чужой проект и чужая сессия; здесь — настоящие.
 */
import puppeteer from 'puppeteer';

const CAP = process.argv[2] || '4';
const DO_CLICK = process.argv[3] !== 'dry';

const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const pages = await browser.pages();
const page = pages.find((p) => p.url().includes('/studio'));
if (!page) { console.log('вкладки со столом нет'); await browser.disconnect(); process.exit(1); }
console.log('вкладка:', page.url());

const state = await page.evaluate(() => {
    const txt = document.body.innerText;
    const line = (re) => txt.split('\n').find((l) => re.test(l)) || '';
    const sel = [...document.querySelectorAll('select')]
        .find((s) => [...s.options].some((o) => /^×[\d.]+$/.test(o.textContent.trim())));
    return {
        project: line(/\.sbproj/),
        counts: line(/предложени[йя].*жест/),
        summary: line(/План рассчитан|уложились|не влезает/),
        cap: sel ? sel.value : '(селекта нет)',
        capOptions: sel ? [...sel.options].map((o) => o.textContent.trim()).join(' ') : '',
    };
});
console.log('состояние до:', JSON.stringify(state, null, 1));

const seen = [];
page.on('request', (r) => {
    if (r.url().includes('/api/sync/plan') && r.method() === 'POST') {
        const b = JSON.parse(r.postData() || '{}');
        seen.push({ kind: 'req', max_rate: b.max_rate, n: (b.sentences || []).length,
                    locked: (b.sentences || []).reduce((s, x) => s + (x.locked || []).filter((v) => v).length, 0) });
    }
});
page.on('response', async (r) => {
    if (!r.url().includes('/api/sync/plan')) return;
    try {
        const d = await r.json();
        const rates = (d.sentences || []).map((s) => s.rate).sort((a, b) => a - b);
        const nofit = (d.sentences || []).filter((s) => !s.fits);
        seen.push({ kind: 'resp', status: r.status(), n: rates.length,
                    max: rates.at(-1), median: rates[Math.floor(rates.length / 2)],
                    nofit: nofit.length,
                    worst: nofit.slice(0, 3).map((s) => `#${s.index + 1} rate=${s.rate} нехватка=${s.deficit}с`) });
    } catch (e) { seen.push({ kind: 'resp', error: String(e).slice(0, 80) }); }
});

if (DO_CLICK) {
    const set = await page.evaluate((cap) => {
        const sel = [...document.querySelectorAll('select')]
            .find((s) => [...s.options].some((o) => o.textContent.trim() === '×' + cap));
        if (!sel) return 'селект не найден';
        const opt = [...sel.options].find((o) => o.textContent.trim() === '×' + cap);
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
        setter.call(sel, opt.value);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        return sel.value;
    }, CAP);
    console.log('потолок выставлен:', set);

    const clicked = await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((x) => /^Синхронизировать/i.test(x.textContent.trim()));
        if (!b) return false;
        b.click();
        return true;
    });
    console.log('нажал «Синхронизировать»:', clicked);
    await new Promise((r) => setTimeout(r, 25000));
}

console.log('\n=== сеть ===');
for (const s of seen) console.log(' ', JSON.stringify(s));

const after = await page.evaluate(() => {
    const txt = document.body.innerText;
    return {
        summary: txt.split('\n').find((l) => /План рассчитан|уложились/i.test(l)) || '',
        chips: [...document.querySelectorAll('*')]
            .filter((e) => !e.children.length && /[\d.]+\s*с\s*·\s*[\d.]+×/.test(e.textContent || ''))
            .slice(0, 12).map((e) => e.textContent.trim()),
    };
});
console.log('\n=== после ===');
console.log(' сводка:', after.summary);
console.log(' чипы:', after.chips.join(' | ') || '(не нашёл)');

await page.screenshot({ path: '/tmp/claude-1000/prod-studio.png' });
console.log('\nскриншот: /tmp/claude-1000/prod-studio.png');
await browser.disconnect();
