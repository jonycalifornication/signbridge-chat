/**
 * Timeline module for studio
 * Handles timeline markers and seeking
 * @module studio/timeline
 */

/**
 * Setup timeline markers for animation sequence
 * @param {Object} recorder - StudioRecorder instance
 */
export async function setupTimelineMarkers(recorder) {
    const markersContainer = document.getElementById('timeline-markers');
    markersContainer.innerHTML = '';

    recorder.animationTimestamps = [];
    let cumulativeDuration = 0;

    for (const gloss of recorder.glosses) {
        const clip = await recorder.loadAnimation(gloss);
        const duration = clip ? clip.duration : 1.0;

        recorder.animationTimestamps.push({
            gloss: gloss,
            startTime: cumulativeDuration,
            duration: duration,
            endTime: cumulativeDuration + duration
        });

        cumulativeDuration += duration + 0.3;
    }

    recorder.totalAnimationDuration = cumulativeDuration;

    // Create timeline markers
    recorder.animationTimestamps.forEach((anim, index) => {
        const marker = document.createElement('div');
        marker.className = 'timeline-marker';
        marker.dataset.gloss = anim.gloss;
        marker.dataset.index = index;
        marker.style.left = `${(anim.startTime / recorder.totalAnimationDuration) * 100}%`;

        marker.addEventListener('click', () => {
            recorder.seekToAnimation(index);
        });

        markersContainer.appendChild(marker);
    });
}

/**
 * Setup timeline interaction (dragging)
 * @param {Object} recorder - StudioRecorder instance
 */
export function setupTimelineInteraction(recorder) {
    const timeline = document.getElementById('timeline');
    const handle = document.getElementById('timeline-handle');
    let isDragging = false;

    const updateTimelineVisuals = (percent) => {
        document.getElementById('timeline-progress').style.width = `${percent}%`;
        handle.style.left = `${percent}%`;
    };

    const handleSeek = (clientX) => {
        const rect = timeline.getBoundingClientRect();
        const x = clientX - rect.left;
        const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
        updateTimelineVisuals(percent);

        // Find which animation to seek to
        const targetTime = (percent / 100) * recorder.totalAnimationDuration;
        for (let i = 0; i < recorder.animationTimestamps.length; i++) {
            const anim = recorder.animationTimestamps[i];
            if (targetTime >= anim.startTime && targetTime <= anim.endTime) {
                recorder.seekToAnimation(i);
                break;
            }
        }
    };

    timeline.addEventListener('mousedown', (e) => {
        isDragging = true;
        handleSeek(e.clientX);
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) handleSeek(e.clientX);
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    // Touch support
    timeline.addEventListener('touchstart', (e) => {
        isDragging = true;
        handleSeek(e.touches[0].clientX);
    });

    document.addEventListener('touchmove', (e) => {
        if (isDragging) handleSeek(e.touches[0].clientX);
    });

    document.addEventListener('touchend', () => {
        isDragging = false;
    });
}
