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
const ENV = import.meta.env || {};

const readEnv = (name, fallback = '') => {
    const value = ENV[name];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
};

const getModuleOrigin = () => {
    const moduleUrl = typeof import.meta !== 'undefined' ? import.meta.url : '';
    if (!moduleUrl.startsWith('http://') && !moduleUrl.startsWith('https://')) {
        return '';
    }

    try {
        return new URL(moduleUrl).origin;
    } catch {
        return '';
    }
};

const normalizeApiUrl = (value) => {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';

    // Keep absolute URLs as-is.
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed;
    }

    // Resolve relative API URLs against widget script origin (not host page origin).
    if (trimmed.startsWith('/')) {
        const origin = getModuleOrigin();
        return origin ? `${origin}${trimmed}` : trimmed;
    }

    return trimmed;
};

export const CONFIG = Object.freeze({
    defaultAvatar: 'Aibek',
    speechSpeed: 150, // ms per character (higher = slower)

    // API settings (configured via .env / Vite env vars)
    apiUrl: normalizeApiUrl(readEnv('VITE_API_URL', '/api/v1')),
    apiKey: readEnv('VITE_API_KEY', ''), // X-API-Key for signBridgeStorage translate endpoint
    languageId: readEnv('VITE_LANGUAGE_ID', 'kz_KSL'),

    // Telegram Error Logging config
    telegram: {
        botToken: readEnv('VITE_TG_BOT_TOKEN', '8723076091:AAGpkQwerwh_lubAJKO7C8IZdCUM6PkQneY'),
        chatId: readEnv('VITE_TG_CHAT_ID', '-5133993969')
    },

    /** @type {Object.<string, string|Object>} */
    avatars: {
        'Aidana': { path: '/alicia1.0.vrm', rotation: 0 },
        'Aibek': 'https://storage.yandexcloud.kz/signbridge-animations/%D0%B0%D0%B2%D0%B0%D1%82%D0%B0%D1%80.vrm',
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
        posZ: 3,
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
