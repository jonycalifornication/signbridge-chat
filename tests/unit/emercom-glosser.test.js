import { describe, expect, it } from 'vitest';

import { detectDictLang, processEmercomDates, processEmercomNumbers } from '../../video_generator/emercom-glosser.js';

describe('Emercom glosser', () => {
    describe('processEmercomDates', () => {
        it('expands Kazakh dates using numeric glosses', () => {
            expect(processEmercomDates('10.11.25ж', 'kk')).toBe('10 қараша 2 1000 20 5 жыл');
            expect(processEmercomDates('17.10.25', 'kk')).toBe('17 қазан 2 1000 20 5 жыл');
            expect(processEmercomDates('17.10.2025', 'kk')).toBe('17 қазан 2 1000 20 5 жыл');
        });

        it('expands Russian dates using numeric glosses', () => {
            expect(processEmercomDates('10.11.25г.', 'ru')).toBe('10 ноябрь 2 1000 20 5 год');
            expect(processEmercomDates('17.10.25 г.', 'ru')).toBe('17 октябрь 2 1000 20 5 год');
            expect(processEmercomDates('17.10.2025', 'ru')).toBe('17 октябрь 2 1000 20 5 год');
        });

        it('expands date ranges', () => {
            expect(processEmercomDates('03-04.09.25', 'kk')).toBe('3 4 қыркүйек 2 1000 20 5 жыл');
            expect(processEmercomDates('03-04.9.25', 'ru')).toBe('3 4 сентябрь 2 1000 20 5 год');
        });

        it('uses the date suffix language before the fallback text language', () => {
            expect(processEmercomDates('10.10.25ж', 'ru')).toBe('10 қазан 2 1000 20 5 жыл');
            expect(processEmercomDates('10.10.25 г.', 'kk')).toBe('10 октябрь 2 1000 20 5 год');
        });

        it('keeps standalone numbers unchanged', () => {
            expect(processEmercomDates('телефон 112', 'ru')).toBe('телефон 112');
        });

        it('does not expand invalid date parts', () => {
            expect(processEmercomDates('17.13.25ж', 'kk')).toBe('17.13.25ж');
            expect(processEmercomDates('00.10.25 г.', 'ru')).toBe('00.10.25 г.');
        });
    });

    describe('processEmercomNumbers', () => {
        it('expands standalone numbers into numeric gloss parts', () => {
            expect(processEmercomNumbers('128518')).toBe('100 20 8 1000 500 18');
            expect(processEmercomNumbers('телефон 112')).toBe('телефон 100 12');
            expect(processEmercomNumbers('код 03')).toBe('код 0 3');
        });

        it('does not break dates before date processing handles them', () => {
            expect(processEmercomNumbers('17.10.25ж')).toBe('17.10.25ж');
            expect(processEmercomNumbers('03-04.09.25')).toBe('03-04.09.25');
        });
    });

    describe('detectDictLang', () => {
        it('detects Kazakh dates by year suffix', () => {
            expect(detectDictLang('17.10.25ж')).toBe('kk');
            expect(detectDictLang('17.10.25 ж.')).toBe('kk');
            expect(detectDictLang('17.10.25 жылы')).toBe('kk');
        });

        it('detects Russian dates by year suffix', () => {
            expect(detectDictLang('17.10.25г')).toBe('ru');
            expect(detectDictLang('17.10.25 г.')).toBe('ru');
            expect(detectDictLang('17.10.25 года')).toBe('ru');
        });
    });
});
