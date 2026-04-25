const dictionaries = {};
let activeDictionary = null;
let activeLang = null;
let maxPhraseLen = 1;

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

const KZ_UNITS = {
    0: 'нөл',
    1: 'бір',
    2: 'екі',
    3: 'үш',
    4: 'төрт',
    5: 'бес',
    6: 'алты',
    7: 'жеті',
    8: 'сегіз',
    9: 'тоғыз'
};

const KZ_TENS = {
    10: 'он',
    20: 'жиырма',
    30: 'отыз',
    40: 'қырық',
    50: 'елу',
    60: 'алпыс',
    70: 'жетпіс',
    80: 'сексен',
    90: 'тоқсан'
};

const RU_UNITS = {
    0: 'ноль',
    1: 'один',
    2: 'два',
    3: 'три',
    4: 'четыре',
    5: 'пять',
    6: 'шесть',
    7: 'семь',
    8: 'восемь',
    9: 'девять'
};

const RU_THOUSAND_UNITS = {
    ...RU_UNITS,
    1: 'одна',
    2: 'две'
};

const RU_TEENS = {
    10: 'десять',
    11: 'одиннадцать',
    12: 'двенадцать',
    13: 'тринадцать',
    14: 'четырнадцать',
    15: 'пятнадцать',
    16: 'шестнадцать',
    17: 'семнадцать',
    18: 'восемнадцать',
    19: 'девятнадцать'
};

const RU_TENS = {
    20: 'двадцать',
    30: 'тридцать',
    40: 'сорок',
    50: 'пятьдесят',
    60: 'шестьдесят',
    70: 'семьдесят',
    80: 'восемьдесят',
    90: 'девяносто'
};

const RU_HUNDREDS = {
    100: 'сто',
    200: 'двести',
    300: 'триста',
    400: 'четыреста',
    500: 'пятьсот',
    600: 'шестьсот',
    700: 'семьсот',
    800: 'восемьсот',
    900: 'девятьсот'
};

const DATE_RE = /(\d{1,2})(?:-(\d{1,2}))?\.(\d{1,2})\.(\d{2,4})(?:\s*(жыл(?:ы)?|год(?:а)?|ж\.?|г\.?))?/giu;
const KAZAKH_DATE_SUFFIX_RE = /\d{1,2}(?:-\d{1,2})?\.\d{1,2}\.\d{2,4}\s*(?:жыл(?:ы)?|ж\.?)(?=$|[\s.,!?;:])/iu;
const RUSSIAN_DATE_SUFFIX_RE = /\d{1,2}(?:-\d{1,2})?\.\d{1,2}\.\d{2,4}\s*(?:год(?:а)?|г\.?)(?=$|[\s.,!?;:])/iu;

function normalizeEmercomLang(lang) {
    return lang === 'kk' || lang === 'kz' ? 'kk' : 'ru';
}

function detectDateLangFromSuffix(suffix, fallbackLang) {
    const normalizedSuffix = (suffix || '').toLowerCase().replace(/\./g, '');
    if (normalizedSuffix === 'ж' || normalizedSuffix === 'жыл' || normalizedSuffix === 'жылы') return 'kk';
    if (normalizedSuffix === 'г' || normalizedSuffix === 'год' || normalizedSuffix === 'года') return 'ru';
    return normalizeEmercomLang(fallbackLang);
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

function numberToWordsKk(n) {
    if (!Number.isInteger(n) || n < 0 || n >= 10000) return String(n);
    if (n < 10) return KZ_UNITS[n];
    if (n < 100) {
        const tens = Math.floor(n / 10) * 10;
        const rest = n % 10;
        return KZ_TENS[tens] + (rest === 0 ? '' : ` ${KZ_UNITS[rest]}`);
    }
    if (n < 1000) {
        const hundreds = Math.floor(n / 100);
        const rest = n % 100;
        return `${KZ_UNITS[hundreds]} жүз` + (rest === 0 ? '' : ` ${numberToWordsKk(rest)}`);
    }

    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    return `${KZ_UNITS[thousands]} мың` + (rest === 0 ? '' : ` ${numberToWordsKk(rest)}`);
}

function russianThousandNoun(n) {
    const lastTwo = n % 100;
    if (lastTwo >= 11 && lastTwo <= 14) return 'тысяч';

    const last = n % 10;
    if (last === 1) return 'тысяча';
    if (last >= 2 && last <= 4) return 'тысячи';
    return 'тысяч';
}

function numberToWordsRu(n, options = {}) {
    if (!Number.isInteger(n) || n < 0 || n >= 10000) return String(n);
    if (n < 10) {
        const units = options.gender === 'feminine' ? RU_THOUSAND_UNITS : RU_UNITS;
        return units[n];
    }
    if (n < 20) return RU_TEENS[n];
    if (n < 100) {
        const tens = Math.floor(n / 10) * 10;
        const rest = n % 10;
        return RU_TENS[tens] + (rest === 0 ? '' : ` ${numberToWordsRu(rest, options)}`);
    }
    if (n < 1000) {
        const hundreds = Math.floor(n / 100) * 100;
        const rest = n % 100;
        return RU_HUNDREDS[hundreds] + (rest === 0 ? '' : ` ${numberToWordsRu(rest, options)}`);
    }

    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const thousandPart = `${numberToWordsRu(thousands, { gender: 'feminine' })} ${russianThousandNoun(thousands)}`;
    return thousandPart + (rest === 0 ? '' : ` ${numberToWordsRu(rest, options)}`);
}

function dateNumberToWords(n, lang) {
    return lang === 'kk' ? numberToWordsKk(n) : numberToWordsRu(n);
}

export function processEmercomDates(text, lang) {
    return text.replace(DATE_RE, (match, day1Raw, day2Raw, monthRaw, yearRaw, suffixRaw) => {
        const dateLang = detectDateLangFromSuffix(suffixRaw, lang);
        const months = dateLang === 'kk' ? MONTHS_KK : MONTHS_RU;
        const yearWord = dateLang === 'kk' ? 'жыл' : 'год';
        const day1 = Number.parseInt(day1Raw, 10);
        const day2 = day2Raw ? Number.parseInt(day2Raw, 10) : null;
        const month = Number.parseInt(monthRaw, 10);

        if (!isValidDatePart(day1, day2, month)) {
            return match;
        }

        const monthName = months[month];
        const year = normalizeDateYear(yearRaw);
        if (year === null) {
            return match;
        }

        const dayPart = day2 === null
            ? dateNumberToWords(day1, dateLang)
            : `${dateNumberToWords(day1, dateLang)} ${dateNumberToWords(day2, dateLang)}`;
        const yearPart = dateNumberToWords(year, dateLang);

        return `${dayPart} ${monthName} ${yearPart} ${yearWord}`;
    });
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

    const preparedText = processEmercomDates(text, activeLang);
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
