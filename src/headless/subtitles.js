/**
 * Субтитры поверх кадра рендера.
 *
 * Файл, как и `inject-renderer.js`, БЕЗ импортов: он вставляется в страницу
 * аватара обычным `<script>`, отдельно — чтобы эту часть можно было прогнать
 * и посмотреть глазами, не запуская рендер целиком (см.
 * `scripts/check-subtitles.mjs`).
 *
 * Зачем вообще. Видео с аватаром смотрят и те, кто жестов ещё не знает:
 * ученик сверяет жест с глоссом, редактор — глосс с оригиналом. Подпись на
 * кадре для этого единственный путь: отдельной дорожки субтитров в webm у нас
 * нет, а собирать её в монтаже значит делать руками то, что известно точно.
 *
 * Два режима, потому что вопросы разные: `glosses` подписывает ЖЕСТ (что
 * показывают руки), `text` — ОРИГИНАЛ (что было сказано). Третьего умолчания
 * нет: без параметра подписи не рисуются вовсе и кадр идёт в кодек ровно так
 * же, как раньше.
 *
 * Строка на экране — ПРЕДЛОЖЕНИЕ целиком, а внутри подсвечен текущий жест.
 * Показывать по одному слову значило бы мигать на каждом жесте и не давать
 * прочитать фразу; показывать всё без подсветки — не давать понять, где мы.
 */
(function () {
    'use strict';

    // DejaVu стоит в образе рендера (Dockerfile.renderer) и покрывает казахские
    // буквы — ә, ң, ө, ұ, ү, һ, і. Без явного имени chromium в slim-образе
    // рисует квадраты: системных шрифтов там нет вообще.
    const FONT_FAMILY = '"DejaVu Sans", "Liberation Sans", sans-serif';
    /** Сколько строк подписи показываем. Больше трёх — это уже не субтитр, а
     *  текст поверх аватара; в такой ситуации показываем окно вокруг текущего
     *  жеста, а не всё предложение. */
    const MAX_ROWS = 3;
    /** Насколько далеко вперёд ищем совпадение слова из события. Виджет
     *  пропускает пунктуацию, поэтому «следующий» не всегда следующий; но и
     *  уходить на пол-предложения по случайному повтору нельзя. */
    const LOOKAHEAD = 8;

    function words(line) {
        return String(line || '')
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }

    function same(a, b) {
        return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
    }

    /**
     * @param {object} options
     * @param {string} options.mode    'glosses' | 'text' — иное значит «не надо»
     * @param {string|string[]} options.glosses  глоссы, строка на предложение
     * @param {Array<{gloss:string,word:string}>} options.tokens пары жест↔оригинал
     * @param {number} options.width   размер кадра
     * @param {number} options.height
     * @returns {null|{note:Function,compose:Function}}
     */
    function create(options) {
        const mode = options && (options.mode === 'glosses' || options.mode === 'text')
            ? options.mode
            : null;
        if (!mode) return null;

        const raw = Array.isArray(options.glosses)
            ? options.glosses.join('\n')
            : String(options.glosses || '');
        const lines = raw.split('\n').map(words).filter((l) => l.length > 0);
        if (lines.length === 0) return null;

        const tokens = Array.isArray(options.tokens) ? options.tokens : [];

        // Плоский порядок жестов — тот же, в каком идёт последовательность у
        // аватара и в каком лежат tokens[]. По нему и разыскиваем текущий.
        const lineOf = [];
        const posOf = [];
        const captions = [];
        let flat = 0;
        for (let li = 0; li < lines.length; li++) {
            const row = [];
            for (let wi = 0; wi < lines[li].length; wi++) {
                const gloss = lines[li][wi];
                const token = tokens[flat] || {};
                // В режиме оригинала слово берём из пары; её может не быть
                // (старый клиент, дактиль без alignment) — тогда глосс.
                row.push(mode === 'text' ? String(token.word || gloss) : gloss);
                lineOf.push(li);
                posOf.push(wi);
                flat++;
            }
            captions.push(row);
        }

        const width = Math.max(1, Math.round(Number(options.width) || 0));
        const height = Math.max(1, Math.round(Number(options.height) || 0));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const size = Math.max(16, Math.min(44, Math.round(height * 0.05)));
        const pad = Math.round(size * 0.45);
        const rowStep = Math.round(size * 1.55);
        const maxWidth = Math.round(width * 0.88);
        const bottom = Math.round(height * 0.05);

        // Где стоим в плоском списке. −1 значит «жестов ещё не было»: подпись до
        // первого события не рисуется вовсе — там тишина перед первым
        // предложением, и подписывать нечего.
        let cursor = -1;

        function note(message) {
            if (!message || message.type !== 'AVATAR_WORD_START') return;
            const word = message.payload && message.payload.word;
            if (!word) return;
            const limit = Math.min(tokens.length || lineOf.length, cursor + 1 + LOOKAHEAD);
            for (let i = Math.max(0, cursor + 1); i < limit; i++) {
                const token = tokens[i] || {};
                const gloss = captions[lineOf[i]][posOf[i]];
                if (same(token.word, word) || same(token.gloss, word) || same(gloss, word)) {
                    cursor = i;
                    return;
                }
            }
            // Не нашли — значит слово переписано где-то по пути (дактиль,
            // число, чужая нормализация). Двигаемся на одну позицию: подпись
            // отстанет на жест, но не замрёт и не убежит.
            cursor = Math.min(cursor + 1, lineOf.length - 1);
        }

        /** Разложить слова строки по рядам, не шире maxWidth. */
        function wrap(row) {
            ctx.font = `${size}px ${FONT_FAMILY}`;
            const rows = [];
            let current = [];
            let currentWidth = 0;
            const space = ctx.measureText(' ').width;
            for (let i = 0; i < row.length; i++) {
                const w = ctx.measureText(row[i]).width;
                const add = current.length === 0 ? w : w + space;
                if (current.length > 0 && currentWidth + add > maxWidth) {
                    rows.push(current);
                    current = [];
                    currentWidth = 0;
                }
                current.push(i);
                currentWidth += current.length === 1 ? w : add;
            }
            if (current.length > 0) rows.push(current);
            return rows;
        }

        function roundRect(x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }

        function paint() {
            if (cursor < 0) return;
            const line = lineOf[cursor];
            const active = posOf[cursor];
            const row = captions[line] || [];
            if (row.length === 0) return;

            let rows = wrap(row);
            if (rows.length > MAX_ROWS) {
                // Окно вокруг текущего жеста: длинное предложение целиком не
                // помещается, а читают его ради того места, которое сейчас
                // показывают.
                const at = rows.findIndex((r) => r.indexOf(active) >= 0);
                const from = Math.max(0, Math.min(rows.length - MAX_ROWS, at - 1));
                rows = rows.slice(from, from + MAX_ROWS);
            }

            ctx.font = `${size}px ${FONT_FAMILY}`;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const space = ctx.measureText(' ').width;

            const blockHeight = rows.length * rowStep;
            let y = height - bottom - blockHeight + rowStep / 2;
            for (const indexes of rows) {
                const widths = indexes.map((i) => ctx.measureText(row[i]).width);
                const total = widths.reduce((a, b) => a + b, 0) + space * (indexes.length - 1);
                let x = Math.round((width - total) / 2);

                ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
                roundRect(x - pad, y - rowStep / 2 + 2, total + pad * 2, rowStep - 4, Math.round(pad / 2));
                ctx.fill();

                for (let k = 0; k < indexes.length; k++) {
                    // Текущий жест жёлтым: белым по белому фону подписи его не
                    // отличить, а знать, где идёт показ, — половина смысла.
                    ctx.fillStyle = indexes[k] === active ? '#ffd23f' : '#ffffff';
                    ctx.fillText(row[indexes[k]], x, y);
                    x += widths[k] + space;
                }
                y += rowStep;
            }
        }

        /**
         * Кадр с подписью. Возвращает холст — его и кодируем.
         *
         * Кадр сначала копируется целиком: фон у нас задан клиром WebGL, и
         * рисовать подпись прямо в него нельзя — следующий кадр аватара
         * подпись бы не стёр.
         */
        let complained = false;
        function compose(source) {
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(source, 0, 0, width, height);
            try {
                paint();
            } catch (e) {
                // Подпись — украшение кадра, и ронять из-за неё пятиминутный
                // рендер нельзя. Но и молчать нельзя: без записи в лог
                // оператор увидит видео без подписей и не узнает почему.
                if (!complained) {
                    complained = true;
                    console.error('[Subtitles] Подпись не нарисована:', e);
                }
            }
            return canvas;
        }

        return { note, compose };
    }

    window.HeadlessSubtitles = { create };
})();
