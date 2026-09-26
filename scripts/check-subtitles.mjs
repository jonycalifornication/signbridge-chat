/**
 * Посмотреть на субтитры, не запуская рендер.
 *
 * Рендер видео стоит минуты, ходит в шлюз за анимациями и требует GPU — ради
 * вопроса «не налезает ли подпись на край и переносится ли длинное
 * предложение» это слишком дорого, а вопрос именно такой: код подписи чистый,
 * ломается он раскладкой, а раскладку видно только глазами.
 *
 * Скрипт кладёт `src/headless/subtitles.js` в пустую страницу, прогоняет
 * несколько положений курсора и сохраняет PNG.
 *
 *     node scripts/check-subtitles.mjs [каталог]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const here = path.dirname(fileURLToPath(import.meta.url));
const SUBTITLES = path.join(here, '../src/headless/subtitles.js');
const out = process.argv[2] || path.join(here, '../.subtitles-check');

const WIDTH = 720;
const HEIGHT = 480;

// Короткое предложение, длинное (с переносом) и казахские буквы — три случая,
// в которых раскладка ведёт себя по-разному.
const GLOSSES = [
    'МЕН ҮЙ БАРУ',
    'БҮГІН ЕРТЕҢГІ САҒАТ ТОҒЫЗ ЖИНАЛЫС БОЛУ УНИВЕРСИТЕТ ҮЛКЕН ЗАЛ КЕЛУ КЕРЕК ЕМЕС',
    'ӘЛЕУМЕТТАНУ ПӘН ҚЫЗЫҚ',
].join('\n');
const TOKENS = GLOSSES.split(/\s+/).map((gloss) => ({ gloss, word: gloss.toLowerCase() }));

// Тот же путь, что у сервера рендера: в образе стоит системный chromium, и
// своей копии puppeteer там нет.
const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: HEIGHT });
await page.setContent('<body style="margin:0;background:#2f6f4f"></body>');
await page.addScriptTag({ path: SUBTITLES });

const shots = await page.evaluate(
    (glosses, tokens, width, height) => {
        const results = [];
        for (const mode of ['glosses', 'text']) {
            const subs = window.HeadlessSubtitles.create({ mode, glosses, tokens, width, height });
            // Подложка вместо кадра аватара: сам кадр здесь не важен, важно, что
            // подпись рисуется ПОВЕРХ и не съедает его.
            const stage = document.createElement('canvas');
            stage.width = width;
            stage.height = height;
            const sctx = stage.getContext('2d');
            sctx.fillStyle = '#2f6f4f';
            sctx.fillRect(0, 0, width, height);
            sctx.fillStyle = 'rgba(255,255,255,0.25)';
            sctx.fillRect(width / 2 - 60, height * 0.2, 120, height * 0.55);

            const words = glosses.split(/\s+/);
            // Начало, середина длинного предложения и последний жест.
            for (const at of [0, 6, 12, words.length - 1]) {
                for (let i = 0; i <= at; i++) {
                    subs.note({ type: 'AVATAR_WORD_START', payload: { word: tokens[i].word } });
                }
                results.push({
                    name: `${mode}-${at}`,
                    data: subs.compose(stage).toDataURL('image/png'),
                });
                // Курсор двигается только вперёд — для следующего кадра нужен
                // свежий экземпляр.
                Object.assign(subs, window.HeadlessSubtitles.create({ mode, glosses, tokens, width, height }));
            }
        }
        return results;
    },
    GLOSSES,
    TOKENS,
    WIDTH,
    HEIGHT,
);

fs.mkdirSync(out, { recursive: true });
for (const shot of shots) {
    const file = path.join(out, `${shot.name}.png`);
    fs.writeFileSync(file, Buffer.from(shot.data.split(',')[1], 'base64'));
    console.log(file);
}

await browser.close();
