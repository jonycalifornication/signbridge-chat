/**
 * Mappings for Russian and Kazakh characters to VRM Viseme presets.
 * VRM 0.0/1.0 usually supports: aa, ih, ou, ee, oh.
 */
const CHAR_TO_VISEME = {
    // A / А -> aa
    'а': 'aa', 'a': 'aa', 'ә': 'aa', 'я': 'aa',

    // I / И / Ы / І -> ih
    'и': 'ih', 'й': 'ih', 'ы': 'ih', 'і': 'ih', 'i': 'ih', 'e': 'ih',

    // U / У / Ұ / Ү / Ю -> ou
    'у': 'ou', 'ұ': 'ou', 'ү': 'ou', 'ю': 'ou', 'u': 'ou', 'w': 'ou',

    // E / Е / Ё / Э -> ee
    'е': 'ee', 'ё': 'ee', 'э': 'ee',

    // O / О / Ө -> oh
    'о': 'oh', 'ө': 'oh', 'o': 'oh',

    // Consonants (mapped to nearest closed shape or neutral)
    // For many simple lip-syncs, silence or 'ih' (slightly open) or 'ou' (pucker) are used.
    // We'll leave them as null/neutral or map some to closed lips if available.
    // VRM doesn't always have a "closed" viseme other than neutral.
    // We will simulate "M", "B", "P" with 'ou' (briefly) or just neutral.
    'б': 'ou', 'п': 'ou', 'м': 'ou', 'в': 'ou', 'ф': 'ou',
    'b': 'ou', 'p': 'ou', 'm': 'ou', 'v': 'ou', 'f': 'ou',

    // Dental/Alveolar (Teeth visible): S, Z, D, T, N, L -> ih
    'с': 'ih', 'з': 'ih', 'д': 'ih', 'т': 'ih', 'ц': 'ih', 'ч': 'ih', 'щ': 'ih', 'н': 'ih',
    's': 'ih', 'z': 'ih', 'd': 'ih', 't': 'ih', 'n': 'ih',

    // L, R -> oh (Open but slightly different)
    'л': 'oh', 'р': 'oh',
    'l': 'oh', 'r': 'oh',

    // Velar (Back of throat): K, G, X -> aa (Open mouth)
    'к': 'aa', 'г': 'aa', 'х': 'aa', 'ж': 'aa', 'ш': 'aa',
    'k': 'aa', 'g': 'aa', 'h': 'aa'
};

/**
 * Generate a sequence of visemes from text.
 * @param {string} text - Input text (Russian/Kazakh/English)
 * @param {number} speed - Duration per character in ms
 * @returns {Array<{preset: string, duration: number, time: number}>} Timeline of visemes
 */
export function textToVisemeSequence(text, speed = 100) {
    const sequence = [];
    let currentTime = 0;
    const lowerText = text.toLowerCase();

    for (const char of lowerText) {
        if (char === ' ') {
            sequence.push({
                preset: 'neutral',
                duration: speed,
                time: currentTime,
                value: 0
            });
        } else {
            // Natural variation: not every mouth movement is 100% open
            // Vowels usually stronger (0.8 - 1.0), consonants weaker (0.5 - 0.8)
            let intensity = 0.8 + Math.random() * 0.2;

            if (CHAR_TO_VISEME[char]) {
                const preset = CHAR_TO_VISEME[char];

                // Consonants like 'm', 'b', 'p' (mapped to 'ou') shouldn't pucker too hard if it's just a closure
                if (['б', 'п', 'м', 'в', 'ф', 'b', 'p', 'm', 'v', 'f'].includes(char)) {
                    intensity = 0.5 + Math.random() * 0.3;
                }

                sequence.push({
                    preset: preset,
                    duration: speed,
                    time: currentTime,
                    value: intensity
                });
            } else {
                // Unknown character - generic movement
                sequence.push({
                    preset: Math.random() > 0.5 ? 'ih' : 'aa',
                    duration: speed,
                    time: currentTime,
                    value: 0.4 + Math.random() * 0.3 // Weaker movement for unknowns
                });
            }
        }
        currentTime += speed;
    }

    // Return to neutral at the end
    sequence.push({
        preset: 'neutral',
        duration: 100,
        time: currentTime
    });

    return sequence;
}
