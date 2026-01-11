/**
 * VRM to Character Creator (CC_Base) bone name mapping
 * Maps standard VRM humanoid bone names to CC_Base bone names
 * @module utils/cc-bone-map
 */

/**
 * VRM bone name to CC_Base bone name mapping
 * VRM uses camelCase, CC uses CC_Base_* prefix
 * @type {Object.<string, string>}
 */
export const VRM_TO_CC_BONE_MAP = {
    // Root/Pelvis
    'hips': 'CC_Base_Hip',

    // Spine
    'spine': 'CC_Base_Spine01',
    'chest': 'CC_Base_Spine02',
    'upperChest': 'CC_Base_Waist',

    // Head
    'neck': 'CC_Base_NeckTwist01',
    'head': 'CC_Base_Head',
    'leftEye': 'CC_Base_L_Eye',
    'rightEye': 'CC_Base_R_Eye',

    // Left Leg
    'leftUpperLeg': 'CC_Base_L_Thigh',
    'leftLowerLeg': 'CC_Base_L_Calf',
    'leftFoot': 'CC_Base_L_Foot',
    'leftToes': 'CC_Base_L_ToeBase',

    // Right Leg
    'rightUpperLeg': 'CC_Base_R_Thigh',
    'rightLowerLeg': 'CC_Base_R_Calf',
    'rightFoot': 'CC_Base_R_Foot',
    'rightToes': 'CC_Base_R_ToeBase',

    // Left Arm
    'leftShoulder': 'CC_Base_L_Clavicle',
    'leftUpperArm': 'CC_Base_L_Upperarm',
    'leftLowerArm': 'CC_Base_L_Forearm',
    'leftHand': 'CC_Base_L_Hand',

    // Right Arm
    'rightShoulder': 'CC_Base_R_Clavicle',
    'rightUpperArm': 'CC_Base_R_Upperarm',
    'rightLowerArm': 'CC_Base_R_Forearm',
    'rightHand': 'CC_Base_R_Hand',

    // Left Hand Fingers - Thumb
    'leftThumbMetacarpal': 'CC_Base_L_Thumb1',
    'leftThumbProximal': 'CC_Base_L_Thumb2',
    'leftThumbDistal': 'CC_Base_L_Thumb3',

    // Left Hand Fingers - Index
    'leftIndexProximal': 'CC_Base_L_Index1',
    'leftIndexIntermediate': 'CC_Base_L_Index2',
    'leftIndexDistal': 'CC_Base_L_Index3',

    // Left Hand Fingers - Middle
    'leftMiddleProximal': 'CC_Base_L_Mid1',
    'leftMiddleIntermediate': 'CC_Base_L_Mid2',
    'leftMiddleDistal': 'CC_Base_L_Mid3',

    // Left Hand Fingers - Ring
    'leftRingProximal': 'CC_Base_L_Ring1',
    'leftRingIntermediate': 'CC_Base_L_Ring2',
    'leftRingDistal': 'CC_Base_L_Ring3',

    // Left Hand Fingers - Little
    'leftLittleProximal': 'CC_Base_L_Pinky1',
    'leftLittleIntermediate': 'CC_Base_L_Pinky2',
    'leftLittleDistal': 'CC_Base_L_Pinky3',

    // Right Hand Fingers - Thumb
    'rightThumbMetacarpal': 'CC_Base_R_Thumb1',
    'rightThumbProximal': 'CC_Base_R_Thumb2',
    'rightThumbDistal': 'CC_Base_R_Thumb3',

    // Right Hand Fingers - Index
    'rightIndexProximal': 'CC_Base_R_Index1',
    'rightIndexIntermediate': 'CC_Base_R_Index2',
    'rightIndexDistal': 'CC_Base_R_Index3',

    // Right Hand Fingers - Middle
    'rightMiddleProximal': 'CC_Base_R_Mid1',
    'rightMiddleIntermediate': 'CC_Base_R_Mid2',
    'rightMiddleDistal': 'CC_Base_R_Mid3',

    // Right Hand Fingers - Ring
    'rightRingProximal': 'CC_Base_R_Ring1',
    'rightRingIntermediate': 'CC_Base_R_Ring2',
    'rightRingDistal': 'CC_Base_R_Ring3',

    // Right Hand Fingers - Little
    'rightLittleProximal': 'CC_Base_R_Pinky1',
    'rightLittleIntermediate': 'CC_Base_R_Pinky2',
    'rightLittleDistal': 'CC_Base_R_Pinky3',
};

/**
 * Reverse mapping: CC_Base to VRM bone names
 * @type {Object.<string, string>}
 */
export const CC_TO_VRM_BONE_MAP = Object.fromEntries(
    Object.entries(VRM_TO_CC_BONE_MAP).map(([vrm, cc]) => [cc, vrm])
);

/**
 * Get CC_Base bone name from VRM bone name
 * @param {string} vrmBoneName - VRM bone name
 * @returns {string|null} CC_Base bone name or null if not found
 */
export function getCCBoneName(vrmBoneName) {
    return VRM_TO_CC_BONE_MAP[vrmBoneName] || null;
}

/**
 * Get VRM bone name from CC_Base bone name
 * @param {string} ccBoneName - CC_Base bone name
 * @returns {string|null} VRM bone name or null if not found
 */
export function getVRMBoneName(ccBoneName) {
    return CC_TO_VRM_BONE_MAP[ccBoneName] || null;
}

/**
 * Alias for backward compatibility with vrm-loader.js
 * vrm-loader.js expects CC→VRM mapping (key=CC_Base, value=VRM)
 * @type {Object.<string, string>}
 */
export const CC_BONE_MAP = CC_TO_VRM_BONE_MAP;

