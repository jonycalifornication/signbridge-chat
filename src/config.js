/**
 * Application configuration
 * @typedef {Object} AvatarConfig
 * @property {string} defaultAvatar - Default avatar name
 * @property {Object.<string, string>} avatars - Avatar name to VRM path mapping
 * @property {Object.<string, string>} animations - Animation name to VRMA path mapping
 * @property {Object} camera - Camera configuration
 * @property {Object} avatar - Avatar positioning configuration
 * @property {Object} widget - Widget display configuration
 * @property {Object} lights - Lighting configuration
 * @readonly
 */
export const CONFIG = Object.freeze({
    defaultAvatar: 'Aibek',
    speechSpeed: 150, // ms per character (higher = slower)

    /** @type {Object.<string, string|Object>} */
    avatars: {
        'Aidana': { path: '/alicia1.0.vrm', rotation: 0 },
        'Aibek': '/AliciaSolidmen.vrm',
    },

    /** @type {Object.<string, string>} */
    animations: {
        hello: '/hello.vrma',
        alaqan: '/alaqan_2.vrma',
        алақан: "/alaqan.vrma",
        аурухана: "/аурыхана.vrma",
        aga: "/aga.vrma",
        ana: "/ana.vrma",
        сүйек: "/сүйек.vrma",
        аялдама: "/аялдама.vrma",
        мектеп: "/мектеп.vrma",
        театр: "/театр.vrma",
    },

    camera: {
        posX: 0.0,
        posY: 1.3,
        posZ: 2.5,
        fov: 35.0,
    },

    avatar: {
        position: { x: 0, y: -1, z: 0.75 },
        scale: 1.4,
    },

    widget: {
        transparent: true,
        width: 400,
        height: 500,
    },

    lights: {
        intensity: 1.3,
    },

    /** Motion capture configuration */
    mocap: {
        mediapipe: {
            modelComplexity: 1,
            smoothLandmarks: true,
            minDetectionConfidence: 0.7,
            minTrackingConfidence: 0.7,
        },
        camera: {
            width: 640,
            height: 480,
        },
        smoothing: 0.5,
    },
});
