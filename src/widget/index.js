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
class AvatarWidget {
    /**
     * Create avatar widget
     * @param {string} containerId - DOM element ID for widget container
     */
    constructor(containerId) {
        this.container = document.getElementById(containerId);
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
            this.showNotification(`🎬 ${selectedText}`);
            this.playAnimation(selectedText);
        } else {
            for (const animName in CONFIG.animations) {
                if (selectedText.includes(animName)) {
                    this.showNotification(`🎬 ${animName}`);
                    this.playAnimation(animName);
                    break;
                }
            }
        }
    }

    /**
     * Show notification toast
     * @param {string} message - Message to display
     */
    showNotification(message) {
        const existing = document.querySelector('.animation-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = 'animation-notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 2000);
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
        const modelPath = CONFIG.avatars[name];
        if (!modelPath) {
            console.error(`Avatar "${name}" not found in config`);
            return;
        }
        await this.loadModel(modelPath);
    }

    /**
     * Load VRM model from path
     * @param {string} modelPath - Path to VRM file
     */
    async loadModel(modelPath) {
        // Clean up old model
        if (this.currentVrm) {
            this.scene.remove(this.currentVrm.scene);
            disposeVRM(this.currentVrm);
            this.mixer = null;
            this.idleAction = null;
            this.currentAction = null;
        }

        try {
            this.currentVrm = await loadVRMModel(modelPath, CONFIG);
            this.scene.add(this.currentVrm.scene);
            this.mixer = new THREE.AnimationMixer(this.currentVrm.scene);
            await this.playIdleAnimation();
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
        if (!url) {
            console.error(`Animation "${name}" not found in config`);
            return;
        }

        const clip = await loadAnimation(url, this.currentVrm, this.animationCache);
        if (!clip) return;

        // Stop previous animation
        if (this.currentAction?.isRunning()) {
            this.currentAction.fadeOut(ANIMATION_DEFAULTS.CROSSFADE_DURATION);
            this.currentAction.stop();
        }

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;

        // Crossfade from idle
        if (this.idleAction?.isRunning()) {
            action.crossFadeFrom(this.idleAction, ANIMATION_DEFAULTS.FADE_DURATION, true);
        }

        action.play();
        this.currentAction = action;

        // Return to idle when finished
        if (this.onAnimationFinished) {
            this.mixer.removeEventListener('finished', this.onAnimationFinished);
        }
        this.onAnimationFinished = (e) => {
            if (e.action === action) {
                this.currentAction = null;
                if (this.idleAction) {
                    this.idleAction.reset().crossFadeFrom(action, ANIMATION_DEFAULTS.FADE_DURATION, true).play();
                }
            }
        };
        this.mixer.addEventListener('finished', this.onAnimationFinished);
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

        const lerpSpeed = 15.0; // Adjustable smoothing speed

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
     * Speak text using lip-sync
     * @param {string} text - Text to speak
     * @param {number} speed - Milliseconds per character
     */
    speak(text, speed = 100) {
        console.log(`[Avatar] Speaking: "${text}"`);
        const sequence = textToVisemeSequence(text, speed);
        this.playExpressionSequence(sequence);
    }

    /**
     * Play animation/speech from JSON data
     * @param {Object} json - { text: string, emotions: Array<{time, name, value}> }
     */
    async playFromJSON(json) {
        if (!json) return;

        // 1. Generate visemes from text
        let visemeSequence = [];
        if (json.text) {
            // Speed: from JSON > CONFIG > default 100ms
            const speed = json.speed || CONFIG.speechSpeed || 100;
            visemeSequence = textToVisemeSequence(json.text, speed);
        }

        // 2. Process emotions
        const events = [];

        // Add visemes
        visemeSequence.forEach(v => {
            events.push({
                time: v.time,
                type: 'viseme',
                name: v.preset,
                duration: v.duration,
                value: v.value !== undefined ? v.value : 1.0 // Use generated intensity
            });
        });

        // Add explicit emotions
        if (json.emotions && Array.isArray(json.emotions)) {
            json.emotions.forEach(e => {
                events.push({
                    time: e.time,
                    type: 'emotion',
                    name: e.name,
                    value: e.value,
                    duration: 0
                });
            });
        }

        // Sort by time
        events.sort((a, b) => a.time - b.time);

        this.currentExpressionSequence = events;
        this.expressionTimer = 0;
        this.currentExpressionIndex = 0;

        // Reset all expressions
        if (this.currentVrm?.expressionManager) {
            ['aa', 'ih', 'ou', 'ee', 'oh', 'neutral', 'happy', 'angry', 'sad', 'relaxed', 'surprised'].forEach(name => {
                this.setExpression(name, 0);
            });
        }

        console.log('[Avatar] Playing JSON sequence:', events);
    }

    /**
     * Update expressions based on time (Improved for mixed events)
     * @param {number} deltaTime - Time since last frame
     */
    updateExpressions(deltaTime) {
        if (!this.currentExpressionSequence) return;

        this.expressionTimer += deltaTime * 1000; // Convert to ms

        // Process all events that have happened up to now
        while (this.currentExpressionIndex < this.currentExpressionSequence.length &&
            this.currentExpressionSequence[this.currentExpressionIndex].time <= this.expressionTimer) {

            const event = this.currentExpressionSequence[this.currentExpressionIndex];
            this.applyExpressionEvent(event);
            this.currentExpressionIndex++;
        }

        // Handle viseme duration expiration
        if (this.currentActiveViseme) {
            if (this.expressionTimer > this.currentActiveViseme.endTime) {
                this.setExpression(this.currentActiveViseme.name, 0);
                this.currentActiveViseme = null;
            }
        }

        // Check if finished
        const lastEvent = this.currentExpressionSequence[this.currentExpressionSequence.length - 1];
        const totalDuration = lastEvent ? lastEvent.time + (lastEvent.duration || 0) + 100 : 0;

        if (this.expressionTimer > totalDuration) {
            this.currentExpressionSequence = null;
            this.currentActiveViseme = null;
            // Back to neutral
            this.setExpression('neutral', 1.0);
            ['aa', 'ih', 'ou', 'ee', 'oh', 'happy', 'angry', 'sad'].forEach(name => {
                this.setExpression(name, 0);
            });

            // Notify speech ended
            if (this.onSpeechEnd) {
                this.onSpeechEnd();
            }
        }
    }

    applyExpressionEvent(event) {
        if (!this.currentVrm || !this.currentVrm.expressionManager) return;

        if (event.type === 'viseme') {
            // Unset previous viseme
            if (this.currentActiveViseme) {
                this.setExpression(this.currentActiveViseme.name, 0);
            }

            // Set new viseme
            if (event.name !== 'neutral') {
                this.setExpression(event.name, event.value);
                this.currentActiveViseme = {
                    name: event.name,
                    endTime: event.time + event.duration
                };
            }
        } else if (event.type === 'emotion') {
            // Set emotion value directly
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
        this.setNeutralPose();

        if (this.mixer) this.mixer.update(deltaTime);

        this.updateBlinking(deltaTime);
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
