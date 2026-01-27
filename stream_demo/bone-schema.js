/**
 * Fixed order of bones for binary streaming.
 * Encoder and Decoder MUST use this exact same order.
 */
export const BONE_ORDER = [
    'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
    'leftEye', 'rightEye',
    'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
    'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
    'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
    'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',

    // Fingers Left
    'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
    'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
    'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
    'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
    'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',

    // Fingers Right
    'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
    'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
    'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
    'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
    'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
];

/**
 * Metadata for parsing the stream
 */
export const STREAM_SCHEMA = {
    POSITION_COMPONENTS: 3, // x, y, z
    QUATERNION_COMPONENTS: 4, // x, y, z, w
    // Hips has position + rotation (3 + 4 = 7 floats)
    // All others have rotation only (4 floats)
    STRIDE_PER_FRAME: 7 + (BONE_ORDER.length - 1) * 4
};
