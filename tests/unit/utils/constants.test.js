/**
 * Tests for constants module
 */
import { describe, it, expect } from 'vitest';
import {
    CAMERA_DEFAULTS,
    ANIMATION_DEFAULTS,
    RENDERER_DEFAULTS,
    LIGHTS
} from '../../../src/utils/constants.js';

describe('Constants Module', () => {
    describe('CAMERA_DEFAULTS', () => {
        it('should have all required camera properties', () => {
            expect(CAMERA_DEFAULTS).toHaveProperty('FOV');
            expect(CAMERA_DEFAULTS).toHaveProperty('NEAR');
            expect(CAMERA_DEFAULTS).toHaveProperty('FAR');
        });

        it('should have correct types', () => {
            expect(typeof CAMERA_DEFAULTS.FOV).toBe('number');
            expect(typeof CAMERA_DEFAULTS.NEAR).toBe('number');
            expect(typeof CAMERA_DEFAULTS.FAR).toBe('number');
        });

        it('should have valid values', () => {
            expect(CAMERA_DEFAULTS.FOV).toBeGreaterThan(0);
            expect(CAMERA_DEFAULTS.NEAR).toBeGreaterThan(0);
            expect(CAMERA_DEFAULTS.FAR).toBeGreaterThan(CAMERA_DEFAULTS.NEAR);
        });
    });

    describe('ANIMATION_DEFAULTS', () => {
        it('should have all required animation properties', () => {
            expect(ANIMATION_DEFAULTS).toHaveProperty('FADE_DURATION');
            expect(ANIMATION_DEFAULTS).toHaveProperty('PAUSE_BETWEEN_ANIMATIONS');
            expect(ANIMATION_DEFAULTS).toHaveProperty('CROSSFADE_DURATION');
        });

        it('should have correct types', () => {
            expect(typeof ANIMATION_DEFAULTS.FADE_DURATION).toBe('number');
            expect(typeof ANIMATION_DEFAULTS.PAUSE_BETWEEN_ANIMATIONS).toBe('number');
            expect(typeof ANIMATION_DEFAULTS.CROSSFADE_DURATION).toBe('number');
        });

        it('should have positive values', () => {
            expect(ANIMATION_DEFAULTS.FADE_DURATION).toBeGreaterThan(0);
            expect(ANIMATION_DEFAULTS.PAUSE_BETWEEN_ANIMATIONS).toBeGreaterThanOrEqual(0);
            expect(ANIMATION_DEFAULTS.CROSSFADE_DURATION).toBeGreaterThan(0);
        });
    });

    describe('RENDERER_DEFAULTS', () => {
        it('should have all required renderer properties', () => {
            expect(RENDERER_DEFAULTS).toHaveProperty('ANTIALIAS');
            expect(RENDERER_DEFAULTS).toHaveProperty('ALPHA');
            expect(RENDERER_DEFAULTS).toHaveProperty('MAX_PIXEL_RATIO');
        });

        it('should have correct types', () => {
            expect(typeof RENDERER_DEFAULTS.ANTIALIAS).toBe('boolean');
            expect(typeof RENDERER_DEFAULTS.ALPHA).toBe('boolean');
            expect(typeof RENDERER_DEFAULTS.MAX_PIXEL_RATIO).toBe('number');
        });

        it('should have valid pixel ratio', () => {
            expect(RENDERER_DEFAULTS.MAX_PIXEL_RATIO).toBeGreaterThan(0);
            expect(RENDERER_DEFAULTS.MAX_PIXEL_RATIO).toBeLessThanOrEqual(4);
        });
    });

    describe('LIGHTS', () => {
        it('should have all required light properties', () => {
            expect(LIGHTS).toHaveProperty('DIRECTIONAL_INTENSITY');
            expect(LIGHTS).toHaveProperty('AMBIENT_INTENSITY');
        });

        it('should have correct types', () => {
            expect(typeof LIGHTS.DIRECTIONAL_INTENSITY).toBe('number');
            expect(typeof LIGHTS.AMBIENT_INTENSITY).toBe('number');
        });

        it('should have reasonable intensity values', () => {
            expect(LIGHTS.DIRECTIONAL_INTENSITY).toBeGreaterThan(0);
            expect(LIGHTS.AMBIENT_INTENSITY).toBeGreaterThan(0);
        });
    });
});
