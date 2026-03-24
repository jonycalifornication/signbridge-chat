import * as THREE from 'three';

/**
 * Rest pose (interpreter pause stance) quaternions extracted from
 * 7122a6a7-51e0-4d42-9a09-13e651a0491b_pause.vrma
 *
 * Hardcoded for instant loading without HTTP requests.
 * Identity quaternions (0,0,0,1) are omitted.
 *
 * @module utils/rest-pose
 */

/**
 * Rest pose quaternions for all non-identity bones.
 * Keys are VRM humanoid bone names.
 * @type {Object.<string, {x: number, y: number, z: number, w: number}>}
 */
export const REST_POSE_QUATERNIONS = {
    // Body & Head
    'hips':             { x: -0.0002, y:  0.0215, z:  0.0004, w:  0.9998 },
    'chest':            { x:  0.0000, y: -0.0000, z:  0.0034, w:  1.0000 },
    'upperChest':       { x: -0.0002, y:  0.0239, z: -0.0026, w:  0.9997 },
    'head':             { x:  0.0541, y:  0.0294, z:  0.0198, w: -0.9979 },

    // Left Arm
    'leftShoulder':           { x: -0.0000, y: -0.0000, z:  0.0462, w:  0.9989 },
    'leftUpperArm':           { x:  0.1301, y: -0.0729, z:  0.4624, w:  0.8741 },
    'leftLowerArm':           { x: -0.1051, y: -0.4140, z:  0.5160, w:  0.7425 },
    'leftHand':               { x: -0.2571, y: -0.0781, z:  0.3387, w:  0.9017 },
    'leftThumbMetacarpal':    { x: -0.0019, y: -0.0721, z: -0.0053, w: -0.9974 },
    'leftThumbProximal':      { x:  0.0006, y: -0.2378, z: -0.0013, w: -0.9713 },
    'leftIndexProximal':      { x:  0.0446, y: -0.0071, z:  0.1348, w:  0.9899 },
    'leftIndexIntermediate':  { x:  0.0067, y:  0.0769, z:  0.0583, w:  0.9953 },
    'leftMiddleProximal':     { x: -0.0064, y: -0.0140, z:  0.1494, w:  0.9887 },
    'leftMiddleIntermediate': { x: -0.0073, y:  0.0348, z:  0.1061, w:  0.9937 },
    'leftRingProximal':       { x: -0.0010, y: -0.0292, z:  0.0945, w:  0.9951 },
    'leftRingIntermediate':   { x:  0.0080, y:  0.0250, z:  0.1166, w:  0.9928 },
    'leftLittleProximal':     { x:  0.0036, y: -0.0282, z:  0.0607, w:  0.9977 },
    'leftLittleIntermediate': { x:  0.0105, y:  0.0254, z:  0.1100, w:  0.9936 },

    // Right Arm
    'rightShoulder':           { x: -0.0000, y:  0.0000, z: -0.0628, w:  0.9980 },
    'rightUpperArm':           { x:  0.1639, y: -0.0089, z: -0.4633, w:  0.8709 },
    'rightLowerArm':           { x: -0.0655, y:  0.3581, z: -0.5799, w:  0.7288 },
    'rightHand':               { x: -0.3460, y:  0.0768, z: -0.2395, w:  0.9039 },
    'rightThumbProximal':      { x:  0.1061, y: -0.2991, z: -0.1799, w:  0.9311 },
    'rightIndexIntermediate':  { x: -0.0466, y: -0.0018, z: -0.1820, w:  0.9822 },
    'rightMiddleIntermediate': { x: -0.0323, y: -0.0263, z: -0.1904, w:  0.9808 },
    'rightRingIntermediate':   { x:  0.0119, y: -0.0769, z: -0.1625, w:  0.9836 },
    'rightLittleIntermediate': { x:  0.0079, y: -0.0219, z: -0.2295, w:  0.9730 },

    // Legs
    'leftUpperLeg':  { x:  0.0000, y:  0.0000, z: -0.0000, w: -1.0000 },
    'leftFoot':      { x: -0.0168, y:  0.0210, z: -0.0028, w: -0.9996 },
    'rightUpperLeg': { x: -0.0000, y: -0.0000, z:  0.0000, w: -1.0000 },
    'rightFoot':     { x: -0.0161, y:  0.0206, z: -0.0027, w: -0.9997 },
};

/**
 * Create a single-frame AnimationClip from the hardcoded rest pose quaternions.
 * Instant — no HTTP requests needed.
 *
 * @param {Object} vrm - VRM model instance (needs vrm.humanoid)
 * @returns {THREE.AnimationClip|null} Rest pose clip or null
 */
export function createRestPoseClip(vrm) {
    if (!vrm?.humanoid) {
        console.warn('[RestPose] VRM has no humanoid, cannot create rest pose clip');
        return null;
    }

    const tracks = [];
    const times = [0]; // single keyframe at t=0

    for (const [boneName, quat] of Object.entries(REST_POSE_QUATERNIONS)) {
        const node = vrm.humanoid.getNormalizedBoneNode?.(boneName)
            || vrm.humanoid.getRawBoneNode?.(boneName)
            || vrm.humanoid.getBoneNode?.(boneName);

        if (!node) continue;

        tracks.push(new THREE.QuaternionKeyframeTrack(
            `${node.name}.quaternion`,
            times,
            [quat.x, quat.y, quat.z, quat.w]
        ));
    }

    if (tracks.length === 0) {
        console.warn('[RestPose] No tracks created');
        return null;
    }

    console.log(`[RestPose] Created rest pose clip with ${tracks.length} tracks (inline quaternions)`);
    return new THREE.AnimationClip('restPose', 0.01, tracks);
}
