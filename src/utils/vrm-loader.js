import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

/**
 * Create and configure a VRM loader
 * @returns {GLTFLoader} Configured GLTF loader with VRM plugin
 */
export function createVRMLoader() {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    return loader;
}

/**
 * Load a VRM model from path
 * @param {string} path - Path to VRM file
 * @param {Object} config - Configuration object for avatar positioning
 * @returns {Promise<Object>} Promise resolving to VRM object
 */
export async function loadVRMModel(path, config) {
    const loader = createVRMLoader();

    return new Promise((resolve, reject) => {
        loader.load(
            path,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                configureVRM(vrm, config);
                resolve(vrm);
            },
            undefined,
            (error) => reject(error)
        );
    });
}

/**
 * Configure VRM model with position, scale, and rotation
 * @param {Object} vrm - VRM model object
 * @param {Object} config - Configuration with avatar settings
 */
export function configureVRM(vrm, config) {
    // Remove unnecessary data for optimization
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.removeUnnecessaryJoints(vrm.scene);

    // Apply configuration
    if (config?.avatar) {
        const { position, scale } = config.avatar;
        vrm.scene.position.set(position.x, position.y, position.z);
        vrm.scene.scale.setScalar(scale);
    }

    // Face camera (180° rotation)
    vrm.scene.rotation.y = Math.PI;
}

/**
 * Clean up VRM resources
 * @param {Object} vrm - VRM model to dispose
 */
export function disposeVRM(vrm) {
    if (vrm?.scene) {
        VRMUtils.deepDispose(vrm.scene);
    }
}
