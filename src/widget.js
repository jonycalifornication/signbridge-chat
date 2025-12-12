import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// 1. ИМПОРТИРУЕМ КОНФИГ
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

        this.init();
    }

    init() {
        // Сцена
        this.scene = new THREE.Scene();

        // Камера (берем настройки из CONFIG)
        const aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera = new THREE.PerspectiveCamera(25.0, aspect, 0.1, 20.0);
        this.camera.position.set(
            CONFIG.camera.posX,
            CONFIG.camera.posY,
            CONFIG.camera.posZ
        );
        this.camera.lookAt(0.0, 1.3, 0.0);

        // Свет
        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.lights.intensity);
        dirLight.position.set(0.0, 1.0, 2.0);
        this.scene.add(dirLight);

        const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambLight);

        // Рендерер
        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        // Загрузка
        this.loadModel();
        this.animate();

        window.addEventListener('resize', () => this.onResize());
    }

    loadModel() {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser));

        // 2. ИСПОЛЬЗУЕМ ПУТЬ ИЗ КОНФИГА
        loader.load(
            CONFIG.modelPath,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                VRMUtils.rotateVRM0(vrm);

                this.currentVrm = vrm;
                this.scene.add(vrm.scene);

                // 3. ИСПОЛЬЗУЕМ НАСТРОЙКИ ПОЗИЦИИ ИЗ КОНФИГА
                vrm.scene.position.set(
                    CONFIG.avatar.position.x,
                    CONFIG.avatar.position.y,
                    CONFIG.avatar.position.z
                );

                // Применяем масштаб, если нужно
                vrm.scene.scale.set(
                    CONFIG.avatar.scale,
                    CONFIG.avatar.scale,
                    CONFIG.avatar.scale
                );

                vrm.scene.rotation.y = Math.PI; // Лицом к нам

                this.mixer = new THREE.AnimationMixer(vrm.scene);
                console.log(`Аватар загружен из: ${CONFIG.modelPath}`);
            },
            undefined,
            (error) => console.error("Ошибка загрузки:", error)
        );
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

// Запуск (теперь передаем только ID контейнера, путь берется из config.js внутри)
new AvatarWidget('avatar-widget-container');
