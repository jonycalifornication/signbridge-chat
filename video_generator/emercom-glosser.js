/**
 * Emercom glosser — re-exports from shared gloss-dictionary module.
 * Kept for backward compatibility with video_generator/main.js.
 * @module emercom-glosser
 */
export {
    loadDictionary,
    loadDictionaryFromText,
    isDictionaryLoaded,
    getActiveLang,
    textToGlosses,
    detectDictLang,
    processEmercomDates,
    processEmercomNumbers
} from '../src/utils/gloss-dictionary.js';
