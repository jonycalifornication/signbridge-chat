import { AvatarWidget } from '../widget/index.js';
import { CONFIG } from '../config.js';

class HeadlessRenderer extends AvatarWidget {
    constructor(containerId) {
        super(containerId);
        window.rendererLoaded = true;
        console.log('[Headless] Renderer initialized and ready');
    }

    // Override to avoid UI elements if any
    setupUI() {
        console.log('[Headless] Skipping standard UI setup');
    }
    
    setupTextSelection() {
        console.log('[Headless] Skipping text selection setup');
    }
    
    setupWidgetToggle() {
        console.log('[Headless] Skipping widget toggle setup');
    }

    async renderToVideo(config) {
        const { glosses, avatar, background } = config;
        
        console.log(`[Headless] Starting render for avatar: ${avatar}, glosses: ${glosses}`);
        
        // 1. Setup avatar
        if (avatar && CONFIG.avatars[avatar]) {
            await this.loadModelByName(avatar);
        } else {
            await this.loadModelByName(CONFIG.defaultAvatar);
        }

        // 2. Set background color
        if (background === 'green') {
            document.body.style.backgroundColor = '#00ff00';
            this.renderer.setClearColor(0x00ff00, 1);
        } else if (background === 'transparent') {
            document.body.style.backgroundColor = 'transparent';
            this.renderer.setClearColor(0x000000, 0);
        } else if (background) {
            document.body.style.backgroundColor = background;
            this.renderer.setClearColor(background, 1);
        }

        const text = Array.isArray(glosses) ? glosses.join(' ') : glosses;
        console.log(`[Headless] Preloading all animations for text: "${text}"`);
        if (window.reportProgress) window.reportProgress(20, 'Распознаем контекст и ищем шаблоны движений...');
        
        let apiResponse = null;
        let apiUrls = null;

        // 3. Pre-fetch and Pre-parse EVERYTHING before recording begins (NO PAUSES IN VIDEO)
        try {
            const result = await this.downloadManager.translateAndPreload(text);
            apiResponse = result.response;
            apiUrls = result.urls;

            // Force parse into Three.js objects right now
            const { loadAnimation } = await import('../utils/animation-loader.js');
            if (apiUrls && apiUrls.size > 0 && this.currentVrm) {
                if (window.reportProgress) window.reportProgress(30, 'Загружаем 3D-данные из подсознания (S3)...');
                const parsePromises = [...apiUrls.values()].map(blobUrl =>
                    loadAnimation(blobUrl, this.currentVrm, this.animationCache).catch(() => null)
                );
                await Promise.all(parsePromises);
                console.log('[Headless] All animations fully downloaded and parsed into memory!');
            }
        } catch (e) {
            console.error('[Headless] Preload error, will fallback:', e);
        }

        if (!window.WebMMuxer) {
            throw new Error('WebMMuxer not found via CDN!');
        }

        const framerate = 30;
        const tickRate = 1000 / framerate;
        
        const encWidth = window.innerWidth;
        const encHeight = window.innerHeight;
        
        const muxer = new window.WebMMuxer.Muxer({
            target: new window.WebMMuxer.ArrayBufferTarget(),
            video: {
                codec: 'V_VP8',
                width: encWidth,
                height: encHeight,
                frameRate: framerate
            }
        });

        let videoEncoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: e => console.error('[Headless] VideoEncoder Error:', e)
        });

        videoEncoder.configure({
            codec: 'vp8',
            width: encWidth,
            height: encHeight,
            bitrate: 5_000_000,
            framerate: framerate
        });

        // 4. Hijack Environment for Deterministic Time
        const originalSetTimeout = window.setTimeout;
        const originalClearTimeout = window.clearTimeout;
        const originalRAF = window.requestAnimationFrame;
        const originalDateNow = Date.now;
        const originalPerfNow = performance.now;
        const originalClockDelta = this.clock ? this.clock.getDelta : null;

        let virtualTime = 0;
        const pendingTimeouts = [];
        let rafIdx = 0;
        let isEncoding = true;
        let frameCount = 0;

        try {
        window.setTimeout = (cb, delay) => {
            const id = ++rafIdx;
            pendingTimeouts.push({ id, cb, fireAt: virtualTime + (delay || 0) });
            return id;
        };
        window.clearTimeout = (id) => {
            const idx = pendingTimeouts.findIndex(t => t.id === id);
            if (idx >= 0) pendingTimeouts.splice(idx, 1);
        };
        
        performance.now = () => virtualTime;
        Date.now = () => virtualTime;
        if (this.clock) {
            this.clock.getDelta = () => tickRate / 1000;
        }

        let rafCb = null;
        window.requestAnimationFrame = (cb) => {
            rafCb = cb;
            return ++rafIdx;
        };

        // Background deterministic loop
        const encodingPromise = (async () => {
             while (isEncoding || pendingTimeouts.length > 0) {
                 virtualTime += tickRate;
                 
                 const ripe = [];
                 for (let i = pendingTimeouts.length - 1; i >= 0; i--) {
                     if (virtualTime >= pendingTimeouts[i].fireAt) {
                         ripe.push(pendingTimeouts.splice(i, 1)[0]);
                     }
                 }
                 ripe.sort((a,b) => a.fireAt - b.fireAt);
                 ripe.forEach(t => t.cb());
                 
                 if (rafCb) {
                     const cb = rafCb;
                     rafCb = null;
                     cb(virtualTime);
                 }
                 
                 if (isEncoding) {
                     const bitmap = await createImageBitmap(this.renderer.domElement);
                     const frame = new VideoFrame(bitmap, { timestamp: frameCount * 1_000_000 / framerate });
                     videoEncoder.encode(frame, { keyFrame: frameCount % 30 === 0 });
                     frame.close();
                     bitmap.close();
                     frameCount++;
                     
                     if (frameCount % 60 === 0 && window.reportProgress) {
                         // Scale progress 50→75 logarithmically so it never truly stalls
                         const renderPct = 50 + 25 * (1 - 1 / (1 + frameCount / 300));
                         window.reportProgress(Math.round(renderPct), `Синтезируем движения: кадр ${frameCount} ⚡`);
                     }
                 }
                 
                 await new Promise(r => originalSetTimeout(r, 0));
             }
        })();

        console.log('[Headless] Deterministic recording started');
        if (window.reportProgress) window.reportProgress(50, 'Оживляем аватар в турбо-режиме (30 FPS)...');

        // 5. Play sequence smoothly (completely detached from wall-clock time)
        if (apiResponse && apiResponse.sequence && apiResponse.sequence.length > 0) {
            await this.playTranslateResponse(apiResponse, apiUrls);
        } else {
            console.warn('[Headless] No valid API sequence returned. Falling back to default playback.');
            await this.processTextSelection(text);
        }

        // 6. Stop recording
        if (window.reportProgress) window.reportProgress(80, 'Финальные вычисления нейросети...');
        
        // Small buffer inside virtual time so hands can smoothly lower
        let waitEnd = virtualTime + 2000; 
        pendingTimeouts.push({
            id: ++rafIdx,
            fireAt: waitEnd,
            cb: () => { isEncoding = false; }
        });
        
        await encodingPromise;
        
        await videoEncoder.flush();
        videoEncoder.close();
        muxer.finalize();
        } finally {
            // Stop encoding loop in case of error
            isEncoding = false;
            pendingTimeouts.length = 0;
            // Always restore native APIs
            window.setTimeout = originalSetTimeout;
            window.clearTimeout = originalClearTimeout;
            window.requestAnimationFrame = originalRAF;
            Date.now = originalDateNow;
            performance.now = originalPerfNow;
            if (this.clock) this.clock.getDelta = originalClockDelta;
            // Close encoder if still open
            try { if (videoEncoder.state !== 'closed') videoEncoder.close(); } catch(e) {}
            // Finalize muxer if not yet done
            try { muxer.finalize(); } catch(e) {}
        }

        const buffer = muxer.target.buffer;
        const blob = new Blob([buffer], { type: 'video/webm' });
        
        const recordingFinished = new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });

        console.log(`[Headless] Deterministic recording finished. Total frames: ${frameCount}`);
        if (window.reportProgress) window.reportProgress(90, 'Упаковываем нейро-магию в контейнер...');

        return await recordingFinished;
    }
}

// Initialize and expose
const renderer = new HeadlessRenderer('render-container');

window.startHeadlessRender = async (config) => {
    try {
        return await renderer.renderToVideo(config);
    } catch (error) {
        console.error('[Headless] Render function error:', error);
        throw error;
    }
};
