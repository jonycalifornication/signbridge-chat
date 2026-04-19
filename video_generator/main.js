import { loadDictionary, textToGlosses, detectDictLang } from './emercom-glosser.js';

console.log('🚀 SignBridge Loading System Components...');

// --- i18n ---
const LANG_KEY = 'signbridge_lang';
let currentLang = localStorage.getItem(LANG_KEY) || 'kk';

const i18n = {
    kk: {
        backLink: 'Панельге',
        newChat: 'Жаңа аударма',
        modeNormal: 'Қарапайым',
        modeEmercom: 'ТЖД',
        themeToggle: 'Түнгі режим',
        themeToggleLight: 'Күндізгі режим',
        langToggle: 'Қазақша',
        welcomeText: 'Кез келген тілде мәтін жазыңыз, 3D-аватар оны ым тіліне аударады.',
        inputPlaceholder: 'Фразаны енгізіңіз...',
        avatarSelect: 'Кейіпкерді таңдау',
        avatarName: 'Айназ',
        avatarDesc: 'Негізгі модель',
        comingSoon: 'Көбірек аватарлар жақында...',
        bgSelect: 'Фон түсі',
        colorWhite: 'Ақ',
        colorGreen: 'Жасыл хромакей',
        colorDark: 'Қараңғы',
        colorTransparent: 'Мөлдір',
        chipHello: '👋 Сәлем',
        chipThanks: '🙏 Рахмет',
        chipHowAreYou: '😊 Қалдарыңыз қалай?',
        chipHelp: '🆘 Көмектесіңіз',
        chipBye: '✌️ Сау болыңыз',
        chipTextHello: 'Сәлем',
        chipTextThanks: 'Рахмет',
        chipTextHowAreYou: 'Қалдарыңыз қалай?',
        chipTextHelp: 'Көмектесіңіз',
        chipTextBye: 'Сау болыңыз',
        newChatTitle: 'Жаңа чат',
        rename: 'Атын өзгерту',
        deleteChat: 'Чатты жою',
        download: 'Жүктеу',
        genTime: '⚡ ${sec} секундта жасалды',
        glossLabel: 'Глосстар:',
        videoExpired: '⏳ Видео орын үнемдеу үшін жойылды',
        regenerate: '🔄 Қайта жасау',
        stepTranslate: 'Аударма',
        stepAnimate: 'Анимация',
        stepRender: 'Рендер',
        stepDone: 'Дайын',
        statusInit: 'Нейро-байланыс орнатылуда...',
        error: '❌ Қате: ',
        tabReady: '✅ Видео дайын! — SignBridge',
        taskExpired: '⏳ Тапсырма мерзімі аяқталды',
        reconnecting: 'Қайта қосылу (${count}/${max})...',
        connectionLost: '⚠️ Байланыс үзілді... (бетті жаңартыңыз)',
    },
    ru: {
        backLink: 'В панель',
        newChat: 'Новый перевод',
        modeNormal: 'Обычный',
        modeEmercom: 'МЧС',
        themeToggle: 'Тёмная тема',
        themeToggleLight: 'Светлая тема',
        langToggle: 'Русский',
        welcomeText: 'Напишите текст на любом языке, и 3D-аватар переведет его на язык жестов.',
        inputPlaceholder: 'Введите фразу...',
        avatarSelect: 'Выбор персонажа',
        avatarName: 'Айназ',
        avatarDesc: 'Базовая модель',
        comingSoon: 'Скоро будет больше аватаров...',
        bgSelect: 'Цвет фона',
        colorWhite: 'Белый',
        colorGreen: 'Зеленый хромакей',
        colorDark: 'Темный',
        colorTransparent: 'Прозрачный',
        chipHello: '👋 Привет',
        chipThanks: '🙏 Спасибо',
        chipHowAreYou: '😊 Как дела?',
        chipHelp: '🆘 Помогите',
        chipBye: '✌️ До свидания',
        chipTextHello: 'Привет',
        chipTextThanks: 'Спасибо',
        chipTextHowAreYou: 'Как дела?',
        chipTextHelp: 'Помогите',
        chipTextBye: 'До свидания',
        newChatTitle: 'Новый чат',
        rename: 'Переименовать',
        deleteChat: 'Удалить чат',
        download: 'Скачать',
        genTime: '⚡ Сгенерировано за ${sec}с',
        glossLabel: 'Глоссы:',
        videoExpired: '⏳ Видео удалено для экономии места',
        regenerate: '🔄 Сгенерировать заново',
        stepTranslate: 'Перевод',
        stepAnimate: 'Анимация',
        stepRender: 'Рендер',
        stepDone: 'Готово',
        statusInit: 'Устанавливаем нейро-контакт...',
        error: '❌ Ошибка: ',
        tabReady: '✅ Видео готово! — SignBridge',
        taskExpired: '⏳ Задача истекла',
        reconnecting: 'Переподключение (${count}/${max})...',
        connectionLost: '⚠️ Связь прервана... (обновите страницу)',
    }
};

function t(key, params) {
    let str = i18n[currentLang]?.[key] || i18n.kk[key] || key;
    if (params) {
        for (const [k, v] of Object.entries(params)) {
            str = str.replace('${' + k + '}', v);
        }
    }
    return str;
}

function applyLanguage(lang) {
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    document.documentElement.lang = lang;

    // Update all data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        el.textContent = t(el.dataset.i18n);
    });
    // Update placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        el.placeholder = t(el.dataset.i18nPlaceholder);
    });
    // Update titles
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        el.title = t(el.dataset.i18nTitle);
    });
    // Update phrase chip data-text
    const chipMap = { chipHello: 'chipTextHello', chipThanks: 'chipTextThanks', chipHowAreYou: 'chipTextHowAreYou', chipHelp: 'chipTextHelp', chipBye: 'chipTextBye' };
    document.querySelectorAll('.phrase-chip[data-i18n]').forEach(chip => {
        const textKey = chipMap[chip.dataset.i18n];
        if (textKey) chip.dataset.text = t(textKey);
    });
    // Update lang toggle button flag + text
    const langBtn = document.getElementById('lang-toggle');
    if (langBtn) {
        const flag = langBtn.querySelector('span:first-child');
        if (flag) flag.textContent = lang === 'kk' ? '🇰🇿' : '🇷🇺';
    }
    updateThemeToggleText();
}

function updateThemeToggleText() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const el = document.querySelector('#theme-toggle [data-i18n="themeToggle"]');
    if (el) el.textContent = isDark ? t('themeToggleLight') : t('themeToggle');
}

const getEl = (id) => {
    const el = document.getElementById(id);
    if (!el) {
        console.warn(`[DOM] Warning: Element #${id} not found in current view.`);
    } else {
        console.log(`[DOM] Found: #${id}`);
    }
    return el;
};

const chatMessages = getEl('chat-messages');
const glossInput = getEl('gloss-input');
const sendBtn = getEl('send-btn');
const newChatBtn = getEl('new-chat-btn');
const historyList = getEl('history-list');
const welcomeScreen = getEl('welcome-screen');
const bgSelectorBtn = getEl('bg-selector-btn');
const bgPopover = getEl('bg-popover');
const colorOptions = document.querySelectorAll('.color-option');
const avatarSelectorBtn = getEl('avatar-selector-btn');
const avatarPopover = getEl('avatar-popover');
const themeToggle = getEl('theme-toggle');
const langToggle = getEl('lang-toggle');
const langFlag = getEl('lang-flag');
const modeToggle = getEl('mode-toggle');
const charCounter = getEl('char-counter');
const scrollBottomBtn = getEl('scroll-bottom-btn');

console.log(`[Init] Colors found: ${colorOptions.length}`);

const HISTORY_KEY = 'signbridge_sessions_var2';
const THEME_KEY = 'signbridge_theme';
let sessions = []; // Will be loaded from server
let currentSessionId = null;
let selectedBgColor = 'white';
let selectedAvatar = 'Aibek'; // Internal name for backend
let currentMode = 'normal'; // 'normal' | 'emercom'

const MAX_TEXT_LENGTH = 500;

// Track active SSE connections for cleanup
const activeEventSources = new Set();

// --- Typing Effect Engine ---
const TypingEngine = {
    _active: null,
    type(node, text, speed = 30) {
        // Cancel any ongoing typing
        if (this._active) clearInterval(this._active);
        node.textContent = '';
        let i = 0;
        this._active = setInterval(() => {
            if (i < text.length) {
                node.textContent += text[i];
                i++;
            } else {
                clearInterval(this._active);
                this._active = null;
            }
        }, speed);
    },
    stop() {
        if (this._active) { clearInterval(this._active); this._active = null; }
    }
};

// --- Particle Background ---
function initParticles() {
    const canvas = document.getElementById('particle-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let width, height, particles, mouseX = -1000, mouseY = -1000;
    const PARTICLE_COUNT = 60;
    const CONNECT_DIST = 120;
    const MOUSE_RADIUS = 150;

    function resize() {
        width = canvas.width = canvas.offsetWidth;
        height = canvas.height = canvas.offsetHeight;
    }

    function createParticles() {
        particles = [];
        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * width,
                y: Math.random() * height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.5,
                r: 2 + Math.random() * 2
            });
        }
    }

    function draw() {
        ctx.clearRect(0, 0, width, height);
        const isDark = document.body.getAttribute('data-theme') === 'dark';
        const dotColor = isDark ? 'rgba(148,163,184,' : 'rgba(100,116,139,';
        const lineColor = isDark ? 'rgba(148,163,184,' : 'rgba(100,116,139,';

        for (const p of particles) {
            // Mouse repulsion
            const dx = p.x - mouseX, dy = p.y - mouseY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < MOUSE_RADIUS && dist > 0) {
                const force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS * 0.8;
                p.vx += (dx / dist) * force;
                p.vy += (dy / dist) * force;
            }

            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.99;
            p.vy *= 0.99;

            if (p.x < 0) p.x = width;
            if (p.x > width) p.x = 0;
            if (p.y < 0) p.y = height;
            if (p.y > height) p.y = 0;

            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = dotColor + '0.5)';
            ctx.fill();
        }

        // Lines between nearby particles
        for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const d = Math.sqrt(dx * dx + dy * dy);
                if (d < CONNECT_DIST) {
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.strokeStyle = lineColor + (0.15 * (1 - d / CONNECT_DIST)) + ')';
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                }
            }
        }

        requestAnimationFrame(draw);
    }

    canvas.parentElement?.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouseX = e.clientX - rect.left;
        mouseY = e.clientY - rect.top;
    });
    canvas.parentElement?.addEventListener('mouseleave', () => { mouseX = -1000; mouseY = -1000; });

    window.addEventListener('resize', () => { resize(); });
    resize();
    createParticles();
    draw();
}

// --- Ripple Effect ---
function addRipple(btn, e) {
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function sanitizeUrl(url) {
    if (typeof url !== 'string') return '';
    if (url.startsWith('/') || url.startsWith('https://') || url.startsWith('http://')) {
        return url.replace(/"/g, '&quot;');
    }
    return '';
}

// --- Init ---
async function init() {
    console.log('[System] Initializing theme...');
    initTheme();
    console.log('[System] Initializing language...');
    applyLanguage(currentLang);
    console.log('[System] Initializing particles...');
    initParticles();
    console.log('[System] Initializing sessions from server...');
    await initSession();
    console.log('[System] Setting up auto-resize...');
    setupAutoResize();
}


// --- Listeners ---
// Background Popover
if (bgSelectorBtn) {
    bgSelectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (avatarPopover) avatarPopover.classList.remove('show');
        if (avatarSelectorBtn) avatarSelectorBtn.classList.remove('active');
        if (bgPopover) bgPopover.classList.toggle('show');
        bgSelectorBtn.classList.toggle('active');
    });
}


// Avatar Popover
if (avatarSelectorBtn) {
    avatarSelectorBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (bgPopover) bgPopover.classList.remove('show');
        if (bgSelectorBtn) bgSelectorBtn.classList.remove('active');
        if (avatarPopover) avatarPopover.classList.toggle('show');
        avatarSelectorBtn.classList.toggle('active');
    });
}


document.addEventListener('click', (e) => {
    if (bgPopover && bgSelectorBtn && !bgPopover.contains(e.target) && !bgSelectorBtn.contains(e.target)) {
        bgPopover.classList.remove('show');
        bgSelectorBtn.classList.remove('active');
    }
    if (avatarPopover && avatarSelectorBtn && !avatarPopover.contains(e.target) && !avatarSelectorBtn.contains(e.target)) {
        avatarPopover.classList.remove('show');
        avatarSelectorBtn.classList.remove('active');
    }
});

// Avatar card selection
document.querySelectorAll('.avatar-card[data-avatar]').forEach(card => {
    card.addEventListener('click', () => {
        selectedAvatar = card.dataset.avatar;
        document.querySelectorAll('.avatar-card').forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        if (avatarPopover) avatarPopover.classList.remove('show');
        if (avatarSelectorBtn) avatarSelectorBtn.classList.remove('active');
    });
});

colorOptions.forEach(btn => {
    btn.addEventListener('click', () => {
        selectedBgColor = btn.dataset.color;
        colorOptions.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        bgPopover.classList.remove('show');
        bgSelectorBtn.classList.remove('active');
    });
});

// Mode toggle (normal / emercom)
if (modeToggle) {
    modeToggle.querySelectorAll('.mode-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentMode = btn.dataset.mode;
            modeToggle.querySelectorAll('.mode-toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            console.log(`[Mode] Switched to: ${currentMode}`);
            if (currentMode === 'emercom') {
                loadDictionary('ru').catch(e => console.warn('[Emercom] Preload ru failed:', e));
                loadDictionary('kk').catch(e => console.warn('[Emercom] Preload kk failed:', e));
            }
        });
    });
}

glossInput.addEventListener('input', () => {
    if (glossInput.value.length > MAX_TEXT_LENGTH) {
        glossInput.value = glossInput.value.substring(0, MAX_TEXT_LENGTH);
    }
    langFlag.innerText = detectLanguage(glossInput.value);
    sendBtn.disabled = glossInput.value.trim().length === 0;
    updateCharCounter();
});

glossInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) triggerGenerate();
    }
});

sendBtn.addEventListener('click', (e) => {
    if (!sendBtn.disabled) addRipple(sendBtn, e);
    triggerGenerate();
});
newChatBtn.addEventListener('click', startNewSession);

// Quick phrase chips
document.querySelectorAll('.phrase-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        glossInput.value = chip.dataset.text;
        langFlag.innerText = detectLanguage(glossInput.value);
        sendBtn.disabled = false;
        triggerGenerate();
    });
});

// --- Theme Logic ---
function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    if (savedTheme) {
        document.body.setAttribute('data-theme', savedTheme);
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.body.setAttribute('data-theme', 'dark');
    }
}

themeToggle.addEventListener('click', () => {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    const newTheme = isDark ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem(THEME_KEY, newTheme);
    updateThemeToggleText();
});

// --- Language Toggle ---
if (langToggle) {
    langToggle.addEventListener('click', () => {
        applyLanguage(currentLang === 'kk' ? 'ru' : 'kk');
    });
}

// --- Language Logic ---
function detectLanguage(text) {
    if (!text.trim()) return '';
    const kazakhPattern = /[әғқңөұүһіӘҒҚҢӨҰҮҺІ]/;
    const cyrillicPattern = /[а-яА-ЯёЁ]/;
    const latinPattern = /[a-zA-Z]/;
    if (kazakhPattern.test(text)) return '🇰🇿';
    if (cyrillicPattern.test(text)) return '🇷🇺';
    if (latinPattern.test(text)) return '🇺🇸';
    return '🌐';
}

// --- Sound Engine (Web Audio API) ---
const SoundFX = {
    ctx: null,
    init() {
        if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    },
    playPop() {
        this.init();
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
    },
    playChime() {
        this.init();
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(this.ctx.destination);
        osc1.type = 'sine';
        osc2.type = 'sine';
        osc1.frequency.setValueAtTime(1046.50, this.ctx.currentTime); // C6
        osc2.frequency.setValueAtTime(1318.51, this.ctx.currentTime); // E6
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.05, this.ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 1.2);
        osc1.start();
        osc2.start();
        osc1.stop(this.ctx.currentTime + 1.2);
        osc2.stop(this.ctx.currentTime + 1.2);
    }
};

// --- Session Logic ---
let _saveTimer = null;
function saveSessions() {
    renderSidebar();
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(_flushSessions, 300);
}

async function _flushSessions() {
    _saveTimer = null;
    try {
        await fetch('/api/v1/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(sessions)
        });
    } catch (e) {
        console.error('[Storage] Save failed:', e);
    }
}

// Prevent data loss on tab close
window.addEventListener('beforeunload', () => {
    if (_saveTimer) {
        clearTimeout(_saveTimer);
        _saveTimer = null;
        navigator.sendBeacon('/api/v1/sessions', new Blob([JSON.stringify(sessions)], { type: 'application/json' }));
    }
});


function _uid(prefix) {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return prefix + crypto.randomUUID();
    return prefix + 'xxxx-xxxx-4xxx-yxxx-xxxx'.replace(/[xy]/g, c => {
        const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }) + '-' + Date.now().toString(36);
}

function startNewSession() {
    currentSessionId = _uid('sess_');
    sessions.unshift({ id: currentSessionId, title: t('newChatTitle'), messages: [] });
    if (sessions.length > 1000) sessions = sessions.slice(0, 1000);
    saveSessions();

    clearChatUI();
    selectedBgColor = 'white';
    colorOptions.forEach(b => {
        if(b.dataset.color === 'white') b.classList.add('active');
        else b.classList.remove('active');
    });
    glossInput.focus();
}

async function initSession() {
    const localData = localStorage.getItem(HISTORY_KEY);
    try {
        const res = await fetch('/api/v1/sessions');
        const data = await res.json();
        
        if (data && data.length > 0) {
            sessions = data;
            if (localData) localStorage.removeItem(HISTORY_KEY);
        } else if (localData) {
            console.log('[Storage] Migrating localStorage to server...');
            sessions = JSON.parse(localData);
            try {
                await _flushSessions();
                localStorage.removeItem(HISTORY_KEY);
            } catch(e) {
                console.error('[Storage] Migration save failed, keeping localStorage');
            }
        }
    } catch (e) {
        console.error('[Storage] Init failed:', e);
        if (localData) sessions = JSON.parse(localData);
    }

    if (sessions.length === 0) startNewSession();
    else loadSession(sessions[0].id);
}


function loadSession(id) {
    currentSessionId = id;
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    clearChatUI();
    if (session.messages.length > 0) {
        welcomeScreen.style.opacity = '0';
        welcomeScreen.style.visibility = 'hidden';
        session.messages.forEach(msg => {
            if (msg.role === 'user') appendUserMessageToDOM(msg.content);
            else if (msg.role === 'assistant') appendAssistantMessageToDOM(msg);
        });
        scrollToBottom();
    }
    renderSidebar();
}

function deleteSession(e, id) {
    e.stopPropagation();
    sessions = sessions.filter(s => s.id !== id);
    saveSessions();
    if (sessions.length === 0) startNewSession();
    else if (currentSessionId === id) loadSession(sessions[0].id);
}

function renameSession(e, id) {
    e.stopPropagation();
    const session = sessions.find(s => s.id === id);
    if (!session) return;
    const btn = e.currentTarget;
    const titleDiv = btn.closest('.history-item').querySelector('.history-item-title');
    titleDiv.contentEditable = "true";
    titleDiv.style.background = "var(--border-color)";
    titleDiv.style.outline = "2px solid var(--text-muted)";
    titleDiv.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(titleDiv);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);

    const saveRename = () => {
        titleDiv.contentEditable = "false";
        titleDiv.style.background = "transparent";
        titleDiv.style.outline = "none";
        const newTitle = titleDiv.innerText.trim().slice(0, 100);
        if (newTitle && newTitle !== session.title) {
            session.title = newTitle;
            saveSessions();
        } else titleDiv.innerText = session.title;
    };
    titleDiv.onblur = saveRename;
    titleDiv.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); titleDiv.blur(); } };
}

// --- UI Logic ---
function renderSidebar() {
    historyList.innerHTML = '';
    sessions.forEach(session => {
        if (session.messages.length === 0 && session.id !== currentSessionId) return;
        const div = document.createElement('div');
        div.className = `history-item ${session.id === currentSessionId ? 'active' : ''}`;
        div.onclick = () => { if (session.id !== currentSessionId) loadSession(session.id); };
        div.innerHTML = `
            <div class="history-item-title">${escapeHtml(session.title)}</div>
            <div class="history-item-actions">
                <button class="action-btn rename-btn" title="${t('rename')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="action-btn del" title="${t('deleteChat')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path></svg>
                </button>
            </div>
        `;
        div.querySelector('.rename-btn').addEventListener('click', (e) => renameSession(e, session.id));
        div.querySelector('.action-btn.del').addEventListener('click', (e) => deleteSession(e, session.id));
        historyList.appendChild(div);
    });
}

function closeAllEventSources() {
    activeEventSources.forEach(es => {
        try { es.close(); } catch(e) {}
    });
    activeEventSources.clear();
}

function clearChatUI() {
    closeAllEventSources();
    chatMessages.innerHTML = '';
    if (sessions.find(s => s.id === currentSessionId)?.messages.length === 0) {
        welcomeScreen.style.opacity = '1';
        welcomeScreen.style.visibility = 'visible';
    } else {
        welcomeScreen.style.opacity = '0';
        welcomeScreen.style.visibility = 'hidden';
    }
}

function autoResizeHeight() {
    glossInput.style.height = 'auto';
    glossInput.style.height = (glossInput.scrollHeight) + 'px';
}

function setupAutoResize() {
    glossInput.addEventListener('input', autoResizeHeight);
    autoResizeHeight();
}

function scrollToBottom() {
    chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: 'smooth' });
}

// --- Character Counter ---
function updateCharCounter() {
    const len = glossInput.value.length;
    charCounter.textContent = `${len}/${MAX_TEXT_LENGTH}`;
    charCounter.classList.toggle('warn', len >= 400 && len < 470);
    charCounter.classList.toggle('danger', len >= 470);
}

// --- Scroll-to-bottom button ---
let _unreadCount = 0;
function updateScrollBtn() {
    const el = chatMessages;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    scrollBottomBtn.classList.toggle('visible', !atBottom);
    if (atBottom) {
        _unreadCount = 0;
        const badge = scrollBottomBtn.querySelector('.scroll-badge');
        if (badge) badge.remove();
    }
}
chatMessages.addEventListener('scroll', updateScrollBtn);
scrollBottomBtn.addEventListener('click', () => {
    scrollToBottom();
    _unreadCount = 0;
    const badge = scrollBottomBtn.querySelector('.scroll-badge');
    if (badge) badge.remove();
});
function bumpUnread() {
    const el = chatMessages;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (atBottom) return;
    _unreadCount++;
    let badge = scrollBottomBtn.querySelector('.scroll-badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'scroll-badge';
        scrollBottomBtn.appendChild(badge);
    }
    badge.textContent = _unreadCount;
}

function appendUserMessageToDOM(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `<div class="bubble">${escapeHtml(text)}</div>`;
    chatMessages.appendChild(row);
    scrollToBottom();
}

function appendAssistantMessageToDOM(msgData) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = msgData.msgId;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    
    // Show gloss preview for emercom mode messages
    if (msgData.mode === 'emercom' && msgData.glosses) {
        renderGlossPreviewSimple(bubble, msgData.glosses);
    }

    if (msgData.videoUrl) {
        renderVideoToBubble(bubble, msgData.videoUrl, bubble.querySelector('.gloss-preview'));
    } else if (msgData.taskId) {
        // Re-attach to ongoing task
        attachTaskListener(msgData.taskId, msgData.msgId, bubble);
    } else if (msgData.error) {
        const gpHtml = bubble.querySelector('.gloss-preview')?.outerHTML || '';
        bubble.innerHTML = gpHtml + `<span class="error-text">${t('error')}${escapeHtml(msgData.error)}</span>`;
    }
    
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
    return bubble;
}

function renderVideoToBubble(bubble, url, preserveGlossPreview, durationSec) {
    const safeUrl = sanitizeUrl(url);
    const glossHtml = preserveGlossPreview ? preserveGlossPreview.outerHTML : '';
    const timeHtml = durationSec ? `<div class="gen-time">${t('genTime', { sec: durationSec })}</div>` : '';
    bubble.innerHTML = glossHtml + `
        <div class="video-wrapper">
            <div class="video-container">
                <video controls autoplay loop playsinline><source src="${safeUrl}" type="video/webm"></video>
                <a href="${safeUrl}" download="signbridge_video.webm" class="download-btn">${t('download')}</a>
            </div>
        </div>
        <div class="speed-controls">
            <button class="speed-btn" data-speed="0.5">0.5x</button>
            <button class="speed-btn active" data-speed="1">1x</button>
            <button class="speed-btn" data-speed="1.5">1.5x</button>
            <button class="speed-btn" data-speed="2">2x</button>
        </div>
    ` + timeHtml;
    // Speed control listeners
    const video = bubble.querySelector('video');
    bubble.querySelectorAll('.speed-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            bubble.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (video) video.playbackRate = parseFloat(btn.dataset.speed);
        });
    });
    // Handle video load failure (file deleted by LRU cleanup)
    const source = bubble.querySelector('source');
    if (source) {
        source.addEventListener('error', () => {
            const row = bubble.closest('.message-row');
            const msgId = row?.id;
            if (!msgId) return;
            const session = sessions.find(s => s.id === currentSessionId);
            const msg = session?.messages.find(m => m.msgId === msgId);
            const glosses = msg?.glosses || '';
            const wrapper = bubble.querySelector('.video-wrapper');
            const speedControls = bubble.querySelector('.speed-controls');
            if (wrapper) {
                const block = document.createElement('div');
                block.className = 'expired-block';
                block.innerHTML = `<p>${t('videoExpired')}</p>`;
                const btn = document.createElement('button');
                btn.className = 'regenerate-btn';
                btn.textContent = t('regenerate');
                btn.addEventListener('click', () => regenerateVideo(msgId, glosses));
                block.appendChild(btn);
                wrapper.replaceWith(block);
                if (speedControls) speedControls.remove();
            }
        }, { once: true });
    }
}

function renderGlossPreview(bubble, tokens) {
    const div = document.createElement('div');
    div.className = 'gloss-preview';
    div.innerHTML = '<span class="gloss-label">' + t('glossLabel') + '</span> ' +
        tokens.map(tk => {
            const cls = tk.matched ? 'matched' : 'unmatched';
            return `<span class="gloss-token ${cls}" title="${escapeHtml(tk.original)}">${escapeHtml(tk.gloss)}</span>`;
        }).join(' ');
    bubble.prepend(div);
}

function renderGlossPreviewSimple(bubble, glossText) {
    const div = document.createElement('div');
    div.className = 'gloss-preview';
    div.innerHTML = '<span class="gloss-label">' + t('glossLabel') + '</span> ' + escapeHtml(glossText);
    bubble.prepend(div);
}

function renderSkeleton(bubble) {
    // Preserve gloss preview if present
    const glossPreview = bubble.querySelector('.gloss-preview');
    const glossHtml = glossPreview ? glossPreview.outerHTML : '';
    bubble.innerHTML = glossHtml + `
        <div class="typing-dots"><span></span><span></span><span></span></div>
        <div class="skeleton-container">
            <div class="skeleton-shimmer"></div>
            <div class="status-container">
                <div class="stepper">
                    <div class="step-node active" data-step="0">1</div>
                    <div class="step-line"><div class="step-line-fill"></div></div>
                    <div class="step-node" data-step="1">2</div>
                    <div class="step-line"><div class="step-line-fill"></div></div>
                    <div class="step-node" data-step="2">3</div>
                    <div class="step-line"><div class="step-line-fill"></div></div>
                    <div class="step-node" data-step="3">✓</div>
                </div>
                <div class="step-labels">
                    <span class="step-label active" data-step="0">${t('stepTranslate')}</span>
                    <span class="step-label" data-step="1">${t('stepAnimate')}</span>
                    <span class="step-label" data-step="2">${t('stepRender')}</span>
                    <span class="step-label" data-step="3">${t('stepDone')}</span>
                </div>
                <span class="spinner"></span>
                <span class="status-text-anim">${t('statusInit')}</span>
            </div>
        </div>
    `;
}

function updateStepper(bubble, progress) {
    // Map progress to step: 0-19 → step 0, 20-49 → step 1, 50-99 → step 2, 100 → step 3
    let currentStep;
    if (progress >= 100) currentStep = 3;
    else if (progress >= 50) currentStep = 2;
    else if (progress >= 20) currentStep = 1;
    else currentStep = 0;

    const nodes = bubble.querySelectorAll('.step-node');
    const labels = bubble.querySelectorAll('.step-label');
    const lines = bubble.querySelectorAll('.step-line-fill');

    nodes.forEach((node, i) => {
        node.classList.remove('active', 'done');
        if (i < currentStep) { node.classList.add('done'); node.innerHTML = '✓'; }
        else if (i === currentStep) node.classList.add('active');
    });
    labels.forEach((label, i) => {
        label.classList.remove('active', 'done');
        if (i < currentStep) label.classList.add('done');
        else if (i === currentStep) label.classList.add('active');
    });
    lines.forEach((line, i) => {
        if (i < currentStep) line.style.width = '100%';
        else if (i === currentStep) {
            // Partial fill within the current step
            const stepRanges = [[0, 20], [20, 50], [50, 100]];
            if (i < stepRanges.length) {
                const [start, end] = stepRanges[i];
                const pct = Math.min(100, ((progress - start) / (end - start)) * 100);
                line.style.width = Math.max(0, pct) + '%';
            }
        } else line.style.width = '0%';
    });
}

function spawnConfetti(container) {
    const confettiContainer = document.createElement('div');
    confettiContainer.className = 'confetti-container';
    container.style.position = 'relative';
    container.appendChild(confettiContainer);
    const colors = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#a855f7', '#ec4899'];
    for (let i = 0; i < 30; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = Math.random() * 100 + '%';
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = (Math.random() * 0.5) + 's';
        piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        piece.style.width = (5 + Math.random() * 6) + 'px';
        piece.style.height = (5 + Math.random() * 6) + 'px';
        confettiContainer.appendChild(piece);
    }
    setTimeout(() => confettiContainer.remove(), 2000);
}

function regenerateVideo(msgId, glosses) {
    const row = document.getElementById(msgId);
    if (!row) return;
    const bubble = row.querySelector('.bubble');
    // Use original bg/avatar from message, not current global state
    const session = sessions.find(s => s.id === currentSessionId);
    const msg = session?.messages.find(m => m.msgId === msgId);
    const bg = msg?.bgColor || selectedBgColor;
    const av = msg?.avatar || selectedAvatar;
    const md = msg?.mode || currentMode;
    SoundFX.playPop();
    triggerFetch(glosses, msgId, bubble, bg, av, md);
}

async function triggerGenerate() {
    const text = glossInput.value.trim();
    if (!text) return;
    glossInput.value = '';
    langFlag.innerText = '';
    sendBtn.disabled = true;
    autoResizeHeight();
    const session = sessions.find(s => s.id === currentSessionId);
    if (!session) return;
    if (session.messages.length === 0) {
        session.title = text.substring(0, 30) + (text.length > 30 ? '...' : '');
    }
    session.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    appendUserMessageToDOM(text);
    SoundFX.playPop();
    bumpUnread();

    // Emercom mode: convert text → glosses
    let glossText = text;
    let glossTokens = null;
    if (currentMode === 'emercom') {
        try {
            const lang = detectDictLang(text);
            await loadDictionary(lang);
            const result = textToGlosses(text);
            glossText = result.glosses;
            glossTokens = result.tokens;
        } catch (e) {
            console.error('[Emercom] Gloss conversion failed:', e);
        }
    }

    const msgId = _uid('msg_');
    const assistantMsgData = { role: 'assistant', msgId: msgId, glosses: glossText, timestamp: Date.now(), taskId: null, bgColor: selectedBgColor, avatar: selectedAvatar, mode: currentMode };
    session.messages.push(assistantMsgData);
    saveSessions();
    welcomeScreen.style.opacity = '0';
    welcomeScreen.style.visibility = 'hidden';
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = msgId;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    row.appendChild(bubble);
    chatMessages.appendChild(row);

    // Show gloss preview with highlighting in emercom mode
    if (glossTokens) {
        renderGlossPreview(bubble, glossTokens);
    }

    scrollToBottom();
    triggerFetch(glossText, msgId, bubble);
}

async function triggerFetch(text, msgId, bubbleNode, overrideBg, overrideAvatar, overrideMode) {
    renderSkeleton(bubbleNode);
    bubbleNode.dataset.startTime = Date.now();
    const bg = overrideBg || selectedBgColor;
    const av = overrideAvatar || selectedAvatar;
    const mode = overrideMode || currentMode;
    try {
        const response = await fetch('/api/v1/video/generate-async', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                glosses: text, 
                avatar: av, 
                background: bg,
                mode: mode,
                sessionId: currentSessionId,
                msgId: msgId
            })
        });
        if (!response.ok) throw new Error('Server error');
        const data = await response.json();
        
        // Save Task ID locally and on server (asyncly)
        updateSessionParam(msgId, { taskId: data.taskId });
        
        attachTaskListener(data.taskId, msgId, bubbleNode);
    } catch (err) {

        updateSessionParam(msgId, { error: err.message, videoUrl: null });
        const gp = bubbleNode.querySelector('.gloss-preview');
        bubbleNode.innerHTML = (gp ? gp.outerHTML : '') + `<span class="error-text">${t('error')}${escapeHtml(err.message)}</span>`;
    }
}

function attachTaskListener(taskId, msgId, bubbleNode) {
    // Track which session this listener belongs to
    const ownerSessionId = currentSessionId;
    // If it's a restore, the skeleton might be missing
    if (!bubbleNode.querySelector('.skeleton-container')) {
        renderSkeleton(bubbleNode);
    }
    const statusTextNode = bubbleNode.querySelector('.status-text-anim');
    let retryCount = 0;
    const maxRetries = 3;

    function connectSSE() {
        const es = new EventSource('/api/v1/video/status/' + taskId);
        activeEventSources.add(es);

        es.onmessage = (event) => {
            retryCount = 0; // Reset on successful message
            let sseData;
            try { sseData = JSON.parse(event.data); } catch(e) { console.warn('[SSE] Invalid JSON:', event.data); return; }
            if (sseData.error) {
                es.close();
                activeEventSources.delete(es);
                updateSessionParam(msgId, { error: sseData.error, videoUrl: null, taskId: null });
                const gp = bubbleNode.querySelector('.gloss-preview');
                bubbleNode.innerHTML = (gp ? gp.outerHTML : '') + `<span class="error-text">${t('error')}${escapeHtml(sseData.error)}</span>`;
                return;
            }

            if (sseData.message && statusTextNode) {
                TypingEngine.type(statusTextNode, sseData.message);
            }

            if (typeof sseData.progress === 'number') {
                updateStepper(bubbleNode, sseData.progress);
            }

            if ((sseData.progress === 100 || sseData.status === 'completed') && sseData.downloadUrl) {
                es.close();
                activeEventSources.delete(es);
                // Local update only! Server handles sessions.json update itself.
                updateSessionParam(msgId, { videoUrl: sseData.downloadUrl, timestamp: Date.now(), error: null, taskId: null }, false);
                SoundFX.playChime();
                spawnConfetti(bubbleNode);
                // Tab title notification
                if (document.hidden) {
                    const originalTitle = document.title;
                    document.title = t('tabReady');
                    const restoreTitle = () => { document.title = originalTitle; document.removeEventListener('visibilitychange', restoreTitle); };
                    document.addEventListener('visibilitychange', restoreTitle);
                }
                setTimeout(() => {
                    const glossPreview = bubbleNode.querySelector('.gloss-preview');
                    const startTime = parseInt(bubbleNode.dataset.startTime);
                    const durationSec = startTime ? ((Date.now() - startTime) / 1000).toFixed(1) : null;
                    renderVideoToBubble(bubbleNode, sseData.downloadUrl, glossPreview, durationSec);
                    scrollToBottom();
                }, 1500);
            }
        };

        es.onerror = async (e) => {
            console.error('[SSE] Connection error:', e);
            es.close();
            activeEventSources.delete(es);
            retryCount++;

            // Check if task still exists before retrying
            try {
                const check = await fetch('/api/v1/video/status/' + taskId);
                if (check.status === 404) {
                    // Task expired/deleted — show regenerate option
                    const session = sessions.find(s => s.id === currentSessionId);
                    const msg = session?.messages.find(m => m.msgId === msgId);
                    const glosses = msg?.glosses || '';
                    updateSessionParam(msgId, { error: 'expired', videoUrl: null, taskId: null });
                    const gp = bubbleNode.querySelector('.gloss-preview');
                    const gpHtml = gp ? gp.outerHTML : '';
                    const block = document.createElement('div');
                    block.className = 'expired-block';
                    block.innerHTML = `<p>${t('taskExpired')}</p>`;
                    const btn = document.createElement('button');
                    btn.className = 'regenerate-btn';
                    btn.textContent = t('regenerate');
                    btn.addEventListener('click', () => regenerateVideo(msgId, glosses));
                    block.appendChild(btn);
                    bubbleNode.innerHTML = gpHtml;
                    bubbleNode.appendChild(block);
                    return;
                }
                // SSE endpoint returned 200 (stream) — cancel body and retry
                if (check.body) await check.body.cancel().catch(() => {});
            } catch(fetchErr) {
                // Network error — proceed with normal retry
            }

            if (retryCount <= maxRetries) {
                console.log(`[SSE] Reconnecting (${retryCount}/${maxRetries})...`);
                if (statusTextNode) statusTextNode.innerText = t('reconnecting', { count: retryCount, max: maxRetries });
                setTimeout(connectSSE, 2000 * retryCount);
            } else if (statusTextNode) {
                statusTextNode.innerHTML = `<span style="color:var(--text-muted)">${t('connectionLost')}</span>`;
            }
        };
    }

    connectSSE();
}

function updateSessionParam(msgId, data, shouldSyncToServer = true) {
    let msg = null;
    const session = sessions.find(s => s.id === currentSessionId);
    if (session) msg = session.messages.find(m => m.msgId === msgId);
    if (!msg) {
        // Fallback: search all sessions (task may belong to a different one)
        for (const s of sessions) {
            msg = s.messages.find(m => m.msgId === msgId);
            if (msg) break;
        }
    }
    if (msg) { 
        Object.assign(msg, data); 
        if (shouldSyncToServer) saveSessions(); 
        else renderSidebar();
    }
}


// Start app
init().then(() => console.log('✅ SignBridge Ready')).catch(e => console.error('❌ SignBridge Init Error:', e));


