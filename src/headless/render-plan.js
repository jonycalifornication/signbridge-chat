import { CONFIG } from '../config.js';
import { expandDatesInText } from '../utils/date-glosses.js';
import { normalizeNumericText } from '../utils/number-glosses.js';

const LETTER_RE = /[0-9A-Za-z\u0400-\u04FF°]/;
const DEFAULT_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_LANGUAGE_ID = CONFIG.languageId || 'KSL';

function normalizeApiUrl(apiUrl) {
    if (typeof apiUrl !== 'string' || !apiUrl.trim()) {
        throw new Error('Render plan API URL is required');
    }
    return apiUrl.replace(/\/+$/, '');
}

function normalizeText(text) {
    return Array.isArray(text) ? text.join(' ') : String(text || '').trim();
}

function splitDactylLetters(text) {
    return Array.from(String(text || '').toLowerCase()).filter(char => LETTER_RE.test(char));
}

function getItemText(item) {
    return String(item?.text || item?.word || '').trim();
}

function getItemGloss(item) {
    return String(item?.gloss_name || item?.word || item?.text || '').trim();
}

/**
 * @param {string} text
 * @param {object} options - { apiUrl, apiKey, languageId, fetchTimeoutMs }
 * @param {object} [flags]
 * @param {boolean} [flags.alreadyGlossed] - when true, tells the avatar gateway
 *   to skip its own text→gloss step because we already glossed the text. Passing
 *   false lets the gateway act as a fallback glosser.
 */
async function translateText(text, options, { alreadyGlossed = true } = {}) {
    const apiUrl = normalizeApiUrl(options.apiUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.fetchTimeoutMs || DEFAULT_FETCH_TIMEOUT_MS);

    try {
        const headers = { 'Content-Type': 'application/json' };
        if (options.apiKey) headers['X-API-Key'] = options.apiKey;

        const response = await fetch(`${apiUrl}/translate/`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                text,
                language_id: options.languageId || DEFAULT_LANGUAGE_ID,
                already_glossed: alreadyGlossed,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Translation API failed (${response.status}): ${errorText}`);
        }

        return await response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}

function makeAnimationItem(item) {
    const original = getItemText(item);
    return {
        kind: 'animation',
        original,
        spokenText: original,
        gloss: getItemGloss(item) || original,
        source: 'remote',
        fileUrl: item.file_url,
        duration: typeof item.duration === 'number' ? item.duration : null,
    };
}

/**
 * A word the backend has no gloss for. We only describe it — the widget's
 * `playTextAsLetters()` resolves, downloads and pre-parses the letter clips
 * itself, so there is no reason to spend a `/translate/` call per letter here
 * just to say the same thing twice.
 */
function makeDactylItem(word) {
    const letters = splitDactylLetters(word);

    return {
        kind: letters.length > 0 ? 'dactyl' : 'missing',
        original: word,
        spokenText: word,
        gloss: letters.join(' ').toUpperCase(),
        letters: letters.map(char => ({ char, source: 'widget' })),
    };
}

function summarizePlan(items) {
    const stats = {
        animationItems: 0,
        dactylItems: 0,
        dactylLetters: 0,
        missingItems: 0,
        missingLetters: 0,
        remoteFiles: 0,
    };

    for (const item of items) {
        if (item.kind === 'animation') {
            stats.animationItems++;
            if (item.source === 'remote' && item.fileUrl) stats.remoteFiles++;
            continue;
        }

        if (item.kind === 'dactyl' || item.kind === 'partial-dactyl') {
            stats.dactylItems++;
            stats.dactylLetters += item.letters?.length || 0;
            continue;
        }

        stats.missingItems++;
        stats.missingLetters += item.letters?.length || 0;
    }

    return stats;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export function estimateRenderTimeoutMs(plan, { hasGPU = false } = {}) {
    const stats = plan?.stats || {};
    const baseMs = hasGPU ? 90000 : 140000;
    const animationMs = hasGPU ? 22000 : 40000;
    const dactylLetterMs = hasGPU ? 14000 : 30000;
    const missingLetterMs = hasGPU ? 4000 : 8000;

    const estimate =
        baseMs +
        (stats.animationItems || 0) * animationMs +
        (stats.dactylLetters || 0) * dactylLetterMs +
        (stats.missingLetters || 0) * missingLetterMs;

    return clamp(estimate, hasGPU ? 180000 : 240000, hasGPU ? 600000 : 900000);
}

export function estimateFallbackTimeoutMs(text, { hasGPU = false } = {}) {
    const normalizedText = normalizeText(text);
    const letters = splitDactylLetters(normalizedText).length;
    const words = normalizedText.match(/[^\s]+/g)?.length || 0;
    const baseMs = hasGPU ? 120000 : 180000;
    const estimate = baseMs + words * (hasGPU ? 12000 : 20000) + letters * (hasGPU ? 4000 : 8000);
    return clamp(estimate, hasGPU ? 180000 : 240000, hasGPU ? 600000 : 900000);
}

export function renderPlanToGlossPreview(plan) {
    const tokens = (plan?.items || []).map(item => {
        const kind = item.kind === 'animation' ? 'matched' : item.kind;
        return {
            original: item.original || item.spokenText || '',
            gloss: (item.gloss || item.original || '').toUpperCase(),
            kind,
            matched: kind === 'matched' || kind === 'dactyl',
        };
    }).filter(token => token.original || token.gloss);

    return {
        glossPreview: tokens.map(token => token.gloss).join(' '),
        glossTokens: tokens,
    };
}

export function normalizeRenderText(text) {
    return normalizeNumericText(expandDatesInText(normalizeText(text), 'kk'));
}

/**
 * Build everything the renderer needs for one video.
 *
 * Text→gloss is NOT done here. The avatar gateway already does it inside
 * `/translate/` ("сәлем достар" → "сәлем дос"), with its own scoring, caching
 * and per-key metering — so we send the plain text and let it gloss. That keeps
 * the video's glosses identical to what the live widget produces for the same
 * text, and leaves exactly one implementation of glossing in the system.
 *
 * What we still do here, because the page cannot:
 *   - summarise the work, which drives the render timeout;
 *   - produce the gloss preview shown in the UI.
 *
 * The raw `response` is returned untouched and handed to the widget's own
 * `playTranslateResponse()`, which owns playback.
 */
export async function buildRenderPlan(text, options) {
    const normalizedText = normalizeRenderText(text);

    // The caller may have glossed the text itself (speech-to-avatar). Then the
    // gateway must not gloss it again — a second pass would rewrite the glosses
    // the caller's tokens/speeds are aligned to.
    const response = await translateText(normalizedText, options, {
        alreadyGlossed: options.alreadyGlossed === true,
    });
    const sequence = Array.isArray(response?.sequence) ? response.sequence : [];
    
    const items = [];

    if (sequence.length === 0 && normalizedText) {
        // Nothing came back at all — finger-spell the whole text.
        items.push(makeDactylItem(normalizedText));
    } else {
        for (const item of sequence) {
            const original = getItemText(item);
            if (!original) continue;

            if (item?.found && item?.file_url) {
                items.push(makeAnimationItem(item));
            } else {
                // `original` is the gloss the gateway produced for this word.
                items.push(makeDactylItem(original));
            }
        }
    }

    const stats = summarizePlan(items);

    return {
        version: 2,
        text: normalizedText,
        languageId: options.languageId || DEFAULT_LANGUAGE_ID,
        items,
        stats,
        glosses: items.map(item => item.gloss || item.original).join(' '),
        // Handed to the widget's playTranslateResponse() — it owns playback,
        // including glued second clips and the letter fallback.
        response,
    };
}
