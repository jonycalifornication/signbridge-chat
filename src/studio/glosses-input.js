/**
 * Glosses input module for studio
 * Handles animation sequence input and preview
 * @module studio/glosses-input
 */

import { CONFIG } from '../config.js';

/**
 * Setup glosses input and preview
 * @param {Object} recorder - StudioRecorder instance
 */
export function setupGlossesInput(recorder) {
    const glossesInput = document.getElementById('glosses-input');
    const glossesPreview = document.getElementById('glosses-preview');
    const videoControls = document.getElementById('video-controls');

    glossesInput.addEventListener('input', (e) => {
        const text = e.target.value.trim().toLowerCase();
        recorder.glosses = text.split(/\s+/).filter(g => g && CONFIG.animations[g]);

        if (recorder.glosses.length > 0) {
            glossesPreview.textContent = `✅ Готов к записи: ${recorder.glosses.join(' → ')} (${recorder.glosses.length} анимаций)`;
            glossesPreview.style.color = '#10b981';
            videoControls.style.display = 'flex';
            recorder.setupTimelineMarkers();
        } else {
            const availableAnims = Object.keys(CONFIG.animations).join(', ');
            glossesPreview.textContent = `Введите глоссы (доступные: ${availableAnims})`;
            glossesPreview.style.color = '#9ca3af';
            videoControls.style.display = 'none';
        }
    });
}
