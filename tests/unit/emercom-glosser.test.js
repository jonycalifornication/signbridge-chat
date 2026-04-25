import { describe, expect, it } from 'vitest';

import { detectDictLang, processEmercomDates } from '../../video_generator/emercom-glosser.js';

describe('Emercom glosser', () => {
    describe('processEmercomDates', () => {
        it('expands Kazakh dates using written numbers', () => {
            expect(processEmercomDates('10.11.25ж', 'kk')).toBe('он қараша екі мың жиырма бес жыл');
            expect(processEmercomDates('17.10.25', 'kk')).toBe('он жеті қазан екі мың жиырма бес жыл');
            expect(processEmercomDates('17.10.2025', 'kk')).toBe('он жеті қазан екі мың жиырма бес жыл');
        });

        it('expands Russian dates using written numbers', () => {
            expect(processEmercomDates('10.11.25г.', 'ru')).toBe('десять ноябрь две тысячи двадцать пять год');
            expect(processEmercomDates('17.10.25 г.', 'ru')).toBe('семнадцать октябрь две тысячи двадцать пять год');
            expect(processEmercomDates('17.10.2025', 'ru')).toBe('семнадцать октябрь две тысячи двадцать пять год');
        });

        it('expands date ranges', () => {
            expect(processEmercomDates('03-04.09.25', 'kk')).toBe('үш төрт қыркүйек екі мың жиырма бес жыл');
            expect(processEmercomDates('03-04.9.25', 'ru')).toBe('три четыре сентябрь две тысячи двадцать пять год');
        });

        it('uses the date suffix language before the fallback text language', () => {
            expect(processEmercomDates('10.10.25ж', 'ru')).toBe('он қазан екі мың жиырма бес жыл');
            expect(processEmercomDates('10.10.25 г.', 'kk')).toBe('десять октябрь две тысячи двадцать пять год');
        });

        it('keeps standalone numbers unchanged', () => {
            expect(processEmercomDates('телефон 112', 'ru')).toBe('телефон 112');
        });

        it('does not expand invalid date parts', () => {
            expect(processEmercomDates('17.13.25ж', 'kk')).toBe('17.13.25ж');
            expect(processEmercomDates('00.10.25 г.', 'ru')).toBe('00.10.25 г.');
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
