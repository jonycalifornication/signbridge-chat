import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { createVRMAnimationClip, VRMAnimationLoaderPlugin } from '@pixiv/three-vrm-animation';
import { CONFIG } from './config.js';
// gif.js будет загружен через CDN

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
        this.currentAnimation = null;
        this.recordedChunks = [];
        this.mediaRecorder = null;
        this.isRecording = false;
        this.backgroundType = 'green';
        this.customBackgroundTexture = null;
        this.resolution = 720;

        this.init();
        this.setupUI();
    }

    init() {
        this.scene = new THREE.Scene();

        // Initial размеры (будут обновлены при выборе разрешения)
        const width = 1280;
        const height = 720;
        const aspect = width / height;

        this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov || 35.0, aspect, 0.1, 20.0);
        this.camera.position.set(CONFIG.camera.posX, CONFIG.camera.posY, CONFIG.camera.posZ);
        this.camera.lookAt(0.0, 1.0, 0.0);

        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.lights.intensity);
        dirLight.position.set(0.0, 1.0, 2.0);
        this.scene.add(dirLight);
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

        this.renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            preserveDrawingBuffer: true, // Важно для записи
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio * 1.5, 2));
        this.container.appendChild(this.renderer.domElement);

        // Устанавливаем начальный фон
        this.setBackground('green');

        // Загружаем модель
        this.loadModel(CONFIG.avatars[CONFIG.defaultAvatar]);

        this.animate();
    }

    setBackground(type) {
        this.backgroundType = type;

        switch (type) {
            case 'green':
                this.scene.background = new THREE.Color(0x00ff00); // Chroma key green
                break;
            case 'white':
                this.scene.background = new THREE.Color(0xffffff);
                break;
            case 'transparent':
                this.scene.background = null; // Прозрачный
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

    updateResolution(resolution) {
        this.resolution = resolution;
        let width, height;

        switch (parseInt(resolution)) {
            case 480:
                width = 854;
                height = 480;
                break;
            case 720:
                width = 1280;
                height = 720;
                break;
            case 1080:
                width = 1920;
                height = 1080;
                break;
        }

        this.renderer.setSize(width, height);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        console.log(`📐 Разрешение изменено: ${width}×${height}`);
    }

    loadModel(path) {
        if (this.currentVrm) {
            VRMUtils.deepDispose(this.currentVrm.scene);
            this.currentVrm = null;
            this.mixer = null;
        }

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

                this.mixer = new THREE.AnimationMixer(vrm.scene);
                console.log('✅ VRM модель загружена');
            },
            (progress) => console.log('Загрузка VRM:', Math.round((progress.loaded / progress.total) * 100) + '%'),
            (error) => console.error('Ошибка загрузки VRM:', error)
        );
    }

    async loadAnimation(url) {
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

            console.error("Анимация не найдена в файле:", url);
            return null;
        } catch (e) {
            console.error("Ошибка загрузки анимации:", e);
            return null;
        }
    }

    async playAnimation(name, loop = false) {
        const url = CONFIG.animations[name];
        if (!url) {
            console.error(`Анимация "${name}" не найдена`);
            return null;
        }

        const clip = await this.loadAnimation(url);
        if (!clip) return null;

        const action = this.mixer.clipAction(clip);
        action.reset();
        action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce);
        action.clampWhenFinished = true;
        action.play();

        console.log(`🎬 Воспроизведение: ${name}`);
        return { action, clip };
    }

    async startRecording(animationName) {
        if (this.isRecording) {
            console.warn('Запись уже идет');
            return;
        }

        this.recordedChunks = [];
        const canvas = this.renderer.domElement;

        // Создаем stream из canvas
        const stream = canvas.captureStream(60); // 60 FPS

        // Определяем MIME type
        let mimeType = 'video/webm;codecs=vp9';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
        }

        this.mediaRecorder = new MediaRecorder(stream, {
            mimeType: mimeType,
            videoBitsPerSecond: 8000000 // 8 Mbps для хорошего качества
        });

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            console.log(' ✅ Запись завершена');
            this.isRecording = false;
            this.showDownloadButtons();
        };

        // Запускаем анимацию и записываем
        const result = await this.playAnimation(animationName, false);
        if (!result) {
            console.error('Не удалось запустить анимацию');
            return;
        }

        const { clip } = result;
        const duration = clip.duration;

        this.mediaRecorder.start();
        this.isRecording = true;
        console.log(`⏺️ Запись началась (${duration.toFixed(2)} сек)`);

        // Показываем прогресс
        this.updateProgress(0);
        const startTime = Date.now();
        const progressInterval = setInterval(() => {
            const elapsed = (Date.now() - startTime) / 1000;
            const progress = Math.min((elapsed / duration) * 100, 100);
            this.updateProgress(progress);

            if (elapsed >= duration) {
                clearInterval(progressInterval);
            }
        }, 100);

        // Останавливаем запись автоматически после анимации
        setTimeout(() => {
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
                this.mediaRecorder.stop();
            }
            clearInterval(progressInterval);
            this.updateProgress(100);
        }, (duration + 0.5) * 1000); // +0.5 сек запас
    }

    downloadWebM() {
        if (this.recordedChunks.length === 0) {
            console.warn('Нет данных для скачивания');
            return;
        }

        const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `animation_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
        console.log('⬇️ WebM скачан');
    }

    async downloadGIF() {
        if (!this.currentAnimation) {
            alert('Сначала запишите анимацию!');
            return;
        }

        console.log('🎨 Создание GIF...');
        this.updateProgress(0, 'Создание GIF...');

        // Создаем GIF encoder
        const gif = new GIF({
            workers: 2,
            quality: 10,
            width: this.renderer.domElement.width,
            height: this.renderer.domElement.height,
            workerScript: '/node_modules/gif.js/dist/gif.worker.js'
        });

        // Воспроизводим анимацию снова и захватываем кадры
        const result = await this.playAnimation(this.currentAnimation, false);
        if (!result) return;

        const { clip } = result;
        const duration = clip.duration;
        const fps = 30; // GIF FPS
        const frameCount = Math.floor(duration * fps);
        const frameDelay = 1000 / fps;

        let frameIndex = 0;
        const captureInterval = setInterval(() => {
            if (frameIndex >= frameCount) {
                clearInterval(captureInterval);
                gif.render();
                return;
            }

            // Захватываем текущий кадр
            this.renderer.render(this.scene, this.camera);
            const imageData = this.renderer.domElement.toDataURL('image/png');

            const img = new Image();
            img.onload = () => {
                gif.addFrame(img, { delay: frameDelay, copy: true });
            };
            img.src = imageData;

            frameIndex++;
            this.updateProgress((frameIndex / frameCount) * 100, 'Создание GIF...');
        }, frameDelay);

        gif.on('finished', (blob) => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `animation_${Date.now()}.gif`;
            a.click();
            URL.revokeObjectURL(url);
            console.log('⬇️ GIF скачан');
            this.updateProgress(100);
        });
    }

    updateProgress(percent, label = 'Запись...') {
        const progressContainer = document.getElementById('progress-container');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        const progressLabel = progressContainer.querySelector('.progress-label');

        progressContainer.style.display = 'block';
        progressFill.style.width = `${percent}%`;
        progressText.textContent = `${Math.round(percent)}%`;
        progressLabel.textContent = label;

        if (percent >= 100) {
            setTimeout(() => {
                progressContainer.style.display = 'none';
            }, 1000);
        }
    }

    showDownloadButtons() {
        document.querySelector('.download-buttons').style.display = 'flex';
    }

    setupUI() {
        // Выбор анимации
        const animSelect = document.getElementById('animation-select');
        animSelect.addEventListener('change', (e) => {
            const anim = e.target.value;
            this.currentAnimation = anim;
            document.getElementById('record-btn').disabled = !anim;
            document.getElementById('play-preview-btn').disabled = !anim;
            document.getElementById('preview-status').textContent = anim ? `Выбрана: ${anim}` : 'Выберите анимацию';
        });

        // Выбор фона
        const bgRadios = document.querySelectorAll('input[name="background"]');
        bgRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                const type = e.target.value;
                this.setBackground(type);

                const customUpload = document.getElementById('custom-background-upload');
                customUpload.style.display = type === 'custom' ? 'block' : 'none';
            });
        });

        // Загрузка кастомного фона
        const bgFileInput = document.getElementById('background-file');
        bgFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.setCustomBackground(file);

                // Превью
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const preview = document.getElementById('background-preview');
                    preview.innerHTML = `<img src="${ev.target.result}" alt="Background preview">`;
                };
                reader.readAsDataURL(file);
            }
        });

        // Выбор разрешения
        const resSelect = document.getElementById('resolution-select');
        resSelect.addEventListener('change', (e) => {
            this.updateResolution(e.target.value);
        });

        // Кнопка записи
        const recordBtn = document.getElementById('record-btn');
        recordBtn.addEventListener('click', async () => {
            if (!this.currentAnimation) {
                alert('Выберите анимацию!');
                return;
            }

            recordBtn.disabled = true;
            document.querySelector('.download-buttons').style.display = 'none';

            await this.startRecording(this.currentAnimation);

            recordBtn.disabled = false;
        });

        // Предпросмотр
        const playBtn = document.getElementById('play-preview-btn');
        playBtn.addEventListener('click', () => {
            if (this.currentAnimation) {
                this.playAnimation(this.currentAnimation, false);
            }
        });

        // Скачивание WebM
        const downloadWebMBtn = document.getElementById('download-webm-btn');
        downloadWebMBtn.addEventListener('click', () => {
            this.downloadWebM();
        });

        // Скачивание GIF (заглушка пока)
        const downloadGIFBtn = document.getElementById('download-gif-btn');
        downloadGIFBtn.addEventListener('click', () => {
            this.downloadGIF();
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

// Инициализация при загрузке
new StudioRecorder();
