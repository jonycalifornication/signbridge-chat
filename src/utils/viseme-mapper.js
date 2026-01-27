/**
 * Mappings for Russian and Kazakh characters to VRM Viseme presets.
 * VRM 0.0/1.0 usually supports: aa, ih, ou, ee, oh.
 */
const CHAR_TO_VISEME = {
    // A / А -> aa
    'а': 'aa', 'a': 'aa', 'ә': 'aa', 'я': 'aa', 'h': 'aa',

    // I / И / Ы / І -> ih
    'и': 'ih', 'й': 'ih', 'ы': 'ih', 'і': 'ih', 'i': 'ih', 'e': 'ih', 'y': 'ih',

    // U / У / Ұ / Ү / Ю -> ou
    'у': 'ou', 'ұ': 'ou', 'ү': 'ou', 'ю': 'ou', 'u': 'ou', 'w': 'ou',

    // E / Е / Ё / Э -> ee
    'е': 'ee', 'ё': 'ee', 'э': 'ee',

    // O / О / Ө -> oh
    'о': 'oh', 'ө': 'oh', 'o': 'oh',

    // Consonants mappings
    // M, B, P -> Neutral (Closed Lips) to simulate closure before/after vowels
    'б': 'neutral', 'п': 'neutral', 'м': 'neutral',
    'b': 'neutral', 'p': 'neutral', 'm': 'neutral',

    // F, V -> ih (Teeth visible, slightly open) works better than 'ou' (pucker)
    'в': 'ih', 'ф': 'ih',
    'v': 'ih', 'f': 'ih',

    // Dental/Alveolar (Teeth visible): S, Z, D, T, N, L, C -> ih
    'с': 'ih', 'з': 'ih', 'д': 'ih', 'т': 'ih', 'ц': 'ih', 'ч': 'ih', 'щ': 'ih', 'н': 'ih',
    's': 'ih', 'z': 'ih', 'd': 'ih', 't': 'ih', 'n': 'ih', 'c': 'ih',

    // L, R -> oh (Open but slightly different shape)
    'л': 'oh', 'р': 'oh',
    'l': 'oh', 'r': 'oh',

    // Velar/Guttural: K, G, X -> aa (Open mouth often) or ih (if tighter)
    // Relaxed 'aa' usually fits context of speech
    'к': 'aa', 'г': 'aa', 'х': 'aa', 'ж': 'aa', 'ш': 'aa',
    'k': 'aa', 'g': 'aa', 'x': 'aa', 'j': 'aa'
};

const VOWELS = new Set(['а', 'a', 'ә', 'я', 'и', 'й', 'ы', 'і', 'i', 'e', 'у', 'ұ', 'ү', 'ю', 'u', 'w', 'е', 'ё', 'э', 'о', 'ө', 'o']);

/**
 * Generate a sequence of visemes from text.
 * @param {string} text - Input text (Russian/Kazakh/English)
 * @param {number} baseSpeed - Base duration per character in ms (average)
 * @returns {Array<{preset: string, duration: number, time: number}>} Timeline of visemes
 */
export function textToVisemeSequence(text, baseSpeed = 100) {
    const sequence = [];
    let currentTime = 0;
    const lowerText = text.toLowerCase();

    for (const char of lowerText) {
        if (char === ' ') {
            sequence.push({
                preset: 'neutral',
                duration: baseSpeed * 0.8, // Pauses are slightly shorter than full beat
                time: currentTime,
                value: 0
            });
            currentTime += baseSpeed * 0.8;
            continue;
        }

        // Determine if vowel
        const isVowel = VOWELS.has(char);

        // Calculate Duration
        // Vowels hold longer (1.2x), Consonants shorter (0.6x) to create rhythm
        let duration = isVowel ? baseSpeed * 1.5 : baseSpeed * 0.6;

        // Intensity
        // Vowels are more open (0.7 - 1.0)
        // Consonants vary. Closed consonants (m, b, p) are 0 intensity (neutral).
        let intensity = isVowel ? 0.85 : 0.6;

        let preset = CHAR_TO_VISEME[char] || 'aa';

        // Specific overrides
        if (['б', 'п', 'м', 'b', 'p', 'm'].includes(char)) {
            preset = 'neutral';
            intensity = 0;
            // Duration for closure needs to be perceivable but short
            duration = baseSpeed * 0.5;
        }

        // Add randomness for natural jitter (less robotic)
        // but keep it subtle
        if (preset !== 'neutral') {
            intensity += (Math.random() * 0.2 - 0.1); // +/- 0.1
            if (intensity > 1) intensity = 1;
            if (intensity < 0.2) intensity = 0.2;
        }

        sequence.push({
            preset: preset,
            duration: duration,
            time: currentTime,
            value: intensity
        });

        currentTime += duration;
    }

    // Return to neutral slightly after
    sequence.push({
        preset: 'neutral',
        duration: 200,
        time: currentTime
    });

    return sequence;
}
