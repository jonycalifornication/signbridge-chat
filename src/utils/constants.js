/**
 * Application constants
 * @module constants
 */

export const CAMERA_DEFAULTS = {
    FOV: 35.0,
    NEAR: 0.1,
    FAR: 20.0
};

export const ANIMATION_DEFAULTS = {
    FADE_DURATION: 0.15,
    PAUSE_BETWEEN_ANIMATIONS: 150, // ms (shortened for smoother sequences)
    CROSSFADE_DURATION: 0.08, // ms (very short blend to avoid losing the first frames of a sign)
    DEFAULT_PLAYBACK_SPEED: 1.0,
    REST_POSE_FADE_DURATION: 0.15 // ms (faster return to rest pose)
};

export const RENDERER_DEFAULTS = {
    ANTIALIAS: true,
    ALPHA: true,
    MAX_PIXEL_RATIO: 2
};

export const LIGHTS = {
    DIRECTIONAL_INTENSITY: 1.3,
    AMBIENT_INTENSITY: 0.6
};
