import { CONFIG } from '../config.js';
import { expandDatesInText } from '../utils/date-glosses.js';
import { normalizeNumericText } from '../utils/number-glosses.js';
import { loadDictionary, textToGlosses, detectDictLang, isDictionaryLoaded } from '../utils/gloss-dictionary.js';

const LETTER_RE = /[0-9A-Za-z\u0400-\u04FF°]/;
const DEFAULT_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_LANGUAGE_ID = CONFIG.languageId || 'kz_KSL';

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

async function translateText(text, options) {
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

function createLetterResolver(options) {
    const cache = new Map();

    return async function resolveLetter(letter) {
        const key = letter.toLowerCase();
        if (cache.has(key)) return cache.get(key);

        const promise = (async () => {
            if (CONFIG.animations[key]) {
                return {
                    char: key,
                    found: true,
                    source: 'local',
                    animationName: key,
                    fileUrl: null,
                    gloss: key.toUpperCase(),
                };
            }

            try {
                const response = await translateText(key, options);
                const sequence = Array.isArray(response?.sequence) ? response.sequence : [];
                const match = sequence.find(item => item?.found && item?.file_url);

                if (match) {
                    return {
                        char: key,
                        found: true,
                        source: 'remote',
                        animationName: null,
                        fileUrl: match.file_url,
                        gloss: getItemGloss(match) || key.toUpperCase(),
                    };
                }
            } catch (error) {
                console.warn(`[RenderPlan] Letter lookup failed for "${key}": ${error.message}`);
            }

            return {
                char: key,
                found: false,
                source: 'missing',
                animationName: null,
                fileUrl: null,
                gloss: key,
            };
        })();

        cache.set(key, promise);
        return promise;
    };
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

async function makeDactylItem(word, resolveLetter) {
    const letters = splitDactylLetters(word);
    const resolvedLetters = await Promise.all(letters.map(letter => resolveLetter(letter)));
    const foundLetters = resolvedLetters.filter(letter => letter.found).length;

    let kind = 'missing';
    if (foundLetters === letters.length && letters.length > 0) {
        kind = 'dactyl';
    } else if (foundLetters > 0) {
        kind = 'partial-dactyl';
    }

    return {
        kind,
        original: word,
        spokenText: word,
        gloss: resolvedLetters
            .map(letter => (letter.found ? letter.gloss : letter.char).toUpperCase())
            .join(' '),
        letters: resolvedLetters,
        foundLetters,
        missingLetters: Math.max(0, letters.length - foundLetters),
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
            stats.missingLetters += item.missingLetters || 0;
            stats.remoteFiles += (item.letters || []).filter(letter => letter.source === 'remote' && letter.fileUrl).length;
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

export function collectRenderPlanFileUrls(plan) {
    const urls = [];

    for (const item of plan?.items || []) {
        if (item.kind === 'animation' && item.source === 'remote' && item.fileUrl) {
            urls.push(item.fileUrl);
        }
        for (const letter of item.letters || []) {
            if (letter.source === 'remote' && letter.fileUrl) {
                urls.push(letter.fileUrl);
            }
        }
    }

    return [...new Set(urls)];
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

async function aiTextToGloss(text, langId) {
    const aiUrl = 'http://94.131.83.85:8010/api/t2g/glossing';
    const apiKey = 'sta_SjLaEdygAVPJ0YKDbpmm0EXxhJwim10JkOQ9eExkIPA';
    
    // Подстраиваем язык для AI API (ожидает 'kz', 'ru' и т.д.)
    let glossLang = 'kz';
    if (langId && langId.toLowerCase().startsWith('ru')) {
        glossLang = 'ru';
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
        const response = await fetch(aiUrl, {
            method: 'POST',
            headers: {
                'accept': 'application/json',
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                text: text,
                gloss_language: glossLang
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`AI API failed with status ${response.status}`);
        }

        const data = await response.json();
        return data?.lemmas_text || text;
    } finally {
        clearTimeout(timeoutId);
    }
}

export async function buildRenderPlan(text, options) {
    const normalizedText = normalizeRenderText(text);

    // Pre-process through CSV dictionary: convert text to glosses before sending to /translate/
    let glossText = normalizedText;
    
    if (options.mode === 'normal') {
        try {
            console.log(`[RenderPlan] Mode is normal. Calling AI Glossing for: "${normalizedText}"`);
            const aiGloss = await aiTextToGloss(normalizedText, options.languageId || DEFAULT_LANGUAGE_ID);
            if (aiGloss && aiGloss.trim()) {
                glossText = aiGloss;
                console.log(`[RenderPlan] AI Glossing returned: "${glossText}"`);
            }
        } catch (err) {
            console.warn(`[RenderPlan] AI Glossing failed, falling back to CSV: ${err.message}`);
        }
    }

    // Если ИИ не использовался или вернул тот же текст (или упал с ошибкой) - используем CSV
    if (glossText === normalizedText) {
        try {
            const lang = detectDictLang(normalizedText);
            // If no dictionary is loaded, or we need to switch language
            if (getActiveLang() !== lang) {
                // Only try to fetch if we are in a browser environment
                if (typeof fetch === 'function') {
                    await loadDictionary(lang);
                }
            }
            
            if (isDictionaryLoaded() && getActiveLang() === lang) {
                const csvResult = textToGlosses(normalizedText);
                if (csvResult.glosses && csvResult.glosses !== normalizedText) {
                    console.log(`[RenderPlan] CSV pre-processed (${lang}): "${normalizedText}" → "${csvResult.glosses}"`);
                    glossText = csvResult.glosses;
                }
            }
        } catch (csvErr) {
            console.warn(`[RenderPlan] CSV pre-processing failed: ${csvErr.message}`);
        }
    }

    const response = await translateText(glossText, options);
    const sequence = Array.isArray(response?.sequence) ? response.sequence : [];
    const resolveLetter = createLetterResolver(options);
    const items = [];

    if (sequence.length === 0 && glossText) {
        // If API returned nothing, use dactyl for the entire glossed text
        items.push(await makeDactylItem(glossText, resolveLetter));
    } else {
        for (const item of sequence) {
            const original = getItemText(item);
            if (!original) continue;

            if (item?.found && item?.file_url) {
                items.push(makeAnimationItem(item));
            } else {
                // This 'original' is the word returned by API (which is our glossed word)
                items.push(await makeDactylItem(original, resolveLetter));
            }
        }
    }

    const stats = summarizePlan(items);

    return {
        version: 1,
        text: normalizedText,
        languageId: options.languageId || DEFAULT_LANGUAGE_ID,
        items,
        stats,
        glosses: items.map(item => item.gloss || item.original).join(' '),
    };
}
