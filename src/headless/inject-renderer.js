/**
 * Headless video renderer — injected into the mirrored avatar page.
 *
 * This file is deliberately dependency-free: no imports, no build step. The
 * render server injects it verbatim with `page.addScriptTag({ path })` into the
 * avatar's own `embed.html` (served from our local mirror), where it drives the
 * already-constructed `window.avatarWidget`.
 *
 * Division of labour:
 *   - the avatar owns *playback* — glosses, glued second clips, per-gloss speed,
 *     lip-sync and the finger-spelling fallback all live in its
 *     `playTranslateResponse()`. We call it instead of reimplementing it, so a
 *     video always looks like what the live widget produces.
 *   - we own *recording* — deterministic virtual time, frame capture, encoding.
 *
 * Contract with the server:
 *   window.headlessRendererReady === true   → script evaluated
 *   window.startHeadlessRender(config)      → resolves to a webm data URL
 *   window.reportProgress(percent, message) → optional, exposed by puppeteer
 */
(function () {
    'use strict';

    /**
     * Must match CONFIG.defaultAvatar in the avatar project. The widget loads
     * that avatar on its own during construction, so when the request asks for
     * the same one we simply wait instead of loading it twice.
     */
    const DEFAULT_AVATAR = 'Aibek';

    const FRAMERATE = 30;
    const TICK_MS = 1000 / FRAMERATE;

    /**
     * Recording pauses while the avatar waits on the network. Bounded so a
     * background request that never settles cannot stall a render: per pause and
     * across the whole render.
     */
    const MAX_NETWORK_HOLD_MS = 5000;
    const MAX_TOTAL_NETWORK_HOLD_MS = 60000;

    /**
     * Сколько ждать первого кадра от виджета, прежде чем начать запись.
     *
     * Виджет рисует по rAF, то есть раз в ~16 мс; секунда — это шестьдесят его
     * тиков. Не уложился — значит его цикл не идёт вовсе, и ждать дальше
     * бессмысленно.
     */
    const FIRST_FRAME_WAIT_MS = 1000;

    // Captured before any hijacking so our own waiting is never virtualised.
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeDateNow = Date.now.bind(Date);

    function realSleep(ms) {
        return new Promise((resolve) => nativeSetTimeout(resolve, ms));
    }

    async function waitFor(predicate, timeoutMs, label) {
        const deadline = nativeDateNow() + timeoutMs;
        while (!predicate()) {
            if (nativeDateNow() > deadline) {
                throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
            }
            await realSleep(50);
        }
    }

    function reportProgress(percent, message) {
        if (typeof window.reportProgress === 'function') {
            try {
                window.reportProgress(percent, message);
            } catch (_) {
                /* progress reporting must never break a render */
            }
        }
    }

    // ── Avatar readiness ──────────────────────────────────────────────

    /**
     * `window.avatarWidget` is assigned in the widget's constructor, before its
     * async init finishes — so its presence alone means nothing. Wait for the
     * renderer, then for a VRM.
     */
    async function getWidget() {
        await waitFor(
            () => window.avatarWidget && window.avatarWidget.renderer,
            30000,
            'window.avatarWidget to be constructed',
        );
        return window.avatarWidget;
    }

    async function ensureAvatar(widget, requestedAvatar) {
        // The widget kicks off its own load of CONFIG.defaultAvatar during
        // construction. Let that settle first so our load can never race it.
        await waitFor(() => widget.currentVrm, 90000, 'the default avatar to load');

        const wanted = requestedAvatar || DEFAULT_AVATAR;
        if (wanted !== DEFAULT_AVATAR) {
            // loadModelByName() resolves without throwing for an unknown name,
            // leaving currentVrm untouched — so verify rather than trust it.
            const previousVrm = widget.currentVrm;
            await widget.loadModelByName(wanted);

            if (!widget.currentVrm) {
                throw new Error(`Avatar "${wanted}" failed to load`);
            }
            if (widget.currentVrm === previousVrm) {
                console.warn(`[Headless] Avatar "${wanted}" is unknown to the widget; kept the default.`);
            }
        }

        return widget.currentVrm;
    }

    // ── Preloading ────────────────────────────────────────────────────

    /**
     * Force every downloaded clip through the widget's own parser *before*
     * recording starts.
     *
     * `playTranslateResponse()` pre-parses too, but it does so after recording
     * has begun — and parsing is CPU work that the network pause below cannot
     * cover, so those frames would show the avatar holding its last pose. Warming
     * first turns that pre-parse into cache hits.
     *
     * The parser (`loadAnimation`) is internal to the avatar bundle and cannot be
     * imported from here, so we trigger it the only way a caller can: start a
     * playback and wait for the widget's own `animationCache` to grow. We never
     * await the playback itself — only the parse — and the visual side effect is
     * irrelevant because it happens before the first captured frame.
     */
    async function warmAnimationCache(widget, preloadedUrls) {
        const blobUrls = [...(preloadedUrls || new Map()).values()].filter(Boolean);
        if (blobUrls.length === 0 || !widget.currentVrm) return;

        reportProgress(30, 'Загружаем 3D-данные из подсознания (S3)...');

        for (const blobUrl of blobUrls) {
            const sizeBefore = widget.animationCache.size;
            try {
                widget.playAnimationFromUrl(blobUrl).catch(() => {});
                await waitFor(
                    () => widget.animationCache.size > sizeBefore,
                    20000,
                    'animation clip to be parsed',
                );
            } catch (error) {
                console.warn('[Headless] Failed to warm an animation clip:', error.message);
            }
        }

        // Put the avatar back to a clean idle pose and let the fade finish in
        // real time, so recording starts from rest rather than mid-gesture.
        try {
            widget.returnToRestPose();
        } catch (_) {
            /* older builds may not expose it — not fatal */
        }
        await realSleep(700);

        console.log(`[Headless] Animation cache warmed: ${widget.animationCache.size} clips`);
    }

    /**
     * The server normally hands us the translate response it already fetched, so
     * the avatar gateway is called once per video. Only when it is missing do we
     * ask the widget to translate on its own.
     */
    async function resolveSequence(widget, config, text) {
        if (config.translateResponse) {
            const response = config.translateResponse;
            const sequence = Array.isArray(response.sequence) ? response.sequence : [];
            const urls = sequence.length > 0
                ? await widget.downloadManager.preloadSequence(sequence)
                : new Map();
            return { response, urls };
        }

        console.warn('[Headless] No translate response from the server — translating in the page.');
        const result = await widget.downloadManager.translateAndPreload(text);
        return { response: result.response, urls: result.urls };
    }

    // ── Encoding ──────────────────────────────────────────────────────

    function resolveEncoderMaxQueueSize(renderProfile) {
        const fallback = renderProfile && renderProfile.hasGPU ? 256 : 30;
        const configured = Number.parseInt(renderProfile && renderProfile.encoderMaxQueueSize, 10);

        if (!Number.isFinite(configured)) return fallback;
        return Math.max(1, Math.min(configured, 256));
    }

    async function waitForEncoderBackpressure(videoEncoder, maxQueueSize) {
        while (videoEncoder.encodeQueueSize > maxQueueSize) {
            await realSleep(8);
        }
    }

    function applyBackground(widget, background) {
        if (background === 'green') {
            document.body.style.backgroundColor = '#00ff00';
            widget.renderer.setClearColor(0x00ff00, 1);
        } else if (background === 'transparent') {
            document.body.style.backgroundColor = 'transparent';
            widget.renderer.setClearColor(0x000000, 0);
        } else if (background) {
            document.body.style.backgroundColor = background;
            widget.renderer.setClearColor(background, 1);
        }
    }

    async function renderToVideo(config) {
        const { glosses, avatar, background, renderPlan, renderProfile } = config;

        console.log(`[Headless] Starting render for avatar: ${avatar}, glosses: ${glosses}`);

        const widget = await getWidget();

        // 1. Avatar
        await ensureAvatar(widget, avatar);

        // 2. Background
        applyBackground(widget, background);

        const text = Array.isArray(glosses) ? glosses.join(' ') : glosses;
        reportProgress(20, 'Распознаем контекст и ищем шаблоны движений...');

        // 3. Download and parse everything we can before recording begins
        let response = null;
        let preloadedUrls = new Map();
        try {
            const resolved = await resolveSequence(widget, config, text);
            response = resolved.response;
            preloadedUrls = resolved.urls || new Map();
            await warmAnimationCache(widget, preloadedUrls);
        } catch (e) {
            console.error('[Headless] Preload error, will fallback:', e);
        }

        if (!window.WebMMuxer) {
            throw new Error('WebMMuxer not found — the muxer script was not injected');
        }

        const encWidth = window.innerWidth;
        const encHeight = window.innerHeight;

        const muxer = new window.WebMMuxer.Muxer({
            target: new window.WebMMuxer.ArrayBufferTarget(),
            video: {
                codec: 'V_VP8',
                width: encWidth,
                height: encHeight,
                frameRate: FRAMERATE,
            },
        });

        let videoEncoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => console.error('[Headless] VideoEncoder Error:', e),
        });

        videoEncoder.configure({
            codec: 'vp8',
            width: encWidth,
            height: encHeight,
            bitrate: 5_000_000,
            framerate: FRAMERATE,
        });

        // 4. Hijack the environment for deterministic time
        const originalSetTimeout = window.setTimeout;
        const originalClearTimeout = window.clearTimeout;
        const originalRAF = window.requestAnimationFrame;
        const originalDateNow = Date.now;
        const originalPerfNow = performance.now;
        const originalFetch = window.fetch;
        const originalClockDelta = widget.clock ? widget.clock.getDelta : null;

        let virtualTime = 0;
        const pendingTimeouts = [];
        let rafIdx = 0;
        let isEncoding = true;
        let frameCount = 0;
        let pendingNetwork = 0;
        let totalHeldMs = 0;
        const maxEncoderQueueSize = resolveEncoderMaxQueueSize(renderProfile);
        console.log(`[Headless] Encoder backpressure queue limit: ${maxEncoderQueueSize}`);

        try {
            window.setTimeout = (cb, delay) => {
                const id = ++rafIdx;
                pendingTimeouts.push({ id, cb, fireAt: virtualTime + (delay || 0) });
                return id;
            };
            window.clearTimeout = (id) => {
                const idx = pendingTimeouts.findIndex((t) => t.id === id);
                if (idx >= 0) pendingTimeouts.splice(idx, 1);
            };

            performance.now = () => virtualTime;
            Date.now = () => virtualTime;
            if (widget.clock) {
                widget.clock.getDelta = () => TICK_MS / 1000;
            }

            let rafCb = null;
            window.requestAnimationFrame = (cb) => {
                rafCb = cb;
                return ++rafIdx;
            };

            // Count in-flight requests so the loop below can hold still while the
            // avatar is waiting on one — the widget resolves finger-spelling
            // letters mid-sequence, and those round trips would otherwise be
            // recorded as the avatar holding a pose.
            window.fetch = (...args) => {
                pendingNetwork++;
                let settled;
                try {
                    settled = originalFetch.apply(window, args);
                } catch (err) {
                    pendingNetwork--;
                    throw err;
                }
                return settled.finally(() => { pendingNetwork--; });
            };

            // Первые кадры писались ЧЁРНЫМИ, и вот почему.
            //
            // Свой кадр виджет рисует из собственного rAF-колбэка. Он
            // зарегистрировал его ДО перехвата, поэтому наш `rafCb` пуст, пока
            // виджет не дойдёт до следующего тика и не перерегистрируется уже
            // через нашу подмену. Все витки цикла до этого момента ничего не
            // рисуют — а снимают.
            //
            // Снять в такой момент нечего: холст виджета создан без
            // `preserveDrawingBuffer` (см. widget/index.js; в студийном
            // рендерере он включён явно как раз потому, что та снимает кадры),
            // и буфер, прочитанный вне только что отрисованного кадра, отдаёт
            // чёрное. Отсюда чёрная заставка в начале каждого видео.
            //
            // Ждём реального тика виджета, чтобы цикл стартовал с живым
            // колбэком. Ждём ОГРАНИЧЕННО: не дождались — идём как раньше,
            // чёрный кадр лучше зависшего рендера.
            let waitedForFirstFrame = 0;
            while (rafCb === null && waitedForFirstFrame < FIRST_FRAME_WAIT_MS) {
                await realSleep(16);
                waitedForFirstFrame += 16;
            }
            if (rafCb === null) {
                console.warn(
                    `[Headless] Widget did not re-register rAF in ${FIRST_FRAME_WAIT_MS} ms —` +
                    ' the first frames may come out black',
                );
            } else {
                console.log(`[Headless] First frame ready after ${waitedForFirstFrame} ms`);
            }

            // Background deterministic loop
            const encodingPromise = (async () => {
                while (isEncoding || pendingTimeouts.length > 0) {
                    // Freeze virtual time (and therefore the video) while a
                    // request is outstanding. Bounded, so a stuck background
                    // request degrades to the old behaviour instead of hanging.
                    let heldMs = 0;
                    while (
                        pendingNetwork > 0 &&
                        heldMs < MAX_NETWORK_HOLD_MS &&
                        totalHeldMs < MAX_TOTAL_NETWORK_HOLD_MS
                    ) {
                        await realSleep(16);
                        heldMs += 16;
                        totalHeldMs += 16;
                    }

                    if (isEncoding) {
                        await waitForEncoderBackpressure(videoEncoder, maxEncoderQueueSize);
                    }

                    virtualTime += TICK_MS;

                    const ripe = [];
                    for (let i = pendingTimeouts.length - 1; i >= 0; i--) {
                        if (virtualTime >= pendingTimeouts[i].fireAt) {
                            ripe.push(pendingTimeouts.splice(i, 1)[0]);
                        }
                    }
                    ripe.sort((a, b) => a.fireAt - b.fireAt);
                    ripe.forEach((t) => t.cb());

                    if (rafCb) {
                        const cb = rafCb;
                        rafCb = null;
                        cb(virtualTime);
                    }

                    if (isEncoding) {
                        const bitmap = await createImageBitmap(widget.renderer.domElement);
                        const frame = new VideoFrame(bitmap, { timestamp: (frameCount * 1_000_000) / FRAMERATE });
                        videoEncoder.encode(frame, { keyFrame: frameCount % 30 === 0 });
                        frame.close();
                        bitmap.close();
                        frameCount++;

                        if (frameCount % 60 === 0) {
                            // Scale progress 50→75 logarithmically so it never truly stalls
                            const renderPct = 50 + 25 * (1 - 1 / (1 + frameCount / 300));
                            reportProgress(Math.round(renderPct), `Синтезируем движения: кадр ${frameCount} ⚡`);
                        }
                    }

                    await realSleep(0);
                }
            })();

            console.log('[Headless] Deterministic recording started');
            reportProgress(50, 'Оживляем аватар в турбо-режиме (30 FPS)...');

            // 5. Hand playback to the avatar. It owns glosses, glued clips,
            //    per-gloss speed, lip-sync and finger-spelling; we only record.
            //
            //    speeds[i] scales gesture i (and, with it, its lip timing and the
            //    pause after it). tokens[i].word is the original word behind the
            //    gloss, so the hands sign "БАРУ" while the lips say "барады".
            //    Both are positional; the avatar ignores tokens if the count does
            //    not match the sequence, which the server checks and reports.
            const languageId = (renderPlan && renderPlan.languageId) || config.languageId || undefined;
            //
            //    pauses[i] — тишина записи ПОСЛЕ жеста i, в секундах. Заменяет
            //    обычный зазор и НЕ делится на rate: это длительность речи, а
            //    не анимации. Без неё всё после первой паузы уезжает вперёд
            //    относительно оригинала, ради синхронизации с которым и
            //    зовут этот рендер.
            const speeds = Array.isArray(config.speeds) ? config.speeds : [];
            const tokens = Array.isArray(config.tokens) ? config.tokens : [];
            const pauses = Array.isArray(config.pauses) ? config.pauses : [];
            if (response) {
                await widget.playTranslateResponse(response, preloadedUrls, languageId, speeds, tokens, { pauses });
            } else {
                console.warn('[Headless] Nothing to play from the API — speaking the raw text.');
                await widget.processTextSelection(text);
            }

            // 6. Stop recording
            reportProgress(80, 'Финальные вычисления нейросети...');

            // Хвост записи после последнего жеста: руки опускаются за
            // REST_POSE_FADE_DURATION (0.5 с), остальное — запас. Раньше здесь
            // стояли зашитые 2000 мс, и на нарезке лекции кусками каждый кусок
            // забирал их целиком независимо от того, сколько тишины в записи
            // после него на самом деле. Значение по умолчанию прежнее, так что
            // клиенты без tail_seconds получают тот же файл.
            const tailMs = Number.isFinite(Number(config.tailSeconds))
                ? Math.max(0, Number(config.tailSeconds) * 1000)
                : 2000;
            pendingTimeouts.push({
                id: ++rafIdx,
                fireAt: virtualTime + tailMs,
                cb: () => { isEncoding = false; },
            });

            await encodingPromise;

            await videoEncoder.flush();
            videoEncoder.close();
            muxer.finalize();
        } finally {
            // Stop the encoding loop in case of error
            isEncoding = false;
            pendingTimeouts.length = 0;
            // Always restore native APIs
            window.setTimeout = originalSetTimeout;
            window.clearTimeout = originalClearTimeout;
            window.requestAnimationFrame = originalRAF;
            window.fetch = originalFetch;
            Date.now = originalDateNow;
            performance.now = originalPerfNow;
            if (widget.clock && originalClockDelta) widget.clock.getDelta = originalClockDelta;
            try { if (videoEncoder.state !== 'closed') videoEncoder.close(); } catch (e) { /* already closed */ }
            try { muxer.finalize(); } catch (e) { /* already finalized */ }
        }

        if (totalHeldMs > 0) {
            console.log(`[Headless] Paused ${totalHeldMs}ms of recording while waiting on the network`);
        }

        const buffer = muxer.target.buffer;
        const blob = new Blob([buffer], { type: 'video/webm' });

        const recordingFinished = new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });

        console.log(`[Headless] Deterministic recording finished. Total frames: ${frameCount}`);
        reportProgress(90, 'Упаковываем нейро-магию в контейнер...');

        if (frameCount === 0) {
            throw new Error('Render produced no frames');
        }

        return await recordingFinished;
    }

    window.startHeadlessRender = async (config) => {
        try {
            return await renderToVideo(config);
        } catch (error) {
            console.error('[Headless] Render function error:', error);
            throw error;
        }
    };

    window.headlessRendererReady = true;
    console.log('[Headless] Renderer injected and ready');
})();
