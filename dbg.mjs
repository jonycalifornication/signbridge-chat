import puppeteer from 'puppeteer';
const FILE = process.argv[2];
const b = await puppeteer.launch({ headless: 'new', executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const p = await b.newPage();
await p.setViewport({ width: 1500, height: 1000 });
p.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 200)));
p.on('console', (m) => { const t = m.text(); if (!t.includes('webpack-hmr')) console.log('  [console]', m.type(), t.slice(0, 200)); });
await p.goto('http://127.0.0.1:3000/ru/studio', { waitUntil: 'networkidle2' });
const input = await p.$('input[type=file]');
console.log('input найден:', !!input);
await input.uploadFile(FILE);
await p.evaluate(() => {
    const i = document.querySelector('input[type=file]');
    i.dispatchEvent(new Event('change', { bubbles: true }));
});
console.log('файл отдан + change послан, жду...');
for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const state = await p.evaluate(() => ({
        text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
        selects: document.querySelectorAll('select').length,
        files: [...document.querySelectorAll('input[type=file]')].map((i) => i.files?.length ?? -1),
    }));
    console.log(i, JSON.stringify(state).slice(0, 320));
    if (state.selects > 0) break;
}
await b.close();
