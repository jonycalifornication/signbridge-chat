/**
 * Язык жестов рендера.
 *
 * Раньше язык был один на весь сервис — `RENDER_PLAN_LANGUAGE_ID` (на боксе
 * KSL), а поле языка в запросе не читалось вовсе. Портал s2a глоссирует и
 * по-русски, и русские глоссы уходили в казахский словарь: из «ПРИХОДИТЬ
 * ЗАВТРА 9 ЧАСЫ» находилось одно число, остальное не находилось. Теперь язык
 * приходит с запросом (`language_id`), а переменная окружения осталась
 * умолчанием для тех, кто его не шлёт.
 *
 * Отдельным файлом, чтобы проверить тестом без поднятия сервера.
 */

export const DEFAULT_LANGUAGE_ID = 'KSL';

// Код языка у storage: KSL, RSL, ASl… Ограничение формы не даёт протащить в
// адрес страницы и в запрос к шлюзу что попало.
const LANGUAGE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/** `language_id` из запроса → код языка или null (не задан или мусор). */
export function parseLanguageId(raw) {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    return LANGUAGE_ID.test(value) ? value : null;
}

/** На каком языке рендерить: из запроса, иначе из окружения, иначе KSL. */
export function renderLanguageId(requested, env = process.env) {
    return requested || env.RENDER_PLAN_LANGUAGE_ID || DEFAULT_LANGUAGE_ID;
}

/**
 * Язык для ключа кэша.
 *
 * Те же глоссы на другом языке — другие жесты, и без языка в ключе русский
 * запрос получил бы готовое казахское видео. Язык по умолчанию отдаётся как
 * undefined: JSON.stringify такое поле пропускает, и ключ остаётся тем же, что
 * до появления языка в запросе, — уже снятые видео не перерисовываются.
 */
export function cacheLanguageId(requested, env = process.env) {
    const language = renderLanguageId(requested, env);
    return language === renderLanguageId(null, env) ? undefined : language;
}
