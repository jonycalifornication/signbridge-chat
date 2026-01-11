import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/**
 * VRMA Exporter
 * Exports animation frames to a .vrma file (Binary GLTF + VRMC_vrm_animation extension)
 */

export class VRMAExporter {
    constructor() {
        this.exporter = new GLTFExporter();
    }

    /**
     * Export frames to VRMA blob
     * @param {Array} frames - Animation frames from JSON
     * @returns {Promise<Blob>} VRMA file blob (GLB format)
     */
    async exportVRMA(frames) {
        if (!frames || frames.length === 0) {
            throw new Error('No frames to export');
        }

        console.log('[VRMAExporter] Starting export...');

        // 1. Create a virtual skeleton for export
        const scene = new THREE.Scene();
        const boneMap = new Map();

        const vrmBones = [
            'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
            'leftEye', 'rightEye',
            'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
            'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
            'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
            'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
            'leftThumbProximal', 'leftThumbIntermediate', 'leftThumbDistal',
            'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
            'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
            'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
            'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
            'rightThumbProximal', 'rightThumbIntermediate', 'rightThumbDistal',
            'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
            'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
            'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
            'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'
        ];

        vrmBones.forEach(name => {
            const bone = new THREE.Bone();
            bone.name = name;
            if (name === 'hips') {
                bone.position.set(0, 1.0, 0);
            } else {
                bone.position.set(0, 0, 0);
            }
            scene.add(bone);
            boneMap.set(name, bone);
        });

        // 2. Create AnimationClip
        const tracks = [];
        const times = [];
        let accumulatedTime = 0;

        for (let i = 0; i < frames.length; i++) {
            times.push(accumulatedTime);
            accumulatedTime += frames[i].frameTime || (1 / 60);
        }
        const duration = accumulatedTime;

        const processedBones = new Set();
        frames.forEach(frame => {
            if (frame.bones) Object.keys(frame.bones).forEach(k => processedBones.add(k));
        });

        processedBones.forEach(vrmBoneName => {
            if (!boneMap.has(vrmBoneName)) return;

            const bone = boneMap.get(vrmBoneName);
            const values = [];

            frames.forEach(frame => {
                const bData = frame.bones[vrmBoneName];
                if (bData && bData.quaternion) {
                    values.push(...bData.quaternion);
                } else {
                    values.push(0, 0, 0, 1);
                }
            });

            const track = new THREE.QuaternionKeyframeTrack(
                `${bone.name}.quaternion`,
                times,
                values
            );
            tracks.push(track);

            if (vrmBoneName === 'hips') {
                const posValues = [];
                frames.forEach(frame => {
                    const bData = frame.bones[vrmBoneName];
                    if (bData && bData.position) {
                        posValues.push(...bData.position);
                    } else {
                        posValues.push(0, 1, 0);
                    }
                });
                const posTrack = new THREE.VectorKeyframeTrack(
                    `${bone.name}.position`,
                    times,
                    posValues
                );
                tracks.push(posTrack);
            }
        });

        const clip = new THREE.AnimationClip('vrma_animation', duration, tracks);

        // 3. Export to GLTF JSON first, then convert to Binary
        return new Promise((resolve, reject) => {
            this.exporter.parse(
                scene,
                async (json) => {
                    try {
                        const modifiedJson = this._convertToVRMA(json);
                        const binaryBlob = await this._createBinaryGLB(modifiedJson);
                        resolve(binaryBlob);
                    } catch (e) {
                        reject(e);
                    }
                },
                (error) => reject(error),
                {
                    animations: [clip],
                    binary: false // We get JSON, then pack it manually
                }
            );
        });
    }

    _convertToVRMA(gltf) {
        const vrma = JSON.parse(JSON.stringify(gltf));

        if (!vrma.extensions) vrma.extensions = {};
        if (!vrma.extensionsUsed) vrma.extensionsUsed = [];

        const humanBones = {};
        vrma.nodes.forEach((node, index) => {
            if (node.name) {
                humanBones[node.name] = { node: index };
            }
        });

        vrma.extensions['VRMC_vrm_animation'] = {
            specVersion: '1.0',
            humanoid: {
                humanBones: humanBones
            }
        };

        if (!vrma.extensionsUsed.includes('VRMC_vrm_animation')) {
            vrma.extensionsUsed.push('VRMC_vrm_animation');
        }

        return vrma;
    }

    async _createBinaryGLB(json) {
        // Collect buffers
        const buffers = [];
        let bufferOffset = 0;

        // Process buffers in JSON (handle Data URIs)
        if (json.buffers) {
            for (let i = 0; i < json.buffers.length; i++) {
                const bufferDef = json.buffers[i];
                if (bufferDef.uri && bufferDef.uri.startsWith('data:')) {
                    const response = await fetch(bufferDef.uri);
                    const buffer = await response.arrayBuffer();
                    buffers.push(buffer);
                    delete bufferDef.uri; // Remove URI, will be merged into binary chunk
                    bufferDef.byteLength = buffer.byteLength;
                }
            }
        }

        // Calculate total binary length (with padding)
        const binaryBuffer = this._concatArrayBuffers(buffers);

        // Define standard GLTF buffer if not present or updated
        if (!json.buffers) json.buffers = [];
        if (json.buffers.length === 0) {
            json.buffers.push({ byteLength: binaryBuffer.byteLength });
        } else {
            json.buffers[0] = { byteLength: binaryBuffer.byteLength };
        }

        // Create GLB structure
        const jsonString = JSON.stringify(json);
        const jsonBuffer = new TextEncoder().encode(jsonString);

        // Padding for JSON (must be 4-byte aligned)
        const jsonPadding = (4 - (jsonBuffer.byteLength % 4)) % 4;
        const binPadding = (4 - (binaryBuffer.byteLength % 4)) % 4;

        const totalLength = 12 + // Header
            8 + jsonBuffer.byteLength + jsonPadding + // JSON Chunk header + data + padding
            8 + binaryBuffer.byteLength + binPadding; // BIN Chunk header + data + padding

        const glbBuffer = new ArrayBuffer(totalLength);
        const dataView = new DataView(glbBuffer);

        let offset = 0;

        // 1. Header
        dataView.setUint32(offset, 0x46546C67, true); // MAGIC 'glTF'
        offset += 4;
        dataView.setUint32(offset, 2, true); // Version
        offset += 4;
        dataView.setUint32(offset, totalLength, true); // Total length
        offset += 4;

        // 2. JSON Chunk
        const jsonChunkLength = jsonBuffer.byteLength + jsonPadding;
        dataView.setUint32(offset, jsonChunkLength, true);
        offset += 4;
        dataView.setUint32(offset, 0x4E4F534A, true); // Type 'JSON'
        offset += 4;

        // Write JSON data
        const uint8View = new Uint8Array(glbBuffer);
        uint8View.set(jsonBuffer, offset);
        offset += jsonBuffer.byteLength;

        // Write JSON padding (spaces 0x20)
        for (let i = 0; i < jsonPadding; i++) {
            uint8View[offset++] = 0x20;
        }

        // 3. BIN Chunk
        const binChunkLength = binaryBuffer.byteLength + binPadding;
        dataView.setUint32(offset, binChunkLength, true);
        offset += 4;
        dataView.setUint32(offset, 0x004E4942, true); // Type 'BIN'
        offset += 4;

        // Write Binary data
        const binSource = new Uint8Array(binaryBuffer);
        uint8View.set(binSource, offset);
        offset += binaryBuffer.byteLength;

        // Write Bin padding (zeros 0x00)
        for (let i = 0; i < binPadding; i++) {
            uint8View[offset++] = 0x00;
        }

        return new Blob([glbBuffer], { type: 'model/gltf-binary' });
    }

    _concatArrayBuffers(buffers) {
        let totalLen = 0;
        for (const b of buffers) totalLen += b.byteLength;
        const tmp = new Uint8Array(totalLen);
        let offset = 0;
        for (const b of buffers) {
            tmp.set(new Uint8Array(b), offset);
            offset += b.byteLength;
        }
        return tmp.buffer;
    }
}
