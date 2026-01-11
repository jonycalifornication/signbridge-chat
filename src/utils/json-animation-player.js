import * as THREE from 'three';
import { VRM_TO_CC_BONE_MAP } from './cc-bone-map.js';

/**
 * JSON Animation Loader for VRM models
 * Converts JSON frame data to Three.js AnimationClip
 * @module utils/json-animation-player
 */

/**
 * @typedef {Object} BoneData
 * @property {number[]} quaternion - [x, y, z, w]
 * @property {number[]} position - [x, y, z]
 */

/**
 * @typedef {Object} AnimationFrame
 * @property {number} timestamp - Frame timestamp in ms
 * @property {number} frameTime - Time delta from previous frame
 * @property {Object.<string, BoneData>} bones - VRM bone name to data
 */

/**
 * Create AnimationClip from JSON animation data
 * @param {string} name - Clip name
 * @param {AnimationFrame[]} frames - Animation frames
 * @param {Object} vrm - VRM model instance
 * @param {Object} options - Options
 * @param {boolean} [options.applyPosition=true] - Whether to include position tracks
 * @returns {THREE.AnimationClip|null} Animation clip or null if failed
 */
export function createClipFromJSON(name, frames, vrm, options = {}) {
    if (!frames || frames.length === 0 || !vrm?.scene) {
        console.error('[JSONAnimationLoader] Invalid frames or VRM');
        return null;
    }

    const applyPosition = options.applyPosition !== undefined ? options.applyPosition : true;
    const tracks = [];

    // Build bone cache
    const boneCache = new Map();
    for (const [vrmName, ccName] of Object.entries(VRM_TO_CC_BONE_MAP)) {
        const bone = vrm.scene.getObjectByName(ccName);
        if (bone) {
            boneCache.set(vrmName, bone);
        }
    }

    console.log(`[JSONAnimationLoader] Building clip from ${frames.length} frames, ${boneCache.size} bones`);

    // Calculate frame times
    const times = [];
    let accumulatedTime = 0;
    for (let i = 0; i < frames.length; i++) {
        times.push(accumulatedTime);
        accumulatedTime += frames[i].frameTime || (1 / 60);
    }

    const duration = accumulatedTime;

    // Create tracks for each bone
    for (const [vrmName, bone] of boneCache) {
        // Quaternion track
        const quaternionValues = [];
        for (const frame of frames) {
            const boneData = frame.bones[vrmName];
            if (boneData?.quaternion) {
                quaternionValues.push(...boneData.quaternion);
            } else {
                // Default quaternion if missing
                quaternionValues.push(0, 0, 0, 1);
            }
        }

        if (quaternionValues.length > 0) {
            const quatTrack = new THREE.QuaternionKeyframeTrack(
                `${bone.name}.quaternion`,
                times,
                quaternionValues
            );
            tracks.push(quatTrack);
        }

        // Position track (optional)
        if (applyPosition) {
            const positionValues = [];
            for (const frame of frames) {
                const boneData = frame.bones[vrmName];
                if (boneData?.position) {
                    positionValues.push(...boneData.position);
                } else {
                    // Use bone's current position as default
                    positionValues.push(bone.position.x, bone.position.y, bone.position.z);
                }
            }

            if (positionValues.length > 0) {
                const posTrack = new THREE.VectorKeyframeTrack(
                    `${bone.name}.position`,
                    times,
                    positionValues
                );
                tracks.push(posTrack);
            }
        }
    }

    console.log(`[JSONAnimationLoader] Created ${tracks.length} tracks, duration: ${duration.toFixed(2)}s`);

    return new THREE.AnimationClip(name, duration, tracks);
}

/**
 * JSON Animation Player using Three.js AnimationMixer
 */
export class JSONAnimationPlayer {
    /**
     * Create JSON Animation Player
     * @param {Object} vrm - VRM model instance
     * @param {THREE.AnimationMixer} mixer - Animation mixer
     * @param {Object} options - Player options
     */
    constructor(vrm, mixer, options = {}) {
        this.vrm = vrm;
        this.mixer = mixer;
        this.clip = null;
        this.action = null;
        this.frames = [];

        // Options
        this.applyPosition = options.applyPosition !== undefined ? options.applyPosition : true;
        this.loop = options.loop || false;

        // Callbacks
        this.onComplete = null;
    }

    /**
     * Load animation from URL
     * @param {string} url - URL to JSON animation file
     * @returns {Promise<boolean>} Success status
     */
    async loadFromURL(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            return this.loadFromData(data);
        } catch (error) {
            console.error('[JSONAnimationPlayer] Failed to load animation:', error);
            return false;
        }
    }

    /**
     * Load animation from data
     * @param {Object|AnimationFrame[]} data - Animation data
     * @returns {boolean} Success status
     */
    loadFromData(data) {
        // Handle object with frames property
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            if (data.frames && Array.isArray(data.frames)) {
                this.frames = data.frames;
                console.log(`[JSONAnimationPlayer] Loading: version=${data.version}, totalFrames=${data.totalFrames}`);
            } else {
                console.error('[JSONAnimationPlayer] Invalid data format');
                return false;
            }
        } else if (Array.isArray(data)) {
            this.frames = data;
        } else {
            console.error('[JSONAnimationPlayer] Invalid data format');
            return false;
        }

        // Create clip
        this.clip = createClipFromJSON('json-animation', this.frames, this.vrm, {
            applyPosition: this.applyPosition
        });

        if (!this.clip) {
            return false;
        }

        // Create action
        this.action = this.mixer.clipAction(this.clip);
        this.action.setLoop(this.loop ? THREE.LoopRepeat : THREE.LoopOnce);
        this.action.clampWhenFinished = true;

        // Setup complete callback
        const handleFinished = (e) => {
            if (e.action === this.action) {
                this.mixer.removeEventListener('finished', handleFinished);
                if (this.onComplete) {
                    this.onComplete();
                }
            }
        };
        this.mixer.addEventListener('finished', handleFinished);

        console.log(`[JSONAnimationPlayer] Loaded ${this.frames.length} frames`);
        return true;
    }

    /**
     * Get animation duration
     * @returns {number} Duration in seconds
     */
    get duration() {
        return this.clip?.duration || 0;
    }

    /**
     * Play animation
     */
    play() {
        if (!this.action) {
            console.warn('[JSONAnimationPlayer] No animation loaded');
            return;
        }

        this.action.reset();
        this.action.play();
        console.log('[JSONAnimationPlayer] Playing');
    }

    /**
     * Pause animation
     */
    pause() {
        if (this.action) {
            this.action.paused = true;
            console.log('[JSONAnimationPlayer] Paused');
        }
    }

    /**
     * Resume animation
     */
    resume() {
        if (this.action) {
            this.action.paused = false;
            console.log('[JSONAnimationPlayer] Resumed');
        }
    }

    /**
     * Stop animation
     */
    stop() {
        if (this.action) {
            this.action.stop();
            console.log('[JSONAnimationPlayer] Stopped');
        }
    }

    /**
     * Dispose resources
     */
    dispose() {
        if (this.action) {
            this.action.stop();
            this.mixer.uncacheAction(this.clip);
        }
        if (this.clip) {
            this.mixer.uncacheClip(this.clip);
        }
        this.clip = null;
        this.action = null;
        this.frames = [];
        this.onComplete = null;
    }
}
