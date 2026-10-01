/**
 * Потыкать монтажный стол вместо человека.
 *
 * Открывает локальную прод-сборку, загружает проект, ставит потолок и жмёт
 * «Синхронизировать», печатая ТЕЛО запроса плана и то, что после него
 * оказалось на чипах. Нужно ровно затем, что спор идёт про число, которого
 * не видно: уходит ли max_rate и что приходит обратно.
 */
import puppeteer from 'puppeteer';

const FILE = process.argv[2];
const CAP = process.argv[3] || '4';
const URL = 'http://127.0.0.1:3000/ru/studio';

const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
    args: ['--no-sandbox', '--window-size=1600,1200'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200 });

const plans = [];
page.on('request', (r) => {
    if (r.url().includes('/api/sync/plan') && r.method() === 'POST') {
        const body = JSON.parse(r.postData() || '{}');
        plans.push({ max_rate: body.max_rate, sentences: (body.sentences || []).length,
                     firstSpoken: body.sentences?.[0]?.spoken });
    }
});
page.on('console', (m) => { if (m.type() === 'error') console.log('  [browser]', m.text().slice(0, 160)); });

console.log('→ открываю', URL);
await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });

console.log('→ загружаю проект', FILE);
const input = await page.$('input[type=file]');
await input.uploadFile(FILE);
// CDP кладёт файл в input, но React про это не узнаёт сам — событие посылаем
// руками, иначе страница молча остаётся пустой.
await page.evaluate(() => {
    document.querySelector('input[type=file]')
        ?.dispatchEvent(new Event('change', { bubbles: true }));
});

// Импорт разбирает файл и сразу меряет длительности пачками — ждём тишины.
await new Promise((r) => setTimeout(r, 4000));
await page.waitForNetworkIdle({ idleTime: 2500, timeout: 180000 }).catch(() => {});
console.log('   запросов плана при импорте:', plans.length);

const capSet = await page.evaluate((cap) => {
    const selects = [...document.querySelectorAll('select')];
    const target = selects.find((s) => [...s.options].some((o) => o.textContent.trim() === '×' + cap));
    if (!target) return { ok: false, selects: selects.map((s) => [...s.options].map((o) => o.textContent)) };
    const before = target.value;
    const option = [...target.options].find((o) => o.textContent.trim() === '×' + cap);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
    setter.call(target, option.value);
    target.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, before, after: target.value, label: target.closest('label')?.textContent?.trim() };
}, CAP);
console.log('→ потолок:', JSON.stringify(capSet));

const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Синхронизировать/i.test(b.textContent));
    if (!btn) return false;
    btn.click();
    return true;
});
console.log('→ нажал «Синхронизировать»:', clicked);
await new Promise((r) => setTimeout(r, 2000));
await page.waitForNetworkIdle({ idleTime: 2500, timeout: 180000 }).catch(() => {});

console.log('\n=== запросы плана ===');
for (const p of plans) console.log('  max_rate=', p.max_rate, '| предложений', p.sentences, '| spoken[0]', p.firstSpoken);

// Сводка плана и вердикты строк — то, что видит человек.
const summary = await page.evaluate(() => {
    const t = document.body.innerText;
    const line = t.split('\n').find((l) => /План рассчитан|уложились/i.test(l));
    return { line: line || '(нет сводки)' };
});
console.log('\n=== сводка на экране ===\n ', summary.line);

const chips = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('*')) {
        if (el.children.length) continue;
        const t = (el.textContent || '').trim();
        if (/[\d.]+\s*×/.test(t) && !/^×[\d.]+$/.test(t)) out.push(t);
    }
    return out.slice(0, 40);
});
console.log('\n=== множители на экране ===');
console.log(' ', chips.join(' | ') || '(не нашёл)');

// Что РЕАЛЬНО легло в проект: скачиваем его же и читаем speeds. Экран может
// показывать что угодно, а файл — это состояние приложения.
const dir = '/tmp/claude-1000/dl';
await page.createCDPSession().then((c) =>
    c.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }));
await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Скачать проект/i.test(b.textContent));
    btn?.click();
});
await new Promise((r) => setTimeout(r, 6000));

await page.screenshot({ path: '/tmp/claude-1000/studio.png', fullPage: false });
console.log('\nскриншот: /tmp/claude-1000/studio.png');
await browser.close();
