import * as THREE from 'three';
import { loadVRMModel, disposeVRM } from '../utils/vrm-loader.js';
import { loadAnimation } from '../utils/animation-loader.js';
import { JSONAnimationPlayer } from '../utils/json-animation-player.js';
import { CAMERA_DEFAULTS, RENDERER_DEFAULTS, LIGHTS } from '../utils/constants.js';
import { CONFIG } from '../config.js';
import { setupBackgroundControls } from './background-controls.js';
import { setupGlossesInput } from './glosses-input.js';
import { setupVideoControls } from './video-controls.js';
import { setupTimelineMarkers, setupTimelineInteraction } from './timeline.js';
import { logDeviceInfo } from '../utils/device-logger.js';
import { createRestPoseClip } from '../utils/rest-pose.js';

/**
 * Studio recorder for creating VRM animation videos
 * @class StudioRecorder
 */
class StudioRecorder {
    constructor() {
        this.container = document.getElementById('studio-avatar-container');
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.currentVrm = null;
        this.mixer = null;
        this.animationCache = new Map();
        this.currentAction = null;
        this.idleAction = null;

        // Recording state
        this.glosses = [];
        this.recordedChunks = [];
        this.mediaRecorder = null;
        this.isRecording = false;
        this.recordedMimeType = null;

        // Settings
        this.backgroundType = 'green';
        this.customBackgroundTexture = null;
        this.currentAvatar = CONFIG.defaultAvatar;
        this.quality = '720';
        this.aspectRatio = '16:9';
        this.playbackSpeed = 1.0;
        this.isLooping = false;

        // Timeline
        this.animationTimestamps = [];
        this.totalAnimationDuration = 0;

        // JSON Animation Player
        this.jsonPlayer = null;

        this.init();
        this.setupUI();
    }

    /** Initialize 3D scene */
    init() {
        this.scene = new THREE.Scene();

        const width = 1280;
        const height = 720;
        const aspect = width / height;

        this.camera = new THREE.PerspectiveCamera(
            CONFIG.camera.fov || CAMERA_DEFAULTS.FOV,
            aspect,
            CAMERA_DEFAULTS.NEAR,
            CAMERA_DEFAULTS.FAR
        );
        this.camera.position.set(0, CONFIG.camera.posY, CONFIG.camera.posZ);
        this.camera.lookAt(0.0, 1.2, 0.0);

        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.lights.intensity || LIGHTS.DIRECTIONAL_INTENSITY);
        dirLight.position.set(0.0, 1.0, 2.0);
        this.scene.add(dirLight);
        this.scene.add(new THREE.AmbientLight(0xffffff, LIGHTS.AMBIENT_INTENSITY));

        this.renderer = new THREE.WebGLRenderer({
            alpha: RENDERER_DEFAULTS.ALPHA,
            antialias: RENDERER_DEFAULTS.ANTIALIAS,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 1.5, RENDERER_DEFAULTS.MAX_PIXEL_RATIO));
        this.container.appendChild(this.renderer.domElement);

        logDeviceInfo(this.renderer);

        this.setBackground('green');
        this.loadModel(CONFIG.avatars[CONFIG.defaultAvatar]);
        this.animate();
    }

    /**
     * Set background type
     * @param {string} type - Background type (green|white|transparent|color|custom)
     * @param {string} [colorValue] - Color value for 'color' type
     */
    setBackground(type, colorValue = null) {
        this.backgroundType = type;

        const backgrounds = {
            green: () => new THREE.Color(0x00ff00),
            white: () => new THREE.Color(0xffffff),
            transparent: () => null,
            color: () => new THREE.Color(colorValue || 0x1a1a2e),
            custom: () => this.customBackgroundTexture || new THREE.Color(0xcccccc)
        };

        this.scene.background = backgrounds[type]?.() ?? null;
    }

    /**
     * Set custom background image
     * @param {File} imageFile - Image file
     */
    setCustomBackground(imageFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const loader = new THREE.TextureLoader();
            loader.load(e.target.result, (texture) => {
                this.customBackgroundTexture = texture;
                if (this.backgroundType === 'custom') {
                    this.scene.background = texture;
                }
            });
        };
        reader.readAsDataURL(imageFile);
    }

    /** Get resolution dimensions based on quality and aspect ratio */
    getResolutionDimensions() {
        const heights = { '480': 480, '720': 720, '1080': 1080 };
        const baseHeight = heights[this.quality] || 720;

        const aspectRatios = {
            '16:9': 16 / 9,
            '4:3': 4 / 3,
            '1:1': 1
        };
        const ratio = aspectRatios[this.aspectRatio] || 16 / 9;

        return {
            width: Math.round(baseHeight * ratio),
            height: baseHeight
        };
    }

    /**
     * Update renderer resolution
     * @param {number} width - Width in pixels
     * @param {number} height - Height in pixels
     */
    updateResolution(width, height) {
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Load VRM model
     * @param {string|Object} avatarConfig - Path to VRM file or config object
     */
    async loadModel(avatarConfig) {
        if (this.currentVrm) {
            this.scene.remove(this.currentVrm.scene);
            disposeVRM(this.currentVrm);
            this.mixer = null;
        }

        this.animationCache.clear();

        // Normalize config
        let path = avatarConfig;
        let rotationOverride = null;

        if (typeof avatarConfig === 'object' && avatarConfig !== null) {
            path = avatarConfig.path;
            if (avatarConfig.rotation !== undefined) {
                rotationOverride = avatarConfig.rotation;
            }
        }

        if (!path) {
            console.error('Invalid avatar configuration:', avatarConfig);
            return;
        }

        try {
            // Pass the original CONFIG but we might want to override rotation locally
            // actually vrm-loader uses CONFIG.avatar.rotation by default.
            // We should apply the specific override if it exists.

            this.currentVrm = await loadVRMModel(path, CONFIG);
            this.scene.add(this.currentVrm.scene);

            if (rotationOverride !== null) {
                this.currentVrm.scene.rotation.y = rotationOverride;
            }

            this.mixer = new THREE.AnimationMixer(this.currentVrm.scene);

            // Create rest pose idle action (inline quaternions — instant)
            const restClip = createRestPoseClip(this.currentVrm);
            if (restClip) {
                this.idleAction = this.mixer.clipAction(restClip);
                this.idleAction.setLoop(THREE.LoopOnce);
                this.idleAction.clampWhenFinished = true;
                this.idleAction.setEffectiveWeight(1.0);
                this.idleAction.play();
            }

            console.log(`[Studio] Model loaded from ${path}`);
        } catch (error) {
            console.error('Failed to load model:', error);
            alert(`Failed to load avatar: ${path}`);
        }
    }

    /**
     * Load animation by name
     * @param {string} animName - Animation name from config
     * @returns {Promise<Object|null>}
     */
    async loadAnimation(animName) {
        const url = CONFIG.animations[animName.toLowerCase()];
        if (!url) {
            console.error(`Animation "${animName}" not found`);
            return null;
        }

        return loadAnimation(url, this.currentVrm, this.animationCache);
    }

    /**
     * Play animation
     * @param {string} name - Animation name
     * @returns {Promise<number|null>} Duration or null
     */
    async playAnimation(name) {
        const clip = await this.loadAnimation(name);
        if (!clip) return null;

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        action.setEffectiveWeight(1.0); // Ensure full weight

        // Smooth transition (Crossfade)
        if (this.currentAction) {
            // Restore effective weight of previous action if it faded out?
            // No, crossFadeFrom handles the weight transfer.
            // But we must ensure the previous action is still 'active' for the fade to work visually?
            // If it's finished/clamped, it contributes to the pose.

            action.crossFadeFrom(this.currentAction, 0.5, true);
        } else {
            // First animation - maybe fade in from T-pose?
            action.fadeIn(0.5);
        }

        action.play();
        this.currentAction = action;

        return new Promise((resolve) => {
            const handler = (e) => {
                if (e.action === action) {
                    this.mixer.removeEventListener('finished', handler);
                    // Fade back to rest pose
                    action.fadeOut(0.3);
                    if (this.idleAction) {
                        this.idleAction.reset();
                        this.idleAction.setEffectiveWeight(1.0);
                        this.idleAction.fadeIn(0.3);
                        this.idleAction.play();
                    }
                    resolve(clip.duration);
                }
            };
            this.mixer.addEventListener('finished', handler);
        });
    }

    /** Detect supported video MIME type */
    getSupportedVideoMimeType() {
        const types = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                return type;
            }
        }

        return 'video/webm';
    }

    /** Start recording */
    async startRecording() {
        if (this.isRecording || this.glosses.length === 0) {
            if (this.glosses.length === 0) alert('Введите глоссы!');
            return;
        }

        const { width, height } = this.getResolutionDimensions();
        this.updateResolution(width, height);
        this.recordedChunks = [];

        await this.recordVideo();
    }

    /** Record video */
    async recordVideo() {
        const stream = this.renderer.domElement.captureStream(60);
        const mimeType = this.getSupportedVideoMimeType();
        this.recordedMimeType = mimeType;

        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType,
            videoBitsPerSecond: 8000000
        });

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) this.recordedChunks.push(event.data);
        };

        this.mediaRecorder.start();
        this.isRecording = true;
        document.getElementById('progress-bar').style.display = 'block';

        // Record all animations
        for (let i = 0; i < this.glosses.length; i++) {
            const duration = await this.playAnimation(this.glosses[i]);
            if (duration) {
                const progress = ((i + 1) / this.glosses.length) * 100;
                this.updateProgress(progress);
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        // Stop recording
        setTimeout(() => {
            if (this.mediaRecorder?.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            this.isRecording = false;
            document.getElementById('download-btn').style.display = 'block';
            this.updateProgress(100);
        }, 500);
    }

    /** Download recorded video */
    download() {
        if (this.recordedChunks.length === 0) {
            alert('Нет данных для скачивания');
            return;
        }

        const mimeType = this.recordedMimeType || 'video/webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        const date = new Date();
        const dateStr = date.toISOString().split('T')[0];
        const timeStr = date.toTimeString().split(' ')[0].replace(/:/g, '-');
        const glossesStr = this.glosses.join('_');

        a.download = `${glossesStr}_${this.quality}p_${this.aspectRatio.replace(':', 'x')}_${dateStr}_${timeStr}.${extension}`;

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Update progress bar
     * @param {number} percent - Progress percentage
     */
    updateProgress(percent) {
        document.getElementById('progress-fill').style.width = `${percent}%`;
        document.getElementById('progress-text').textContent = `${Math.round(percent)}%`;
    }

    /** Setup all UI controls */
    setupUI() {
        // Use modular UI setup
        setupBackgroundControls(this);
        setupGlossesInput(this);
        setupVideoControls(this);

        // Avatar selector
        const avatarSelect = document.getElementById('avatar-select');
        avatarSelect.value = this.currentAvatar;
        avatarSelect.addEventListener('change', (e) => {
            this.currentAvatar = e.target.value;
            this.loadModel(CONFIG.avatars[this.currentAvatar]);
        });

        // Quality selector
        document.getElementById('quality-select').addEventListener('change', (e) => {
            this.quality = e.target.value;
            const { width, height } = this.getResolutionDimensions();
            this.updateResolution(width, height);
        });

        // Aspect ratio selector
        document.getElementById('aspect-select').addEventListener('change', (e) => {
            this.aspectRatio = e.target.value;
            const { width, height } = this.getResolutionDimensions();
            this.updateResolution(width, height);
        });

        // Record button
        document.getElementById('record-btn').addEventListener('click', async () => {
            const btn = document.getElementById('record-btn');
            btn.disabled = true;
            document.getElementById('download-btn').style.display = 'none';
            document.getElementById('video-controls').style.display = 'none';

            await this.startRecording();
            btn.disabled = false;
        });

        // Download button
        document.getElementById('download-btn').addEventListener('click', () => this.download());

        // Timeline interaction
        setupTimelineInteraction(this);

        // Theme Toggle
        const themeBtn = document.getElementById('theme-toggle');
        if (themeBtn) {
            // Check saved preference
            if (localStorage.getItem('theme') === 'dark') {
                document.body.classList.add('dark');
                themeBtn.textContent = '☀\uFE0F';
            }

            themeBtn.addEventListener('click', () => {
                document.body.classList.toggle('dark');
                const isDark = document.body.classList.contains('dark');
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
                themeBtn.textContent = isDark ? '☀\uFE0F' : '🌙';
            });
        }
    }

    /** Setup timeline markers - delegated to module */
    async setupTimelineMarkers() {
        await setupTimelineMarkers(this);
    }

    /**
     * Seek to specific animation
     * @param {number} index - Animation index
     */
    seekToAnimation(index) {
        if (!this.animationTimestamps[index]) return;

        const anim = this.animationTimestamps[index];
        this.mixer.setTime(anim.startTime);
    }

    /** Animation loop */
    animate() {
        requestAnimationFrame(() => this.animate());
        const deltaTime = this.clock.getDelta();
        if (this.mixer) this.mixer.update(deltaTime);
        if (this.currentVrm) this.currentVrm.update(deltaTime);
        this.renderer.render(this.scene, this.camera);
    }

    /**
     * Load JSON animation from URL
     * @param {string} url - URL to JSON animation file
     * @param {Object} options - Player options
     * @returns {Promise<boolean>} Success status
     */
    async loadJSONAnimation(url, options = {}) {
        if (!this.currentVrm) {
            console.error('VRM model not loaded');
            return false;
        }

        if (!this.mixer) {
            console.error('Animation mixer not initialized');
            return false;
        }

        // Dispose previous player
        if (this.jsonPlayer) {
            this.jsonPlayer.dispose();
        }

        // Create new player with mixer
        this.jsonPlayer = new JSONAnimationPlayer(this.currentVrm, this.mixer, {
            applyPosition: options.applyPosition !== undefined ? options.applyPosition : true,
            loop: options.loop || this.isLooping
        });

        // Set callbacks
        this.jsonPlayer.onComplete = () => {
            console.log('[Studio] JSON animation completed');
        };

        return await this.jsonPlayer.loadFromURL(url);
    }

    /**
     * Play loaded JSON animation
     */
    playJSONAnimation() {
        if (this.jsonPlayer) {
            this.jsonPlayer.play();
        }
    }

    /**
     * Pause JSON animation
     */
    pauseJSONAnimation() {
        if (this.jsonPlayer) {
            this.jsonPlayer.pause();
        }
    }

    /**
     * Stop JSON animation
     */
    stopJSONAnimation() {
        if (this.jsonPlayer) {
            this.jsonPlayer.stop();
        }
    }
}

// Create instance and expose to window for console access
const studioRecorder = new StudioRecorder();
window.studioRecorder = studioRecorder;
