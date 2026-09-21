/**
 * Размер кадра видео — одно место на весь рендер.
 *
 * Кадр — это viewport страницы аватара: инжектируемый рендерер кодирует ровно
 * window.innerWidth × window.innerHeight. У камеры аватара зафиксирован
 * вертикальный угол, а горизонтальный она берёт из пропорций кадра. Поэтому
 * более широкий кадр — это буквально полоса свободного места по бокам при том
 * же росте и положении аватара, а не отъехавшая камера.
 *
 * Портретные 768×1024 обрезали широкие жесты: руки, разведённые в стороны,
 * упирались в края кадра. 1280×1024 оставляет вертикальную рамку прежней и
 * добавляет эти поля по бокам.
 */
export const DEFAULT_FRAME_WIDTH = 1280;
export const DEFAULT_FRAME_HEIGHT = 1024;

// Нижняя граница — от опечатки вроде RENDER_WIDTH=12, верхняя — от кадра,
// который энкодер на CPU уже не вывезет. Стороны округляются вниз до чётных:
// их хотят и VP8, и ffmpeg с yuv420p.
const MIN_SIDE = 320;
const MAX_SIDE = 2160;

function resolveSide(rawValue, fallback) {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(MIN_SIDE, Math.min(parsed, MAX_SIDE)) & ~1;
}

/** @returns {{width: number, height: number}} */
export function resolveFrameSize(env = process.env) {
    return {
        width: resolveSide(env.RENDER_WIDTH, DEFAULT_FRAME_WIDTH),
        height: resolveSide(env.RENDER_HEIGHT, DEFAULT_FRAME_HEIGHT),
    };
}
