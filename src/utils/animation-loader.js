import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy } from '@pixiv/three-vrm-animation';

/**
 * Create and configure an animation loader
 * @returns {GLTFLoader} Configured GLTF loader with VRM Animation plugin
 */
export function createAnimationLoader() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
    return loader;
}

/**
 * Load animation from URL with caching
 * @param {string} url - URL to animation file
 * @param {Object} vrm - VRM model to apply animation to
 * @param {Map} cache - Animation cache map
 * @returns {Promise<Object|null>} Animation clip or null if failed
 */
export async function loadAnimation(url, vrm, cache = null) {
    // Check cache first
    if (cache?.has(url)) {
        return cache.get(url);
    }

    if (!vrm) {
        console.error('VRM model not loaded');
        return null;
    }

    try {
        const loader = createAnimationLoader();
        const gltf = await loader.loadAsync(url);
        const clip = extractAnimationClip(gltf, vrm);

        // Cache if available
        if (cache && clip) {
            cache.set(url, clip);
        }

        return clip;
    } catch (error) {
        console.error(`Failed to load animation from ${url}:`, error);
        return null;
    }
}

/**
 * Extract animation clip from loaded GLTF
 * @param {Object} gltf - Loaded GLTF object
 * @param {Object} vrm - VRM model
 * @returns {Object|null} Animation clip or null
 */
function extractAnimationClip(gltf, vrm) {
    // Suppress "VRMLookAtQuaternionProxy is not found" warning by creating it manually
    if (vrm && vrm.lookAt) {
        let proxy = vrm.scene.children.find(obj => obj.name === 'VRMLookAtQuaternionProxy');
        if (!proxy) {
            proxy = new VRMLookAtQuaternionProxy(vrm.lookAt);
            proxy.name = 'VRMLookAtQuaternionProxy';
            vrm.scene.add(proxy);
        }
    }

    // Try VRM animations first
    if (gltf.userData.vrmAnimations?.length > 0) {
        return createVRMAnimationClip(gltf.userData.vrmAnimations[0], vrm);
    }

    if (gltf.userData.vrmAnimation) {
        return createVRMAnimationClip(gltf.userData.vrmAnimation, vrm);
    }

    // Fallback to standard GLTF animations
    if (gltf.animations?.length > 0) {
        return gltf.animations[0];
    }

    console.warn('No animations found in GLTF');
    return null;
}
