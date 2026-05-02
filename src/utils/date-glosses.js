import { numberToGlossText } from './number-glosses.js';

const MONTHS_KK = {
    1: 'қаңтар',
    2: 'ақпан',
    3: 'наурыз',
    4: 'сәуір',
    5: 'мамыр',
    6: 'маусым',
    7: 'шілде',
    8: 'тамыз',
    9: 'қыркүйек',
    10: 'қазан',
    11: 'қараша',
    12: 'желтоқсан'
};

const MONTHS_RU = {
    1: 'январь',
    2: 'февраль',
    3: 'март',
    4: 'апрель',
    5: 'май',
    6: 'июнь',
    7: 'июль',
    8: 'август',
    9: 'сентябрь',
    10: 'октябрь',
    11: 'ноябрь',
    12: 'декабрь'
};

const DATE_RE = /(\d{1,2})(?:-(\d{1,2}))?\.(\d{1,2})\.(\d{2,4})(?:\s*(жыл(?:ы)?|год(?:а)?|ж\.?|г\.?))?/giu;

export const KAZAKH_DATE_SUFFIX_RE = /\d{1,2}(?:-\d{1,2})?\.\d{1,2}\.\d{2,4}\s*(?:жыл(?:ы)?|ж\.?)(?=$|[\s.,!?;:])/iu;
export const RUSSIAN_DATE_SUFFIX_RE = /\d{1,2}(?:-\d{1,2})?\.\d{1,2}\.\d{2,4}\s*(?:год(?:а)?|г\.?)(?=$|[\s.,!?;:])/iu;

function normalizeDateLang(lang) {
    return lang === 'ru' ? 'ru' : 'kk';
}

function detectDateLangFromSuffix(suffix, fallbackLang) {
    const normalizedSuffix = (suffix || '').toLowerCase().replace(/\./g, '');
    if (normalizedSuffix === 'ж' || normalizedSuffix === 'жыл' || normalizedSuffix === 'жылы') return 'kk';
    if (normalizedSuffix === 'г' || normalizedSuffix === 'год' || normalizedSuffix === 'года') return 'ru';
    return normalizeDateLang(fallbackLang);
}

function isValidDatePart(day1, day2, month) {
    if (!Number.isInteger(day1) || day1 < 1 || day1 > 31) return false;
    if (!Number.isInteger(month) || month < 1 || month > 12) return false;
    if (day2 === null) return true;
    return Number.isInteger(day2) && day2 >= day1 && day2 <= 31;
}

function normalizeDateYear(yearRaw) {
    const year = Number.parseInt(yearRaw, 10);
    if (!Number.isInteger(year)) return null;
    return yearRaw.length === 2 ? 2000 + year : year;
}

export function expandDatesInText(text, fallbackLang = 'kk') {
    return String(text ?? '').replace(DATE_RE, (match, day1Raw, day2Raw, monthRaw, yearRaw, suffixRaw) => {
        const dateLang = detectDateLangFromSuffix(suffixRaw, fallbackLang);
        const months = dateLang === 'kk' ? MONTHS_KK : MONTHS_RU;
        const yearWord = dateLang === 'kk' ? 'жыл' : 'год';
        const day1 = Number.parseInt(day1Raw, 10);
        const day2 = day2Raw ? Number.parseInt(day2Raw, 10) : null;
        const month = Number.parseInt(monthRaw, 10);

        if (!isValidDatePart(day1, day2, month)) {
            return match;
        }

        const year = normalizeDateYear(yearRaw);
        if (year === null) {
            return match;
        }

        const dayPart = day2 === null
            ? numberToGlossText(day1)
            : `${numberToGlossText(day1)} ${numberToGlossText(day2)}`;
        const yearPart = numberToGlossText(year);

        return `${dayPart} ${months[month]} ${yearPart} ${yearWord}`;
    });
}
