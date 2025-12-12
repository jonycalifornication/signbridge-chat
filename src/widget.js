import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { CONFIG } from './config.js';

class AvatarWidget {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.currentVrm = null;
        this.mixer = null;

        // Loader for VRM models
        this.loader = new GLTFLoader();
        this.loader.register((parser) => new VRMLoaderPlugin(parser));

        // Loader for VRMA animations
        this.animLoader = new GLTFLoader();
        this.animLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

        this.animationCache = new Map();
        this.idleAction = null;

        this.init();
        this.setupUI();
    }

    init() {
        this.scene = new THREE.Scene();
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(25.0, aspect, 0.1, 20.0);
        this.camera.position.set(CONFIG.camera.posX, CONFIG.camera.posY, CONFIG.camera.posZ);
        this.camera.lookAt(0.0, 1.3, 0.0);

        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.lights.intensity);
        dirLight.position.set(0.0, 1.0, 2.0);
        this.scene.add(dirLight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        window.addEventListener('resize', () => this.onResize());
        this.animate();
    }

    setupUI() {
        const select = document.getElementById('avatar-select');
        if (!select) return;

        for (const name in CONFIG.avatars) {
            const option = document.createElement('option');
            option.value = name;
            option.innerText = name;
            if (name === CONFIG.defaultAvatar) {
                option.selected = true;
            }
            select.appendChild(option);
        }

        this.loadModelByName(CONFIG.defaultAvatar);

        select.addEventListener('change', (e) => {
            this.loadModelByName(e.target.value);
        });
    }

    loadModelByName(name) {
        const modelPath = CONFIG.avatars[name];
        if (!modelPath) {
            console.error(`Аватар с именем "${name}" не найден в конфиге.`);
            return;
        }
        this.loadModel(modelPath);
    }

    loadModel(modelPath) {
        if (this.currentVrm) {
            this.scene.remove(this.currentVrm.scene);
            VRMUtils.deepDispose(this.currentVrm.scene);
            this.currentVrm = null;
            this.mixer = null;
        }

        this.loader.load(
            modelPath,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                VRMUtils.rotateVRM0(vrm);
                this.currentVrm = vrm;
                this.scene.add(vrm.scene);

                vrm.scene.position.set(CONFIG.avatar.position.x, CONFIG.avatar.position.y, CONFIG.avatar.position.z);
                vrm.scene.scale.set(CONFIG.avatar.scale, CONFIG.avatar.scale, CONFIG.avatar.scale);
                vrm.scene.rotation.y = Math.PI;

                this.mixer = new THREE.AnimationMixer(vrm.scene);

                console.log("VRM Loaded:", this.currentVrm);
                this.playIdleAnimation();
                console.log(`Аватар загружен из: ${modelPath}`);
            },
            undefined,
            (error) => console.error("Ошибка загрузки:", error)
        );
    }

    async loadAnimation(url) {
        if (this.animationCache.has(url)) {
            return this.animationCache.get(url);
        }
        if (!this.currentVrm) {
            console.error("VRM model not loaded yet.");
            return null;
        }

        console.log(`Loading animation from ${url}`);
        try {
            const gltf = await this.animLoader.loadAsync(url);
            const vrmAnimation = gltf.userData.vrmAnimation;

            if (!vrmAnimation) {
                console.error("No vrmAnimation found in file:", url);
                return null;
            }

            console.log("VRM Animation found, creating clip...");
            const clip = createVRMAnimationClip(vrmAnimation, this.currentVrm);
            console.log("Clip created:", clip);

            this.animationCache.set(url, clip);
            return clip;
        } catch (e) {
            console.error("Error loading animation:", e);
            return null;
        }
    }

    async playIdleAnimation() {
        const idleClip = await this.loadAnimation(CONFIG.animations.idle);
        if (idleClip) {
            this.idleAction = this.mixer.clipAction(idleClip);
            this.idleAction.play();
        }
    }

    async playAnimation(name) {
        const url = CONFIG.animations[name];
        if (!url) {
            console.error(`Анимация с именем "${name}" не найдена в конфиге.`);
            return;
        }
        const clip = await this.loadAnimation(url);
        if (clip) {
            const action = this.mixer.clipAction(clip);
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;
            action.crossFadeFrom(this.idleAction, 0.2, true);
            action.play();

            this.mixer.addEventListener('finished', (e) => {
                if (e.action === action) {
                    this.idleAction.reset().crossFadeFrom(action, 0.2, true).play();
                }
            });
        }
    }

    onResize() {
        if (!this.container) return;
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const deltaTime = this.clock.getDelta();
        if (this.mixer) this.mixer.update(deltaTime);
        if (this.currentVrm) this.currentVrm.update(deltaTime);
        this.renderer.render(this.scene, this.camera);
    }
}

new AvatarWidget('avatar-widget-container');
