import { AvatarWidget } from '../src/widget/index.js';
import { StreamPlayer } from './stream-player.js';
import { AnimationEncoder } from './animation-encoder.js';
import { CONFIG } from '../src/config.js';
import { loadAnimation } from '../src/utils/animation-loader.js';
import * as THREE from 'three';


class StreamDemo {
    constructor() {
        this.widget = new AvatarWidget('avatar-container');
        this.jsonOutput = document.getElementById('json-output');
        this.animSelect = document.getElementById('anim-select');
        this.statsDiv = document.getElementById('conversion-stats');

        this.init();
    }

    async init() {
        // Wait for widget to be ready (load default avatar)
        // We can hook into a promise or just wait a bit.
        // AvatarWidget doesn't expose a "ready" promise easily, but loadModelByName is async.
        // The widget loads default avatar in constructor via side effect or explicit call? 
        // Index.js constructor calls `loadModelByName(CONFIG.defaultAvatar)`.

        // Populate Animation Select
        Object.keys(CONFIG.animations).forEach(name => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            this.animSelect.appendChild(opt);
        });

        // Event Listeners
        document.getElementById('convert-btn').addEventListener('click', () => this.convert());
        document.getElementById('play-stream-btn').addEventListener('click', () => this.playStream());
        document.getElementById('copy-btn').addEventListener('click', () => {
            this.jsonOutput.select();
            document.execCommand('copy');
        });
    }

    /** 
     * Helper to resolve standard bone name ('hips') to actual node name on current avatar
     */
    getBoneNodeName(standardBoneName) {
        if (!this.widget.currentVrm) return null;

        // 1. Try Humanoid (Best way)
        const humanoid = this.widget.currentVrm.humanoid;
        if (humanoid) {
            // three-vrm method: getNormalizedBoneNode(name)
            const node = humanoid.getNormalizedBoneNode(standardBoneName);
            if (node) return node.name;
        }

        // 2. Fallback (if raw names are used)
        return standardBoneName;
    }

    async convert() {
        const animName = this.animSelect.value;
        if (!animName) return;

        const url = CONFIG.animations[animName];
        if (!url) return;

        console.log(`Loading animation: ${animName} from ${url}`);
        this.statsDiv.textContent = 'Loading...';

        try {
            // 1. Load Animation (Retargeted to current avatar)
            // loadAnimation(url, vrm) returns a Clip that targets the VRM's nodes
            if (!this.widget.currentVrm) {
                alert("Avatar not loaded yet!");
                return;
            }

            const clip = await loadAnimation(url, this.widget.currentVrm);

            // 2. Encode to Slim Format
            this.statsDiv.textContent = 'Encoding...';

            // We pass a resolver so Encoder knows which Node Name corresponds to 'hips'
            const resolver = (name) => this.getBoneNodeName(name);
            const encodedData = AnimationEncoder.encodeFromClip(clip, 30, resolver);

            // 3. Generate Output JSON
            const output = {
                text: animName, // Just use name as text for demo
                animationData: encodedData
            };

            const jsonStr = JSON.stringify(output, null, 2);
            this.jsonOutput.value = jsonStr;

            // Stats
            const originalSize = JSON.stringify(clip.toJSON()).length; // Rough existing JSON size
            const newSize = jsonStr.length;
            const ratio = ((1 - newSize / originalSize) * 100).toFixed(1);

            this.statsDiv.innerHTML = `
                <b>Optimization Results:</b><br>
                Original JSON (approx): ${(originalSize / 1024).toFixed(2)} KB<br>
                Streamed JSON: ${(newSize / 1024).toFixed(2)} KB<br>
                Reduction: ${ratio}%
            `;

        } catch (e) {
            console.error(e);
            this.statsDiv.textContent = 'Error: ' + e.message;
        }
    }

    async playStream() {
        const jsonStr = this.jsonOutput.value;
        if (!jsonStr) {
            alert("No JSON data!");
            return;
        }

        try {
            const data = JSON.parse(jsonStr);

            // 1. Decode to Clip
            // We pass resolver so Decoder knows which Node Name to target
            const resolver = (name) => this.getBoneNodeName(name);
            const clip = StreamPlayer.decodeToClip(data.animationData, resolver);

            if (!clip) {
                console.error("Failed to decode clip");
                return;
            }

            console.log("Decoded Clip:", clip);

            // 2. Play Clip on Widget
            // AvatarWidget doesn't have a direct 'playClip' method yet, 
            // but we can access mixer directly or add logic.
            // Let's use mixer directly for this demo.

            if (this.widget.mixer) {
                // Stop previous
                this.widget.mixer.stopAllAction();

                const action = this.widget.mixer.clipAction(clip);
                action.reset();
                action.setLoop(THREE.LoopOnce);
                action.clampWhenFinished = true;
                action.play();


            }

        } catch (e) {
            console.error(e);
            alert("Invalid JSON data");
        }
    }
}

new StreamDemo();
