import { describe, expect, it } from 'vitest';

import { normalizeRenderText } from '../../src/headless/render-plan.js';

describe('render plan normalization', () => {
    it('normalizes dates before numeric fallback in all render modes', () => {
        expect(normalizeRenderText('25.04.2026 ж.')).toBe('20 5 сәуір 2 1000 20 6 жыл');
        expect(normalizeRenderText('25.04.2026ж')).toBe('20 5 сәуір 2 1000 20 6 жыл');
    });

    it('still expands standalone numbers', () => {
        expect(normalizeRenderText('128518')).toBe('100 20 8 1000 500 18');
    });

    it('normalizes numeric ranges and slash units before rendering', () => {
        expect(normalizeRenderText('15-20 м/с')).toBe('15 20 м с');
    });
});
