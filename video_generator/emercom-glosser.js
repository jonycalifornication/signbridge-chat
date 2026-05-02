import {
    expandDatesInText,
    KAZAKH_DATE_SUFFIX_RE,
    RUSSIAN_DATE_SUFFIX_RE
} from '../src/utils/date-glosses.js';
import { normalizeNumericText } from '../src/utils/number-glosses.js';

const dictionaries = {};
let activeDictionary = null;
let activeLang = null;
let maxPhraseLen = 1;

export function processEmercomDates(text, lang) {
    return expandDatesInText(text, lang === 'kk' || lang === 'kz' ? 'kk' : 'ru');
}

export function processEmercomNumbers(text) {
    return normalizeNumericText(text);
}

function parseCSV(text) {
    const rows = [];
    let i = 0;
    const len = text.length;

    while (i < len) {
        const row = [];
        while (i < len) {
            if (text[i] === '"') {
                // Quoted field — may contain newlines and commas
                i++;
                let field = '';
                while (i < len) {
                    if (text[i] === '"') {
                        if (i + 1 < len && text[i + 1] === '"') {
                            field += '"';
                            i += 2;
                        } else {
                            i++;
                            break;
                        }
                    } else {
                        field += text[i];
                        i++;
                    }
                }
                row.push(field);
                if (i < len && text[i] === ',') i++;
            } else {
                // Unquoted field
                let field = '';
                while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
                    field += text[i];
                    i++;
                }
                row.push(field);
                if (i < len && text[i] === ',') {
                    i++;
                } else {
                    break;
                }
            }
        }
        while (i < len && (text[i] === '\n' || text[i] === '\r')) i++;

        if (row.length >= 2 && row[0].trim()) {
            rows.push(row);
        }
    }
    return rows;
}

function buildDictionary(rows) {
    const map = new Map();
    let maxLen = 1;

    for (const row of rows) {
        const gloss = row[0].trim();
        const variantsRaw = row[1] || '';
        const note = (row[2] || '').trim();

        // Split variants by commas and newlines (Russian uses \n, Kazakh uses ,)
        const variants = variantsRaw
            .split(/[\n,]/)
            .map(v => v.trim())
            .filter(v => v.length > 0);

        for (const variant of variants) {
            const key = variant.toLowerCase();
            const wordCount = key.split(/\s+/).length;
            if (wordCount > maxLen) maxLen = wordCount;
            map.set(key, { gloss, note });
        }
    }

    return { map, maxLen };
}

export async function loadDictionary(lang) {
    if (dictionaries[lang]) {
        activeDictionary = dictionaries[lang];
        activeLang = lang;
        maxPhraseLen = activeDictionary.maxLen;
        return;
    }

    const file = lang === 'kk' ? 'kazakh.csv' : 'russian.csv';
    const res = await fetch(`/emercom/${file}`);
    if (!res.ok) throw new Error(`Failed to load dictionary: ${file} (${res.status})`);
    const text = await res.text();
    const rows = parseCSV(text);
    const dict = buildDictionary(rows);

    dictionaries[lang] = dict;
    activeDictionary = dict;
    activeLang = lang;
    maxPhraseLen = dict.maxLen;

    console.log(`[Emercom] Loaded ${file}: ${dict.map.size} variants, max phrase len: ${dict.maxLen}`);
}

export function textToGlosses(text) {
    if (!activeDictionary) return { glosses: text, tokens: [] };

    const preparedText = processEmercomNumbers(processEmercomDates(text, activeLang));
    // Split input into words, preserving punctuation as separate tokens
    const words = preparedText.match(/[^\s]+/g) || [];
    const result = [];
    const tokens = [];

    let i = 0;
    while (i < words.length) {
        let matched = false;

        // Try longest phrase first, then shorter
        for (let wlen = Math.min(maxPhraseLen, words.length - i); wlen >= 1; wlen--) {
            const phrase = words.slice(i, i + wlen).join(' ');
            // Strip leading and trailing punctuation for lookup
            const cleaned = phrase.replace(/^[«»"'(\[]+|[.,!?;:()»"'\]]+$/g, '').toLowerCase();
            const entry = activeDictionary.map.get(cleaned);
            if (entry) {
                result.push(entry.gloss);
                tokens.push({
                    original: phrase,
                    gloss: entry.gloss,
                    note: entry.note,
                    matched: true
                });
                i += wlen;
                matched = true;
                break;
            }
        }

        if (!matched) {
            // Keep original word as-is
            result.push(words[i]);
            tokens.push({
                original: words[i],
                gloss: words[i],
                matched: false
            });
            i++;
        }
    }

    return {
        glosses: result.join(' '),
        tokens
    };
}

export function detectDictLang(text) {
    const kazakhPattern = /[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/;
    if (kazakhPattern.test(text)) return 'kk';
    if (KAZAKH_DATE_SUFFIX_RE.test(text)) return 'kk';
    if (RUSSIAN_DATE_SUFFIX_RE.test(text)) return 'ru';
    return 'ru';
}
