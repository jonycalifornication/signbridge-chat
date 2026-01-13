import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { CC_BONE_MAP } from './cc-bone-map.js';

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
                console.log(`[VRM-Loader] Loaded GLTF: ${path}`);
                const vrm = gltf.userData.vrm;
                if (!vrm) {
                    console.error(`[VRM-Loader] VRM data not found in GLTF: ${path}`);
                    return;
                }
                console.log(`[VRM-Loader] VRM object found. Configuring...`);
                configureVRM(vrm, config);
                resolve(vrm);
            },
            (progress) => {
                console.log(`[VRM-Loader] Loading... ${(progress.loaded / progress.total * 100).toFixed(2)}%`);
            },
            (error) => {
                console.error(`[VRM-Loader] Error loading ${path}:`, error);
                reject(error);
            }
        );
    });
}



/**
 * Configure VRM model with position, scale, and rotation
 * @param {Object} vrm - VRM model object
 * @param {Object} config - Configuration with avatar settings
 */
export function configureVRM(vrm, config) {
    // Optimize VRM - use combineSkeletons instead of deprecated methods
    if (vrm?.scene) {
        VRMUtils.combineSkeletons(vrm.scene);
    }

    // Attempt to map CC bones if present
    applyCCBoneMapping(vrm);

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
 * Apply Character Creator bone mapping to VRM
 * @param {Object} vrm - VRM model object
 */
function applyCCBoneMapping(vrm) {
    console.log('[VRM-Loader] Starting CC Bone Mapping...');

    if (!vrm?.scene) {
        console.warn('[VRM-Loader] VRM scene not found');
        return;
    }

    if (!vrm?.humanoid) {
        console.warn('[VRM-Loader] VRM humanoid not found');
        return;
    }

    // Debug: Print existing bones
    const existingBones = Object.keys(vrm.humanoid.humanBones || {}).length;
    console.log(`[VRM-Loader] Existing humanBones count: ${existingBones}`);

    let remappedCount = 0;
    let notFoundCount = 0;

    for (const [ccBoneName, vrmBoneName] of Object.entries(CC_BONE_MAP)) {
        // Find the bone in the scene
        const boneNode = vrm.scene.getObjectByName(ccBoneName);

        if (boneNode) {
            // Assign to VRM humanoid - structure depends on three-vrm version
            // For @pixiv/three-vrm 3.0, humanBones is { [name]: { node: Object3D, ... } }
            if (!vrm.humanoid.humanBones[vrmBoneName]) {
                vrm.humanoid.humanBones[vrmBoneName] = [];
            }

            // We set/overwrite the node for this bone
            vrm.humanoid.humanBones[vrmBoneName] = {
                node: boneNode
            };

            // console.log(`[VRM-Loader] Mapped ${ccBoneName} -> ${vrmBoneName}`);
            remappedCount++;
        } else {
            // Only log the first few missing ones to avoid spam
            if (notFoundCount < 3) {
                console.warn(`[VRM-Loader] Could not find bone: ${ccBoneName}`);
            }
            notFoundCount++;
        }
    }

    console.log(`[VRM-Loader] Bone Mapping Complete.`);
    console.log(`[VRM-Loader] Successfully remapped: ${remappedCount}`);
    console.log(`[VRM-Loader] Not found: ${notFoundCount}`);

    // Verify the update
    const newCount = Object.keys(vrm.humanoid.humanBones || {}).length;
    console.log(`[VRM-Loader] New humanBones count: ${newCount}`);
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
