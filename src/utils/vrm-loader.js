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

    // Fix for Mobile WebGL bug: disable MToon outlines causing black artifacts
    if (vrm?.scene) {
        vrm.scene.traverse((obj) => {
            if (obj.isMesh && obj.material) {
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                materials.forEach(m => {
                    if (m.isMToonMaterial || m.type === 'MToonMaterial' || m.name.includes('Outline')) {
                        // Remove outlines which break depth buffers on mobile devices
                        m.outlineWidthFactor = 0;
                        if (m.userData && m.userData.outlineWidthMode) {
                            m.userData.outlineWidthMode = 'none';
                        }
                        m.needsUpdate = true;
                    }
                });
            }
        });
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
    // VRM 0.0 usually needs 180 degree rotation to face +Z.
    // VRM 1.0 usually faces +Z natively.
    const isVRM0 = vrm.meta && (vrm.meta.version === '0' || vrm.meta.version === '0.0' || !vrm.meta.version);

    // Check if the metadata suggests it's 1.0 (often indicated by absence of version '0' fields or presence of specific 1.0 meta)
    // Simple heuristic: If it's V0, rotate. If V1, don't.
    // However, safest is to default to PI (old behavior) unless it's explicitly 1.0

    // Detecting VRM 1.0 via meta property existence structure
    // standard three-vrm behavior: vrm.meta (V0) vs vrm.vrm (V1?) 
    // Actually, newer three-vrm unifies them.

    // Let's assume user works with standard avatars.
    // We can allow config to override this too.

    let rotation = Math.PI;
    if (config?.avatar?.rotation !== undefined) {
        rotation = config.avatar.rotation;
    } else {
        // Auto-detect attempt
        if (vrm.meta?.metaVersion === '1.0' || (vrm.meta?.version && vrm.meta.version.includes('1.0'))) {
            rotation = 0;
        }
    }

    vrm.scene.rotation.y = rotation;
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
