import { describe, expect, it } from 'vitest';

import {
    DEFAULT_LANGUAGE_ID,
    cacheLanguageId,
    parseLanguageId,
    renderLanguageId,
} from '../../src/server/sign-language.js';

describe('язык жестов из запроса', () => {
    it('берёт код языка как есть', () => {
        expect(parseLanguageId('RSL')).toBe('RSL');
        expect(parseLanguageId(' KSL ')).toBe('KSL');
        expect(parseLanguageId('ASl')).toBe('ASl');
    });

    it('мусор и пустое — не задано', () => {
        for (const raw of [undefined, null, '', '   ', 5, {}, 'RSL&apiKey=x', '../KSL', 'R'.repeat(40)]) {
            expect(parseLanguageId(raw)).toBeNull();
        }
    });
});

describe('язык рендера', () => {
    it('запрос важнее окружения', () => {
        expect(renderLanguageId('RSL', { RENDER_PLAN_LANGUAGE_ID: 'KSL' })).toBe('RSL');
    });

    it('без языка в запросе — окружение, потом KSL', () => {
        expect(renderLanguageId(null, { RENDER_PLAN_LANGUAGE_ID: 'RSL' })).toBe('RSL');
        expect(renderLanguageId(null, {})).toBe(DEFAULT_LANGUAGE_ID);
    });
});

describe('язык в ключе кэша', () => {
    const env = { RENDER_PLAN_LANGUAGE_ID: 'KSL' };

    it('русский запрос не получает казахское видео с теми же глоссами', () => {
        const ksl = JSON.stringify({ glosses: '9 ЧАСЫ', languageId: cacheLanguageId('KSL', env) });
        const rsl = JSON.stringify({ glosses: '9 ЧАСЫ', languageId: cacheLanguageId('RSL', env) });
        expect(rsl).not.toBe(ksl);
    });

    it('язык по умолчанию не меняет прежний ключ — снятое не перерисовывается', () => {
        const before = JSON.stringify({ glosses: 'АДАМ', tokens: null });
        for (const requested of [null, 'KSL']) {
            const after = JSON.stringify({ glosses: 'АДАМ', languageId: cacheLanguageId(requested, env), tokens: null });
            expect(after).toBe(before);
        }
    });
});
