/**
 * Пиксельный сторож рваного снимка.
 *
 * `inject-renderer.js` вставляется в страницу целиком и потому живёт без
 * импортов — как `subtitles.js` и по той же причине. Поэтому проверяем его
 * так же, как `frame-size`: вытаскиваем из текста ровно ту функцию, которая
 * считает расхождение, и считаем ею по-настоящему, а не переписываем формулу
 * в тесте (переписанная разошлась бы с кодом в первый же день).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
    path.join(__dirname, '../../src/headless/inject-renderer.js'),
    'utf8'
);

/** Достать объявление `const <name> = (…) => { … };` из текста файла. */
function lift(name) {
    const start = source.indexOf(`const ${name} = (`);
    expect(start, `в inject-renderer.js нет ${name}`).toBeGreaterThan(-1);
    const end = source.indexOf('\n        };', start);
    expect(end, `не нашёлся конец ${name}`).toBeGreaterThan(start);
    const body = source.slice(start, end + '\n        };'.length);
    return new Function(`${body}\nreturn ${name};`)();
}

function constant(name) {
    const m = source.match(new RegExp(`const ${name} = ([0-9.]+);`));
    expect(m, `в inject-renderer.js нет ${name}`).not.toBeNull();
    return Number(m[1]);
}

/** Уменьшенная копия 32×32 в том же виде, в каком её отдаёт getImageData. */
function thumb(fill) {
    const data = new Uint8ClampedArray(32 * 32 * 4);
    for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = fill(i / 4);
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
    return data;
}

const thumbDiff = lift('thumbDiff');
const TEAR_EPSILON = constant('TEAR_EPSILON');

describe('расхождение уменьшенных копий', () => {
    it('одинаковые кадры не расходятся', () => {
        const a = thumb(() => [10, 200, 10]);
        expect(thumbDiff(a, thumb(() => [10, 200, 10]))).toBe(0);
    });

    it('полная подмена картинки даёт предел шкалы', () => {
        expect(thumbDiff(thumb(() => [0, 0, 0]), thumb(() => [255, 255, 255]))).toBe(255);
    });

    it('прозрачность не участвует — считаем видимые каналы', () => {
        const a = thumb(() => [10, 200, 10]);
        const b = thumb(() => [10, 200, 10]);
        for (let i = 3; i < b.length; i += 4) b[i] = 0;
        expect(thumbDiff(a, b)).toBe(0);
    });
});

describe('порог', () => {
    // Это ровно тот случай, ради которого всё затевалось, и именно он
    // проходил мимо порога «во столько-то раз больше обычного движения»:
    // во время жеста соседние кадры расходятся сильнее, чем пропавший пиджак.
    const jacketGone = () => thumbDiff(
        thumb((px) => (px % 32 < 8 ? [20, 20, 30] : [0, 255, 0])),
        thumb(() => [0, 255, 0])
    );

    it('пиджак в четверть кадра виден с большим запасом', () => {
        expect(jacketGone()).toBeGreaterThan(TEAR_EPSILON * 8);
    });

    it('даже рукав в одну шестнадцатую кадра выше порога', () => {
        const sleeve = thumbDiff(
            thumb((px) => (px % 32 < 2 ? [20, 20, 30] : [0, 255, 0])),
            thumb(() => [0, 255, 0])
        );
        expect(sleeve).toBeGreaterThan(TEAR_EPSILON);
    });

    it('допуск оставлен только на само уменьшение', () => {
        // Холст и ImageBitmap приходят в drawImage разными путями. Допуск
        // должен покрывать эту разницу и не больше: подними его до десятков,
        // и пропажа рукава пройдёт как норма.
        expect(TEAR_EPSILON).toBeGreaterThan(0);
        expect(TEAR_EPSILON).toBeLessThan(5);
    });
});

describe('с чем сверяется снимок', () => {
    it('с холстом, а не с предыдущим кадром', () => {
        // Предыдущий кадр законно отличается — там движение. Холст между
        // снимком и сверкой не меняется, поэтому любое расхождение с ним
        // означает именно рваный снимок, независимо от сцены.
        expect(source).toContain('const canvasNow = thumbOf(widget.renderer.domElement);');
        expect(source).toContain('const drift = thumbDiff(shot, canvasNow);');
        expect(source).not.toContain('prevThumb');
    });

    it('из двух снимков оставляется тот, что ближе к холсту', () => {
        expect(source).toContain('if (thumbDiff(thumbOf(again), canvasNow) < drift)');
    });

    it('пересъёмка не перерисовывает сцену', () => {
        // Рвётся снимок, а не отрисовка: лишний render() на каждом подозрении
        // удвоил бы время записи и ничего бы не проверил.
        const body = source.slice(source.indexOf('const drift = thumbDiff'), source.indexOf('} catch (e) {', source.indexOf('const drift = thumbDiff')));
        expect(body).not.toContain('widget.renderer.render(');
    });

    it('частые несовпадения выключают проверку, а не удваивают работу', () => {
        expect(source).toContain('pixelGuardOff = true');
        expect(source).toContain('PIXEL_GIVE_UP_SHARE');
    });
});

describe('сторож отрисовок', () => {
    it('не читает счётчик с витка, на котором никто не рисовал', () => {
        // Счётчик отрисовок живёт до следующего render(): виток без отрисовки
        // читал бы прошлое значение и проходил бы как нормальный, а сводка
        // «всегда 14» считала бы эхо за измерение.
        expect(source).toContain("renderInfo.frame !== lastRenderFrame");
        expect(source).toContain('framesWithoutRender++');
    });
});
