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
        this.currentAction = null;  // Текущая воспроизводимая анимация
        // Состояние виджета (свернут/развернут)
        this.isExpanded = false;

        this.init();
        this.setupUI();
        this.setupTextSelection();
        this.setupWidgetToggle();
    }

    init() {
        this.scene = new THREE.Scene();

        // Проверяем размеры контейнера, если 0 - используем минимальные
        const width = this.container.clientWidth || 150;
        const height = this.container.clientHeight || 180;
        const aspect = width / height;

        this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov || 35.0, aspect, 0.1, 20.0);
        this.camera.position.set(CONFIG.camera.posX, CONFIG.camera.posY, CONFIG.camera.posZ);
        this.camera.lookAt(0.0, 1.0, 0.0);  // Смотрим на уровень груди

        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.lights.intensity);
        dirLight.position.set(0.0, 1.0, 2.0);
        this.scene.add(dirLight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(width, height);
        // Увеличиваем pixelRatio для лучшего качества (но не более 2 для производительности)
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 1.5, 2));
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        window.addEventListener('resize', () => this.onResize());

        // Принудительный ресайз после инициализации для корректных размеров
        setTimeout(() => {
            this.onResize();
        }, 100);

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

    setupTextSelection() {
        // Обработчик выделения текста на странице
        document.addEventListener('mouseup', () => {
            this.handleTextSelection();
        });

        // Для поддержки мобильных устройств
        document.addEventListener('touchend', () => {
            setTimeout(() => this.handleTextSelection(), 100);
        });

        console.log('✅ Обработчик выделения текста подключен. Выделите "hello" или "idle" для воспроизведения анимации.');
    }

    handleTextSelection() {
        const selectedText = window.getSelection().toString().trim().toLowerCase();

        if (!selectedText) {
            return; // Ничего не выделено
        }

        console.log(`📝 Выделен текст: "${selectedText}"`);

        // Разворачиваем виджет при выделении текста
        if (!this.isExpanded) {
            this.expand();
        }

        // Проверяем, есть ли анимация с таким названием
        if (CONFIG.animations[selectedText]) {
            console.log(`🎬 Запуск анимации: ${selectedText}`);
            this.showNotification(`🎬 ${selectedText}`);
            this.playAnimation(selectedText);
        } else {
            // Проверяем, содержит ли выделенный текст название анимации
            for (const animName in CONFIG.animations) {
                if (selectedText.includes(animName)) {
                    console.log(`🎬 Найдено совпадение, запуск анимации: ${animName}`);
                    this.showNotification(`🎬 ${animName}`);
                    this.playAnimation(animName);
                    break;
                }
            }
        }
    }

    showNotification(message) {
        // Удаляем предыдущее уведомление, если оно есть
        const existing = document.querySelector('.animation-notification');
        if (existing) {
            existing.remove();
        }

        // Создаем новое уведомление
        const notification = document.createElement('div');
        notification.className = 'animation-notification';
        notification.textContent = message;
        document.body.appendChild(notification);

        // Автоматически удаляем через 2 секунды
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }

    setupWidgetToggle() {
        // Изначально виджет компактный
        this.container.classList.add('compact');

        // Клик на контейнер для разворачивания
        this.container.addEventListener('click', (e) => {
            if (!this.isExpanded) {
                this.expand();
            }
        });

        // Создаем кнопку закрытия
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

    expand() {
        if (this.isExpanded) return;

        this.isExpanded = true;
        this.container.classList.remove('compact');
        this.container.classList.add('expanded');
        console.log('🔼 Виджет развернут');
    }

    collapse() {
        if (!this.isExpanded) return;

        this.isExpanded = false;
        this.container.classList.remove('expanded');
        this.container.classList.add('compact');
        console.log('🔽 Виджет свернут');
    }

    toggleExpanded() {
        if (this.isExpanded) {
            this.collapse();
        } else {
            this.expand();
        }
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
            this.idleAction = null;
            this.currentAction = null;
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
            // Пытаемся загрузить через VRMAnimationLoaderPlugin
            const gltf = await this.animLoader.loadAsync(url);

            // Детальная отладка
            console.log("GLTF loaded:", gltf);
            console.log("GLTF userData:", gltf.userData);
            console.log("GLTF animations:", gltf.animations);

            // Сначала проверяем стандартные animations в GLTF
            if (gltf.animations && gltf.animations.length > 0) {
                console.log(`Found ${gltf.animations.length} standard GLTF animation(s)`);

                // Пытаемся создать VRM анимацию из стандартной GLTF анимации
                // если есть vrmAnimation в userData
                if (gltf.userData.vrmAnimations && gltf.userData.vrmAnimations.length > 0) {
                    console.log("Found vrmAnimations in userData");
                    const vrmAnimation = gltf.userData.vrmAnimations[0];
                    const clip = createVRMAnimationClip(vrmAnimation, this.currentVrm);
                    console.log("VRM Animation clip created:", clip);
                    this.animationCache.set(url, clip);
                    return clip;
                }

                // Проверяем единичный vrmAnimation
                if (gltf.userData.vrmAnimation) {
                    console.log("Found vrmAnimation in userData");
                    const clip = createVRMAnimationClip(gltf.userData.vrmAnimation, this.currentVrm);
                    console.log("VRM Animation clip created:", clip);
                    this.animationCache.set(url, clip);
                    return clip;
                }

                // Используем первую стандартную анимацию
                console.log("Using first standard GLTF animation");
                const clip = gltf.animations[0];
                this.animationCache.set(url, clip);
                console.log("Standard animation clip cached:", clip);
                return clip;
            }

            console.error("No animations found in file:", url);
            console.log("Available keys in userData:", Object.keys(gltf.userData));
            return null;
        } catch (e) {
            console.error("Error loading animation:", e);
            console.error("Error stack:", e.stack);
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
            // Останавливаем текущую анимацию, если она воспроизводится
            if (this.currentAction && this.currentAction.isRunning()) {
                console.log('⏸️ Останавливаем предыдущую анимацию');
                this.currentAction.fadeOut(0.2);
                this.currentAction.stop();
            }

            const action = this.mixer.clipAction(clip);
            action.reset();
            action.setLoop(THREE.LoopOnce);
            action.clampWhenFinished = true;

            // Плавный переход от idle
            if (this.idleAction && this.idleAction.isRunning()) {
                action.crossFadeFrom(this.idleAction, 0.3, true);
            }

            action.play();
            this.currentAction = action;
            console.log(`🎬 Запущена анимация: ${name}`);

            // Убираем старые обработчики и добавляем новый
            if (this.onAnimationFinished) {
                this.mixer.removeEventListener('finished', this.onAnimationFinished);
            }
            this.onAnimationFinished = (e) => {
                if (e.action === action) {
                    console.log('✅ Анимация завершена, возврат к idle');
                    this.currentAction = null;
                    if (this.idleAction) {
                        this.idleAction.reset().crossFadeFrom(action, 0.3, true).play();
                    }
                }
            };
            this.mixer.addEventListener('finished', this.onAnimationFinished);
        }
    }

    onResize() {
        if (!this.container || !this.renderer) return;

        // Используем fallback размеры если контейнер не имеет размеров
        const width = this.container.clientWidth || 150;
        const height = this.container.clientHeight || 180;

        if (width > 0 && height > 0) {
            this.renderer.setSize(width, height);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        }
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const deltaTime = this.clock.getDelta();
        if (this.mixer) this.mixer.update(deltaTime);
        if (this.currentVrm) this.currentVrm.update(deltaTime);
        this.renderer.render(this.scene, this.camera);
    }
}

// Инициализация для основного контейнера
if (document.getElementById('avatar-widget-container')) {
    new AvatarWidget('avatar-widget-container');
}

// Инициализация для standalone виджета
if (document.getElementById('standalone-widget')) {
    new AvatarWidget('standalone-widget');
}
