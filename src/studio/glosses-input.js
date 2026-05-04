/**
 * Glosses input module for studio
 * Handles text input, CSV-based gloss conversion, and color-coded preview badges
 * @module studio/glosses-input
 */

import { CONFIG } from '../config.js';
import { loadDictionary, textToGlosses, detectDictLang, isDictionaryLoaded } from '../utils/gloss-dictionary.js';

// Badge color styles
const BADGE_STYLES = {
    // Green: matched in CSV + animation exists in config
    matched: 'background: #d1fae5; color: #065f46; border: 1px solid #34d399;',
    // Blue: matched in CSV but no animation file (will be dactyl of the GLOSS)
    dactylGloss: 'background: #dbeafe; color: #1e40af; border: 1px solid #60a5fa;',
    // Grey: not found in CSV (will be dactyl of the ORIGINAL word)
    unmatched: 'background: #f3f4f6; color: #6b7280; border: 1px solid #d1d5db;',
};

/**
 * Setup glosses input and preview
 * @param {Object} recorder - StudioRecorder instance
 */
export function setupGlossesInput(recorder) {
    const glossesInput = document.getElementById('glosses-input');
    const glossesPreview = document.getElementById('glosses-preview');
    const videoControls = document.getElementById('video-controls');
    let debounceTimer;
    let dictionaryReady = false;

    // Pre-load default dictionary (Kazakh)
    loadDictionary('kk')
        .then(() => { dictionaryReady = true; })
        .catch(err => console.warn('[Studio] Failed to preload CSV dictionary:', err));

    glossesInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const text = e.target.value;

        debounceTimer = setTimeout(async () => {
            const trimmedText = text.trim();
            if (!trimmedText) {
                glossesPreview.textContent = 'Введите текст для перевода в жестовый язык';
                glossesPreview.style.color = '#9ca3af';
                videoControls.style.display = 'none';
                recorder.glosses = [];
                return;
            }

            // Detect language and load dictionary if needed
            const lang = detectDictLang(trimmedText);
            if (!isDictionaryLoaded() || !dictionaryReady) {
                try {
                    await loadDictionary(lang);
                    dictionaryReady = true;
                } catch (err) {
                    console.warn('[Studio] Dictionary load failed:', err);
                }
            }

            // Convert text to glosses via CSV dictionary
            const { tokens } = textToGlosses(trimmedText);

            // Build the glosses array for the recorder
            const finalGlosses = [];
            
            // Build preview badges
            glossesPreview.innerHTML = '';
            glossesPreview.style.color = '';

            if (tokens.length > 0) {
                tokens.forEach(token => {
                    const badge = document.createElement('span');
                    const glossLower = token.gloss.toLowerCase();
                    const hasAnimation = !!CONFIG.animations[glossLower];

                    let style;
                    let title;
                    let displayText = token.gloss.toUpperCase();

                    if (token.matched && hasAnimation) {
                        // CASE 1: Matched + Animation exists (GREEN)
                        style = BADGE_STYLES.matched;
                        title = `✅ Жест найден: ${token.original} → ${token.gloss}`;
                        finalGlosses.push(glossLower);
                    } else if (token.matched && !hasAnimation) {
                        // CASE 2: Matched + NO Animation (BLUE)
                        // Use dactyl of the GLOSS name
                        style = BADGE_STYLES.dactylGloss;
                        title = `ℹ️ Глосс найден, будет дактиль глосса: ${token.original} → ${token.gloss}`;
                        displayText = token.gloss.toUpperCase().split('').join(' ');
                        
                        // Push each letter of the gloss as a separate animation item
                        finalGlosses.push(...token.gloss.toLowerCase().split(''));
                    } else {
                        // CASE 3: Not matched in CSV (GREY)
                        // Use dactyl of the ORIGINAL word
                        style = BADGE_STYLES.unmatched;
                        title = `❓ Слово не найдено в словаре: ${token.original}`;
                        
                        // Push each letter of the original word
                        finalGlosses.push(...token.original.toLowerCase().split(''));
                    }

                    badge.style.cssText = style + ' padding: 4px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: default; display: inline-block; margin: 4px; transition: all 0.2s;';
                    badge.textContent = displayText;
                    badge.title = title;
                    glossesPreview.appendChild(badge);
                });

                recorder.glosses = finalGlosses;
                videoControls.style.display = 'block';
                recorder.setupTimelineMarkers();
            } else {
                glossesPreview.textContent = 'Введите текст для перевода в жестовый язык';
                glossesPreview.style.color = '#9ca3af';
                videoControls.style.display = 'none';
            }
        }, 600);
    });
}

