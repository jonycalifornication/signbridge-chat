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
    let debounceTimer;

    glossesInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        const text = e.target.value; // Store raw value to avoid cursor jumps? No, we just read it.

        debounceTimer = setTimeout(() => {
            const trimmedText = text.trim().toUpperCase(); // Normalize
            // Filter valid glosses
            recorder.glosses = trimmedText.split(/\s+/).filter(g => g && CONFIG.animations[g.toLowerCase()]);

            // Check for potential valid glosses being typed (optional UX improvement)
            const allWords = trimmedText.split(/\s+/);
            const validCount = recorder.glosses.length;

            if (validCount > 0) {
                // Update Preview
                glossesPreview.innerHTML = ''; // Clear

                // Show recognized badges
                recorder.glosses.forEach(g => {
                    const badge = document.createElement('span');
                    badge.style.cssText = 'background: #d1fae5; color: #065f46; padding: 2px 6px; border-radius: 99px; font-size: 11px; border: 1px solid #34d399;';
                    badge.textContent = g;
                    glossesPreview.appendChild(badge);
                });

                videoControls.style.display = 'block'; // Show controls
                recorder.setupTimelineMarkers();
            } else {
                glossesPreview.textContent = 'Введите известные глоссы (например: HELLO)';
                glossesPreview.style.color = '#9ca3af';
                videoControls.style.display = 'none';
            }
        }, 600); // 600ms Delay
    });
}
