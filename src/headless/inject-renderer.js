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

    /**
     * Сколько секунд видео ОЖИДАЕТСЯ — чтобы проценты значили проценты.
     *
     * Раньше полоса ползла к 75% логарифмически от числа кадров: после
     * четырёх минут видео она садилась на 74% и стояла там до конца, сколько
     * бы ни осталось. Оператор видел «застряло» на нормальном рендере и
     * дважды перезапускал получасовую работу.
     *
     * Считаем по тому, что уже известно: клипы последовательности, их
     * множители скорости, паузы записи, лид и хвост. Точность тут нужна не
     * аптекарская — это шкала, а не план; промах в 10% полосу не портит.
     * Не вышло посчитать (нет последовательности) — возвращаем 0, и полоса
     * работает по-старому.
     */
    function expectedRecordingSeconds(response, config, leadMs, tailMs) {
        const sequence = Array.isArray(response?.sequence) ? response.sequence : [];
        if (sequence.length === 0) return 0;
        const speeds = Array.isArray(config.speeds) ? config.speeds : [];
        const pauses = Array.isArray(config.pauses) ? config.pauses : [];
        // Зазор между жестами у проигрывателя (PAUSE_BETWEEN_ANIMATIONS, мс) —
        // он ускоряется вместе с жестом, а вот пауза записи из pauses[] нет.
        const GAP_SECONDS = 0.15;
        let total = (leadMs + tailMs) / 1000;
        sequence.forEach((item, i) => {
            const rawRate = Number(speeds[i]);
            const rate = Number.isFinite(rawRate) && rawRate > 0 ? rawRate : 1;
            const clip = (Number(item?.duration) || 0) + (Number(item?.duration_2) || 0);
            total += clip / rate;
            const pause = Number(pauses[i]);
            total += Number.isFinite(pause) && pause > 0 ? pause : GAP_SECONDS / rate;
        });
        return total;
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

        // Субтитры. Без параметра `subtitles` фабрика отдаёт null, и кадр идёт
        // в кодек ровно как раньше — ни лишнего холста, ни лишней копии.
        const subtitles = window.HeadlessSubtitles
            ? window.HeadlessSubtitles.create({
                mode: config.subtitles,
                glosses,
                tokens: config.tokens,
                width: encWidth,
                height: encHeight,
            })
            : null;

        // Размер ФАЙЛА, а не кадра аватара: с субтитрами кадр выше на полосу
        // подписи, и настроить кодек по виджету значит срезать эту полосу.
        const outWidth = subtitles ? subtitles.width : encWidth;
        const outHeight = subtitles ? subtitles.height : encHeight;
        if (subtitles) {
            console.log(`[Headless] Субтитры: полоса ${subtitles.stripHeight}px сверху, кадр ${outWidth}x${outHeight}`);
        }

        // Контейнер: mp4, если браузер умеет кодировать H.264, иначе прежний
        // webm. Перекодировки нет ни там, ни там — кодирует один и тот же
        // энкодер, меняется кодек и упаковка. mp4 выбран потому, что его берут
        // все плееры и монтажки, а webm половина из них не открывает.
        //
        // Уровень 4.0 (`4d0028`) не прихоть: 3.1 (`42001f`) не тянет кадр
        // 1280×1024 и на боксе отвечает «не поддержан».
        const AVC_CODEC = 'avc1.4d0028';
        const avcConfig = {
            codec: AVC_CODEC,
            width: outWidth,
            height: outHeight,
            bitrate: 5_000_000,
            framerate: FRAMERATE,
        };
        let useMp4 = false;
        if (window.Mp4Muxer && typeof VideoEncoder.isConfigSupported === 'function') {
            try {
                const support = await VideoEncoder.isConfigSupported(avcConfig);
                useMp4 = !!(support && support.supported);
            } catch (e) {
                console.warn('[Headless] H.264 не проверился, пишем webm:', e && e.message);
            }
        }
        console.log(`[Headless] Контейнер: ${useMp4 ? 'mp4 (H.264)' : 'webm (VP8)'}, кадр ${outWidth}x${outHeight}`);

        const muxer = useMp4
            ? new window.Mp4Muxer.Muxer({
                target: new window.Mp4Muxer.ArrayBufferTarget(),
                video: { codec: 'avc', width: outWidth, height: outHeight },
                // Без этого moov пишется в конец файла: такой mp4 не начинает
                // играть, пока не скачан целиком, а мы отдаём его ссылкой.
                fastStart: 'in-memory',
            })
            : new window.WebMMuxer.Muxer({
                target: new window.WebMMuxer.ArrayBufferTarget(),
                video: {
                    codec: 'V_VP8',
                    width: outWidth,
                    height: outHeight,
                    frameRate: FRAMERATE,
                },
            });

        let videoEncoder = new VideoEncoder({
            output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
            error: (e) => console.error('[Headless] VideoEncoder Error:', e),
        });

        videoEncoder.configure(
            useMp4
                ? { ...avcConfig, avc: { format: 'avc' } }
                : {
                    codec: 'vp8',
                    width: outWidth,
                    height: outHeight,
                    bitrate: 5_000_000,
                    framerate: FRAMERATE,
                }
        );

        // 4. Hijack the environment for deterministic time
        const originalSetTimeout = window.setTimeout;
        const originalClearTimeout = window.clearTimeout;
        const originalRAF = window.requestAnimationFrame;
        const originalDateNow = Date.now;
        const originalPerfNow = performance.now;
        const originalFetch = window.fetch;
        const originalClockDelta = widget.clock ? widget.clock.getDelta : null;
        // Какой жест идёт сейчас, знает только сам аватар, и говорит он об этом
        // наружу — `postToParent`. В рендере родительского окна нет, и событие
        // не уходит никуда; перехватываем на месте. Тем же приёмом, что время и
        // сеть выше: страница чужая, и трогаем мы её только на время записи.
        const originalPostToParent = subtitles ? widget.postToParent : null;

        let virtualTime = 0;
        const pendingTimeouts = [];
        let rafIdx = 0;
        let isEncoding = true;
        let frameCount = 0;
        /**
         * Сторож пропавших мешей.
         *
         * На живой лекции один кадр из 30 тысяч выходит без пиджака: голова и
         * кисти на месте, корпуса с рукавами нет. Ровно один кадр, 1/30 с.
         * `gl.finish()` снял 99.7% таких кадров (было 12 из 1025), но не все,
         * и остаточную причину по картинке не отличить: то ли three.js сам не
         * нарисовал меш, то ли снимок взят недорисованным.
         *
         * Число отрисовок за кадр (`renderer.info.render.calls`) отвечает на
         * это прямо: сцена у нас постоянная, и меньше обычного значит, что меш
         * до видеокарты не доехал. Тогда кадр перерисовывается и снимается
         * заново — и в лог идёт, помогло ли. Помогло — виноват был кадр
         * (переснимок чинит); не помогло — меш выкинули раньше, на стороне
         * сцены, и чинить надо там.
         */
        let expectedCalls = 0;
        const callCounts = new Map();
        let shortFrames = 0;
        let recoveredFrames = 0;
        let stubbornFrames = 0;
        let guardOff = false;
        /** Пока сцена догружается, отрисовок законно меньше — не считаем. */
        const GUARD_WARMUP_FRAMES = 30;
        /** Если «мало отрисовок» на каждом втором кадре — это не сбой, а наша
         *  неверная догадка о сцене: выключаем, чтобы не рендерить всё дважды. */
        const GUARD_GIVE_UP_SHARE = 0.25;
        const GUARD_GIVE_UP_AFTER = 300;
        // Сколько секунд видео ждём — заполняется, когда известна
        // последовательность (до начала записи). 0 = посчитать не вышло.
        let expectedSeconds = 0;
        // Запись объявлена законченной: отчёты по кадрам больше не шлём.
        let recordingReported = false;
        let pendingNetwork = 0;
        let totalHeldMs = 0;
        const maxEncoderQueueSize = resolveEncoderMaxQueueSize(renderProfile);
        console.log(`[Headless] Encoder backpressure queue limit: ${maxEncoderQueueSize}`);

        try {
            if (subtitles) {
                widget.postToParent = function (message) {
                    try { subtitles.note(message); } catch (e) { /* подпись не стоит кадра */ }
                    return originalPostToParent.call(this, message);
                };
            }

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
                        // Меш мог не доехать до кадра — проверяем по числу
                        // отрисовок и, если их меньше обычного, рисуем ещё раз.
                        if (!guardOff && widget.renderer.info && widget.renderer.info.render) {
                            const calls = widget.renderer.info.render.calls;
                            callCounts.set(calls, (callCounts.get(calls) || 0) + 1);
                            if (frameCount < GUARD_WARMUP_FRAMES) {
                                if (calls > expectedCalls) expectedCalls = calls;
                            } else if (calls > expectedCalls) {
                                expectedCalls = calls;
                            } else if (calls < expectedCalls) {
                                shortFrames++;
                                let after = calls;
                                try {
                                    widget.renderer.render(widget.scene, widget.camera);
                                    after = widget.renderer.info.render.calls;
                                } catch (e) {
                                    console.warn('[Headless] Перерисовать кадр не вышло:', e && e.message);
                                }
                                if (after >= expectedCalls) recoveredFrames++;
                                else stubbornFrames++;
                                if (shortFrames <= 10) {
                                    console.warn(
                                        `[Headless] Кадр ${frameCount} (${(frameCount / FRAMERATE).toFixed(2)} с): отрисовок ${calls} вместо ${expectedCalls}, после перерисовки ${after}`
                                    );
                                }
                                if (
                                    frameCount >= GUARD_GIVE_UP_AFTER &&
                                    shortFrames > frameCount * GUARD_GIVE_UP_SHARE
                                ) {
                                    guardOff = true;
                                    console.warn(`[Headless] Сторож отрисовок выключен: коротких кадров ${shortFrames} из ${frameCount} — это норма сцены, а не сбой`);
                                }
                            }
                        }

                        // Ждём, пока драйвер РЕАЛЬНО дорисует кадр.
                        //
                        // `renderer.render()` только ставит команды в очередь, а
                        // снимок холста берёт то, что нарисовано на этот момент.
                        // Меши рисуются по порядку, поэтому в кадр попадали
                        // первые, а пиджак и рукава пропадали целиком — на
                        // живой лекции это мелькало на 1–5% кадров.
                        //
                        // `finish()` блокирует до конца отрисовки. Замер на
                        // ролике в 34 с: провалов было 12 из 1025 кадров, стало
                        // 0 из 1027, а время записи не выросло (30 с).
                        widget.renderer.getContext().finish();
                        const bitmap = await createImageBitmap(widget.renderer.domElement);
                        let source = bitmap;
                        if (subtitles) {
                            try { source = subtitles.compose(bitmap); } catch (e) { source = bitmap; }
                        }
                        const frame = new VideoFrame(source, { timestamp: (frameCount * 1_000_000) / FRAMERATE });
                        videoEncoder.encode(frame, { keyFrame: frameCount % 30 === 0 });
                        frame.close();
                        bitmap.close();
                        frameCount++;

                        if (frameCount % 60 === 0 && !recordingReported) {
                            const done = frameCount / FRAMERATE;
                            if (expectedSeconds > 0) {
                                // Доля записанного, зажатая в полосу 50→75.
                                const share = Math.min(1, done / expectedSeconds);
                                reportProgress(
                                    Math.round(50 + 25 * share),
                                    `Синтезируем движения: ${done.toFixed(0)} с из ${expectedSeconds.toFixed(0)} ⚡`,
                                );
                            } else {
                                // Последовательности нет — прежняя логарифмическая
                                // шкала: врёт, зато никогда не упирается в 100%.
                                const renderPct = 50 + 25 * (1 - 1 / (1 + frameCount / 300));
                                reportProgress(Math.round(renderPct), `Синтезируем движения: кадр ${frameCount} ⚡`);
                            }
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

            // Тишина ДО первого жеста. Пауза в записи бывает и до первого
            // предложения — лектор молчит, пока включается проектор, — и без
            // неё видео начинается с жеста, а речь в оригинале через четыре
            // секунды: файл смещён с первого кадра, и ручной подгонкой в
            // монтаже это чинить бессмысленно, когда число известно точно.
            //
            // Ждём по ВИРТУАЛЬНОМУ времени, тем же механизмом, что хвост:
            // кадры всё это время пишутся, и аватар в них стоит в позе покоя —
            // ровно то, что происходит в записи, пока никто не говорит.
            const leadMs = Number.isFinite(Number(config.leadSeconds))
                ? Math.max(0, Number(config.leadSeconds) * 1000)
                : 0;
            const tailMsForEstimate = Number.isFinite(Number(config.tailSeconds))
                ? Math.max(0, Number(config.tailSeconds) * 1000)
                : 2000;
            expectedSeconds = expectedRecordingSeconds(response, config, leadMs, tailMsForEstimate);
            console.log(`[Headless] Ожидаемая длительность записи: ${expectedSeconds.toFixed(1)} с`);
            if (leadMs > 0) {
                await new Promise((resolve) => {
                    pendingTimeouts.push({
                        id: ++rafIdx,
                        fireAt: virtualTime + leadMs,
                        cb: resolve,
                    });
                });
            }

            if (response) {
                await widget.playTranslateResponse(response, preloadedUrls, languageId, speeds, tokens, { pauses });
            } else {
                console.warn('[Headless] Nothing to play from the API — speaking the raw text.');
                await widget.processTextSelection(text);
            }

            // 6. Stop recording
            // Дальше идёт только хвост записи, и отчёты о кадрах больше не
            // нужны: цикл ещё крутится, и его «50..75%» перебивали бы уже
            // объявленные 80 — на экране это выглядело как откат процента.
            recordingReported = true;
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
            if (originalPostToParent) widget.postToParent = originalPostToParent;
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
        const blob = new Blob([buffer], { type: useMp4 ? 'video/mp4' : 'video/webm' });

        const recordingFinished = new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });

        console.log(`[Headless] Deterministic recording finished. Total frames: ${frameCount}`);
        {
            const spread = [...callCounts.entries()].sort((a, b) => a[0] - b[0])
                .map(([calls, times]) => `${calls}×${times}`).join(', ');
            console.log(
                `[Headless] Отрисовок за кадр: ${spread || 'нет данных'}; обычно ${expectedCalls}. ` +
                `Коротких кадров ${shortFrames} (${frameCount ? (shortFrames * 100 / frameCount).toFixed(3) : '0'}%), ` +
                `переснимок помог ${recoveredFrames}, не помог ${stubbornFrames}` +
                (guardOff ? ' — сторож был выключен по ходу записи' : '')
            );
        }
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
