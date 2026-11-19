import { describe, it, expect } from 'vitest';
import { createApiGuard, keyMatches, parseApiKeys } from '../../src/server/api-auth.js';

function request({ key, ip = '203.0.113.7' } = {}) {
    const headers = key === undefined ? {} : { 'x-api-key': key };
    return { ip, socket: {}, get: (name) => headers[name.toLowerCase()] };
}

function response() {
    return {
        code: null,
        body: null,
        status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; },
    };
}

/** Прогнать запрос через охрану: 'next' — пропустила, иначе код ответа. */
function check(guard, req) {
    const res = response();
    let passed = false;
    guard.requireApiKey(req, res, () => { passed = true; });
    return passed ? 'next' : res.code;
}

describe('parseApiKeys', () => {
    it('splits by comma, trims and drops empties', () => {
        expect(parseApiKeys(' a , b,,c ,')).toEqual(['a', 'b', 'c']);
    });

    it('treats a missing variable as no keys', () => {
        expect(parseApiKeys(undefined)).toEqual([]);
        expect(parseApiKeys('  ')).toEqual([]);
    });
});

describe('keyMatches', () => {
    it('accepts any of the configured keys exactly', () => {
        expect(keyMatches('old', ['old', 'new'])).toBe(true);
        expect(keyMatches('new', ['old', 'new'])).toBe(true);
    });

    it('rejects a prefix, a longer string and a different case', () => {
        expect(keyMatches('secre', ['secret'])).toBe(false);
        expect(keyMatches('secret!', ['secret'])).toBe(false);
        expect(keyMatches('SECRET', ['secret'])).toBe(false);
    });

    it('rejects a missing or empty key even when no keys are configured', () => {
        expect(keyMatches(undefined, ['secret'])).toBe(false);
        expect(keyMatches('', ['secret'])).toBe(false);
        expect(keyMatches('', [])).toBe(false);
        expect(keyMatches('', [''])).toBe(false);
    });
});

describe('createApiGuard', () => {
    it('lets the right key through and the wrong or missing one gets 401', () => {
        const guard = createApiGuard({ keys: ['secret'] });
        expect(check(guard, request({ key: 'secret' }))).toBe('next');
        expect(check(guard, request({ key: 'guess' }))).toBe(401);
        expect(check(guard, request())).toBe(401);
    });

    it('never rate-limits a request with the right key', () => {
        // Все пользователи портала приходят с одного адреса: лимит на ключ
        // душил бы их разом.
        const guard = createApiGuard({ keys: ['secret'], limit: 3 });
        for (let i = 0; i < 50; i += 1) {
            expect(check(guard, request({ key: 'secret' }))).toBe('next');
        }
    });

    it('answers 429 once one address exceeds the limit without a key', () => {
        const guard = createApiGuard({ keys: ['secret'], limit: 3 });
        const codes = Array.from({ length: 5 }, () => check(guard, request({ key: 'guess' })));
        expect(codes).toEqual([401, 401, 401, 429, 429]);
        // Чужой адрес считается отдельно.
        expect(check(guard, request({ key: 'guess', ip: '198.51.100.1' }))).toBe(401);
        // И верный ключ с того же адреса проходит, лимит его не касается.
        expect(check(guard, request({ key: 'secret' }))).toBe('next');
    });

    it('forgets attempts once the window has passed', () => {
        let clock = 0;
        const guard = createApiGuard({ keys: ['secret'], limit: 1, windowMs: 1000, now: () => clock });
        expect(check(guard, request())).toBe(401);
        expect(check(guard, request())).toBe(429);
        clock = 1001;
        expect(check(guard, request())).toBe(401);
    });

    it('refuses everyone when no keys are configured', () => {
        // Открытый по ошибке генератор хуже, чем громко сломанный.
        const guard = createApiGuard({ keys: [] });
        expect(guard.configured).toBe(false);
        expect(check(guard, request({ key: '' }))).toBe(401);
        expect(check(guard, request({ key: 'anything' }))).toBe(401);
        expect(guard.peerHeaders()).toEqual({});
    });

    it('does not count an empty string as a configured key', () => {
        const guard = createApiGuard({ keys: ['', 'secret'] });
        expect(check(guard, request({ key: '' }))).toBe(401);
        expect(guard.peerHeaders()).toEqual({ 'X-API-Key': 'secret' });
        expect(createApiGuard({ keys: [''] }).configured).toBe(false);
    });

    it('signs requests to peer workers with a configured key', () => {
        // Без ключа сосед ответил бы 401, и передача работы между картами
        // тихо отключилась бы.
        const guard = createApiGuard({ keys: ['new', 'old'] });
        expect(guard.configured).toBe(true);
        expect(guard.peerHeaders()).toEqual({ 'X-API-Key': 'new' });
        expect(check(guard, request({ key: guard.peerHeaders()['X-API-Key'] }))).toBe('next');
    });
});
