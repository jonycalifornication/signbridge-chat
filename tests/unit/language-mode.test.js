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
        expect(normalizeLanguageId('ru')).toBe('RSL');
        expect(normalizeLanguageId('kk')).toBe('KSL');
        expect(normalizeLanguageId('kz')).toBe('KSL');
        expect(normalizeLanguageId('ru_RSL')).toBe('RSL');
        expect(normalizeLanguageId('RSL')).toBe('RSL');
    });

    it('parses language priority', () => {
        expect(parseLanguagePriority('ru_RSL,kz_KSL')).toEqual(['RSL', 'KSL']);
        expect(parseLanguagePriority(['kz', 'ru', 'ru_RSL'])).toEqual(['KSL', 'RSL']);
    });

    it('builds candidates from mode', () => {
        expect(normalizeLanguageMode('auto')).toBe('auto');
        expect(getLanguageIdsForMode('auto', ['ru_RSL', 'KSL'])).toEqual(['RSL', 'KSL']);
        expect(getLanguageIdsForMode('KSL', ['ru_RSL', 'KSL'])).toEqual(['KSL']);
        expect(getLanguageIdsForMode('ru_RSL', ['KSL'])).toEqual(['RSL']);
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
