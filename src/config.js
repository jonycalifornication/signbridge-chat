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

    /** @type {Object.<string, string>} */
    avatars: {
        'Aidana': '/AINaz.vrm',
        'Ainaz': '/AINaz.vrm',
        'Aibek': '/AliciaSolidmen.vrm',
    },

    /** @type {Object.<string, string>} */
    animations: {
        idle: '/idle.vrma',
        hello: '/some.vrma',
    },

    camera: {
        posX: 0.0,
        posY: 1.3,
        posZ: 2.5,
        fov: 35.0,
    },

    avatar: {
        position: { x: 0, y: -0.5, z: 0 },
        scale: 1.2,
    },

    widget: {
        transparent: true,
        width: 400,
        height: 500,
    },

    lights: {
        intensity: 1.3,
    },
});
