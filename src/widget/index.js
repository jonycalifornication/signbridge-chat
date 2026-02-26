import * as THREE from 'three';
import { loadAnimation } from '../utils/animation-loader.js';
import { textToVisemeSequence } from '../utils/viseme-mapper.js';
import { loadVRMModel, disposeVRM } from '../utils/vrm-loader.js';
import { CAMERA_DEFAULTS, ANIMATION_DEFAULTS, RENDERER_DEFAULTS, LIGHTS } from '../utils/constants.js';
import { CONFIG } from '../config.js';

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

        this.init();
        this.setupUI();
        this.setupTextSelection();
        this.setupWidgetToggle();
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
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 1.5, RENDERER_DEFAULTS.MAX_PIXEL_RATIO));
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

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

    /** Setup text selection handlers */
    setupTextSelection() {
        document.addEventListener('mouseup', () => this.handleTextSelection());
        document.addEventListener('touchend', () => setTimeout(() => this.handleTextSelection(), 100));
    }

    /** Handle text selection for animation trigger */
    handleTextSelection() {
        const selectedText = window.getSelection().toString().trim().toLowerCase();
        if (!selectedText) return;

        if (!this.isExpanded) this.expand();

        // Check exact match or contains
        if (CONFIG.animations[selectedText]) {
            this.playAnimation(selectedText);
        } else {
            for (const animName in CONFIG.animations) {
                if (selectedText.includes(animName)) {
                    this.playAnimation(animName);
                    break;
                }
            }
        }
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
    }

    /** Collapse widget */
    collapse() {
        if (!this.isExpanded) return;
        this.isExpanded = false;
        this.container.classList.remove('expanded');
        this.container.classList.add('compact');
    }

    /**
     * Load model by configured name
     * @param {string} name - Avatar name from config
     */
    async loadModelByName(name) {
        const entry = CONFIG.avatars[name];
        if (!entry) {
            console.error(`Avatar "${name}" not found in config`);
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

        try {
            this.currentVrm = await loadVRMModel(modelPath, config);
            this.scene.add(this.currentVrm.scene);
            this.mixer = new THREE.AnimationMixer(this.currentVrm.scene);
            // playIdleAnimation was missing, we use setNeutralPose instead initially
            this.setNeutralPose();
        } catch (error) {
            console.error('Failed to load model:', error);
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
     * Play named animation
     * @param {string} name - Animation name from config
     */
    async playAnimation(name) {
        const url = CONFIG.animations[name];
        const clip = await loadAnimation(url, this.currentVrm, this.animationCache);
        if (!clip) return;

        const newAction = this.mixer.clipAction(clip);

        // Настройка новой анимации
        newAction.reset();
        newAction.setLoop(THREE.LoopOnce);
        newAction.clampWhenFinished = true;
        newAction.enabled = true;
        newAction.setEffectiveWeight(1.0);

        if (this.currentAction) {
            // Плавный переход от старой к новой
            newAction.crossFadeFrom(this.currentAction, 0.5, true);
        }

        newAction.play();
        this.currentAction = newAction;

        // Ждем окончания
        return new Promise((resolve) => {
            const onFinished = (e) => {
                if (e.action === newAction) {
                    this.mixer.removeEventListener('finished', onFinished);
                    // Плавный возврат в Idle
                    if (this.idleAction) {
                        this.idleAction.enabled = true;
                        this.idleAction.setEffectiveWeight(1.0);
                        this.idleAction.crossFadeFrom(newAction, 0.5, true);
                        this.idleAction.play();
                    }
                    resolve();
                }
            };
            this.mixer.addEventListener('finished', onFinished);
        });
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
    async speak(text, speed = 100) {
        console.log(`[Avatar] Speaking: "${text}"`);

        const sequence = textToVisemeSequence(text, speed);
        this.playExpressionSequence(sequence);

        if (this.ttsManager) {
            return this.ttsManager.speak(text);
        }

        const lastViseme = sequence[sequence.length - 1];
        const duration = lastViseme ? lastViseme.time + lastViseme.duration : (text.length * speed);
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
            return;
        }

        console.log('[Avatar] Playing item:', json);

        let animPromise = Promise.resolve();
        if (json.animation) {
            animPromise = this.playAnimation(json.animation);
        }

        // Generate Expression Events
        const events = [];
        let speechPromise = Promise.resolve();

        if (json.text) {
            const speed = json.speed || CONFIG.speechSpeed || 100;
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
                this.setExpression(this.currentActiveViseme.name, 0);
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
                this.setExpression(this.currentActiveViseme.name, 0);
            }
            if (event.name !== 'neutral') {
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
