import { describe, expect, it } from 'vitest';

import { expandDatesInText } from '../../src/utils/date-glosses.js';

describe('date glosses', () => {
    it('expands Kazakh date suffixes with and without a space', () => {
        expect(expandDatesInText('25.04.2026 ж.', 'kk')).toBe('20 5 сәуір 2 1000 20 6 жыл');
        expect(expandDatesInText('25.04.2026ж', 'kk')).toBe('20 5 сәуір 2 1000 20 6 жыл');
        expect(expandDatesInText('25.04.2026 жылы', 'kk')).toBe('20 5 сәуір 2 1000 20 6 жыл');
    });

    it('uses suffix language before fallback language', () => {
        expect(expandDatesInText('25.04.2026 ж.', 'ru')).toBe('20 5 сәуір 2 1000 20 6 жыл');
        expect(expandDatesInText('25.04.2026 г.', 'kk')).toBe('20 5 апрель 2 1000 20 6 год');
    });

    it('keeps invalid dates untouched', () => {
        expect(expandDatesInText('25.13.2026 ж.', 'kk')).toBe('25.13.2026 ж.');
        expect(expandDatesInText('00.04.2026 г.', 'ru')).toBe('00.04.2026 г.');
    });
});
