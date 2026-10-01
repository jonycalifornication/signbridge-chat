import puppeteer from 'puppeteer';
const browser = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
const page = (await browser.pages()).find((p) => p.url().includes('/studio'));
await page.reload({ waitUntil: 'networkidle2' });
console.log('страница перезагружена (нужен свежий бандл) — проект придётся открыть заново');
const has = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')].map((l) => l.textContent.trim());
    return labels.filter((t) => /шв|плавн/i.test(t));
});
console.log('галочка на странице:', has.length ? has : '(проект не открыт — шапки нет)');
await browser.disconnect();
