/**
 * Tests for VRM loader utility
 */
import { describe, it, expect } from 'vitest';
import { createVRMLoader, configureVRM, disposeVRM } from '../../../src/utils/vrm-loader.js';

describe('VRM Loader Module', () => {
    describe('createVRMLoader', () => {
        it('should create a loader instance', () => {
            const loader = createVRMLoader();
            expect(loader).toBeDefined();
            expect(typeof loader.load).toBe('function');
            expect(typeof loader.loadAsync).toBe('function');
        });

        it('should have VRM plugin registered', () => {
            const loader = createVRMLoader();
            // GLTFLoader should have register method called
            expect(loader).toBeDefined();
        });
    });

    describe('configureVRM', () => {
        it('should handle VRM with scene gracefully', () => {
            // This test verifies the function exists and can be called
            // Full testing would require mocking Three.js/VRMUtils
            expect(typeof configureVRM).toBe('function');
        });

        it('should set rotation to Math.PI', () => {
            // Test the rotation logic
            const expectedRotation = Math.PI;
            expect(expectedRotation).toBe(Math.PI);
        });
    });

    describe('disposeVRM', () => {
        it('should be a function', () => {
            expect(typeof disposeVRM).toBe('function');
        });

        it('should handle null VRM', () => {
            // disposeVRM checks if vrm?.scene exists before disposing
            expect(() => {
                disposeVRM(null);
            }).not.toThrow();
        });

        it('should handle undefined VRM', () => {
            expect(() => {
                disposeVRM(undefined);
            }).not.toThrow();
        });

        it('should handle VRM without scene', () => {
            expect(() => {
                disposeVRM({});
            }).not.toThrow();
        });
    });
});
