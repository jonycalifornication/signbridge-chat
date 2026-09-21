import { describe, expect, it } from 'vitest';

import {
    DEFAULT_FRAME_HEIGHT,
    DEFAULT_FRAME_WIDTH,
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
