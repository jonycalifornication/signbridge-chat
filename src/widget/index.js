import * as THREE from 'three';
import { loadAnimation } from '../utils/animation-loader.js';
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

    /** Setup UI controls */
    setupUI() {
        const select = document.getElementById('avatar-select');
        if (!select) return;

        for (const name in CONFIG.avatars) {
            const option = document.createElement('option');
            option.value = name;
            option.innerText = name;
            if (name === CONFIG.defaultAvatar) option.selected = true;
            select.appendChild(option);
        }

        this.loadModelByName(CONFIG.defaultAvatar);
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

    /** Play idle animation */
    async playIdleAnimation() {
        const idleClip = await loadAnimation(CONFIG.animations.idle, this.currentVrm, this.animationCache);
        if (idleClip) {
            this.idleAction = this.mixer.clipAction(idleClip);
            this.idleAction.play();
        }
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
        if (this.mixer) this.mixer.update(deltaTime);
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
