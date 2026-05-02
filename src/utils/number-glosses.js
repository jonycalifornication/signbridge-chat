const MAX_COMPOUND_NUMBER = 999999;
const WORD_ADJACENT_RE = /[0-9A-Za-z_\u0400-\u04FF]/;
const NUMBER_JOINER_RE = /[./:\\-]/;
const RANGE_RE = /\d+\s*-\s*\d+/g;
const UNIT_SLASH_RE = /([A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]+)\s*\/\s*([A-Za-zА-Яа-яЁёӘәҒғҚқҢңӨөҰұҮүҺһІі]+)/g;

function underThousandToGlossParts(value) {
    const parts = [];

    if (value >= 100) {
        parts.push(String(Math.floor(value / 100) * 100));
        value %= 100;
    }

    if (value >= 20) {
        parts.push(String(Math.floor(value / 10) * 10));
        value %= 10;
    }

    if (value > 0) {
        parts.push(String(value));
    }

    return parts;
}

function normalizeDigitInput(value) {
    const raw = String(value ?? '').trim();
    if (!/^\d+$/.test(raw)) return null;
    return raw;
}

export function numberToGlossParts(value) {
    const raw = normalizeDigitInput(value);
    if (raw === null) return null;
    if (raw === '0') return ['0'];

    if (raw.length > 1 && raw.startsWith('0')) {
        return Array.from(raw);
    }

    const number = Number.parseInt(raw, 10);
    if (!Number.isSafeInteger(number)) {
        return Array.from(raw);
    }

    if (number === 0) return ['0'];
    if (number > MAX_COMPOUND_NUMBER) {
        return Array.from(raw);
    }

    if (number < 1000) {
        return underThousandToGlossParts(number);
    }

    const thousands = Math.floor(number / 1000);
    const rest = number % 1000;
    const parts = [];

    if (thousands === 1) {
        parts.push('1000');
    } else {
        parts.push(...underThousandToGlossParts(thousands), '1000');
    }

    if (rest > 0) {
        parts.push(...underThousandToGlossParts(rest));
    }

    return parts;
}

export function numberToGlossText(value) {
    const parts = numberToGlossParts(value);
    return parts ? parts.join(' ') : String(value ?? '');
}

function shouldExpandRange(source, offset, length) {
    const prev = source[offset - 1] || '';
    const next = source[offset + length] || '';

    if (WORD_ADJACENT_RE.test(prev) || WORD_ADJACENT_RE.test(next)) return false;
    if (prev === '.' || next === '.') return false;
    if (prev === '/' || next === '/') return false;

    return true;
}

export function expandNumericRangesInText(text) {
    const source = String(text ?? '');

    return source.replace(RANGE_RE, (match, offset) => {
        if (!shouldExpandRange(source, offset, match.length)) return match;
        const [start, end] = match.split(/\s*-\s*/);
        return `${numberToGlossText(start)} ${numberToGlossText(end)}`;
    });
}

export function expandSlashUnitsInText(text) {
    return String(text ?? '').replace(UNIT_SLASH_RE, '$1 $2');
}

function shouldExpandNumber(source, offset, length) {
    const prev = source[offset - 1] || '';
    const next = source[offset + length] || '';

    if (WORD_ADJACENT_RE.test(prev) || WORD_ADJACENT_RE.test(next)) return false;
    if (NUMBER_JOINER_RE.test(prev) || NUMBER_JOINER_RE.test(next)) return false;

    return true;
}

export function expandNumbersInText(text) {
    const source = String(text ?? '');

    return source.replace(/\d+/g, (match, offset) => {
        if (!shouldExpandNumber(source, offset, match.length)) return match;
        return numberToGlossText(match);
    });
}

export function normalizeNumericText(text) {
    return expandNumbersInText(expandSlashUnitsInText(expandNumericRangesInText(text)));
}
