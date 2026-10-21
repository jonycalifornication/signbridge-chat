/**
 * Видит ли контейнер видеокарту на самом деле.
 *
 * Узел в /dev — ещё не доступ к нему. 18.10.2026 у всех рендереров на боксе
 * слетели права на /dev/nvidia*: известная беда Docker с драйвером cgroup
 * systemd — после `systemctl daemon-reload` на хосте systemd заново применяет
 * правила устройств к запущенным контейнерам и выбрасывает из них то, что
 * добавил хук NVIDIA. Узлы остались на месте, прежняя проверка по списку
 * файлов отвечала «карта есть», Chrome стартовал без программного
 * растеризатора — и каждый рендер 30 секунд ждал виджет, которому не создать
 * WebGL. 21.10 так легла вся лекция, а в логе стояло только
 * «Timed out ... waiting for window.avatarWidget to be constructed».
 *
 * Поэтому доступ проверяем открытием — ровно тем, что потом сделает драйвер.
 * Отдельным файлом, чтобы проверить тестом без настоящего /dev.
 */
import fs from 'node:fs';

const CARD_NODE = /^nvidia\d+$/;

/**
 * @returns {{ expected: boolean, accessible: boolean, reason: string | null }}
 *   expected   — карта контейнеру положена (в /dev есть nvidiaN);
 *   accessible — и она открывается;
 *   reason     — что именно не открылось: идёт в текст ошибки.
 */
export function probeGpuAccess({
    devDir = '/dev',
    readdir = fs.readdirSync,
    open = fs.openSync,
    close = fs.closeSync,
} = {}) {
    let cards;
    try {
        cards = readdir(devDir).filter((name) => CARD_NODE.test(name)).sort();
    } catch {
        cards = [];
    }
    // Карт нет вовсе — это CPU-бокс, а не поломка.
    if (cards.length === 0) return { expected: false, accessible: false, reason: null };

    // nvidiactl нужен любому клиенту драйвера; карта — та, на которой рисуем
    // (контейнер видит только свои: NVIDIA_VISIBLE_DEVICES).
    for (const name of ['nvidiactl', cards[0]]) {
        try {
            close(open(`${devDir}/${name}`, 'r'));
        } catch (err) {
            return { expected: true, accessible: false, reason: `${name}: ${err.code || err.message}` };
        }
    }
    return { expected: true, accessible: true, reason: null };
}

/** Текст для оператора: что сломано и что с этим делать. */
export function gpuUnavailableMessage(reason) {
    return (
        `GPU недоступен контейнеру рендера (${reason}). ` +
        'Обычно это сброс прав на /dev/nvidia* после systemctl daemon-reload на хосте — ' +
        'перезапустите контейнеры рендера.'
    );
}
