import { BONE_ORDER } from './bone-schema.js';
import * as THREE from 'three';

/**
 * Plays animations from compact binary stream.
 */
export class StreamPlayer {

    /**
     * Decode Base64 binary string into an AnimationClip
     * @param {string} base64String - Encoded animation data
     * @param {Function} boneNameResolver - Function(boneName) -> nodeName (e.g. 'hips' -> 'CC_Base_Hip')
     * @returns {THREE.AnimationClip}
     */
    static decodeToClip(base64String, boneNameResolver = null) {
        if (!base64String) return null;

        // 1. Decode Base64
        const binaryString = window.atob(base64String);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        const buffer = bytes.buffer;

        const dataView = new DataView(buffer);

        // 2. Read Header
        const fps = dataView.getFloat32(0, true);
        const duration = dataView.getFloat32(4, true);
        const frameCount = dataView.getUint32(8, true);

        const floatView = new Float32Array(buffer, 12);

        // 3. Reconstruct Tracks
        const times = [];
        const frameTime = 1 / fps;

        for (let i = 0; i < frameCount; i++) {
            times.push(i * frameTime);
        }

        const boneTracks = {};
        BONE_ORDER.forEach(name => {
            boneTracks[name] = {
                quaternion: [],
                position: name === 'hips' ? [] : null
            };
        });

        // 4. Parse Flat Data
        let offset = 0;

        for (let f = 0; f < frameCount; f++) {
            BONE_ORDER.forEach(boneName => {
                const trackData = boneTracks[boneName];

                if (boneName === 'hips') {
                    trackData.position.push(floatView[offset++]);
                    trackData.position.push(floatView[offset++]);
                    trackData.position.push(floatView[offset++]);
                }

                trackData.quaternion.push(floatView[offset++]);
                trackData.quaternion.push(floatView[offset++]);
                trackData.quaternion.push(floatView[offset++]);
                trackData.quaternion.push(floatView[offset++]);
            });
        }

        // 5. Create KeyframeTracks with Resolved Names
        const tracks = [];

        BONE_ORDER.forEach(boneName => {
            const data = boneTracks[boneName];

            // Resolve Node Name
            let nodeName = boneName;
            if (boneNameResolver) {
                const resolved = boneNameResolver(boneName);
                if (resolved) nodeName = resolved;
            }

            if (data.quaternion.length > 0) {
                tracks.push(new THREE.QuaternionKeyframeTrack(
                    `${nodeName}.quaternion`,
                    times,
                    data.quaternion
                ));
            }

            if (data.position && data.position.length > 0) {
                tracks.push(new THREE.VectorKeyframeTrack(
                    `${nodeName}.position`,
                    times,
                    data.position
                ));
            }
        });

        return new THREE.AnimationClip('StreamedAnimation', duration, tracks);
    }
}
