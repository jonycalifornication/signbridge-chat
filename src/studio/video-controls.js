/**
 * Video controls module for studio
 * Handles play/pause/speed/loop controls
 * @module studio/video-controls
 */

/**
 * Setup video playback controls
 * @param {Object} recorder - StudioRecorder instance
 */
export function setupVideoControls(recorder) {
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const speedSelect = document.getElementById('speed-select');
    const loopBtn = document.getElementById('loop-btn');

    let isPlaying = false;
    let isPaused = false;
    let timerInterval = null;

    // Play button
    playBtn.addEventListener('click', async () => {
        if (!recorder.glosses || recorder.glosses.length === 0) {
            alert('Введите глоссы!');
            return;
        }

        if (isPlaying) return;

        isPlaying = true;
        isPaused = false;

        // Calculate total duration
        let totalDuration = recorder.totalAnimationDuration || 0;
        if (!totalDuration) {
            for (const gloss of recorder.glosses) {
                const clip = await recorder.loadAnimation(gloss);
                if (clip) totalDuration += clip.duration;
            }
            totalDuration += recorder.glosses.length * 0.3;
        }

        playBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';

        // Timeline update interval
        let currentAnimIndex = 0;
        timerInterval = setInterval(() => {
            let elapsed = 0;
            if (recorder.mixer && recorder.animationTimestamps) {
                const mixerTime = recorder.mixer.time;

                for (let i = 0; i < recorder.animationTimestamps.length; i++) {
                    if (i < currentAnimIndex) {
                        elapsed += recorder.animationTimestamps[i].duration + 0.3;
                    } else if (i === currentAnimIndex) {
                        elapsed += Math.min(mixerTime, recorder.animationTimestamps[i].duration);
                        break;
                    }
                }
            }

            const percent = Math.min((elapsed / totalDuration) * 100, 100);
            document.getElementById('timeline-progress').style.width = `${percent}%`;
            document.getElementById('timeline-handle').style.left = `${percent}%`;
        }, 100);

        // Play sequence
        do {
            for (let i = 0; i < recorder.glosses.length; i++) {
                if (!isPlaying || isPaused) break;

                currentAnimIndex = i;
                const gloss = recorder.glosses[i];
                await recorder.playAnimation(gloss);

                if (recorder.mixer) {
                    recorder.mixer.timeScale = recorder.playbackSpeed;
                }

                if (i < recorder.glosses.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }
        } while (recorder.isLooping && isPlaying);

        // Cleanup
        isPlaying = false;
        playBtn.style.display = 'flex';
        pauseBtn.style.display = 'none';
        clearInterval(timerInterval);
    });

    // Pause button
    pauseBtn.addEventListener('click', () => {
        if (!isPlaying) return;

        isPaused = !isPaused;

        if (isPaused) {
            if (recorder.mixer) recorder.mixer.timeScale = 0;
            pauseBtn.textContent = '▶';
            pauseBtn.title = 'Продолжить';
        } else {
            if (recorder.mixer) recorder.mixer.timeScale = recorder.playbackSpeed;
            pauseBtn.textContent = '⏸';
            pauseBtn.title = 'Пауза';
        }
    });

    // Speed control
    speedSelect.addEventListener('change', (e) => {
        recorder.playbackSpeed = parseFloat(e.target.value);
        if (recorder.mixer) {
            recorder.mixer.timeScale = recorder.playbackSpeed;
        }
    });

    // Loop button
    loopBtn.addEventListener('click', () => {
        recorder.isLooping = !recorder.isLooping;
        loopBtn.classList.toggle('active');
    });
}
