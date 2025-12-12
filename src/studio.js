import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { CONFIG } from './config.js';

class StudioRecorder {
    constructor() {
        this.container = document.getElementById('studio-avatar-container');
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = new THREE.Clock();
        this.currentVrm = null;
        this.mixer = null;

        // Loaders
        this.loader = new GLTFLoader();
        this.loader.register((parser) => new VRMLoaderPlugin(parser));
        this.animLoader = new GLTFLoader();
        this.animLoader.register((parser) => new VRMAnimationLoaderPlugin(parser));

        this.animationCache = new Map();
        this.glosses = [];
        this.recordedChunks = [];
        this.mediaRecorder = null;
        this.isRecording = false;
        this.backgroundType = 'green';
        this.customBackgroundTexture = null;
        this.currentAvatar = CONFIG.defaultAvatar;
        this.videoFormat = 'webm';
        this.quality = '720';
        this.aspectRatio = '16:9';

        this.init();
        this.setupUI();
    }

    init() {
        this.scene = new THREE.Scene();

        const width = 1280;
        const height = 720;
        const aspect = width / height;

        this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov || 35.0, aspect, 0.1, 20.0);
        this.camera.position.set(0, CONFIG.camera.posY, CONFIG.camera.posZ);
        this.camera.lookAt(0.0, 1.2, 0.0);

        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.lights.intensity);
        dirLight.position.set(0.0, 1.0, 2.0);
        this.scene.add(dirLight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 1.5, 2));
        this.container.appendChild(this.renderer.domElement);

        this.setBackground('green');
        this.loadModel(CONFIG.avatars[CONFIG.defaultAvatar]);
        this.animate();
    }

    setBackground(type) {
        this.backgroundType = type;

        switch (type) {
            case 'green':
                this.scene.background = new THREE.Color(0x00ff00);
                break;
            case 'white':
                this.scene.background = new THREE.Color(0xffffff);
                break;
            case 'transparent':
                this.scene.background = null;
                break;
            case 'custom':
                if (this.customBackgroundTexture) {
                    this.scene.background = this.customBackgroundTexture;
                } else {
                    this.scene.background = new THREE.Color(0xcccccc);
                }
                break;
        }
    }

    setCustomBackground(imageFile) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const loader = new THREE.TextureLoader();
            loader.load(e.target.result, (texture) => {
                this.customBackgroundTexture = texture;
                if (this.backgroundType === 'custom') {
                    this.scene.background = texture;
                }
                console.log('✅ Кастомный фон загружен');
            });
        };
        reader.readAsDataURL(imageFile);
    }

    getResolutionDimensions() {
        let baseHeight;

        // Получаем базовую высоту из качества
        switch (this.quality) {
            case '480':
                baseHeight = 480;
                break;
            case '720':
                baseHeight = 720;
                break;
            case '1080':
                baseHeight = 1080;
                break;
            default:
                baseHeight = 720;
        }

        // Вычисляем ширину на основе соотношения сторон
        let width, height = baseHeight;

        switch (this.aspectRatio || '16:9') {
            case '16:9':
                width = Math.round(baseHeight * 16 / 9);
                break;
            case '4:3':
                width = Math.round(baseHeight * 4 / 3);
                break;
            case '1:1':
                width = baseHeight;
                break;
            default:
                width = Math.round(baseHeight * 16 / 9);
        }

        return { width, height };
    }

    updateResolution(width, height) {
        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        console.log(`📐 Разрешение: ${width}×${height}`);
    }

    loadModel(path) {
        console.log(`🔄 Загрузка модели: ${path}`);

        // Полная очистка старой модели
        if (this.currentVrm) {
            console.log('🗑️ Удаление старой модели');

            // Останавливаем миксер
            if (this.mixer) {
                this.mixer.stopAllAction();
                this.mixer = null;
            }

            // Удаляем модель из сцены
            this.scene.remove(this.currentVrm.scene);

            // Глубокая очистка ресурсов
            VRMUtils.deepDispose(this.currentVrm.scene);

            this.currentVrm = null;
        }

        // Очищаем кэш анимаций при смене аватара
        this.animationCache.clear();

        this.loader.load(
            path,
            (gltf) => {
                const vrm = gltf.userData.vrm;
                VRMUtils.removeUnnecessaryVertices(gltf.scene);
                VRMUtils.removeUnnecessaryJoints(gltf.scene);

                this.currentVrm = vrm;
                this.scene.add(vrm.scene);

                vrm.scene.position.set(
                    CONFIG.avatar.position.x,
                    CONFIG.avatar.position.y,
                    CONFIG.avatar.position.z
                );
                vrm.scene.scale.setScalar(CONFIG.avatar.scale);

                // Поворачиваем модель на 180 градусов чтобы смотрела на камеру
                vrm.scene.rotation.y = Math.PI;

                this.mixer = new THREE.AnimationMixer(vrm.scene);
                console.log('✅ VRM модель загружена и настроена');
            },
            (progress) => {
                const percent = Math.round((progress.loaded / progress.total) * 100);
                console.log(`⏳ Загрузка: ${percent}%`);
            },
            (error) => console.error('❌ Ошибка загрузки:', error)
        );
    }

    async loadAnimation(animName) {
        const url = CONFIG.animations[animName];
        if (!url) {
            console.error(`Анимация "${animName}" не найдена`);
            return null;
        }

        if (this.animationCache.has(url)) {
            return this.animationCache.get(url);
        }

        if (!this.currentVrm) {
            console.error("VRM модель не загружена");
            return null;
        }

        try {
            const gltf = await this.animLoader.loadAsync(url);

            let vrmAnimation = null;
            if (gltf.userData.vrmAnimations && gltf.userData.vrmAnimations.length > 0) {
                vrmAnimation = gltf.userData.vrmAnimations[0];
            } else if (gltf.userData.vrmAnimation) {
                vrmAnimation = gltf.userData.vrmAnimation;
            }

            if (vrmAnimation) {
                const clip = createVRMAnimationClip(vrmAnimation, this.currentVrm);
                this.animationCache.set(url, clip);
                return clip;
            } else if (gltf.animations && gltf.animations.length > 0) {
                const clip = gltf.animations[0];
                this.animationCache.set(url, clip);
                return clip;
            }

            console.error("Анимация не найдена:", url);
            return null;
        } catch (e) {
            console.error("Ошибка загрузки анимации:", e);
            return null;
        }
    }

    async playAnimation(name) {
        const clip = await this.loadAnimation(name);
        if (!clip) return null;

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
        action.play();

        return new Promise((resolve) => {
            const handler = (e) => {
                if (e.action === action) {
                    this.mixer.removeEventListener('finished', handler);
                    resolve(clip.duration);
                }
            };
            this.mixer.addEventListener('finished', handler);
        });
    }

    async startRecording() {
        if (this.isRecording) return;
        if (this.glosses.length === 0) {
            alert('Введите глоссы!');
            return;
        }

        // Получаем размеры из качества
        const { width, height } = this.getResolutionDimensions();
        this.updateResolution(width, height);

        this.recordedChunks = [];
        const canvas = this.renderer.domElement;

        if (this.videoFormat === 'webm') {
            await this.recordWebM();
        } else if (this.videoFormat === 'gif') {
            await this.recordGIF();
        } else if (this.videoFormat === 'mp4') {
            alert('MP4 экспорт в разработке. Используйте WebM.');
        }
    }

    async recordWebM() {
        const canvas = this.renderer.domElement;
        const stream = canvas.captureStream(60);

        let mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
        }

        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 8000000
        });

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        let totalDuration = 0;

        this.mediaRecorder.start();
        this.isRecording = true;
        document.getElementById('progress-bar').style.display = 'block';

        // Воспроизводим последовательно все анимации
        for (let i = 0; i < this.glosses.length; i++) {
            const gloss = this.glosses[i];
            console.log(`🎬 Воспроизведение: ${gloss} (${i + 1}/${this.glosses.length})`);

            const duration = await this.playAnimation(gloss);
            if (duration) {
                totalDuration += duration;
                const progress = ((i + 1) / this.glosses.length) * 100;
                this.updateProgress(progress);

                // Небольшая пауза между анимациями
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        // Останавливаем запись
        setTimeout(() => {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            this.isRecording = false;
            document.getElementById('download-btn').style.display = 'block';
            this.updateProgress(100);
            console.log('✅ Запись завершена');
        }, 500);
    }

    async recordGIF() {
        alert('GIF экспорт в разработке. Используйте WebM.');
    }

    download() {
        console.log('🔽 Download вызван');
        console.log('📦 Chunks:', this.recordedChunks.length);

        if (this.recordedChunks.length === 0) {
            alert('Нет данных для скачивания');
            return;
        }

        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        console.log('💾 Blob создан:', blob.size, 'bytes');

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Формируем читаемое имя файла
        const date = new Date();
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
        const glossesStr = this.glosses.join('_');
        const extension = this.videoFormat === 'gif' ? 'gif' : 'webm';

        a.download = `${glossesStr}_${this.quality}p_${this.aspectRatio.replace(':', 'x')}_${dateStr}_${timeStr}.${extension}`;

        console.log('📁 Имя файла:', a.download);

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
        console.log(`⬇️ Файл скачан: ${a.download}`);
    }

    updateProgress(percent) {
        const fill = document.getElementById('progress-fill');
        const text = document.getElementById('progress-text');

        fill.style.width = `${percent}%`;
        text.textContent = `${Math.round(percent)}%`;
    }

    setupUI() {
        // Кнопки фонов - квадратики
        const bgButtons = document.querySelectorAll('.bg-btn');
        bgButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                // Убираем active со всех
                bgButtons.forEach(b => b.classList.remove('active'));
                // Добавляем active на текущую
                btn.classList.add('active');

                const bgType = btn.dataset.bg;
                this.setBackground(bgType);

                // Показываем file input для custom
                if (bgType === 'custom') {
                    document.getElementById('bg-file').click();
                }
            });
        });

        // Кастомный фон
        const bgFile = document.getElementById('bg-file');
        bgFile.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) this.setCustomBackground(file);
        });

        // Глоссы с превью
        const glossesInput = document.getElementById('glosses-input');
        const glossesPreview = document.getElementById('glosses-preview');

        glossesInput.addEventListener('input', (e) => {
            const text = e.target.value.trim().toUpperCase();
            // Теперь ищем анимации по точному совпадению (верхний регистр)
            this.glosses = text.split(/\s+/).filter(g => g && CONFIG.animations[g]);

            if (this.glosses.length > 0) {
                glossesPreview.textContent = `✅ Готов к записи: ${this.glosses.join(' → ')} (${this.glosses.length} анимаций)`;
                glossesPreview.style.color = '#10b981';
            } else {
                const availableAnims = Object.keys(CONFIG.animations).join(', ');
                glossesPreview.textContent = `Введите глоссы (доступные: ${availableAnims})`;
                glossesPreview.style.color = '#9ca3af';
            }
        });

        // Выбор аватара
        const avatarSelect = document.getElementById('avatar-select');
        avatarSelect.value = this.currentAvatar;
        avatarSelect.addEventListener('change', (e) => {
            const avatarName = e.target.value;
            this.currentAvatar = avatarName;
            this.loadModel(CONFIG.avatars[avatarName]);
            console.log(`🔄 Загружен аватар: ${avatarName}`);
        });

        // Формат видео
        const videoFormatSelect = document.getElementById('video-format');
        videoFormatSelect.addEventListener('change', (e) => {
            this.videoFormat = e.target.value;
        });

        // Качество
        const qualitySelect = document.getElementById('quality-select');
        qualitySelect.addEventListener('change', (e) => {
            this.quality = e.target.value;
            const { width, height } = this.getResolutionDimensions();
            this.updateResolution(width, height);
            console.log(`📐 Качество: ${this.quality}p`);
        });

        // Соотношение сторон
        const aspectSelect = document.getElementById('aspect-select');
        aspectSelect.addEventListener('change', (e) => {
            this.aspectRatio = e.target.value;
            const { width, height } = this.getResolutionDimensions();
            this.updateResolution(width, height);
            console.log(`📺 Соотношение: ${this.aspectRatio}`);
        });

        // Кнопка записи
        const recordBtn = document.getElementById('record-btn');
        recordBtn.addEventListener('click', async () => {
            recordBtn.disabled = true;
            document.getElementById('download-btn').style.display = 'none';
            document.getElementById('video-controls').style.display = 'none';

            await this.startRecording();

            recordBtn.disabled = false;
        });

        // Кнопка скачивания
        const downloadBtn = document.getElementById('download-btn');
        downloadBtn.addEventListener('click', () => {
            this.download();
        });

        // Video controls - Play button
        const playBtn = document.getElementById('play-btn');
        let isPlaying = false;

        playBtn.addEventListener('click', async () => {
            if (!this.glosses || this.glosses.length === 0) {
                alert('Введите глоссы!');
                return;
            }

            if (isPlaying) return;

            isPlaying = true;
            playBtn.textContent = '⏸';

            // Воспроизводим все глоссы последовательно
            for (const gloss of this.glosses) {
                if (!isPlaying) break;
                await this.playAnimation(gloss);
            }

            isPlaying = false;
            playBtn.textContent = '▶';
        });

        // Показываем play button если есть глоссы
        glossesInput.addEventListener('input', () => {
            const videoControls = document.getElementById('video-controls');
            if (this.glosses.length > 0) {
                videoControls.style.display = 'block';
            } else {
                videoControls.style.display = 'none';
            }
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const deltaTime = this.clock.getDelta();
        if (this.mixer) this.mixer.update(deltaTime);
        if (this.currentVrm) this.currentVrm.update(deltaTime);
        this.renderer.render(this.scene, this.camera);
    }
}

new StudioRecorder();
