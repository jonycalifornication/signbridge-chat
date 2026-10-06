/**
 * Бесплатный сторож пропавших кусков аватара.
 *
 * Сверять картинку попиксельно нельзя — обратное чтение кадра стоит
 * пятикратной скорости записи. Зато размер закодированного кадра уже лежит
 * в колбэке энкодера и не стоит ничего, а пропажа большого меша — это
 * огромное межкадровое изменение.
 *
 * Разбор вытаскиваем прямо из `inject-renderer.js`: файл вставляется в
 * страницу и живёт без импортов, поэтому проверяем его той же техникой, что
 * и `frame-size`, — своя копия формулы в тесте разошлась бы с кодом.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(__dirname, '../../src/headless/inject-renderer.js'), 'utf8');

function lift(name) {
    const start = source.indexOf(`const ${name} = (`);
    expect(start, `в inject-renderer.js нет ${name}`).toBeGreaterThan(-1);
    const end = source.indexOf('\n        };', start);
    expect(end).toBeGreaterThan(start);
    return new Function(`${source.slice(start, end + '\n        };'.length)}\nreturn ${name};`)();
}

const findFrameSpikes = lift('findFrameSpikes');
const FACTOR = 8;

/** Ровная запись: кадры примерно одного размера, 30 кадров в секунду. */
function stream(count, bytes = 1000) {
    return Array.from({ length: count }, (_, i) => ({ second: i / 30, bytes }));
}

describe('поиск подозрительных кадров', () => {
    it('на ровной записи ничего не находит', () => {
        expect(findFrameSpikes(stream(300), FACTOR)).toEqual([]);
    });

    it('не придирается к обычному разбросу размеров', () => {
        // Смена жеста даёт двойной-тройной кадр — это норма, а не провал.
        const sizes = stream(300);
        for (let i = 20; i < 300; i += 30) sizes[i].bytes = 3000;
        expect(findFrameSpikes(sizes, FACTOR)).toEqual([]);
    });

    it('находит пару «пропало и вернулось»', () => {
        // Именно так выглядит пропажа меша: кадр без пиджака огромен, и
        // следующий, где пиджак вернулся, — тоже.
        const sizes = stream(300);
        sizes[150].bytes = 40000;
        sizes[151].bytes = 40000;
        const found = findFrameSpikes(sizes, FACTOR);
        expect(found).toHaveLength(1);
        expect(found[0].second).toBeCloseTo(5.0, 2);
        expect(found[0].ratio).toBeCloseTo(40, 0);
    });

    it('одиночный всплеск не считается провалом', () => {
        // Один крупный кадр — это просто резкое движение: картинка изменилась
        // и осталась такой. У провала она возвращается на следующем кадре.
        const sizes = stream(300);
        sizes[150].bytes = 40000;
        expect(findFrameSpikes(sizes, FACTOR)).toEqual([]);
    });

    it('один провал считается один раз, а не тремя', () => {
        // Пропажа может задеть три кадра подряд; это всё ещё один провал,
        // и выписывать оператору три близкие секунды значит врать о числе.
        const sizes = stream(300);
        for (const i of [150, 151, 152, 153]) sizes[i].bytes = 40000;
        expect(findFrameSpikes(sizes, FACTOR)).toHaveLength(1);
    });

    it('два провала в разных местах записи видны оба', () => {
        const sizes = stream(600);
        sizes[100].bytes = sizes[101].bytes = 40000;
        sizes[400].bytes = sizes[401].bytes = 40000;
        const found = findFrameSpikes(sizes, FACTOR);
        expect(found).toHaveLength(2);
        expect(found.map((x) => +x.second.toFixed(2))).toEqual([3.33, 13.33]);
    });

    it('опорное значение — медиана, а не среднее', () => {
        // Среднее утащил бы за собой сам провал: один кадр в сорок раз
        // больше остальных поднимает порог и прячет себя же.
        const sizes = stream(60);
        sizes[30].bytes = sizes[31].bytes = 2_000_000;
        expect(findFrameSpikes(sizes, FACTOR)).toHaveLength(1);
    });

    it('на короткой записи молчит — статистики ещё нет', () => {
        expect(findFrameSpikes(stream(5), FACTOR)).toEqual([]);
    });
});

describe('что попадает в разбор', () => {
    it('ключевые кадры не считаются вовсе', () => {
        // Они крупные по определению, и каждый тридцатый давал бы пару.
        expect(source).toContain("if (chunk.type !== 'key')");
    });

    it('размер берётся из колбэка энкодера, без чтения картинки', () => {
        expect(source).toContain('bytes: chunk.byteLength');
        expect(source).toContain('second: chunk.timestamp / 1_000_000');
    });
});
