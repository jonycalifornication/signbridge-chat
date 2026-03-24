import { AvatarWidget } from '../widget/index.js';
import { CONFIG } from '../config.js';

class HeadlessRenderer extends AvatarWidget {
    constructor(containerId) {
        super(containerId);
        window.rendererLoaded = true;
        console.log('[Headless] Renderer initialized and ready');
    }

    // Override to avoid UI elements if any
    setupUI() {
        console.log('[Headless] Skipping standard UI setup');
    }
    
    setupTextSelection() {
        console.log('[Headless] Skipping text selection setup');
    }
    
    setupWidgetToggle() {
        console.log('[Headless] Skipping widget toggle setup');
    }

    async renderToVideo(config) {
        const { glosses, avatar, background } = config;
        
        console.log(`[Headless] Starting render for avatar: ${avatar}, glosses: ${glosses}`);
        
        // 1. Setup avatar
        if (avatar && CONFIG.avatars[avatar]) {
            await this.loadModelByName(avatar);
        } else {
            await this.loadModelByName(CONFIG.defaultAvatar);
        }

        // 2. Set background color
        if (background === 'green') {
            document.body.style.backgroundColor = '#00ff00';
            this.renderer.setClearColor(0x00ff00, 1);
        } else if (background === 'transparent') {
            document.body.style.backgroundColor = 'transparent';
            this.renderer.setClearColor(0x000000, 0);
        } else if (background) {
            document.body.style.backgroundColor = background;
            this.renderer.setClearColor(background, 1);
        }

        // 3. Prepare MediaRecorder
        const stream = this.renderer.domElement.captureStream(30); // 30 FPS
        const recorder = new MediaRecorder(stream, {
            mimeType: 'video/webm;codecs=vp9'
        });
        
        const chunks = [];
        recorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
        };

        const recordingFinished = new Promise((resolve) => {
            recorder.onstop = () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            };
        });

        // 4. Start recording
        recorder.start();
        console.log('[Headless] Recording started');

        // 5. Play animations
        for (const gloss of glosses) {
            console.log(`[Headless] Playing gloss: ${gloss}`);
            await this.processTextSelection(gloss);
            // Optional: add a small delay between glosses if not handled by processTextSelection
        }

        // 6. Stop recording
        // Small buffer at the end
        await new Promise(r => setTimeout(r, 500));
        recorder.stop();
        console.log('[Headless] Recording stopped');

        return await recordingFinished;
    }
}

// Initialize and expose
const renderer = new HeadlessRenderer('render-container');

window.startHeadlessRender = async (config) => {
    try {
        return await renderer.renderToVideo(config);
    } catch (error) {
        console.error('[Headless] Render function error:', error);
        throw error;
    }
};
