/**
 * Video Generator Test Main Script
 */

const generateBtn = document.getElementById('generate-btn');
const glossInput = document.getElementById('gloss-input');
const resultContainer = document.getElementById('result-container');
const outputVideo = document.getElementById('output-video');
const downloadLink = document.getElementById('download-link');
const loadingArea = document.getElementById('loading-area');
const statusMessage = document.getElementById('status-message');
const progressBar = document.getElementById('progress-bar');
const progressPercentage = document.getElementById('progress-percentage');
const defaultBtnInner = generateBtn.innerHTML;

function setProgress(percent, message) {
    if (message && statusMessage.innerText !== message) {
        statusMessage.animate([
            { transform: 'translateY(10px)', opacity: 0 },
            { transform: 'translateY(0)', opacity: 1 }
        ], { duration: 400, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
        statusMessage.innerText = message;
    }
    progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
    if (progressPercentage) {
        progressPercentage.innerText = `${Math.round(percent)}%`;
    }
}

let activeEventSource = null;

generateBtn.addEventListener('click', async () => {
    const text = glossInput.value.trim();
    if (!text) {
        glossInput.focus();
        glossInput.style.borderColor = '#ef4444';
        glossInput.style.boxShadow = '0 0 0 3px rgba(239, 68, 68, 0.1)';
        setTimeout(() => {
            glossInput.style.borderColor = '';
            glossInput.style.boxShadow = '';
        }, 1500);
        return;
    }

    const glosses = text.split(/\s+/);

    // Update UI Loading State
    generateBtn.disabled = true;
    generateBtn.innerHTML = `
        <span class="spinner btn-spinner-disabled"></span>
        Генерация...
    `;
    
    // Hide previous results smoothly
    resultContainer.style.opacity = '0';
    setTimeout(() => {
        resultContainer.style.display = 'none';
        
        // Show loading area smoothly
        loadingArea.style.display = 'block';
        // Need a tiny delay to trigger CSS transition
        setTimeout(() => loadingArea.style.opacity = '1', 50);
    }, 400);

    setProgress(0, 'Устанавливаем нейро-контакт...');

    const bgColorSelect = document.getElementById('bg-color-select');

    try {
        // Fetch the v2 Async API
        const response = await fetch('/api/v1/video/generate-async', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                glosses: glosses,
                avatar: 'Aibek', // Default
                background: bgColorSelect ? bgColorSelect.value : 'white'
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Ошибка сервера');
        }

        const data = await response.json();
        const taskId = data.taskId;

        if (!taskId) throw new Error("Server didn't return a Task ID");

        // Close any previous SSE just in case
        if (activeEventSource) {
            activeEventSource.close();
        }

        // Open SSE Pipeline
        activeEventSource = new EventSource(`/api/v1/video/status/${taskId}`);

        activeEventSource.onmessage = (event) => {
            try {
                const sseData = JSON.parse(event.data);
                
                if (sseData.error) {
                    activeEventSource.close();
                    throw new Error(sseData.error);
                }

                setProgress(sseData.progress, sseData.message);

                // Finished condition
                if (sseData.progress >= 100 && sseData.downloadUrl) {
                    activeEventSource.close();
                    handleFinished(sseData.downloadUrl);
                }
            } catch (err) {
                console.error("SSE parse error", err);
            }
        };

        activeEventSource.onerror = (err) => {
            console.error("SSE Connection Error", err);
            activeEventSource.close();
            throw new Error("Потеряно соединение с сервером обновлений");
        };

    } catch (err) {
        handleError(err);
    }
});

function handleFinished(downloadUrl) {
    setProgress(100, 'Шедевр готов! Забирайте видео ✨');
    
    // Auto-download or Set video URL
    outputVideo.src = downloadUrl;
    downloadLink.href = downloadUrl;
    // Download link filename is generic here, server sets actual headers
    downloadLink.download = `signbridge_animation.webm`;

    setTimeout(() => {
        loadingArea.style.opacity = '0';
        setTimeout(() => {
            loadingArea.style.display = 'none';
            resultContainer.style.display = 'flex';
            // Smooth fade in
            setTimeout(() => resultContainer.style.opacity = '1', 50);
            
            // Reset Button
            generateBtn.disabled = false;
            generateBtn.innerHTML = defaultBtnInner;
        }, 400);
    }, 800);
}

function handleError(err) {
    console.error('Generation failed:', err);
    alert('Ошибка при генерации видео: ' + err.message);
    
    loadingArea.style.opacity = '0';
    setTimeout(() => loadingArea.style.display = 'none', 400);
    
    generateBtn.disabled = false;
    generateBtn.innerHTML = defaultBtnInner;
    
    if (activeEventSource) {
        activeEventSource.close();
    }
}
