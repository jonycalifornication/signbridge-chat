/**
 * Tests for config module
 */
import { describe, it, expect } from 'vitest';
import { CONFIG } from '../../src/config.js';

describe('Config Module', () => {
    describe('Object immutability', () => {
        it('should be frozen', () => {
            expect(Object.isFrozen(CONFIG)).toBe(true);
        });

        it('should not allow property modification', () => {
            expect(() => {
                CONFIG.defaultAvatar = 'test';
            }).toThrow();
        });

        it('should not allow property deletion', () => {
            expect(() => {
                delete CONFIG.defaultAvatar;
            }).toThrow();
        });
    });

    describe('Structure validation', () => {
        it('should have all required top-level properties', () => {
            expect(CONFIG).toHaveProperty('defaultAvatar');
            expect(CONFIG).toHaveProperty('avatars');
            expect(CONFIG).toHaveProperty('animations');
            expect(CONFIG).toHaveProperty('camera');
            expect(CONFIG).toHaveProperty('avatar');
            expect(CONFIG).toHaveProperty('widget');
            expect(CONFIG).toHaveProperty('lights');
        });

        it('should have correct types', () => {
            expect(typeof CONFIG.defaultAvatar).toBe('string');
            expect(typeof CONFIG.avatars).toBe('object');
            expect(typeof CONFIG.animations).toBe('object');
            expect(typeof CONFIG.camera).toBe('object');
            expect(typeof CONFIG.avatar).toBe('object');
            expect(typeof CONFIG.widget).toBe('object');
            expect(typeof CONFIG.lights).toBe('object');
        });
    });

    describe('Avatars configuration', () => {
        it('should have at least one avatar', () => {
            expect(Object.keys(CONFIG.avatars).length).toBeGreaterThan(0);
        });

        it('should have default avatar in avatars list', () => {
            expect(CONFIG.avatars).toHaveProperty(CONFIG.defaultAvatar);
        });

        it('all avatar paths should be strings', () => {
            Object.values(CONFIG.avatars).forEach(entry => {
                if (typeof entry === 'object') {
                    expect(typeof entry.path).toBe('string');
                    expect(entry.path.length).toBeGreaterThan(0);
                } else {
                    expect(typeof entry).toBe('string');
                    expect(entry.length).toBeGreaterThan(0);
                }
            });
        });
    });

    describe('Animations configuration', () => {
        it('should have at least one animation', () => {
            expect(Object.keys(CONFIG.animations).length).toBeGreaterThan(0);
        });

        it('all animation paths should be strings', () => {
            Object.values(CONFIG.animations).forEach(path => {
                expect(typeof path).toBe('string');
                expect(path.length).toBeGreaterThan(0);
            });
        });
    });

    describe('Camera configuration', () => {
        it('should have all camera properties', () => {
            expect(CONFIG.camera).toHaveProperty('posX');
            expect(CONFIG.camera).toHaveProperty('posY');
            expect(CONFIG.camera).toHaveProperty('posZ');
            expect(CONFIG.camera).toHaveProperty('fov');
        });

        it('should have numeric values', () => {
            expect(typeof CONFIG.camera.posX).toBe('number');
            expect(typeof CONFIG.camera.posY).toBe('number');
            expect(typeof CONFIG.camera.posZ).toBe('number');
            expect(typeof CONFIG.camera.fov).toBe('number');
        });

        it('should have valid FOV', () => {
            expect(CONFIG.camera.fov).toBeGreaterThan(0);
            expect(CONFIG.camera.fov).toBeLessThan(180);
        });
    });

    describe('Avatar positioning', () => {
        it('should have position object', () => {
            expect(CONFIG.avatar).toHaveProperty('position');
            expect(typeof CONFIG.avatar.position).toBe('object');
        });

        it('should have x, y, z coordinates', () => {
            expect(CONFIG.avatar.position).toHaveProperty('x');
            expect(CONFIG.avatar.position).toHaveProperty('y');
            expect(CONFIG.avatar.position).toHaveProperty('z');
        });

        it('should have scale property', () => {
            expect(CONFIG.avatar).toHaveProperty('scale');
            expect(typeof CONFIG.avatar.scale).toBe('number');
            expect(CONFIG.avatar.scale).toBeGreaterThan(0);
        });
    });

    describe('Widget configuration', () => {
        it('should have all widget properties', () => {
            expect(CONFIG.widget).toHaveProperty('transparent');
            expect(CONFIG.widget).toHaveProperty('width');
            expect(CONFIG.widget).toHaveProperty('height');
        });

        it('should have valid dimensions', () => {
            expect(typeof CONFIG.widget.width).toBe('number');
            expect(typeof CONFIG.widget.height).toBe('number');
            expect(CONFIG.widget.width).toBeGreaterThan(0);
            expect(CONFIG.widget.height).toBeGreaterThan(0);
        });
    });

    describe('Lights configuration', () => {
        it('should have intensity property', () => {
            expect(CONFIG.lights).toHaveProperty('intensity');
            expect(typeof CONFIG.lights.intensity).toBe('number');
            expect(CONFIG.lights.intensity).toBeGreaterThan(0);
        });
    });
});
