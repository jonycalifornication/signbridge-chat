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
        this.quality = '720';
        this.aspectRatio = '16:9';
        this.playbackSpeed = 1.0;
        this.isLooping = false;
        this.recordedMimeType = null; // Track actual recording format

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

    setBackground(type, colorValue = null) {
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
            case 'color':
                // Используем выбранный цвет
                if (colorValue) {
                    this.scene.background = new THREE.Color(colorValue);
                } else {
                    this.scene.background = new THREE.Color(0x1a1a2e);
                }
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

    getSupportedVideoMimeType() {
        // Safari supports MP4, Chrome/Firefox support WebM
        const types = [
            'video/mp4',
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];

        for (const type of types) {
            if (MediaRecorder.isTypeSupported(type)) {
                console.log(`✅ Поддерживаемый формат: ${type}`);
                return type;
            }
        }

        console.warn('⚠️ Не найдено поддерживаемых форматов, используем video/webm');
        return 'video/webm';
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

        // Всегда используем recordVideo() - он автоматически выберет WebM или MP4
        await this.recordVideo();
    }

    async recordVideo() {
        const canvas = this.renderer.domElement;
        const stream = canvas.captureStream(60);

        // Auto-detect best supported format (MP4 for Safari, WebM for others)
        const mimeType = this.getSupportedVideoMimeType();
        this.recordedMimeType = mimeType;

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



    download() {
        console.log('🔽 Download вызван');
        console.log('📦 Chunks:', this.recordedChunks.length);

        if (this.recordedChunks.length === 0) {
            alert('Нет данных для скачивания');
            return;
        }

        // Используем реальный MIME type из записи
        const mimeType = this.recordedMimeType || 'video/webm';
        const blob = new Blob(this.recordedChunks, { type: mimeType });

        // Определяем расширение по MIME type
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm';

        console.log('💾 Blob создан:', blob.size, 'bytes', blob.type);

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;

        // Формируем читаемое имя файла
        const date = new Date();
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const timeStr = `${String(date.getHours()).padStart(2, '0')}-${String(date.getMinutes()).padStart(2, '0')}`;
        const glossesStr = this.glosses.join('_');

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

        // Color picker
        const colorPicker = document.getElementById('color-picker');
        colorPicker.addEventListener('input', (e) => {
            const color = e.target.value;
            this.setBackground('color', color);

            // Активируем кнопку color picker
            bgButtons.forEach(b => b.classList.remove('active'));
            document.querySelector('[data-bg="color"]').classList.add('active');
        });

        // Глоссы с превью
        const glossesInput = document.getElementById('glosses-input');
        const glossesPreview = document.getElementById('glosses-preview');

        glossesInput.addEventListener('input', (e) => {
            const text = e.target.value.trim().toLowerCase();
            // Ищем анимации по точному совпадению (нижний регистр)
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

        // Video controls - Play/Pause с timeline
        const playBtn = document.getElementById('play-btn');
        const pauseBtn = document.getElementById('pause-btn');

        let isPlaying = false;
        let isPaused = false;
        let timerInterval = null;

        // Play button
        playBtn.addEventListener('click', async () => {
            if (!this.glosses || this.glosses.length === 0) {
                alert('Введите глоссы!');
                return;
            }

            if (isPlaying) return;

            isPlaying = true;
            isPaused = false;

            // Вычисляем общую длительность
            let totalDuration = 0;
            for (const gloss of this.glosses) {
                const clip = await this.loadAnimation(gloss);
                if (clip) totalDuration += clip.duration;
            }
            totalDuration += this.glosses.length * 0.3; // Паузы между анимациями

            // Используем реальную длительность из timeline markers
            totalDuration = this.totalAnimationDuration || totalDuration;

            playBtn.style.display = 'none';
            pauseBtn.style.display = 'flex';

            // Запускаем обновление timeline
            let currentAnimIndex = 0;

            timerInterval = setInterval(() => {
                // Вычисляем прошедшее время через mixer
                let elapsed = 0;
                if (this.mixer && this.animationTimestamps) {
                    const mixerTime = this.mixer.time;

                    // Считаем elapsed по всем анимациям до текущей позиции
                    for (let i = 0; i < this.animationTimestamps.length; i++) {
                        if (i < currentAnimIndex) {
                            elapsed += this.animationTimestamps[i].duration + 0.3;
                        } else if (i === currentAnimIndex) {
                            elapsed += Math.min(mixerTime, this.animationTimestamps[i].duration);
                            break;
                        }
                    }
                }

                // Обновляем только timeline
                const percent = Math.min((elapsed / totalDuration) * 100, 100);
                document.getElementById('timeline-progress').style.width = `${percent}%`;
                document.getElementById('timeline-handle').style.left = `${percent}%`;
            }, 100);

            // Воспроизводим с поддержкой loop
            do {
                // Воспроизводим все глоссы последовательно
                for (let i = 0; i < this.glosses.length; i++) {
                    if (!isPlaying || isPaused) break;

                    currentAnimIndex = i; // Обновляем для таймера!
                    const gloss = this.glosses[i];
                    await this.playAnimation(gloss);

                    // Применяем скорость
                    if (this.mixer) {
                        this.mixer.timeScale = this.playbackSpeed;
                    }

                    // Пауза между анимациями
                    if (i < this.glosses.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 300));
                    }
                }

                // При loop mixer сам продолжит с начала
            } while (this.isLooping && isPlaying);

            // Завершение
            isPlaying = false;
            playBtn.style.display = 'flex';
            pauseBtn.style.display = 'none';
            clearInterval(timerInterval);
        });

        // Pause button
        pauseBtn.addEventListener('click', () => {
            if (!isPlaying) return;

            isPaused = !isPaused;

            if (isPaused) {
                // Пауза
                if (this.mixer) {
                    this.mixer.timeScale = 0;
                }
                pauseBtn.textContent = '▶';
                pauseBtn.title = 'Продолжить';
            } else {
                // Продолжить
                if (this.mixer) {
                    this.mixer.timeScale = 1;
                }
                pauseBtn.textContent = '⏸';
                pauseBtn.title = 'Пауза';
            }
        });

        // Показываем play button если есть глоссы
        glossesInput.addEventListener('input', () => {
            const videoControls = document.getElementById('video-controls');
            if (this.glosses.length > 0) {
                videoControls.style.display = 'flex';
                this.setupTimelineMarkers();
            } else {
                videoControls.style.display = 'none';
            }
        });

        // Speed select
        const speedSelect = document.getElementById('speed-select');
        speedSelect.addEventListener('change', (e) => {
            this.playbackSpeed = parseFloat(e.target.value);
            if (this.mixer) {
                this.mixer.timeScale = this.playbackSpeed;
            }
            console.log(`⚡ Скорость: ${this.playbackSpeed}x`);
        });

        // Loop button
        const loopBtn = document.getElementById('loop-btn');
        loopBtn.addEventListener('click', () => {
            this.isLooping = !this.isLooping;
            loopBtn.classList.toggle('active');
            console.log(`🔁 Loop: ${this.isLooping ? 'ON' : 'OFF'}`);
        });

        // Timeline interaction
        this.setupTimelineInteraction();
    }

    async setupTimelineMarkers() {
        const markersContainer = document.getElementById('timeline-markers');
        markersContainer.innerHTML = '';

        // Загружаем все анимации и вычисляем реальную длительность
        this.animationTimestamps = [];
        let cumulativeDuration = 0;

        for (const gloss of this.glosses) {
            const clip = await this.loadAnimation(gloss);
            const duration = clip ? clip.duration : 1.0;

            this.animationTimestamps.push({
                gloss: gloss,
                startTime: cumulativeDuration,
                duration: duration,
                endTime: cumulativeDuration + duration
            });

            cumulativeDuration += duration + 0.3; // +0.3 сек пауза между анимациями
        }

        this.totalAnimationDuration = cumulativeDuration;

        // Создаем маркеры на timeline
        this.animationTimestamps.forEach((anim, index) => {
            const marker = document.createElement('div');
            marker.className = 'timeline-marker';
            marker.dataset.gloss = anim.gloss;
            marker.dataset.index = index;

            // Позиция маркера по реальному времени
            const position = (anim.startTime / this.totalAnimationDuration) * 100;
            marker.style.left = `${position}%`;

            // Клик по маркеру для перемотки
            marker.addEventListener('click', (e) => {
                e.stopPropagation();
                this.seekToAnimation(index);
            });

            markersContainer.appendChild(marker);
        });
    }

    async seekToAnimation(index) {
        console.log(`⏩ Перемотка к анимации: ${this.glosses[index]} (${index})`);

        if (!this.animationTimestamps || index >= this.animationTimestamps.length) {
            return;
        }

        const targetAnim = this.animationTimestamps[index];

        // Обновляем визуально timeline
        const percent = (targetAnim.startTime / this.totalAnimationDuration) * 100;
        document.getElementById('timeline-progress').style.width = `${percent}%`;
        document.getElementById('timeline-handle').style.left = `${percent}%`;

        // Останавливаем текущую анимацию
        if (this.mixer) {
            this.mixer.stopAllAction();
        }

        // Воспроизводим с выбранной позиции
        await this.playAnimationSequence(index);
    }

    async playAnimationSequence(startIndex = 0) {
        // Воспроизводим последовательность начиная с startIndex
        for (let i = startIndex; i < this.glosses.length; i++) {
            const gloss = this.glosses[i];
            await this.playAnimation(gloss);

            // Применяем скорость
            if (this.mixer) {
                this.mixer.timeScale = this.playbackSpeed;
            }

            // Пауза между анимациями
            if (i < this.glosses.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }
    }

    setupTimelineInteraction() {
        const timeline = document.getElementById('timeline');
        const timelineProgress = document.getElementById('timeline-progress');
        const timelineHandle = document.getElementById('timeline-handle');
        let isDragging = false;

        const updateTimelineVisuals = (percent) => {
            timelineProgress.style.width = `${percent}%`;
            timelineHandle.style.left = `${percent}%`;
        };

        // Click на timeline для перемотки
        timeline.addEventListener('click', (e) => {
            const rect = timeline.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const percent = (clickX / rect.width) * 100;
            const targetTime = (percent / 100) * this.totalAnimationDuration;

            // Находим ближайшую анимацию
            if (this.animationTimestamps) {
                for (let i = 0; i < this.animationTimestamps.length; i++) {
                    const anim = this.animationTimestamps[i];
                    if (targetTime >= anim.startTime && targetTime <= anim.endTime) {
                        this.seekToAnimation(i);
                        return;
                    }
                }

                // Если кликнули после последней - перематываем к последней
                this.seekToAnimation(this.animationTimestamps.length - 1);
            }

            updateTimelineVisuals(Math.max(0, Math.min(100, percent)));
        });

        // Drag handle
        timelineHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const rect = timeline.getBoundingClientRect();
            const percent = ((e.clientX - rect.left) / rect.width) * 100;
            updateTimelineVisuals(Math.max(0, Math.min(100, percent)));
        });

        document.addEventListener('mouseup', (e) => {
            if (isDragging) {
                // При отпускании - seek к этой позиции
                const rect = timeline.getBoundingClientRect();
                const percent = ((e.clientX - rect.left) / rect.width) * 100;
                const targetTime = (percent / 100) * this.totalAnimationDuration;

                if (this.animationTimestamps) {
                    for (let i = 0; i < this.animationTimestamps.length; i++) {
                        const anim = this.animationTimestamps[i];
                        if (targetTime >= anim.startTime && targetTime <= anim.endTime) {
                            this.seekToAnimation(i);
                            break;
                        }
                    }
                }
            }
            isDragging = false;
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
