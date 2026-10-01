import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    DEFAULT_FRAME_HEIGHT,
    DEFAULT_FRAME_WIDTH,
    SUBTITLE_STRIP_HEIGHT,
    resolveFrameSize
} from '../../src/headless/frame-size.js';

describe('frame size', () => {
    it('defaults to a frame wide enough for outstretched arms', () => {
        expect(resolveFrameSize({})).toEqual({
            width: DEFAULT_FRAME_WIDTH,
            height: DEFAULT_FRAME_HEIGHT
        });
        expect(DEFAULT_FRAME_WIDTH).toBeGreaterThan(768);
    });

    it('takes overrides from the environment', () => {
        expect(resolveFrameSize({ RENDER_WIDTH: '1440', RENDER_HEIGHT: '1080' }))
            .toEqual({ width: 1440, height: 1080 });
    });

    it('falls back on empty and malformed values', () => {
        expect(resolveFrameSize({ RENDER_WIDTH: '', RENDER_HEIGHT: 'wide' }))
            .toEqual({ width: DEFAULT_FRAME_WIDTH, height: DEFAULT_FRAME_HEIGHT });
    });

    it('clamps typos and keeps sides even for the encoder', () => {
        expect(resolveFrameSize({ RENDER_WIDTH: '12', RENDER_HEIGHT: '99999' }))
            .toEqual({ width: 320, height: 2160 });
        expect(resolveFrameSize({ RENDER_WIDTH: '1281', RENDER_HEIGHT: '1025' }))
            .toEqual({ width: 1280, height: 1024 });
    });
});

describe('subtitle strip', () => {
    it('is the same number the page draws', () => {
        // `subtitles.js` вставляется в чужую страницу обычным <script> и
        // импортировать ничего не может, поэтому число живёт в двух местах.
        // Разойдись они — копия «без подписи» приехала бы с полоской подписи
        // по верху или со срезанной макушкой аватара.
        const here = path.dirname(fileURLToPath(import.meta.url));
        const source = fs.readFileSync(path.join(here, '../../src/headless/subtitles.js'), 'utf8');
        const drawn = /const STRIP_HEIGHT = (\d+);/.exec(source);
        expect(drawn).not.toBeNull();
        expect(Number(drawn[1])).toBe(SUBTITLE_STRIP_HEIGHT);
    });

    it('keeps the frame height even, as VP8 and yuv420p want', () => {
        expect(SUBTITLE_STRIP_HEIGHT % 2).toBe(0);
    });
});
