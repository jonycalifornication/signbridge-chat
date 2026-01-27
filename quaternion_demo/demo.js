import * as THREE from 'three';
import { loadVRMModel } from '../src/utils/vrm-loader.js';
import { loadAnimation } from '../src/utils/animation-loader.js';
import { CONFIG } from '../src/config.js';

class QuaternionDemo {
    constructor() {
        this.container = document.getElementById('canvas-container');
        this.tableBody = document.querySelector('#quaternion-table tbody');
        this.slider = document.getElementById('animation-slider');
        this.timeDisplay = document.getElementById('time-display');
        this.select = document.getElementById('animation-select');
        this.playPauseBtn = document.getElementById('play-pause-btn');

        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.currentVrm = null;
        this.mixer = null;
        this.currentAction = null;
        this.clock = new THREE.Clock();
        this.isPlaying = false;
        this.duration = 0;

        this.initThree();
        this.initUI();
        this.loadDefaultAvatar();
    }

    initThree() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xf0f0f0);

        // Grid
        const gridHelper = new THREE.GridHelper(10, 10);
        this.scene.add(gridHelper);

        // Axes
        const axesHelper = new THREE.AxesHelper(2);
        this.scene.add(axesHelper);

        // Camera
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        const aspect = width / height;

        this.camera = new THREE.PerspectiveCamera(30, aspect, 0.1, 20.0);
        this.camera.position.set(0, 1.4, 4.0); // Front view
        this.camera.lookAt(0, 1.0, 0);

        // Lights
        // Main Key Light
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(1.0, 2.0, 3.0);
        this.scene.add(dirLight);

        // Fill Light (from opposite side)
        const fillLight = new THREE.DirectionalLight(0xe0e0e0, 1.0);
        fillLight.position.set(-1.0, 1.0, 2.0);
        this.scene.add(fillLight);

        // Back Light (rim light)
        const backLight = new THREE.DirectionalLight(0xffffff, 1.0);
        backLight.position.set(0.0, 2.0, -2.0);
        this.scene.add(backLight);

        // Hemisphere Light (sky/ground ambient)
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        hemiLight.position.set(0, 5, 0);
        this.scene.add(hemiLight);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.container.appendChild(this.renderer.domElement);

        this.controls = null; // Add OrbitControls if needed, but keeping it simple for now

        // Resize handler
        window.addEventListener('resize', () => this.onResize());

        // Render loop
        this.animate();
    }

    initUI() {
        // Populate Select
        for (const [name, path] of Object.entries(CONFIG.animations)) {
            const option = document.createElement('option');
            option.value = path; // Store path directly
            option.textContent = name;
            this.select.appendChild(option);
        }

        this.select.addEventListener('change', (e) => this.loadAnimation(e.target.value));

        // Slider logic
        this.slider.addEventListener('input', (e) => {
            this.isPlaying = false;
            this.updatePlayButton();
            if (this.mixer) {
                const time = parseFloat(e.target.value);
                this.mixer.setTime(time);
                this.updateTable(); // Update data while scrubbing
                this.updateTimeDisplay(time);
            }
        });

        // Play/Pause logic
        this.playPauseBtn.addEventListener('click', () => {
            this.isPlaying = !this.isPlaying;
            this.updatePlayButton();
        });

        // Step controls
        // Step controls
        document.getElementById('prev-frame').addEventListener('click', () => this.stepFrame(-0.033)); // ~30fps
        document.getElementById('next-frame').addEventListener('click', () => this.stepFrame(0.033));

        // Export controls
        document.getElementById('export-frame-btn').addEventListener('click', () => this.exportFrameCSV());
        document.getElementById('export-anim-btn').addEventListener('click', () => this.exportAnimationCSV());
    }

    updatePlayButton() {
        this.playPauseBtn.textContent = this.isPlaying ? 'Pause' : 'Play';
        this.playPauseBtn.style.background = this.isPlaying ? '#D97706' : '#4F46E5';
    }

    stepFrame(delta) {
        this.isPlaying = false;
        this.updatePlayButton();
        if (this.mixer && this.duration > 0) {
            // Use slider value as base time because it tracks action.time (0..duration)
            // whereas mixer.time accumulates indefinitely.
            let currentTime = parseFloat(this.slider.value) || 0;
            let newTime = currentTime + delta;

            // Handle wrapping
            if (newTime > this.duration) newTime = 0;
            if (newTime < 0) newTime = this.duration;

            this.mixer.setTime(newTime);
            this.slider.value = newTime;
            this.updateTable();
            this.updateTimeDisplay(newTime);
        }
    }

    exportFrameCSV() {
        if (!this.currentVrm || !this.currentVrm.humanoid) return;

        const timestamp = this.currentAction ? this.currentAction.time.toFixed(4) : "0.0000";
        let csvContent = "Time,Bone,X,Y,Z,W\n";

        const humanoid = this.currentVrm.humanoid;
        const availableBones = Object.keys(humanoid.humanBones).sort();

        availableBones.forEach(boneName => {
            const node = humanoid.getNormalizedBoneNode(boneName);
            if (node) {
                const q = node.quaternion;
                csvContent += `${timestamp},${boneName},${q.x.toFixed(6)},${q.y.toFixed(6)},${q.z.toFixed(6)},${q.w.toFixed(6)}\n`;
            }
        });

        this.downloadCSV(csvContent, `frame_${timestamp}.csv`);
    }

    exportAnimationCSV() {
        if (!this.mixer || !this.currentAction || !this.currentVrm) {
            alert("No animation loaded!");
            return;
        }

        const wasPlaying = this.isPlaying;
        this.isPlaying = false;
        this.updatePlayButton();

        // 1. Prepare Header (Wide Format)
        // Time, Bone1_X, Bone1_Y, Bone1_Z, Bone1_W, Bone2_X ...
        const humanoid = this.currentVrm.humanoid;
        const availableBones = Object.keys(humanoid.humanBones).sort();

        let header = "Time";
        availableBones.forEach(bone => {
            header += `,${bone}_X,${bone}_Y,${bone}_Z,${bone}_W`;
        });
        let csvContent = header + "\n";

        // 2. Iterate Frames
        const step = 1 / 30; // 30fps
        const originalTime = this.currentAction.time;

        // Temporarily unclamp to allow full range sampling strictly?? 
        // Actually mixer.setTime handles it.

        for (let t = 0; t <= this.duration; t += step) {
            this.mixer.setTime(t);
            // Must update VRM to apply animations to bones
            this.currentVrm.update(0);

            let row = `${t.toFixed(4)}`;

            availableBones.forEach(boneName => {
                const node = humanoid.getNormalizedBoneNode(boneName);
                if (node) {
                    const q = node.quaternion;
                    row += `,${q.x.toFixed(6)},${q.y.toFixed(6)},${q.z.toFixed(6)},${q.w.toFixed(6)}`;
                } else {
                    row += ",0,0,0,1"; // Fallback/Identity
                }
            });

            csvContent += row + "\n";
        }

        // Restore state
        this.mixer.setTime(originalTime);
        this.currentVrm.update(0); // Restore pose
        if (wasPlaying) {
            this.isPlaying = true;
            this.updatePlayButton();
        }

        this.downloadCSV(csvContent, `animation_export.csv`);
    }

    downloadCSV(content, filename) {
        const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    }

    async loadDefaultAvatar() {
        console.log('Loading default avatar...');
        try {
            // Reusing the project's loadVRMModel utility which handles VRMLoaderPlugin
            this.currentVrm = await loadVRMModel(CONFIG.avatars[CONFIG.defaultAvatar], CONFIG);
            this.scene.add(this.currentVrm.scene);

            // Setup mixer
            this.mixer = new THREE.AnimationMixer(this.currentVrm.scene);

            console.log('Avatar loaded');
            this.generateTableRows();
        } catch (error) {
            console.error('Failed to load avatar:', error);
        }
    }

    generateTableRows() {
        this.tableBody.innerHTML = '';
        if (!this.currentVrm || !this.currentVrm.humanoid) return;

        const humanoid = this.currentVrm.humanoid;
        const availableBones = Object.keys(humanoid.humanBones);

        // Define categories
        const categories = {
            'Body & Head': ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'jaw', 'leftEye', 'rightEye'],
            'Left Arm': ['leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand', 'leftThumbProximal', 'leftThumbIntermediate', 'leftThumbDistal', 'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal', 'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal', 'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal', 'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal'],
            'Right Arm': ['rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand', 'rightThumbProximal', 'rightThumbIntermediate', 'rightThumbDistal', 'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal', 'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal', 'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal', 'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal'],
            'Legs': ['leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes']
        };

        const miscBones = [];

        // Helper to check if bone belongs to category
        const addedBones = new Set();

        for (const [categoryName, boneList] of Object.entries(categories)) {
            // Filter bones that actually exist in the model
            const bonesInCategory = boneList.filter(b => availableBones.includes(b));

            if (bonesInCategory.length > 0) {
                // Add Header
                const headerRow = document.createElement('tr');
                headerRow.className = 'category-header';
                headerRow.innerHTML = `<td colspan="5" style="background: #e5e7eb; font-weight: bold; padding: 8px 12px; color: #374151;">${categoryName}</td>`;
                this.tableBody.appendChild(headerRow);

                // Add Bones
                bonesInCategory.forEach(boneName => {
                    const node = humanoid.getNormalizedBoneNode(boneName);
                    if (node) {
                        this.createRow(boneName);
                        addedBones.add(boneName);
                    }
                });
            }
        }

        // Add Remaining Misc Bones
        availableBones.forEach(boneName => {
            if (!addedBones.has(boneName)) {
                if (miscBones.length === 0) {
                    const headerRow = document.createElement('tr');
                    headerRow.className = 'category-header';
                    headerRow.innerHTML = `<td colspan="5" style="background: #e5e7eb; font-weight: bold; padding: 8px 12px; color: #374151;">Misc</td>`;
                    this.tableBody.appendChild(headerRow);
                }
                const node = humanoid.getNormalizedBoneNode(boneName);
                if (node) {
                    this.createRow(boneName);
                    miscBones.push(boneName);
                }
            }
        });
    }

    createRow(boneName) {
        const tr = document.createElement('tr');
        tr.dataset.bone = boneName;
        tr.style.cursor = 'pointer'; // Make it look clickable
        tr.innerHTML = `
            <td style="font-weight: 500; padding-left: 20px;">${boneName}</td>
            <td class="q-x">0.000</td>
            <td class="q-y">0.000</td>
            <td class="q-z">0.000</td>
            <td class="q-w">1.000</td>
        `;
        // Add click listener
        tr.addEventListener('click', () => this.selectBone(boneName));
        this.tableBody.appendChild(tr);
    }

    selectBone(boneName) {
        // 1. Remove old helper
        if (this.selectedBoneHelper) {
            // It might be parented to a bone, so remove from its parent
            if (this.selectedBoneHelper.parent) {
                this.selectedBoneHelper.parent.remove(this.selectedBoneHelper);
            }
            this.selectedBoneHelper = null;
        }

        // 2. Update Table UI
        const rows = this.tableBody.querySelectorAll('tr');
        rows.forEach(r => r.classList.remove('selected-row'));
        const selectedRow = this.tableBody.querySelector(`tr[data-bone="${boneName}"]`);
        if (selectedRow) selectedRow.classList.add('selected-row');

        // 3. Add new helper
        if (!this.currentVrm || !this.currentVrm.humanoid) return;
        const node = this.currentVrm.humanoid.getNormalizedBoneNode(boneName);
        if (node) {
            // Create a Group for the highlighter
            this.selectedBoneHelper = new THREE.Group();

            // A. Axes Helper (Orientation)
            const axes = new THREE.AxesHelper(0.2);
            axes.material.depthTest = false;
            axes.material.depthWrite = false;
            axes.renderOrder = 999;
            this.selectedBoneHelper.add(axes);

            // B. Joint Marker (Yellow Sphere)
            const sphereGeo = new THREE.SphereGeometry(0.04, 16, 16);
            const sphereMat = new THREE.MeshBasicMaterial({
                color: 0xffff00,
                wireframe: true,
                depthTest: false,
                depthWrite: false,
                transparent: true,
                opacity: 0.8
            });
            const sphere = new THREE.Mesh(sphereGeo, sphereMat);
            sphere.renderOrder = 999;
            this.selectedBoneHelper.add(sphere);

            // C. Pointer/Arrow (Cone pointing down to the bone)
            const coneGeo = new THREE.ConeGeometry(0.02, 0.08, 8);
            const coneMat = new THREE.MeshBasicMaterial({ color: 0xff00ff, depthTest: false, depthWrite: false }); // Magenta pointer
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.set(0, 0.12, 0); // Local Y up
            cone.rotation.x = Math.PI; // Point down
            cone.renderOrder = 999;
            this.selectedBoneHelper.add(cone);

            node.add(this.selectedBoneHelper);
            console.log(`Selected bone (enhanced): ${boneName}`);
        }
    }

    async loadAnimation(url) {
        if (!this.currentVrm) return;
        console.log('Loading animation:', url);

        try {
            // Use the project's utility which handles VRM re-targeting
            // We need to import it first: import { loadAnimation } from '../utils/animation-loader.js';
            // Note: I will update the imports in the next step, but let's assume it's available.

            const clip = await loadAnimation(url, this.currentVrm);

            if (clip) {
                // Stop current
                this.mixer.stopAllAction();

                // Play new
                const action = this.mixer.clipAction(clip);
                action.play();

                this.currentAction = action;
                this.duration = clip.duration;

                // Update Slider Controls
                this.slider.max = this.duration;
                this.slider.value = 0;
                this.mixer.setTime(0); // Reset to start

                this.updateTimeDisplay(0);
                this.updateTable();
            }

        } catch (e) {
            console.error('Anim load exception:', e);
        }
    }

    updateTable() {
        if (!this.currentVrm || !this.currentVrm.humanoid) return;

        const rows = this.tableBody.querySelectorAll('tr[data-bone]'); // Only select rows with data-bone
        rows.forEach(tr => {
            const boneName = tr.dataset.bone;
            const node = this.currentVrm.humanoid.getNormalizedBoneNode(boneName);

            if (node) {
                // Get quaternion (local rotation)
                const q = node.quaternion;

                // Update cells
                tr.querySelector('.q-x').textContent = q.x.toFixed(4);
                tr.querySelector('.q-y').textContent = q.y.toFixed(4);
                tr.querySelector('.q-z').textContent = q.z.toFixed(4);
                tr.querySelector('.q-w').textContent = q.w.toFixed(4);
            }
        });
    }

    updateTimeDisplay(time) {
        this.timeDisplay.textContent = `${time.toFixed(2)} / ${this.duration.toFixed(2)}`;
    }

    onResize() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        if (this.mixer) {
            if (this.isPlaying) {
                this.mixer.update(delta);
                // Sync slider to mixer time
                // Note: time wraps around if looping, or stays at end if clamped.
                // mixer.time is cumulative time for the mixer, not the action time.
                // We should track action time.
                if (this.currentAction) {
                    const time = this.currentAction.time;
                    this.slider.value = time;
                    this.updateTimeDisplay(time);
                }
                this.updateTable();
            } else {
                // Even if paused, we might want to update mixer if we need manual scrubbing effects 
                // (handled in slider input event)
            }
        }

        if (this.currentVrm) {
            this.currentVrm.update(delta);
        }

        this.renderer.render(this.scene, this.camera);
    }
}

// Start
new QuaternionDemo();
