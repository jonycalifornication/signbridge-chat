/**
 * Background controls module for studio
 * Handles background color/image selection
 * @module studio/background-controls
 */

/**
 * Setup background selector controls
 * @param {Object} recorder - StudioRecorder instance
 */
export function setupBackgroundControls(recorder) {
    const bgButtons = document.querySelectorAll('.bg-btn');

    bgButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            bgButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const bgType = btn.dataset.bg;
            recorder.setBackground(bgType);

            if (bgType === 'custom') {
                document.getElementById('bg-file').click();
            }
        });
    });

    // Custom background file
    const bgFile = document.getElementById('bg-file');
    bgFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) recorder.setCustomBackground(file);
    });

    // Color picker
    const colorPicker = document.getElementById('color-picker');
    colorPicker.addEventListener('input', (e) => {
        const color = e.target.value;
        recorder.setBackground('color', color);

        bgButtons.forEach(b => b.classList.remove('active'));
        document.querySelector('[data-bg="color"]').classList.add('active');
    });
}
