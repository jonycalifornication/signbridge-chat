/**
 * Откуда в видео дыры: снимок кадра берут ВНЕ отрисовки.
 *
 * У виджета рендерер создан без `preserveDrawingBuffer`, то есть содержимое
 * буфера после композиции не определено. Генератор снимает кадр
 * `createImageBitmap(canvas)` уже ПОСЛЕ колбэка отрисовки — и иногда получает
 * буфер, в котором нарисована лишь часть мешей.
 *
 * Опыт: на одной и той же странице снимаем каждый кадр двумя способами —
 * внутри вызова render() и сразу после него — и считаем «тёмную площадь»
 * (пиджак). Провал площади = пропавший меш.
 */
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
    headless: 'new', executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1024 });
await page.goto('https://widget.signbridge.kz/embed.html', { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForFunction(() => window.avatarWidget?.renderer && window.avatarWidget?.currentVrm, { timeout: 90000 });

await page.evaluate(() => {
    const w = window.avatarWidget;
    const c = w.renderer.domElement;
    const off = document.createElement('canvas');
    off.width = 160; off.height = 128;
    const ctx = off.getContext('2d', { willReadFrequently: true });
    const darkArea = () => {
        ctx.clearRect(0, 0, 160, 128);
        ctx.drawImage(c, 0, 0, 160, 128);
        const d = ctx.getImageData(0, 0, 160, 128).data;
        let dark = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 10) dark++;
        return dark;
    };
    window.__inside = []; window.__after = []; window.__bitmap = [];
    const orig = w.renderer.render.bind(w.renderer);
    w.renderer.render = (...a) => {
        const r = orig(...a);
        window.__inside.push(darkArea());                    // внутри кадра
        setTimeout(() => window.__after.push(darkArea()), 0); // вне кадра
        // Ровно тот путь, которым снимает генератор: createImageBitmap уже
        // после колбэка отрисовки.
        createImageBitmap(c).then((bmp) => {
            ctx.clearRect(0, 0, 160, 128);
            ctx.drawImage(bmp, 0, 0, 160, 128);
            const d = ctx.getImageData(0, 0, 160, 128).data;
            let dark = 0;
            for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 3] > 10) dark++;
            window.__bitmap.push(dark);
            bmp.close();
        });
        return r;
    };
    w.processTextSelection('МЕН АДАМ БАРУ ҮЙ ЖАҚСЫ КӨРУ КІТАП');
});
await new Promise((r) => setTimeout(r, 20000));

const { inside, after, bitmap } = await page.evaluate(() => ({ inside: window.__inside, after: window.__after, bitmap: window.__bitmap }));
const stat = (name, a) => {
    if (!a.length) return console.log(`${name}: нет данных`);
    const s = [...a].sort((x, y) => x - y);
    const med = s[Math.floor(s.length / 2)];
    const bad = a.filter((x) => x < med * 0.6).length;
    const idx = a.map((x, i) => [x, i]).filter(([x]) => x < med * 0.6).map(([, i]) => i);
    console.log(`${name}: кадров ${a.length}, медиана ${med}, минимум ${s[0]}, `
        + `провалов >40%: ${bad} (${(bad / a.length * 100).toFixed(1)}%) на позициях ${idx.slice(0, 14).join(',')}`);
};
stat('снимок ВНУТРИ отрисовки ', inside);
stat('снимок ПОСЛЕ отрисовки  ', after);
stat('createImageBitmap (как генератор)', bitmap);
await browser.close();
