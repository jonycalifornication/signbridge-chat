/**
 * SignBridge Mobile Demo
 * Mobile-first interface for sign language avatar with word selection and API integration.
 */

import * as THREE from 'three';
import { loadVRMModel, disposeVRM } from '../src/utils/vrm-loader.js';
import { loadAnimation } from '../src/utils/animation-loader.js';
import { getDownloadManager } from '../src/utils/animation-download-manager.js';
import { getApiClient } from '../src/utils/api-client.js';
import { CONFIG } from '../src/config.js';
import { CAMERA_DEFAULTS, ANIMATION_DEFAULTS, RENDERER_DEFAULTS, LIGHTS } from '../src/utils/constants.js';
import { textToVisemeSequence } from '../src/utils/viseme-mapper.js';

// ──────────────────────────────────
// Word database with categories
// ──────────────────────────────────
const WORDS = [
    { word: 'hello', label: 'Сәлем', emoji: '👋', category: 'greetings' },
    { word: 'алақан', label: 'Алақан', emoji: '👐', category: 'body' },
    { word: 'alaqan', label: 'Алақан 2', emoji: '🤲', category: 'body' },
    { word: 'аурухана', label: 'Аурухана', emoji: '🏥', category: 'places' },
    { word: 'aga', label: 'Аға', emoji: '👨', category: 'family' },
    { word: 'ana', label: 'Ана', emoji: '👩', category: 'family' },
    { word: 'сүйек', label: 'Сүйек', emoji: '🦴', category: 'body' },
    { word: 'аялдама', label: 'Аялдама', emoji: '🚏', category: 'places' },
    { word: 'мектеп', label: 'Мектеп', emoji: '🏫', category: 'places' },
    { word: 'театр', label: 'Театр', emoji: '🎭', category: 'places' },
];

// ──────────────────────────────────
// Mobile Avatar App
// ──────────────────────────────────
class MobileAvatarApp {
    constructor() {
        // DOM refs
        this.container = document.getElementById('avatar-container');
        this.wordGrid = document.getElementById('word-grid');
        this.textInput = document.getElementById('text-input');
        this.sendBtn = document.getElementById('send-btn');
        this.statusDot = document.getElementById('status-dot');
        this.statusText = document.getElementById('status-text');
        this.speakingIndicator = document.getElementById('speaking-indicator');
        this.speakingWord = document.getElementById('speaking-word');
        this.toast = document.getElementById('toast');
        this.categoryTabs = document.getElementById('category-tabs');

        // Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.currentVrm = null;
        this.mixer = null;
        this.animationCache = new Map();
        this.currentAction = null;

        // Expression / Viseme state
        this.targetExpressionWeights = {};
        this.currentExpressionSequence = null;
        this.expressionTimer = 0;
        this.currentExpressionIndex = 0;
        this.currentActiveViseme = null;

        // Blinking
        this.blinkTimer = 0;
        this.nextBlinkTime = Math.random() * 3000 + 2000;
        this.isBlinking = false;
        this.blinkDuration = 0.15;

        // State
        this.isPlaying = false;
        this.activeCategory = 'all';
        this.downloadManager = getDownloadManager();
        this.apiClient = getApiClient();

        this.init();
    }

    async init() {
        this.initScene();
        this.renderWords();
        this.bindEvents();
        this.animate();
        await this.loadAvatar();
        await this.checkConnection();
    }

    // ──────── Three.js Scene ────────

    initScene() {
        this.scene = new THREE.Scene();

        const width = this.container.clientWidth || 360;
        const height = this.container.clientHeight || 400;

        this.camera = new THREE.PerspectiveCamera(
            CONFIG.camera.fov || CAMERA_DEFAULTS.FOV,
            width / height,
            CAMERA_DEFAULTS.NEAR,
            CAMERA_DEFAULTS.FAR
        );
        this.camera.position.set(
            CONFIG.camera.posX,
            CONFIG.camera.posY,
            CONFIG.camera.posZ
        );
        this.camera.lookAt(0, 1.0, 0);

        // Lighting
        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.lights.intensity || LIGHTS.DIRECTIONAL_INTENSITY);
        dirLight.position.set(0.5, 1.5, 2.0);
        this.scene.add(dirLight);

        const fillLight = new THREE.DirectionalLight(0x8B9AFF, 0.4);
        fillLight.position.set(-1, 0.5, 1);
        this.scene.add(fillLight);

        this.scene.add(new THREE.AmbientLight(0xffffff, LIGHTS.AMBIENT_INTENSITY));

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            alpha: RENDERER_DEFAULTS.ALPHA,
            antialias: RENDERER_DEFAULTS.ANTIALIAS,
            powerPreference: 'high-performance',
            precision: 'highp',
        });
        // Keep output in sRGB to avoid device-specific dark/black shading on mobile Chrome.
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(
            Math.min(window.devicePixelRatio || 1, 1.5, RENDERER_DEFAULTS.MAX_PIXEL_RATIO)
        );
        this.renderer.domElement.style.display = 'block';
        this.renderer.domElement.style.touchAction = 'none';
        this.container.appendChild(this.renderer.domElement);

        this.renderer.domElement.addEventListener('webglcontextlost', (event) => {
            event.preventDefault();
            console.warn('[MobileDemo] WebGL context lost');
            this.showToast('Графика временно недоступна', 'error');
        });

        this.renderer.domElement.addEventListener('webglcontextrestored', () => {
            console.info('[MobileDemo] WebGL context restored');
            this.showToast('Графика восстановлена', 'success');
        });

        window.addEventListener('resize', () => this.onResize());
        setTimeout(() => this.onResize(), 50);
    }

    async loadAvatar() {
        try {
            const entry = CONFIG.avatars[CONFIG.defaultAvatar];
            let modelPath = entry;
            let modelConfig = CONFIG;

            if (typeof entry === 'object') {
                modelPath = entry.path;
                if (entry.rotation !== undefined) {
                    modelConfig = {
                        ...CONFIG,
                        avatar: {
                            ...CONFIG.avatar,
                            rotation: entry.rotation,
                        },
                    };
                }
            }

            this.currentVrm = await loadVRMModel(modelPath, modelConfig);
            this.currentVrm.scene.traverse((obj) => {
                if (!obj.isMesh || !obj.material) return;
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                materials.forEach((material) => {
                    material.needsUpdate = true;
                });
            });
            this.scene.add(this.currentVrm.scene);
            this.mixer = new THREE.AnimationMixer(this.currentVrm.scene);
            this.setNeutralPose();
            this.showToast('Аватар загружен', 'success');
        } catch (error) {
            console.error('Failed to load avatar:', error);
            this.showToast('Ошибка загрузки аватара', 'error');
        }
    }

    setNeutralPose() {
        if (!this.currentVrm) return;

        const getBone = (name) => {
            if (this.currentVrm.humanoid) {
                const h = this.currentVrm.humanoid;
                if (h.getRawBoneNode) return h.getRawBoneNode(name);
                if (h.getNormalizedBoneNode) return h.getNormalizedBoneNode(name);
                if (h.getBoneNode) return h.getBoneNode(name);
            }
            return null;
        };

        const setRot = (boneName, x, y, z) => {
            const bone = getBone(boneName);
            if (bone) bone.rotation.set(x, y, z);
        };

        const armAngle = 1.35;
        setRot('leftUpperArm', 0, 0, -armAngle);
        setRot('rightUpperArm', 0, 0, armAngle);
        setRot('leftLowerArm', 0.2, -0.5, 0);
        setRot('rightLowerArm', 0.2, 0.5, 0);
        setRot('leftHand', 0.1, -0.2, 0);
        setRot('rightHand', 0.1, 0.2, 0);
    }

    onResize() {
        if (!this.container || !this.renderer) return;
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        if (w > 0 && h > 0) {
            this.renderer.setSize(w, h);
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const dt = this.clock.getDelta();
        if (this.mixer) this.mixer.update(dt);

        this.updateBlinking(dt);
        this.updateExpressions(dt);
        this.processExpressionSmoothing(dt);

        if (this.currentVrm) this.currentVrm.update(dt);
        this.renderer.render(this.scene, this.camera);
    }

    // ──────── Expression / Lip-Sync System ────────

    /** Set target expression value (smoothed) */
    setExpression(name, value) {
        if (!this.currentVrm?.expressionManager) return;
        if (name === 'happy') name = 'fun';
        this.targetExpressionWeights[name] = value;
    }

    /** Smooth interpolation of expression weights */
    processExpressionSmoothing(dt) {
        if (!this.currentVrm?.expressionManager) return;
        const lerpSpeed = 20.0;

        for (const [name, target] of Object.entries(this.targetExpressionWeights)) {
            const current = this.currentVrm.expressionManager.getValue(name);
            let next = current + (target - current) * lerpSpeed * dt;
            if (Math.abs(target - next) < 0.01) next = target;
            this.currentVrm.expressionManager.setValue(name, next);
        }
    }

    /** Auto-blink — try 'blink', 'blinkLeft', 'blinkRight' */
    updateBlinking(dt) {
        if (!this.currentVrm?.expressionManager) return;
        this.blinkTimer += dt * 1000;

        if (this.isBlinking) {
            if (this.blinkTimer >= this.blinkDuration * 1000) {
                this.setExpression('blink', 0);
                this.setExpression('blinkLeft', 0);
                this.setExpression('blinkRight', 0);
                this.isBlinking = false;
                this.blinkTimer = 0;
                this.nextBlinkTime = Math.random() * 3000 + 2000;
            }
        } else {
            if (this.blinkTimer >= this.nextBlinkTime) {
                this.isBlinking = true;
                this.blinkTimer = 0;
                this.setExpression('blink', 1.0);
                this.setExpression('blinkLeft', 1.0);
                this.setExpression('blinkRight', 1.0);
            }
        }
    }

    /** Start playing a viseme/expression sequence */
    playExpressionSequence(sequence) {
        this.currentExpressionSequence = sequence;
        this.expressionTimer = 0;
        this.currentExpressionIndex = 0;
        this.currentActiveViseme = null;

        // Reset all mouth shapes
        ['aa', 'ih', 'ou', 'ee', 'oh', 'neutral'].forEach(n => this.setExpression(n, 0));
        this.setExpression('neutral', 1.0);
    }

    /** Tick expression sequence forward */
    updateExpressions(dt) {
        if (!this.currentExpressionSequence) return;
        this.expressionTimer += dt * 1000;

        while (
            this.currentExpressionIndex < this.currentExpressionSequence.length &&
            this.currentExpressionSequence[this.currentExpressionIndex].time <= this.expressionTimer
        ) {
            const event = this.currentExpressionSequence[this.currentExpressionIndex];
            // Deactivate previous viseme
            if (this.currentActiveViseme) {
                if (this.currentActiveViseme.name === 'ou_oh_combo') {
                    this.setExpression('ou', 0);
                    this.setExpression('oh', 0);
                } else if (this.currentActiveViseme.name === 'aa_ee_combo') {
                    this.setExpression('aa', 0);
                    this.setExpression('ee', 0);
                } else {
                    this.setExpression(this.currentActiveViseme.name, 0);
                }
            }
            
            // Hard reset all vowel visemes to 0 directly to prevent bleeding
            if (this.currentVrm?.expressionManager) {
                let skipReset = [event.preset];
                if (event.preset === 'ou_oh_combo') skipReset = ['ou', 'oh'];
                if (event.preset === 'aa_ee_combo') skipReset = ['aa', 'ee'];
                ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(v => {
                    if (!skipReset.includes(v)) {
                        this.currentVrm.expressionManager.setValue(v, 0);
                        this.setExpression(v, 0);
                    }
                });
            }

            // Activate new viseme
            if (event.preset === 'ou_oh_combo') {
                const val = event.value ?? 0.8;
                this.setExpression('ou', val * 0.5);
                this.setExpression('oh', val * 0.5);
                this.currentActiveViseme = {
                    name: 'ou_oh_combo',
                    endTime: event.time + event.duration,
                };
            } else if (event.preset === 'aa_ee_combo') {
                const val = event.value ?? 0.8;
                this.setExpression('aa', val * 0.3);
                this.setExpression('ee', val * 0.6);
                this.currentActiveViseme = {
                    name: 'aa_ee_combo',
                    endTime: event.time + event.duration,
                };
            } else if (event.preset !== 'neutral') {
                this.setExpression(event.preset, event.value ?? 0.8);
                this.currentActiveViseme = {
                    name: event.preset,
                    endTime: event.time + event.duration,
                };
            } else {
                this.currentActiveViseme = null;
            }
            this.currentExpressionIndex++;
        }

        // Auto-expire active viseme
        if (this.currentActiveViseme && this.expressionTimer > this.currentActiveViseme.endTime) {
            if (this.currentActiveViseme.name === 'ou_oh_combo') {
                this.setExpression('ou', 0);
                this.setExpression('oh', 0);
            } else if (this.currentActiveViseme.name === 'aa_ee_combo') {
                this.setExpression('aa', 0);
                this.setExpression('ee', 0);
            } else {
                this.setExpression(this.currentActiveViseme.name, 0);
            }
            this.currentActiveViseme = null;
        }

        // Sequence complete
        const last = this.currentExpressionSequence[this.currentExpressionSequence.length - 1];
        const totalDur = last ? last.time + (last.duration || 0) + 100 : 0;
        if (this.expressionTimer > totalDur) {
            this.currentExpressionSequence = null;
            this.currentActiveViseme = null;
            ['aa', 'ih', 'ou', 'ee', 'oh'].forEach(n => this.setExpression(n, 0));
            this.setExpression('neutral', 1.0);
        }
    }

    // ──────── Animation Playback ────────

    async playAnimationFromUrl(url) {
        const clip = await loadAnimation(url, this.currentVrm, this.animationCache);
        if (!clip) return;

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        action.enabled = true;
        action.setEffectiveWeight(1.0);

        if (this.currentAction) {
            action.crossFadeFrom(this.currentAction, 0.4, true);
        }

        action.play();
        this.currentAction = action;

        return new Promise((resolve) => {
            const onFinished = (e) => {
                if (e.action === action) {
                    this.mixer.removeEventListener('finished', onFinished);
                    resolve();
                }
            };
            this.mixer.addEventListener('finished', onFinished);
        });
    }

    /**
     * Play a word — tries API first, falls back to local config
     */
    async playWord(word) {
        if (this.isPlaying) return;
        this.isPlaying = true;

        // UI feedback
        this.setSpeaking(true, word);
        this.highlightChip(word, true);

        try {
            // Try API translation first
            const { response, urls } = await this.downloadManager.translateAndPreload(word);

            if (response.sequence && response.sequence.length > 0) {
                let played = false;

                for (const item of response.sequence) {
                    if (item.found && item.file_url) {
                        const localUrl = urls.get(item.file_url);
                        if (localUrl) {
                            const wordLabel = item.gloss_name || item.word;
                            this.setSpeaking(true, wordLabel);

                            // Start lip-sync for this word
                            const visemes = textToVisemeSequence(wordLabel, CONFIG.speechSpeed || 150);
                            this.playExpressionSequence(visemes);

                            await this.playAnimationFromUrl(localUrl);
                            played = true;

                            // Pause between sequential animations
                            if (response.sequence.indexOf(item) < response.sequence.length - 1) {
                                await new Promise(r => setTimeout(r, ANIMATION_DEFAULTS.PAUSE_BETWEEN_ANIMATIONS));
                            }
                        } else {
                            // Download on-the-fly fallback
                            try {
                                const downloadedUrl = await this.downloadManager.getAnimationUrl(item.file_url);
                                await this.playAnimationFromUrl(downloadedUrl);
                                played = true;
                            } catch (err) {
                                console.warn(`Download failed for "${item.word}"`, err);
                            }
                        }
                    }
                }

                if (played) {
                    this.isPlaying = false;
                    this.setSpeaking(false);
                    this.highlightChip(word, false);
                    return;
                }
            }
        } catch (err) {
            console.warn('[Mobile] API fallback:', err.message);
        }

        // Fallback: local config animations
        const localKey = Object.keys(CONFIG.animations).find(
            k => k.toLowerCase() === word.toLowerCase()
        );

        if (localKey && CONFIG.animations[localKey]) {
            try {
                // Start lip-sync for local animation too
                const wordEntry = WORDS.find(w => w.word === localKey);
                const lipLabel = wordEntry ? wordEntry.label : localKey;
                const visemes = textToVisemeSequence(lipLabel, CONFIG.speechSpeed || 150);
                this.playExpressionSequence(visemes);

                await this.playAnimationFromUrl(CONFIG.animations[localKey]);
            } catch (e) {
                this.showToast('Анимация не найдена', 'error');
            }
        } else {
            this.showToast(`"${word}" — анимация не найдена`, 'info');
        }

        this.isPlaying = false;
        this.setSpeaking(false);
        this.highlightChip(word, false);
    }

    // ──────── UI Rendering ────────

    renderWords(category = 'all') {
        this.wordGrid.innerHTML = '';
        const filtered = category === 'all'
            ? WORDS
            : WORDS.filter(w => w.category === category);

        filtered.forEach(w => {
            const chip = document.createElement('button');
            chip.className = 'word-chip';
            chip.dataset.word = w.word;
            chip.innerHTML = `<span class="emoji">${w.emoji}</span><span class="label">${w.label}</span>`;
            chip.addEventListener('click', () => this.playWord(w.word));
            this.wordGrid.appendChild(chip);
        });
    }

    highlightChip(word, active) {
        const chips = this.wordGrid.querySelectorAll('.word-chip');
        chips.forEach(chip => {
            if (chip.dataset.word === word) {
                chip.classList.toggle('playing', active);
            }
        });
    }

    setSpeaking(active, word = '') {
        if (active) {
            this.speakingIndicator.classList.add('active');
            this.speakingWord.textContent = word;
        } else {
            this.speakingIndicator.classList.remove('active');
        }
    }

    showToast(message, type = 'info') {
        this.toast.textContent = message;
        this.toast.className = `toast ${type} show`;
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(() => {
            this.toast.classList.remove('show');
        }, 2500);
    }

    // ──────── Events ────────

    bindEvents() {
        // Category tabs
        this.categoryTabs.addEventListener('click', (e) => {
            const tab = e.target.closest('.category-tab');
            if (!tab) return;

            this.categoryTabs.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            this.activeCategory = tab.dataset.category;
            this.renderWords(this.activeCategory);
        });

        // Send button
        this.sendBtn.addEventListener('click', () => this.submitText());

        // Enter key
        this.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.submitText();
            }
        });
    }

    submitText() {
        const text = this.textInput.value.trim();
        if (!text) return;
        this.textInput.value = '';
        this.textInput.blur();
        this.playWord(text.toLowerCase());
    }

    // ──────── Connection Check ────────

    async checkConnection() {
        try {
            const healthy = await this.apiClient.checkHealth();
            if (healthy) {
                this.statusDot.classList.add('connected');
                this.statusText.textContent = 'Онлайн';
            } else {
                this.statusText.textContent = 'Локальный';
            }
        } catch {
            this.statusText.textContent = 'Оффлайн';
        }
    }
}

// ──────── Initialize ────────
const app = new MobileAvatarApp();
window.mobileApp = app;
