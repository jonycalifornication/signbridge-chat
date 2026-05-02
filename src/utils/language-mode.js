export const AUTO_LANGUAGE_MODE = 'auto';
export const DEFAULT_LANGUAGE_ID = 'kz_KSL';
export const DEFAULT_LANGUAGE_PRIORITY = ['kz_KSL', 'ru-RSL'];

const LANGUAGE_ALIASES = {
    kk: 'kz_KSL',
    kz: 'kz_KSL',
    kazakh: 'kz_KSL',
    kz_ksl: 'kz_KSL',
    'kz-ksl': 'kz_KSL',
    ru: 'ru-RSL',
    russian: 'ru-RSL',
    ru_rsl: 'ru-RSL',
    'ru-rsl': 'ru-RSL',
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
