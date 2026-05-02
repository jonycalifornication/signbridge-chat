import { describe, expect, it } from 'vitest';

import { expandNumbersInText, numberToGlossParts, numberToGlossText } from '../../src/utils/number-glosses.js';

describe('number glosses', () => {
    it('keeps base numeric glosses intact', () => {
        expect(numberToGlossParts('0')).toEqual(['0']);
        expect(numberToGlossParts('1')).toEqual(['1']);
        expect(numberToGlossParts('10')).toEqual(['10']);
        expect(numberToGlossParts('11')).toEqual(['11']);
        expect(numberToGlossParts('19')).toEqual(['19']);
        expect(numberToGlossParts('100')).toEqual(['100']);
        expect(numberToGlossParts('1000')).toEqual(['1000']);
    });

    it('expands compound numbers by place value', () => {
        expect(numberToGlossText('28')).toBe('20 8');
        expect(numberToGlossText('128')).toBe('100 20 8');
        expect(numberToGlossText('518')).toBe('500 18');
        expect(numberToGlossText('2025')).toBe('2 1000 20 5');
        expect(numberToGlossText('128518')).toBe('100 20 8 1000 500 18');
    });

    it('treats leading-zero strings as digit codes', () => {
        expect(numberToGlossText('03')).toBe('0 3');
        expect(numberToGlossText('007')).toBe('0 0 7');
    });

    it('expands standalone numbers in text without touching dates', () => {
        expect(expandNumbersInText('код 128518 готов')).toBe('код 100 20 8 1000 500 18 готов');
        expect(expandNumbersInText('17.10.25ж')).toBe('17.10.25ж');
        expect(expandNumbersInText('03-04.09.25')).toBe('03-04.09.25');
    });
});
