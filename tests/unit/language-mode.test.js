import { describe, expect, it } from 'vitest';

import {
    getFoundAnimationCount,
    getLanguageIdsForMode,
    hasFoundAnimations,
    normalizeLanguageId,
    normalizeLanguageMode,
    parseLanguagePriority
} from '../../src/utils/language-mode.js';

describe('language mode utilities', () => {
    it('normalizes known language aliases', () => {
        expect(normalizeLanguageId('ru')).toBe('ru_RSL');
        expect(normalizeLanguageId('kk')).toBe('kz_KSL');
        expect(normalizeLanguageId('kz')).toBe('kz_KSL');
    });

    it('parses language priority', () => {
        expect(parseLanguagePriority('ru_RSL,kz_KSL')).toEqual(['ru_RSL', 'kz_KSL']);
        expect(parseLanguagePriority(['kz', 'ru', 'ru_RSL'])).toEqual(['kz_KSL', 'ru_RSL']);
    });

    it('builds candidates from mode', () => {
        expect(normalizeLanguageMode('auto')).toBe('auto');
        expect(getLanguageIdsForMode('auto', ['ru_RSL', 'kz_KSL'])).toEqual(['ru_RSL', 'kz_KSL']);
        expect(getLanguageIdsForMode('kz_KSL', ['ru_RSL', 'kz_KSL'])).toEqual(['kz_KSL']);
    });

    it('counts found animations', () => {
        const response = {
            sequence: [
                { found: true, file_url: 'a.vrma' },
                { found: true, file_url: null },
                { found: false, file_url: 'b.vrma' },
            ]
        };

        expect(getFoundAnimationCount(response)).toBe(1);
        expect(hasFoundAnimations(response)).toBe(true);
        expect(hasFoundAnimations({ sequence: [] })).toBe(false);
    });
});
