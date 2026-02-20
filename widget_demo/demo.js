import { AvatarWidget } from '../src/widget/index.js';


class WidgetDemo {
    constructor() {
        this.jsonInput = document.getElementById('json-input');
        this.playBtn = document.getElementById('play-btn');

        this.widget = null;

        this.init();
    }

    init() {
        // Initialize widget
        // The widget/index.js might have auto-initialized if IDs were present.
        // We want to control our own instance for the demo if possible.
        // Since we are importing the class, we can just new it.
        // But first check if one already exists on window (from auto-init side effect)?
        // Actually, since we are using ES modules, the side effect in index.js runs once.
        // If our demo.html has "avatar-widget-container", index.js created one.
        // But our demo.html has "avatar-container". So index.js did NOT create one.

        this.widget = new AvatarWidget('avatar-container');

        // Event Listeners
        this.playBtn.addEventListener('click', () => this.play());

        // Presets
        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.jsonInput.value = JSON.stringify(JSON.parse(btn.dataset.preset), null, 2);
            });
        });
    }

    play() {
        try {
            const json = JSON.parse(this.jsonInput.value);

            // Play logic without TTS
            this.widget.setTTSManager(null);

            // Play
            this.widget.playFromJSON(json);

        } catch (e) {
            console.error('Invalid JSON:', e);
            alert('Invalid JSON! Check console.');
        }
    }
}

const demo = new WidgetDemo();
// Expose for debugging
window.demo = demo;
