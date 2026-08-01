export const AUTO_LANGUAGE_MODE = 'auto';

/**
 * These must be the codes the storage backend actually uses — it returns KSL,
 * RSL and ASl from /cms/languages. Sending anything else (the old `kz_KSL`)
 * makes /translate/ find nothing at all, so every word silently degrades to
 * finger-spelling. The avatar project made the same move; this keeps the two in
 * step.
 */
export const DEFAULT_LANGUAGE_ID = 'KSL';
export const DEFAULT_LANGUAGE_PRIORITY = ['KSL', 'RSL'];

const LANGUAGE_ALIASES = {
    kk: 'KSL',
    kz: 'KSL',
    kazakh: 'KSL',
    ksl: 'KSL',
    kz_ksl: 'KSL',
    'kz-ksl': 'KSL',
    ru: 'RSL',
    russian: 'RSL',
    rsl: 'RSL',
    ru_rsl: 'RSL',
    'ru-rsl': 'RSL',
};

export function normalizeLanguageId(value, fallback = DEFAULT_LANGUAGE_ID) {
    if (typeof value !== 'string') return fallback;

    const trimmed = value.trim();
    if (!trimmed) return fallback;

    return LANGUAGE_ALIASES[trimmed.toLowerCase()] || trimmed;
}

export function normalizeLanguageMode(value, fallback = AUTO_LANGUAGE_MODE) {
    if (typeof value !== 'string') return fallback;

    const trimmed = value.trim();
    if (!trimmed) return fallback;
    if (trimmed.toLowerCase() === AUTO_LANGUAGE_MODE) return AUTO_LANGUAGE_MODE;

    return normalizeLanguageId(trimmed, fallback);
}

export function parseLanguagePriority(value, fallback = DEFAULT_LANGUAGE_PRIORITY) {
    const rawItems = Array.isArray(value)
        ? value
        : typeof value === 'string'
            ? value.split(',')
            : [];

    const items = [];
    for (const rawItem of rawItems) {
        const normalized = normalizeLanguageId(String(rawItem || ''), '');
        if (normalized && !items.includes(normalized)) {
            items.push(normalized);
        }
    }

    return items.length > 0 ? items : [...fallback];
}

export function getLanguageIdsForMode(mode, priority, fallbackLanguageId = DEFAULT_LANGUAGE_ID) {
    const normalizedMode = normalizeLanguageMode(mode, AUTO_LANGUAGE_MODE);
    if (normalizedMode === AUTO_LANGUAGE_MODE) {
        const normalizedPriority = parseLanguagePriority(priority, [fallbackLanguageId]);
        return normalizedPriority.length > 0 ? normalizedPriority : [fallbackLanguageId];
    }

    return [normalizedMode];
}

export function getFoundAnimationCount(response) {
    const sequence = Array.isArray(response?.sequence) ? response.sequence : [];
    return sequence.filter(item => item?.found && item?.file_url).length;
}

export function hasFoundAnimations(response) {
    return getFoundAnimationCount(response) > 0;
}
