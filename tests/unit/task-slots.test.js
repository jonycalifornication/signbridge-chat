/**
 * Чьё место занимает задача.
 *
 * Поломка, ради которой это завели: воркер, отдавший задачу соседу, до
 * перезапуска отвечал «занят». Замер на боксе 06.10.2026 — три воркера из
 * четырёх сообщали `free: false` при нулевой загрузке карт и ноле активных
 * задач.
 */
import { describe, expect, it } from 'vitest';

import { countsAsInFlight, tasksInFlight } from '../../src/server/task-slots.js';

const task = (over = {}) => ({ status: 'processing', ...over });

describe('считается ли задача нашей работой', () => {
    it('считается, пока она у нас', () => {
        expect(countsAsInFlight(task({ status: 'queued' }))).toBe(true);
        expect(countsAsInFlight(task({ status: 'processing' }))).toBe(true);
    });

    it('не считается, когда закончилась', () => {
        expect(countsAsInFlight(task({ status: 'completed' }))).toBe(false);
        expect(countsAsInFlight(task({ status: 'error' }))).toBe(false);
    });

    it('не считается, когда отдана соседу', () => {
        // Это и есть исправление: запись живёт дальше ради переадресации
        // опроса и скачивания, но считает её уже сосед.
        expect(countsAsInFlight(task({ movedTo: { base: 'http://peer:3003', taskId: 'w1-x' } }))).toBe(false);
    });

    it('отданная не считается, даже если её статус ещё не менялся', () => {
        // Так и было на боксе: статус остаётся 'processing' навсегда, потому
        // что фоновая функция вышла сразу после передачи.
        expect(countsAsInFlight({ status: 'processing', movedTo: { base: 'x', taskId: 'y' } })).toBe(false);
    });

    it('пустая запись места не занимает', () => {
        expect(countsAsInFlight(null)).toBe(false);
        expect(countsAsInFlight(undefined)).toBe(false);
    });
});

describe('сколько задач в работе', () => {
    it('считает только свои незаконченные', () => {
        const tasks = new Map([
            ['a', task({ status: 'processing' })],
            ['b', task({ status: 'completed' })],
            ['c', task({ status: 'error' })],
            ['d', task({ movedTo: { base: 'p', taskId: 'q' } })],
            ['e', task({ status: 'queued' })],
        ]);
        expect(tasksInFlight(tasks)).toBe(2);
    });

    it('воркер, раздавший всё, снова свободен', () => {
        // Ровно то, что не происходило: при пределе в одну задачу воркер с
        // одной отданной записью был занят навсегда.
        const tasks = new Map([['a', task({ movedTo: { base: 'p', taskId: 'q' } })]]);
        expect(tasksInFlight(tasks)).toBe(0);
    });

    it('пустой список — ноль', () => {
        expect(tasksInFlight(new Map())).toBe(0);
    });
});
