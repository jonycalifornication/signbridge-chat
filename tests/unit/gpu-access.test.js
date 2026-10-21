/**
 * Доступ к карте проверяется открытием, а не списком файлов.
 *
 * Поломка, ради которой это завели: 18.10.2026 рендереры потеряли право
 * открывать /dev/nvidia*, но узлы остались на месте. Проверка по списку
 * отвечала «карта есть», и каждый рендер 30 секунд ждал невозможного WebGL.
 */
import { describe, expect, it } from 'vitest';

import { gpuUnavailableMessage, probeGpuAccess } from '../../src/server/gpu-access.js';

/** Фальшивый /dev: список узлов и то, какие из них не открываются. */
function fakeDev(nodes, denied = {}) {
    const opened = [];
    const closed = [];
    return {
        opened,
        closed,
        deps: {
            devDir: '/dev',
            readdir: () => nodes,
            open: (path) => {
                const name = path.split('/').pop();
                if (denied[name]) {
                    const err = new Error(`${denied[name]}: open ${path}`);
                    err.code = denied[name];
                    throw err;
                }
                opened.push(name);
                return opened.length;
            },
            close: (fd) => closed.push(fd),
        },
    };
}

describe('положена ли карта вообще', () => {
    it('нет узлов nvidiaN — CPU-бокс, не поломка', () => {
        const dev = fakeDev(['null', 'tty', 'nvidiactl']);
        expect(probeGpuAccess(dev.deps)).toEqual({ expected: false, accessible: false, reason: null });
    });

    it('/dev не читается — тоже считаем, что карты нет', () => {
        const deps = { ...fakeDev([]).deps, readdir: () => { throw new Error('EACCES'); } };
        expect(probeGpuAccess(deps).expected).toBe(false);
    });
});

describe('открывается ли она', () => {
    it('всё открывается — карта доступна, и всё открытое закрыто', () => {
        const dev = fakeDev(['nvidiactl', 'nvidia1', 'nvidia-uvm']);
        expect(probeGpuAccess(dev.deps)).toEqual({ expected: true, accessible: true, reason: null });
        expect(dev.opened).toEqual(['nvidiactl', 'nvidia1']);
        expect(dev.closed).toHaveLength(2);
    });

    it('узлы на месте, а nvidiactl не открыть — ровно случай 18.10', () => {
        const dev = fakeDev(['nvidiactl', 'nvidia1'], { nvidiactl: 'EPERM' });
        expect(probeGpuAccess(dev.deps)).toEqual({
            expected: true,
            accessible: false,
            reason: 'nvidiactl: EPERM',
        });
    });

    it('не открывается сама карта — называем её в причине', () => {
        const dev = fakeDev(['nvidiactl', 'nvidia2'], { nvidia2: 'EACCES' });
        const result = probeGpuAccess(dev.deps);
        expect(result.accessible).toBe(false);
        expect(result.reason).toBe('nvidia2: EACCES');
    });

    it('проверяет свою карту, а не нулевую', () => {
        // Контейнер, привязанный к карте 3, видит только /dev/nvidia3.
        const dev = fakeDev(['nvidiactl', 'nvidia3']);
        probeGpuAccess(dev.deps);
        expect(dev.opened).toContain('nvidia3');
    });

    it('из нескольких карт берёт первую по порядку', () => {
        const dev = fakeDev(['nvidia2', 'nvidiactl', 'nvidia0', 'nvidia1']);
        probeGpuAccess(dev.deps);
        expect(dev.opened).toEqual(['nvidiactl', 'nvidia0']);
    });
});

describe('текст для оператора', () => {
    it('говорит, что сломано и что делать', () => {
        const message = gpuUnavailableMessage('nvidiactl: EPERM');
        expect(message).toContain('nvidiactl: EPERM');
        expect(message).toContain('перезапустите контейнеры рендера');
    });
});
