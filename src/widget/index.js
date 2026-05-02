import * as THREE from 'three';
import { loadAnimation } from '../utils/animation-loader.js';
import { textToVisemeSequence } from '../utils/viseme-mapper.js';
import { loadVRMModel, disposeVRM } from '../utils/vrm-loader.js';
import { CAMERA_DEFAULTS, ANIMATION_DEFAULTS, RENDERER_DEFAULTS, LIGHTS } from '../utils/constants.js';
import { CONFIG } from '../config.js';
import { getDownloadManager } from '../utils/animation-download-manager.js';
import { getLanguageIdsForMode, normalizeLanguageMode } from '../utils/language-mode.js';
import { logDeviceInfo } from '../utils/device-logger.js';
import { createRestPoseClip } from '../utils/rest-pose.js';
import { initGlobalErrorLogger, sendErrorToTelegram } from '../utils/telegram-logger.js';

const LANGUAGE_MODE_STORAGE_KEY = 'signbridge_widget_language_mode';
const LANGUAGE_MODE_OPTIONS = [
    { value: 'auto', label: 'Auto', title: 'Авто' },
    { value: 'kz_KSL', label: 'ҚҚ', title: 'Қазақша' },
    { value: 'ru_RSL', label: 'RU', title: 'Русский' },
];

/**
 * Compact avatar widget with text selection trigger
 * @class AvatarWidget
 */
export class AvatarWidget {
    /**
     * Create avatar widget
     * @param {string} containerId - DOM element ID for widget container
     */
    constructor(containerId) {
        initGlobalErrorLogger(); // Initialize Telegram error listener
        
        this.container = document.getElementById(containerId);
        if (!this.container) {
            console.error(`Container #${containerId} not found`);
            return;
        }
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.currentVrm = null;
        this.mixer = null;
        this.animationCache = new Map();
        this.idleAction = null;
        this.currentAction = null;
        this.isExpanded = false;
        this.playbackRate = 1;
        this.playbackSpeed = ANIMATION_DEFAULTS.DEFAULT_PLAYBACK_SPEED;
        this.languageMode = this.loadLanguageMode();
        this.currentTranslationLanguageId = CONFIG.languageId;
        this.languageControls = null;
        this.languageModeButtons = new Map();

        // Expression state
        this.currentExpressionSequence = null;
        this.expressionTimer = 0;
        this.currentExpressionIndex = 0;
        this.currentActiveViseme = null;

        // Blinking state
        this.blinkTimer = 0;
        this.nextBlinkTime = Math.random() * 3000 + 2000; // Random start 2-5s
        this.isBlinking = false;
        this.blinkDuration = 0.15; // seconds

        // Expose to window for JSON control
        window.avatarWidget = this;

        // Animation download manager for backend VRMA files
        this.downloadManager = getDownloadManager();

        // UI Loader Overlay
        this.loaderOverlay = null;
        this.loaderText = null;

        this.init();
        this.setupUI();
        this.setupLanguageControls();
        this.setupTextSelection();
        this.setupWidgetToggle();
    }

    /**
     * Generate MP4 video of the avatar performing the text/glosses
     * Rendering happens server-side.
     * @param {string} text - Space-separated glosses or text to translate
     * @param {Object} options - Optional parameters (avatar, background)
     * @returns {Promise<Blob>} The generated MP4 video as a Blob
     */
    async generateVideo(text, options = {}) {
        if (!text) throw new Error('Text/Glosses required for video generation');
        
        console.log(`[Avatar] Requesting server-side video generation for: "${text}"`);
        
        const glosses = text.split(/\s+/);
        // Map common avatar names or use current
        const avatar = options.avatar || this.currentAvatarName || CONFIG.defaultAvatar;
        const background = options.background || 'green';

        const response = await fetch('/api/v1/video/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ glosses, avatar, background })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || `Server error: ${response.status}`);
        }

        return await response.blob();
    }

    /**
     * Set playback speed multiplier for body animation and lip-sync
     * @param {number} rate
     */
    setPlaybackRate(rate) {
        const nextRate = Number(rate);
        this.playbackRate = Number.isFinite(nextRate) && nextRate > 0 ? nextRate : 1;
    }

    /**
     * Get current playback speed multiplier
     * @returns {number}
     */
    getPlaybackRate() {
        return this.playbackRate || 1;
    }

    /**
     * Delay scaled by playback rate
     * @param {number} ms
     * @returns {Promise<void>}
     */
    waitScaled(ms) {
        const scaledMs = Math.max(0, ms / this.getPlaybackRate());
        return new Promise((resolve) => setTimeout(resolve, scaledMs));
    }

    /** Initialize 3D scene */
    init() {
        this.scene = new THREE.Scene();

        const width = this.container.clientWidth || 150;
        const height = this.container.clientHeight || 180;
        const aspect = width / height;

        this.camera = new THREE.PerspectiveCamera(
            CONFIG.camera.fov || CAMERA_DEFAULTS.FOV,
            aspect,
            CAMERA_DEFAULTS.NEAR,
            CAMERA_DEFAULTS.FAR
        );
        this.camera.position.set(CONFIG.camera.posX, CONFIG.camera.posY, CONFIG.camera.posZ);
        this.camera.lookAt(0.0, 1.0, 0.0);

        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.lights.intensity || LIGHTS.DIRECTIONAL_INTENSITY);
        dirLight.position.set(0.0, 1.0, 2.0);
        this.scene.add(dirLight);
        this.scene.add(new THREE.AmbientLight(0xffffff, LIGHTS.AMBIENT_INTENSITY));

        this.renderer = new THREE.WebGLRenderer({
            alpha: RENDERER_DEFAULTS.ALPHA,
            antialias: RENDERER_DEFAULTS.ANTIALIAS,
            powerPreference: 'high-performance'
        });
        
        // Fix for dark/black models on mobile: explicitly set standard color space
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 1.5, RENDERER_DEFAULTS.MAX_PIXEL_RATIO));
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        logDeviceInfo(this.renderer);

        // Setup loading overlay
        this.loaderOverlay = document.createElement('div');
        this.loaderOverlay.className = 'avatar-loader-overlay';
        
        const loaderSpinner = document.createElement('div');
        loaderSpinner.className = 'avatar-loader-spinner';
        
        this.loaderText = document.createElement('div');
        this.loaderText.className = 'avatar-loader-text';
        this.loaderText.innerText = 'Loading Avatar...';
        
        this.loaderOverlay.appendChild(loaderSpinner);
        this.loaderOverlay.appendChild(this.loaderText);
        
        // Make sure container is positioned to hold absolute overlay
        if (window.getComputedStyle(this.container).position === 'static') {
            this.container.style.position = 'relative';
        }
        this.container.appendChild(this.loaderOverlay);

        window.addEventListener('resize', () => this.onResize());
        setTimeout(() => this.onResize(), 100);
        this.animate();
    }

    setupUI() {
        // Initial load should happen regardless of UI controls
        this.loadModelByName(CONFIG.defaultAvatar);

        const select = document.getElementById('avatar-select');
        if (!select) return;

        for (const name in CONFIG.avatars) {
            const option = document.createElement('option');
            option.value = name;
            option.innerText = name;
            if (name === CONFIG.defaultAvatar) option.selected = true;
            select.appendChild(option);
        }

        select.addEventListener('change', (e) => this.loadModelByName(e.target.value));
    }

    loadLanguageMode() {
        try {
            const savedMode = localStorage.getItem(LANGUAGE_MODE_STORAGE_KEY);
            if (savedMode) return normalizeLanguageMode(savedMode, CONFIG.languageMode);
        } catch {
            // localStorage can be unavailable in restricted embeds.
        }

        return normalizeLanguageMode(CONFIG.languageMode, 'auto');
    }

    getLanguageIdsForCurrentMode() {
        return getLanguageIdsForMode(this.languageMode, CONFIG.languagePriority, CONFIG.languageId);
    }

    setLanguageMode(mode, { persist = true } = {}) {
        this.languageMode = normalizeLanguageMode(mode, CONFIG.languageMode);

        for (const [value, button] of this.languageModeButtons.entries()) {
            const active = value === this.languageMode;
            button.classList.toggle('active', active);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
            button.style.background = active ? '#ffffff' : 'transparent';
            button.style.color = active ? '#111827' : 'rgba(255, 255, 255, 0.78)';
        }

        if (persist) {
            try {
                localStorage.setItem(LANGUAGE_MODE_STORAGE_KEY, this.languageMode);
            } catch {
                // Ignore storage failures in third-party embeds.
            }
        }

        console.log(`[Avatar] Language mode: ${this.languageMode}`);
    }

    setupLanguageControls() {
        const controls = document.createElement('div');
        controls.className = 'widget-language-toggle';
        controls.setAttribute('role', 'group');
        controls.setAttribute('aria-label', 'Sign language');
        Object.assign(controls.style, {
            position: 'absolute',
            left: '10px',
            bottom: '10px',
            zIndex: '12',
            display: 'inline-flex',
            gap: '2px',
            padding: '3px',
            borderRadius: '8px',
            background: 'rgba(17, 24, 39, 0.68)',
            backdropFilter: 'blur(10px)',
            pointerEvents: 'auto',
            opacity: '0',
            transform: 'translateY(4px)',
            transition: 'opacity 0.2s ease, transform 0.2s ease',
        });

        for (const option of LANGUAGE_MODE_OPTIONS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'widget-language-btn';
            button.textContent = option.label;
            button.title = option.title;
            button.setAttribute('aria-label', option.title);
            Object.assign(button.style, {
                minWidth: '34px',
                height: '26px',
                padding: '0 8px',
                border: '0',
                borderRadius: '6px',
                background: 'transparent',
                color: 'rgba(255, 255, 255, 0.78)',
                font: '700 11px/1 Inter, -apple-system, BlinkMacSystemFont, sans-serif',
                letterSpacing: '0',
                cursor: 'pointer',
            });
            button.addEventListener('click', (event) => {
                event.stopPropagation();
                this.setLanguageMode(option.value);
            });
            controls.appendChild(button);
            this.languageModeButtons.set(option.value, button);
        }

        this.languageControls = controls;
        this.container.appendChild(controls);
        this.setLanguageMode(this.languageMode, { persist: false });
        this.updateLanguageControlsVisibility();
    }

    updateLanguageControlsVisibility() {
        if (!this.languageControls) return;

        this.languageControls.style.opacity = this.isExpanded ? '1' : '0';
        this.languageControls.style.transform = this.isExpanded ? 'translateY(0)' : 'translateY(4px)';
    }

    /** Setup text selection handlers */
    setupTextSelection() {
        document.addEventListener('mouseup', () => this.handleTextSelection());
        document.addEventListener('touchend', () => setTimeout(() => this.handleTextSelection(), 100));
    }

    /** Handle text selection for animation trigger */
    handleTextSelection() {
        const selectedText = window.getSelection().toString().trim().toLowerCase();
        if (!selectedText) return;
        // Guard against overlapping animation calls from rapid mouseup/touchend events
        if (this._isPlaying) return;
        this._isPlaying = true;
        this.processTextSelection(selectedText).finally(() => {
            this._isPlaying = false;
        });
    }

    /** Process explicit text for animation trigger */
    async processTextSelection(selectedText) {
        if (typeof selectedText !== 'string' || !selectedText) return;

        if (!this.isExpanded) this.expand();

        try {
            console.log(`[Avatar] Requesting translation for: "${selectedText}"`);

            // Use download manager to translate and preload all VRMA files
            const languageIds = this.getLanguageIdsForCurrentMode();
            const { response, urls, languageId } = await this.downloadManager.translateAndPreloadAny(selectedText, languageIds);
            this.currentTranslationLanguageId = languageId || response?.language_id || languageIds[0] || CONFIG.languageId;
            console.log(`[Avatar] Using language: ${this.currentTranslationLanguageId}`);

            if (response.sequence && response.sequence.length > 0) {
                await this.playTranslateResponse(response, urls, this.currentTranslationLanguageId);
                return;
            }
            console.warn('[Avatar] API returned no usable animations, falling back to local config');

        } catch (error) {
            console.error('[Avatar] Error processing text selection from API:', error);
            sendErrorToTelegram(error, `AvatarWidget - Text Selection API: "${selectedText}"`);
            console.warn('[Avatar] Falling back to local config');
        }

        // Fallback to local config lookup + always articulate lips
        let bodyPromise = Promise.resolve();
        if (CONFIG.animations[selectedText]) {
            bodyPromise = this.playAnimation(selectedText, this.currentTranslationLanguageId);
        } else {
            for (const animName in CONFIG.animations) {
                if (selectedText.includes(animName)) {
                    bodyPromise = this.playAnimation(animName, this.currentTranslationLanguageId);
                    break;
                }
            }
        }
        await Promise.all([bodyPromise, this.speak(selectedText, 150)]);
    }

    /**
     * Split missing text into letter animations (finger spelling fallback)
     * @param {string} text
     * @param {number} speed
     */
    async playTextAsLetters(text, speed = CONFIG.speechSpeed || 150, languageId = this.currentTranslationLanguageId) {
        const letters = Array.from((text || '').toLowerCase())
            .filter((char) => /[0-9A-Za-z\u0400-\u04FF]/.test(char));

        if (letters.length === 0) {
            if (text) {
                await this.speak(text, speed);
            }
            return;
        }

        console.log(`[Avatar] Falling back to letter animations for "${text}"`);

        // Preload all unique letter animations in parallel before playback
        const uniqueLetters = [...new Set(letters)];
        const letterUrlMap = new Map(); // letter -> blobUrl

        // Translate and download all unique letters concurrently
        const preloadPromises = uniqueLetters
            .filter(letter => !CONFIG.animations[letter]) // Skip letters already in local config
            .map(async (letter) => {
                try {
                    const { getApiClient } = await import('../utils/api-client.js');
                    const apiClient = getApiClient();
                    const response = await apiClient.translate(letter, languageId);
                    if (response?.sequence?.length > 0) {
                        const seq = response.sequence[0];
                        if (seq.found && seq.file_url) {
                            const blobUrl = await this.downloadManager.getAnimationUrl(seq.file_url);
                            letterUrlMap.set(letter, blobUrl);
                            // Pre-parse into Three.js clip
                            await loadAnimation(blobUrl, this.currentVrm, this.animationCache).catch(() => null);
                        }
                    }
                } catch (err) {
                    console.warn(`[Avatar] Failed to preload letter "${letter}":`, err);
                }
            });

        await Promise.all(preloadPromises);
        console.log(`[Avatar] Pre-loaded ${letterUrlMap.size}/${uniqueLetters.length} letter animations`);

        // Now play all letters sequentially (all data is already cached)
        for (const [index, letter] of letters.entries()) {
            const isLastLetter = index === letters.length - 1;

            // Use preloaded URL if available, otherwise fall back to playAnimation
            const preloadedUrl = letterUrlMap.get(letter);
            if (preloadedUrl) {
                await Promise.all([
                    this.playAnimationFromUrl(preloadedUrl),
                    this.speak(letter, speed)
                ]);
            } else {
                await Promise.all([
                    this.playAnimation(letter),
                    this.speak(letter, speed)
                ]);
            }

            if (!isLastLetter) {
                await this.waitScaled(ANIMATION_DEFAULTS.PAUSE_BETWEEN_ANIMATIONS);
            }
        }
    }

    /**
     * Play a translate API response, using letter-by-letter fallback for missing words
     * @param {Object} response
     * @param {Map<string, string>} [preloadedUrls]
     */
    async playTranslateResponse(response, preloadedUrls = null, languageId = response?.language_id || this.currentTranslationLanguageId) {
        const sequence = Array.isArray(response?.sequence) ? response.sequence : [];

        if (sequence.length === 0) {
            if (response?.text) {
                await this.speak(response.text, CONFIG.speechSpeed || 150);
            }
            return;
        }

        // Preload ALL animations before starting playback.
        // This avoids download pauses between animations in long sentences.
        if (!preloadedUrls || preloadedUrls.size === 0) {
            try {
                console.log(`[Avatar] Preloading ${sequence.length} animations before playback...`);
                preloadedUrls = await this.downloadManager.preloadSequence(sequence);
            } catch (preloadErr) {
                console.warn('[Avatar] Preload failed, will download on-the-fly:', preloadErr);
                preloadedUrls = preloadedUrls || new Map();
            }
        }

        // Pre-parse all downloaded VRMA files into Three.js clips (fills animationCache)
        if (preloadedUrls && preloadedUrls.size > 0 && this.currentVrm) {
            const parsePromises = [...preloadedUrls.values()].map(blobUrl =>
                loadAnimation(blobUrl, this.currentVrm, this.animationCache).catch(() => null)
            );
            await Promise.all(parsePromises);
            console.log(`[Avatar] Pre-parsed ${parsePromises.length} animation clips`);
        }

        for (const [index, item] of sequence.entries()) {
            const isLast = index === sequence.length - 1;
            const spokenText = item?.text || item?.word || '';
            const lipSpeed = item?.duration
                ? (item.duration * 1000) / Math.max(spokenText.length, 1)
                : (CONFIG.speechSpeed || 150);

            if (item?.found && item?.file_url) {
                let animationUrl = preloadedUrls?.get(item.file_url) || null;

                if (!animationUrl) {
                    try {
                        animationUrl = await this.downloadManager.getAnimationUrl(item.file_url);
                    } catch (downloadErr) {
                        console.error(`[Avatar] Failed to download animation for "${item.word || spokenText}":`, downloadErr);
                        sendErrorToTelegram(downloadErr, `AvatarWidget - Download Animation: "${item.word || spokenText}"`);
                    }
                }

                if (animationUrl) {
                    console.log(`[Avatar] Playing animation for "${item.word || spokenText}" (${item.gloss_name || 'direct'})`);
                    await Promise.all([
                        this.playAnimationFromUrl(animationUrl),
                        this.speak(spokenText, lipSpeed)
                    ]);
                } else if (spokenText) {
                    await this.playTextAsLetters(spokenText, lipSpeed, languageId);
                }
            } else if (spokenText) {
                console.warn(`[Avatar] No animation found for word: "${item.word || spokenText}". Falling back to letters.`);
                await this.playTextAsLetters(spokenText, lipSpeed, languageId);
            }

            if (!isLast) {
                await this.waitScaled(ANIMATION_DEFAULTS.PAUSE_BETWEEN_ANIMATIONS);
            }
        }

        // Ensure rest pose at the very end of the full sequence
        this.returnToRestPose();
    }

    /** Setup widget toggle behavior */
    setupWidgetToggle() {
        this.container.classList.add('compact');

        this.container.addEventListener('click', () => {
            if (!this.isExpanded) this.expand();
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'widget-close-btn';
        closeBtn.innerHTML = '✕';
        closeBtn.title = 'Свернуть';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.collapse();
        });
        this.container.appendChild(closeBtn);
    }

    /** Expand widget */
    expand() {
        if (this.isExpanded) return;
        this.isExpanded = true;
        this.container.classList.remove('compact');
        this.container.classList.add('expanded');
        this.updateLanguageControlsVisibility();
    }

    /** Collapse widget */
    collapse() {
        if (!this.isExpanded) return;
        this.isExpanded = false;
        this.container.classList.remove('expanded');
        this.container.classList.add('compact');
        this.updateLanguageControlsVisibility();
    }

    /**
     * Load model by configured name
     * @param {string} name - Avatar name from config
     */
    async loadModelByName(name) {
        const entry = CONFIG.avatars[name];
        if (!entry) {
            console.error(`Avatar "${name}" not found in config`);
            sendErrorToTelegram(new Error(`Avatar "${name}" not found in config`), 'AvatarWidget - Load Model By Name');
            return;
        }

        // Handle String vs Object config
        let modelPath = entry;
        let modelConfig = { ...CONFIG };

        if (typeof entry === 'object') {
            modelPath = entry.path;
            // Override avatar rotation logic if provided
            if (entry.rotation !== undefined) {
                // Deep merge or specific override
                modelConfig = {
                    ...CONFIG,
                    avatar: {
                        ...CONFIG.avatar,
                        rotation: entry.rotation
                    }
                };
            }
        }

        await this.loadModel(modelPath, modelConfig);
    }

    /**
     * Load VRM model from path
     * @param {string} modelPath - Path to VRM file
     * @param {Object} config - Configuration object (optional override)
     */
    async loadModel(modelPath, config = CONFIG) {
        // Clean up old model
        if (this.currentVrm) {
            this.scene.remove(this.currentVrm.scene);
            disposeVRM(this.currentVrm);
            this.mixer = null;
            this.idleAction = null;
            this.currentAction = null;
        }

        // Show loader
        if (this.loaderOverlay) {
            this.loaderText.innerText = 'Loading Model 0%...';
            this.loaderOverlay.classList.add('active');
        }

        try {
            this.currentVrm = await loadVRMModel(modelPath, config, (percent) => {
                if (this.loaderText) {
                    this.loaderText.innerText = `Loading Avatar ${percent}%...`;
                }
            });
            this.scene.add(this.currentVrm.scene);
            this.mixer = new THREE.AnimationMixer(this.currentVrm.scene);

            // Create rest pose idle action (inline quaternions — instant)
            const restClip = createRestPoseClip(this.currentVrm);
            if (restClip) {
                this.idleAction = this.mixer.clipAction(restClip);
                this.idleAction.setLoop(THREE.LoopOnce);
                this.idleAction.clampWhenFinished = true;
                this.idleAction.setEffectiveWeight(1.0);
                this.idleAction.play();
            } else {
                console.warn('[Avatar] Could not create rest pose, falling back to setNeutralPose');
                this.setNeutralPose();
            }
            
            // Hide loader smoothly
            setTimeout(() => {
                if (this.loaderOverlay) {
                    this.loaderOverlay.classList.remove('active');
                }
            }, 300);
        } catch (error) {
            console.error('Failed to load model:', error);
            sendErrorToTelegram(error, `AvatarWidget - Load Model (${modelPath})`);
            if (this.loaderText) {
                this.loaderText.innerText = `Load Error: ${(error && error.message) ? error.message : error}`;
                this.loaderText.style.color = '#ef4444';
                // Increase font size slightly so it's readable
                this.loaderText.style.fontSize = '12px';
                this.loaderText.style.textAlign = 'center';
            }
        }
    }

    /** Apply procedural idle pose (hands ready) */
    setNeutralPose() {
        if (!this.currentVrm) return;

        // Helper to find bone node using multiple strategies
        const getBone = (name) => {
            // Strategy 1: Humanoid API
            if (this.currentVrm.humanoid) {
                const h = this.currentVrm.humanoid;
                if (h.getRawBoneNode) return h.getRawBoneNode(name);
                if (h.getNormalizedBoneNode) return h.getNormalizedBoneNode(name);
                if (h.getBoneNode) return h.getBoneNode(name);
            }

            // Strategy 2: Scene traversal (Nuclear option)
            // Common naming conventions for VRM/CC
            const searchNames = [
                name, // Exact match
                name.charAt(0).toUpperCase() + name.slice(1), // Capitalized
                `J_Bip_C_${name}`, // VRM/Unity standard
                `CC_Base_${name}`, // CC standard
                name.replace('left', 'L_').replace('right', 'R_'), // Short L_ R_
            ];

            // Specific mapping for common failures
            if (name === 'leftUpperArm') searchNames.push('LeftArm', 'J_Bip_L_UpperArm', 'CC_Base_L_Upperarm');
            if (name === 'rightUpperArm') searchNames.push('RightArm', 'J_Bip_R_UpperArm', 'CC_Base_R_Upperarm');
            if (name === 'leftLowerArm') searchNames.push('LeftForeArm', 'J_Bip_L_LowerArm', 'CC_Base_L_Forearm');
            if (name === 'rightLowerArm') searchNames.push('RightForeArm', 'J_Bip_R_LowerArm', 'CC_Base_R_Forearm');
            if (name === 'leftHand') searchNames.push('LeftHand', 'J_Bip_L_Hand', 'CC_Base_L_Hand');
            if (name === 'rightHand') searchNames.push('RightHand', 'J_Bip_R_Hand', 'CC_Base_R_Hand');

            for (const search of searchNames) {
                const found = this.scene.getObjectByName(search);
                if (found) return found;
            }

            return null;
        };

        const setRot = (boneName, x, y, z) => {
            const bone = getBone(boneName);
            if (bone) {
                bone.rotation.set(x, y, z);
            } else {
                console.warn(`[Avatar] setNeutralPose: Could not find bone '${boneName}'`);
            }
        };

        // Arms relaxed but ready (Interpreter stance)
        const armAngle = 1.35;
        setRot('leftUpperArm', 0, 0, -armAngle);
        setRot('rightUpperArm', 0, 0, armAngle);

        setRot('leftLowerArm', 0.2, -0.5, 0);
        setRot('rightLowerArm', 0.2, 0.5, 0);

        setRot('leftHand', 0.1, -0.2, 0);
        setRot('rightHand', 0.1, 0.2, 0);
    }

    /**
     * Set animation playback speed
     * @param {number} speed - Speed multiplier (1.0 = normal, 2.0 = double speed)
     */
    setPlaybackSpeed(speed) {
        this.playbackSpeed = Math.max(0.1, Math.min(speed, 5.0));
        // Update current action if playing
        if (this.currentAction && this.currentAction !== this.idleAction) {
            this.currentAction.setEffectiveTimeScale(this.playbackSpeed);
        }
        console.log(`[Avatar] Playback speed set to ${this.playbackSpeed}x`);
    }

    /**
     * Play named animation
     * @param {string} name - Animation name or gloss
     */
    async playAnimation(name, languageId = this.currentTranslationLanguageId) {
        // Try local config first
        if (CONFIG.animations[name]) {
            return this.playAnimationFromUrl(CONFIG.animations[name]);
        }

        // Try backend if not found locally
        console.log(`[Avatar] Animation "${name}" not found in config, querying backend...`);
        try {
            const { getApiClient } = await import('../utils/api-client.js');
            const apiClient = getApiClient();
            
            const response = await apiClient.translate(name, languageId);
            if (response && response.sequence && response.sequence.length > 0) {
                const seq = response.sequence[0];
                if (seq.found && seq.file_url) {
                    const blobUrl = await apiClient.getVRMABlobUrl(seq.file_url);
                    return this.playAnimationFromUrl(blobUrl);
                }
            }
            console.error(`[Avatar] Animation for "${name}" not found on backend either.`);
            sendErrorToTelegram(new Error(`Animation not found: ${name}`), 'AvatarWidget - Animation Lookup');
        } catch (e) {
            console.error(`[Avatar] Backend query failed for "${name}":`, e);
            sendErrorToTelegram(e, `AvatarWidget - Backend Query (${name})`);
        }
    }

    /**
     * Play animation from direct URL.
     * The animation clamps at its last frame when finished (no automatic rest pose return).
     * Call returnToRestPose() explicitly after a sequence if needed.
     * @param {string} url - Direct URL to VRMA file
     */
    async playAnimationFromUrl(url) {
        const clip = await loadAnimation(url, this.currentVrm, this.animationCache);
        if (!clip) return;

        const newAction = this.mixer.clipAction(clip);

        // Настройка новой анимации
        newAction.reset();
        newAction.setLoop(THREE.LoopOnce);
        newAction.clampWhenFinished = true;
        newAction.enabled = true;
        
        // Start playing at full weight immediately to avoid missing the first frames
        newAction.setEffectiveWeight(1.0);
        newAction.setEffectiveTimeScale(this.getPlaybackRate());
        newAction.setEffectiveTimeScale(this.playbackSpeed);

        // Fade out idle action so it blends underneath the new action
        if (this.idleAction) {
            this.idleAction.fadeOut(ANIMATION_DEFAULTS.CROSSFADE_DURATION);
        }

        // Fade out previous action (but NOT if it's the same action being replayed —
        // mixer.clipAction() returns the same object for the same clip)
        if (this.currentAction && this.currentAction !== this.idleAction && this.currentAction !== newAction) {
            this.currentAction.fadeOut(ANIMATION_DEFAULTS.CROSSFADE_DURATION);
        }

        newAction.play();
        this.currentAction = newAction;

        // Wait for animation to finish — stays clamped at last frame
        return new Promise((resolve) => {
            const onFinished = (e) => {
                if (e.action === newAction) {
                    this.mixer.removeEventListener('finished', onFinished);
                    resolve();
                }
            };
            this.mixer.addEventListener('finished', onFinished);
        });
    }

    /**
     * Smoothly return to rest (idle) pose.
     * Call this after the last animation in a sequence.
     * Uses a long fade for natural-looking hand lowering.
     */
    returnToRestPose() {
        const fadeDuration = ANIMATION_DEFAULTS.REST_POSE_FADE_DURATION;
        if (this.currentAction && this.currentAction !== this.idleAction) {
            this.currentAction.fadeOut(fadeDuration);
        }
        if (this.idleAction) {
            this.idleAction.reset();
            this.idleAction.setEffectiveWeight(1.0);
            this.idleAction.fadeIn(fadeDuration);
            this.idleAction.play();
        }
    }

    /**
     * Set a specific expression target (smoothed)
     * @param {string} name - Expression name
     * @param {number} value - Target intensity
     */
    setExpression(name, value) {
        if (!this.currentVrm || !this.currentVrm.expressionManager) return;

        // Remap 'happy' to 'fun' to keep eyes open (Joy usually closes eyes)
        if (name === 'happy') name = 'fun';

        // Instead of setting directly, we set a target
        if (!this.targetExpressionWeights) this.targetExpressionWeights = {};
        this.targetExpressionWeights[name] = value;
    }

    /**
     * Process smoothing of expression weights
     * @param {number} deltaTime
     */
    processExpressionSmoothing(deltaTime) {
        if (!this.currentVrm || !this.currentVrm.expressionManager) return;
        if (!this.targetExpressionWeights) return;

        const lerpSpeed = 20.0; // Increased for snappier lip-sync

        for (const [name, targetValue] of Object.entries(this.targetExpressionWeights)) {
            const currentValue = this.currentVrm.expressionManager.getValue(name);

            // Simple lerp: current + (target - current) * speed * dt
            let newValue = currentValue + (targetValue - currentValue) * lerpSpeed * deltaTime;

            // Snap when close
            if (Math.abs(targetValue - newValue) < 0.01) {
                newValue = targetValue;
            }

            this.currentVrm.expressionManager.setValue(name, newValue);
        }
    }

    /**
     * Update automatic blinking
     * @param {number} deltaTime 
     */
    updateBlinking(deltaTime) {
        if (!this.currentVrm || !this.currentVrm.expressionManager) return;

        this.blinkTimer += deltaTime * 1000;

        if (this.isBlinking) {
            if (this.blinkTimer >= this.blinkDuration * 1000) {
                this.setExpression('blink', 0); // Open eyes
                this.isBlinking = false;
                this.blinkTimer = 0;
                this.nextBlinkTime = Math.random() * 3000 + 2000; // Next blink in 2-5s
            }
        } else {
            if (this.blinkTimer >= this.nextBlinkTime) {
                this.isBlinking = true;
                this.blinkTimer = 0;
                this.setExpression('blink', 1.0); // Close eyes
            }
        }
    }

    /**
     * set TTS Manager
     * @param {Object} ttsManager 
     */
    setTTSManager(ttsManager) {
        this.ttsManager = ttsManager;
    }

    /**
     * Speak text using lip-sync and audio
     * @param {string} text - Text to speak
     * @param {number} speed - Milliseconds per character
     * @returns {Promise} Resolves when speech finishes
     */
    async speak(text, speed = 150) {
        console.log(`[Avatar] Speaking: "${text}"`);

        const effectiveSpeed = speed / this.getPlaybackRate();

        const rawSequence = textToVisemeSequence(text, effectiveSpeed);
        // Convert viseme-mapper format {preset} to expression event format {type, name}
        // that applyExpressionEvent() expects (same conversion as playFromJSON line 529)
        const sequence = rawSequence.map(v => ({
            time: v.time,
            type: 'viseme',
            name: v.preset,
            duration: v.duration,
            value: v.value !== undefined ? v.value : 1.0,
        }));
        this.playExpressionSequence(sequence);

        if (this.ttsManager) {
            return this.ttsManager.speak(text);
        }

        const lastViseme = sequence[sequence.length - 1];
        const duration = lastViseme ? lastViseme.time + lastViseme.duration : (text.length * effectiveSpeed);
        return new Promise(resolve => setTimeout(resolve, duration));
    }

    /**
     * Play animation/speech from JSON data
     * @param {Object|Array} json 
     */
    async playFromJSON(json) {
        if (!json) return;

        if (Array.isArray(json)) {
            console.log('[Avatar] Playing sequence:', json.length, 'items');
            for (const item of json) {
                await this.playFromJSON(item);
            }
            // Return to rest pose after the full sequence
            this.returnToRestPose();
            return;
        }

        console.log('[Avatar] Playing item:', json);

        // Apply speed multiplier if provided
        const previousSpeed = this.playbackSpeed;
        if (json.speed_multiplier) {
            this.setPlaybackSpeed(json.speed_multiplier);
        }

        let animPromise = Promise.resolve();
        if (json.animation) {
            animPromise = this.playAnimation(json.animation);
        }

        // Generate Expression Events
        const events = [];
        let speechPromise = Promise.resolve();

        if (json.text) {
            const speed = json.speed || CONFIG.speechSpeed || 150;
            const visemes = textToVisemeSequence(json.text, speed);
            visemes.forEach(v => events.push({
                time: v.time, type: 'viseme', name: v.preset, duration: v.duration, value: v.value !== undefined ? v.value : 1.0
            }));
        }

        if (json.emotions && Array.isArray(json.emotions)) {
            json.emotions.forEach(e => events.push({
                time: e.time, type: 'emotion', name: e.name, value: e.value, duration: 0
            }));
        }

        events.sort((a, b) => a.time - b.time);
        if (events.length > 0) {
            this.playExpressionSequence(events);
        }

        if (json.text && this.ttsManager) {
            speechPromise = this.ttsManager.speak(json.text);
        } else if (json.text) {
            const lastEvent = events[events.length - 1];
            const dur = lastEvent ? lastEvent.time + lastEvent.duration : 1000;
            speechPromise = new Promise(r => setTimeout(r, dur));
        }

        await Promise.all([animPromise, speechPromise]);

        // Restore previous speed if it was overridden
        if (json.speed_multiplier) {
            this.setPlaybackSpeed(previousSpeed);
        }
    }

    /**
     * Play a sequence of expressions/visemes
     * @param {Array} sequence 
     */
    playExpressionSequence(sequence) {
        this.currentExpressionSequence = sequence;
        this.expressionTimer = 0;
        this.currentExpressionIndex = 0;

        if (this.currentVrm?.expressionManager) {
            ['aa', 'ih', 'ou', 'ee', 'oh', 'neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised', 'blink'].forEach(name => {
                this.setExpression(name, 0);
            });
            this.setExpression('neutral', 1.0);
        }
    }

    /**
     * Update expressions based on time
     * @param {number} deltaTime 
     */
    updateExpressions(deltaTime) {
        if (!this.currentExpressionSequence) return;

        this.expressionTimer += deltaTime * 1000;

        while (this.currentExpressionIndex < this.currentExpressionSequence.length &&
            this.currentExpressionSequence[this.currentExpressionIndex].time <= this.expressionTimer) {

            const event = this.currentExpressionSequence[this.currentExpressionIndex];
            this.applyExpressionEvent(event);
            this.currentExpressionIndex++;
        }

        if (this.currentActiveViseme) {
            if (this.expressionTimer > this.currentActiveViseme.endTime) {
                if (this.currentActiveViseme.name === 'ou_oh_combo') {
                    this.setExpression('ou', 0);
                    this.setExpression('oh', 0);
                } else if (this.currentActiveViseme.name === 'aa_ee_combo') {
                    this.setExpression('aa', 0);
                    this.setExpression('ee', 0);
                } else if (this.currentActiveViseme.name === 'eh_combo') {
                    this.setExpression('aa', 0);
                    this.setExpression('ee', 0);
                } else {
                    this.setExpression(this.currentActiveViseme.name, 0);
                }
                this.currentActiveViseme = null;
            }
        }

        const lastEvent = this.currentExpressionSequence[this.currentExpressionSequence.length - 1];
        const totalDuration = lastEvent ? lastEvent.time + (lastEvent.duration || 0) + 100 : 0;

        if (this.expressionTimer > totalDuration) {
            this.currentExpressionSequence = null;
            this.currentActiveViseme = null;
            this.setExpression('neutral', 1.0);
            ['aa', 'ih', 'ou', 'ee', 'oh', 'happy', 'angry', 'sad'].forEach(name => {
                this.setExpression(name, 0);
            });

            if (this.onSpeechEnd) {
                this.onSpeechEnd();
            }
        }
    }

    applyExpressionEvent(event) {
        if (!this.currentVrm || !this.currentVrm.expressionManager) return;

        if (event.type === 'viseme') {
            if (this.currentActiveViseme) {
                if (this.currentActiveViseme.name === 'ou_oh_combo') {
                    this.setExpression('ou', 0);
                    this.setExpression('oh', 0);
                } else if (this.currentActiveViseme.name === 'aa_ee_combo') {
                    this.setExpression('aa', 0);
                    this.setExpression('ee', 0);
                } else if (this.currentActiveViseme.name === 'eh_combo') {
                    this.setExpression('aa', 0);
                    this.setExpression('ee', 0);
                } else {
                    this.setExpression(this.currentActiveViseme.name, 0);
                }
            }
            
            // Hard reset all vowel visemes to 0 directly to prevent bleeding
            // ('aa' might override 'oh' if not explicitly reset)
            if (this.currentVrm.expressionManager) {
                let skipReset = [event.name];
                if (event.name === 'ou_oh_combo') skipReset = ['ou', 'oh'];
                if (event.name === 'aa_ee_combo') skipReset = ['aa', 'ee'];
                if (event.name === 'eh_combo') skipReset = ['aa', 'ee'];
                
                ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(v => {
                    if (!skipReset.includes(v)) {
                        this.currentVrm.expressionManager.setValue(v, 0);
                        this.setExpression(v, 0);
                    }
                });
            }

            if (event.name === 'ou_oh_combo') {
                this.setExpression('ou', event.value * 0.5);
                this.setExpression('oh', event.value * 0.5);
                this.currentActiveViseme = {
                    name: 'ou_oh_combo',
                    endTime: event.time + event.duration
                };
            } else if (event.name === 'aa_ee_combo') {
                this.setExpression('aa', event.value * 0.3);
                this.setExpression('ee', event.value * 0.6);
                this.currentActiveViseme = {
                    name: 'aa_ee_combo',
                    endTime: event.time + event.duration
                };
            } else if (event.name === 'eh_combo') {
                this.setExpression('aa', event.value * 0.6);
                this.setExpression('ee', event.value * 0.6);
                this.currentActiveViseme = {
                    name: 'eh_combo',
                    endTime: event.time + event.duration
                };
            } else if (event.name !== 'neutral') {
                this.setExpression(event.name, event.value);
                this.currentActiveViseme = {
                    name: event.name,
                    endTime: event.time + event.duration
                };
            }
        } else if (event.type === 'emotion') {
            this.setExpression(event.name, event.value);
        }
    }



    /**
     * Start capturing the canvas to a WebM video
     * @param {Object} options - Recording options
     * @param {number} [options.fps=30] - Frames per second
     * @param {number} [options.bitrate=8000000] - Video bitrate (8Mbps default for high quality)
     */
    startRecording(options = {}) {
        if (!this.renderer || !this.renderer.domElement) return;
        
        const fps = options.fps || 30;
        const bitrate = options.bitrate || 8000000;
        
        const stream = this.renderer.domElement.captureStream(fps);
        this.recordedChunks = [];
        this.recorder = new MediaRecorder(stream, { 
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: bitrate
        });
        
        this.recorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.recordedChunks.push(e.data);
        };
        
        this.recorder.start();
        console.log(`[Avatar] Recording started (FPS: ${fps}, Bitrate: ${bitrate / 1000000} Mbps)`);
    }

    /**
     * Stop capturing and return the video Blob
     * @returns {Promise<Blob>}
     */
    stopRecording() {
        return new Promise((resolve, reject) => {
            if (!this.recorder || this.recorder.state === 'inactive') {
                return reject(new Error('Recorder is not active'));
            }
            
            this.recorder.onstop = () => {
                const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
                this.recordedChunks = [];
                console.log('[Avatar] Recording stopped, blob size:', blob.size);
                resolve(blob);
            };
            
            this.recorder.stop();
        });
    }

    /**
     * Record a specific text animation sequence to a video file
     * @param {string} text - The text to animate
     * @param {Object} [options] - Export options
     * @param {boolean} [options.hd=false] - Temporarily scale canvas to 1280x720 for crisp recording
     * @param {string} [options.background=null] - CSS color for background (e.g. '#00ff00' for green screen)
     * @returns {Promise<Blob>} The recorded WebM video blob
     */
    async exportVideo(text, options = {}) {
        // Save original state
        const originalWidth = this.container.clientWidth;
        const originalHeight = this.container.clientHeight;
        const originalClearColor = new THREE.Color();
        this.renderer.getClearColor(originalClearColor);
        const originalClearAlpha = this.renderer.getClearAlpha();
        const originalBodyBg = document.body.style.backgroundColor;

        // Apply HD resolution if requested
        if (options.hd) {
            console.log('[Avatar] Upscaling to HD for recording...');
            this.renderer.setSize(1280, 720);
            this.camera.aspect = 1280 / 720;
            this.camera.updateProjectionMatrix();
        }

        // Apply custom background if requested
        if (options.background) {
            document.body.style.backgroundColor = options.background;
            this.renderer.setClearColor(options.background, 1);
        }

        this.startRecording(options);
        
        // Allow rendering to catch up with size/color changes
        await new Promise(r => setTimeout(r, 100));
        
        try {
            await this.processTextSelection(text);
        } catch (e) {
            console.error('[Avatar] Error during video export playback:', e);
        }
        
        // Wait a short moment after finishing to avoid cutting off the end
        await new Promise(r => setTimeout(r, 500));
        
        const blob = await this.stopRecording();

        // Revert to original state
        if (options.hd) {
            this.renderer.setSize(originalWidth || window.innerWidth, originalHeight || window.innerHeight);
            this.camera.aspect = (originalWidth || window.innerWidth) / (originalHeight || window.innerHeight);
            this.camera.updateProjectionMatrix();
        }
        
        if (options.background) {
            document.body.style.backgroundColor = originalBodyBg;
            this.renderer.setClearColor(originalClearColor, originalClearAlpha);
        }

        return blob;
    }

    /** Handle window resize */
    onResize() {
        if (!this.container || !this.renderer) return;

        const width = this.container.clientWidth || 150;
        const height = this.container.clientHeight || 180;

        if (width > 0 && height > 0) {
            this.renderer.setSize(width, height);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
    }

    /** Animation loop */
    animate() {
        requestAnimationFrame(() => this.animate());
        const deltaTime = this.clock.getDelta();

        // Force neutral pose every frame to ensure it overrides T-Pose
        // DISABLED: User requested ONLY VRMA animations. Procedural override fights with animation.
        // this.setNeutralPose();

        if (this.mixer) this.mixer.update(deltaTime);

        this.updateBlinking(deltaTime);
        // this.updateBreathing(deltaTime); // DISABLED: Avoiding interference with VRMA
        this.updateExpressions(deltaTime);
        this.processExpressionSmoothing(deltaTime);

        if (this.currentVrm) this.currentVrm.update(deltaTime);
        this.renderer.render(this.scene, this.camera);
    }
}

// Initialize widgets
if (document.getElementById('avatar-widget-container')) {
    new AvatarWidget('avatar-widget-container');
}

if (document.getElementById('standalone-widget')) {
    new AvatarWidget('standalone-widget');
}
