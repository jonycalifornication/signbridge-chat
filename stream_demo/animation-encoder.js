import { BONE_ORDER } from './bone-schema.js';
import * as THREE from 'three';

/**
 * Encodes animation frames into a compact binary format.
 * Format: Header (FPS, Duration) + Frame Data (Flat Array)
 */
export class AnimationEncoder {

    /**
     * Encode a Three.js AnimationClip to compact binary
     * @param {THREE.AnimationClip} clip - The source clip
     * @param {number} fps - Sampling rate
     * @param {Function} boneNameResolver - Function(boneName) -> nodeName (e.g., 'hips' -> 'CC_Base_Hip')
     * @returns {string} Base64 string
     */
    static encodeFromClip(clip, fps = 30, boneNameResolver = null) {
        const duration = clip.duration;
        const frameCount = Math.ceil(duration * fps);
        const frames = [];

        // 1. Setup Dummy Skeleton matching the CLIP's node names
        // If the clip targets 'CC_Base_Hip', our bone must be named 'CC_Base_Hip'
        const dummyRoot = new THREE.Group();
        const bones = {};

        BONE_ORDER.forEach(name => {
            const b = new THREE.Bone();

            // Resolve the name the clip expects
            let nodeName = name;
            if (boneNameResolver) {
                const resolved = boneNameResolver(name);
                if (resolved) nodeName = resolved;
            }
            b.name = nodeName;

            dummyRoot.add(b);
            bones[name] = b; // Map Standard Name -> Bone Object
        });

        // 2. Play Animation on Dummy Skeleton
        const mixer = new THREE.AnimationMixer(dummyRoot);
        const action = mixer.clipAction(clip);
        action.play();

        // 3. Sample Frames
        for (let i = 0; i < frameCount; i++) {
            mixer.setTime(i / fps); // Advance time

            const frame = { time: i / fps, bones: {} };

            BONE_ORDER.forEach(name => {
                const b = bones[name];

                // Read from dummy bone
                frame.bones[name] = {
                    quaternion: b.quaternion.toArray(),
                    // Only capture position for hips (schema requirement)
                    position: (name === 'hips') ? b.position.toArray() : undefined
                };
            });
            frames.push(frame);
        }

        // Cleanup
        mixer.stopAllAction();

        return this.encode(frames, fps);
    }

    /**
     * Convert standard JSON frames to a compact Base64 string
     * @param {Array} frames - Array of frame objects { time, bones: { name: { quaternion: [], position: [] } } }
     * @param {number} fps - Target FPS (e.g., 30 or 60)
     * @returns {string} Base64 encoded binary string
     */
    static encode(frames, fps = 30) {
        if (!frames || frames.length === 0) return '';

        // 1. Prepare Header Data
        const frameCount = frames.length;
        const duration = frames[frames.length - 1].time || (frameCount / fps);

        // 2. Calculate Buffer Size
        const boneCount = BONE_ORDER.length;
        const stride = 7 + (boneCount - 1) * 4;
        const dataByteLength = frameCount * stride * 4;
        const totalSize = 12 + dataByteLength;

        const buffer = new ArrayBuffer(totalSize);
        const dataView = new DataView(buffer);
        const floatView = new Float32Array(buffer, 12); // View starting after header

        // Write Header
        dataView.setFloat32(0, fps, true);
        dataView.setFloat32(4, duration, true);
        dataView.setUint32(8, frameCount, true);

        // Write Frame Data
        let offset = 0;

        frames.forEach(frame => {
            BONE_ORDER.forEach(boneName => {
                const boneData = frame.bones[boneName] || {};

                // Hips: Position (3) + Quaternion (4)
                if (boneName === 'hips') {
                    const pos = boneData.position || [0, 0, 0];
                    floatView[offset++] = pos[0];
                    floatView[offset++] = pos[1];
                    floatView[offset++] = pos[2];
                }

                // All Bones: Quaternion (4)
                const rot = boneData.quaternion || [0, 0, 0, 1];
                floatView[offset++] = rot[0];
                floatView[offset++] = rot[1];
                floatView[offset++] = rot[2];
                floatView[offset++] = rot[3];
            });
        });

        // 3. Convert to Base64
        return this.arrayBufferToBase64(buffer);
    }

    static arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }
}
