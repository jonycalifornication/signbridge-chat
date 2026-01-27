/**
 * Simple Text-to-Speech Manager using window.speechSynthesis
 */
export class TTSManager {
    constructor() {
        this.synth = window.speechSynthesis;
        this.voices = [];
        this.selectedVoice = null;

        // Load voices
        this.loadVoices();
        if (speechSynthesis.onvoiceschanged !== undefined) {
            speechSynthesis.onvoiceschanged = () => this.loadVoices();
        }
    }

    loadVoices() {
        this.voices = this.synth.getVoices();
        // Try to find a Russian voice by default
        this.selectedVoice = this.voices.find(v => v.lang.startsWith('ru')) ||
            this.voices.find(v => v.lang.startsWith('en')) ||
            null;
        // console.log('[TTS] Voices loaded:', this.voices.length, 'Selected:', this.selectedVoice?.name);
    }

    /**
     * Speak text
     * @param {string} text 
     * @param {string} lang - Optional language code (e.g. 'ru-RU', 'kk-KZ')
     */
    speak(text, lang = 'ru-RU') {
        return new Promise((resolve, reject) => {
            if (!text) {
                resolve();
                return;
            }
            this.stop(); // Stop previous speech

            const utterance = new SpeechSynthesisUtterance(text);

            // Find best voice for lang
            const voice = this.voices.find(v => v.lang.startsWith(lang));
            if (voice) {
                utterance.voice = voice;
            } else if (this.selectedVoice) {
                utterance.voice = this.selectedVoice;
            }

            utterance.rate = 1.0;
            utterance.pitch = 1.0;

            utterance.onend = () => {
                // console.log('[TTS] Finished');
                resolve();
            };

            utterance.onerror = (e) => {
                console.error('[TTS] Error:', e);
                resolve(); // Resolve anyway to avoid hanging sequence
            };

            console.log(`[TTS] Speaking: "${text}"`);
            this.synth.speak(utterance);
        });
    }

    stop() {
        if (this.synth.speaking) {
            this.synth.cancel();
        }
    }
}

export const tts = new TTSManager();
