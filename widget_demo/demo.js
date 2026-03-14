import { AvatarWidget } from '../src/widget/index.js';
import { getApiClient } from '../src/utils/api-client.js';


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

        // Presets container
        this.presetsContainer = document.getElementById('presets-container');
        this.loadPresets();
    }

    async loadPresets() {
        try {
            const apiClient = getApiClient();
            const response = await fetch(`${apiClient.baseUrl}/cms/glosses?limit=500`, {
                headers: apiClient._getHeaders()
            });

            if (!response.ok) {
                this.presetsContainer.innerHTML = '<div style="color: red; font-size: 14px; text-align: center; padding: 10px;">Failed to load presets</div>';
                return;
            }

            const glosses = await response.json();
            
            // Group by category
            const grouped = {};
            for (const gloss of glosses) {
                const cat = gloss.category || 'general';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(gloss);
            }

            this.presetsContainer.innerHTML = '';
            
            for (const [category, items] of Object.entries(grouped)) {
                // Sort alphabetically
                items.sort((a, b) => a.name.localeCompare(b.name));
                
                const details = document.createElement('details');
                details.className = 'preset-category';
                details.style.marginBottom = '8px';
                details.style.border = '1px solid var(--border-light)';
                details.style.borderRadius = 'var(--radius-md)';
                details.style.backgroundColor = 'white';
                details.style.overflow = 'hidden';
                details.style.boxShadow = 'var(--shadow-sm)';
                details.style.transition = 'all 0.3s ease';

                const summary = document.createElement('summary');
                summary.style.padding = '12px 16px';
                summary.style.fontWeight = '600';
                summary.style.fontSize = '14px';
                summary.style.cursor = 'pointer';
                summary.style.userSelect = 'none';
                summary.style.backgroundColor = '#F8FAFC'; // slate-50
                summary.style.color = 'var(--text-main)';
                summary.style.display = 'flex';
                summary.style.alignItems = 'center';
                summary.style.justifyContent = 'space-between';
                summary.style.listStyle = 'none'; // hide default arrow
                
                // Add custom arrow marker and category name
                summary.innerHTML = `
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; background: rgba(79, 70, 229, 0.1); color: var(--primary); border-radius: 6px;">
                            ${category.charAt(0).toUpperCase()}
                        </span>
                        <span>${category.charAt(0).toUpperCase() + category.slice(1)}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span style="font-size: 12px; color: var(--text-tertiary); background: #E2E8F0; padding: 2px 8px; border-radius: 12px;">${items.length}</span>
                        <svg class="summary-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease; color: var(--text-tertiary);">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                `;
                
                // Toggle arrow rotation
                details.addEventListener('toggle', (e) => {
                    const arrow = summary.querySelector('.summary-arrow');
                    if (details.open) {
                        arrow.style.transform = 'rotate(180deg)';
                        details.style.boxShadow = 'var(--shadow-md)';
                        details.style.borderColor = 'var(--primary-light)';
                    } else {
                        arrow.style.transform = 'rotate(0deg)';
                        details.style.boxShadow = 'var(--shadow-sm)';
                        details.style.borderColor = 'var(--border-light)';
                    }
                });
                
                const grid = document.createElement('div');
                grid.className = 'preset-grid';
                grid.style.padding = '12px';
                grid.style.borderTop = '1px solid var(--border-light)';
                grid.style.display = 'grid';
                grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(130px, 1fr))';
                grid.style.gap = '8px';
                grid.style.animation = 'fadeIn 0.3s ease-out';
                
                for (const item of items) {
                    const btn = document.createElement('button');
                    btn.className = 'btn btn-secondary preset-btn';
                    btn.style.justifyContent = 'flex-start';
                    btn.style.textAlign = 'left';
                    btn.style.width = '100%';
                    btn.style.padding = '8px 12px';
                    btn.style.display = 'flex';
                    btn.style.alignItems = 'center';
                    btn.style.gap = '8px';
                    btn.style.border = '1px solid var(--border-light)';
                    btn.style.backgroundColor = 'white';
                    btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
                    
                    btn.innerHTML = `
                        <div style="font-weight: 500; font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${item.name}
                        </div>
                    `;
                    
                    // Add hover effect programmatically to ensure it works
                    btn.addEventListener('mouseenter', () => {
                        btn.style.backgroundColor = 'var(--primary-light)';
                        btn.style.borderColor = 'var(--primary)';
                        btn.style.color = 'var(--primary)';
                        btn.style.transform = 'translateY(-1px)';
                        btn.style.boxShadow = 'var(--shadow-sm)';
                    });
                    
                    btn.addEventListener('mouseleave', () => {
                        btn.style.backgroundColor = 'white';
                        btn.style.borderColor = 'var(--border-light)';
                        btn.style.color = 'var(--text-main)';
                        btn.style.transform = 'translateY(0)';
                        btn.style.boxShadow = '0 1px 2px rgba(0,0,0,0.02)';
                    });
                    
                    const presetData = {
                        animation: item.name,
                        text: item.name,
                        speed: 100
                    };
                    
                    btn.addEventListener('click', () => {
                        this.jsonInput.value = JSON.stringify(presetData, null, 2);
                        // Add a little click animation
                        btn.style.transform = 'scale(0.96)';
                        setTimeout(() => btn.style.transform = 'scale(1)', 150);
                    });
                    
                    grid.appendChild(btn);
                }
                
                details.appendChild(summary);
                details.appendChild(grid);
                this.presetsContainer.appendChild(details);
            }
            
        } catch (e) {
            console.error('Error loading presets:', e);
            this.presetsContainer.innerHTML = '<div style="color: red; font-size: 14px; text-align: center; padding: 10px;">Error loading presets</div>';
        }
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
