const chatMessages = document.getElementById('chat-messages');
const glossInput = document.getElementById('gloss-input');
const sendBtn = document.getElementById('send-btn');
const newChatBtn = document.getElementById('new-chat-btn');
const historyList = document.getElementById('history-list');
const welcomeScreen = document.getElementById('welcome-screen');
const bgSelectorBtn = document.getElementById('bg-selector-btn');
const bgPopover = document.getElementById('bg-popover');
const colorOptions = document.querySelectorAll('.color-option');
const avatarSelectorBtn = document.getElementById('avatar-selector-btn');
const avatarPopover = document.getElementById('avatar-popover');
const themeToggle = document.getElementById('theme-toggle');
const langFlag = document.getElementById('lang-flag');

const HISTORY_KEY = 'signbridge_sessions_var2';
const THEME_KEY = 'signbridge_theme';
let sessions = []; // Will be loaded from server
let currentSessionId = null;
let selectedBgColor = 'white';
let selectedAvatar = 'Aibek'; // Internal name for backend

const EXPIRATION_MS = 55 * 60 * 1000; // 55 minutes

// --- Init ---
async function init() {
    initTheme();
    await initSession();
    setupAutoResize();
}

// --- Listeners ---
// Background Popover
bgSelectorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    avatarPopover.classList.remove('show');
    avatarSelectorBtn.classList.remove('active');
    bgPopover.classList.toggle('show');
    bgSelectorBtn.classList.toggle('active');
});

// Avatar Popover
avatarSelectorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    bgPopover.classList.remove('show');
    bgSelectorBtn.classList.remove('active');
    avatarPopover.classList.toggle('show');
    avatarSelectorBtn.classList.toggle('active');
});

document.addEventListener('click', (e) => {
    if (!bgPopover.contains(e.target) && !bgSelectorBtn.contains(e.target)) {
        bgPopover.classList.remove('show');
        bgSelectorBtn.classList.remove('active');
    }
    if (!avatarPopover.contains(e.target) && !avatarSelectorBtn.contains(e.target)) {
        avatarPopover.classList.remove('show');
        avatarSelectorBtn.classList.remove('active');
    }
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

glossInput.addEventListener('input', () => {
    langFlag.innerText = detectLanguage(glossInput.value);
    sendBtn.disabled = glossInput.value.trim().length === 0;
});

glossInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) triggerGenerate();
    }
});

sendBtn.addEventListener('click', triggerGenerate);
newChatBtn.addEventListener('click', startNewSession);

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
});

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
async function saveSessions() {
    renderSidebar();
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


function startNewSession() {
    currentSessionId = 'sess_' + Date.now();
    sessions.unshift({ id: currentSessionId, title: "Новый чат", messages: [] });
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
            await saveSessions();
            localStorage.removeItem(HISTORY_KEY);
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

window.deleteSession = function(e, id) {
    e.stopPropagation();
    sessions = sessions.filter(s => s.id !== id);
    if (sessions.length === 0) startNewSession();
    else if (currentSessionId === id) loadSession(sessions[0].id);
    else saveSessions();
}

window.renameSession = function(e, id) {
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
        const newTitle = titleDiv.innerText.trim();
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
            <div class="history-item-title">${session.title}</div>
            <div class="history-item-actions">
                <button class="action-btn" onclick="renameSession(event, '${session.id}')" title="Переименовать">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="action-btn del" onclick="deleteSession(event, '${session.id}')" title="Удалить чат">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path></svg>
                </button>
            </div>
        `;
        historyList.appendChild(div);
    });
}

function clearChatUI() {
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

function appendUserMessageToDOM(text) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `<div class="bubble">${text}</div>`;
    chatMessages.appendChild(row);
    scrollToBottom();
}

function appendAssistantMessageToDOM(msgData) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = 'msg_' + msgData.msgId;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    
    if (msgData.videoUrl) {
        const age = Date.now() - msgData.timestamp;
        if (age > EXPIRATION_MS) {
            bubble.innerHTML = `
                <div class="expired-block">
                    <p>Срок хранения видео на сервере истек (1 час)</p>
                    <button class="regenerate-btn" onclick="regenerateVideo('${msgData.msgId}', '${msgData.glosses}')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:6px"><path d="M21.5 2v6h-6M2.13 15.57a10 10 0 1 0 3.43-12.2l-3.37 3.37"></path></svg>
                        Сгенерировать заново
                    </button>
                </div>
            `;
        } else {
            renderVideoToBubble(bubble, msgData.videoUrl);
        }
    } else if (msgData.taskId) {
        // Re-attach to ongoing task
        attachTaskListener(msgData.taskId, msgData.msgId, bubble);
    } else if (msgData.error) {
        bubble.innerHTML = `<span class="error-text">❌ Ошибка: ${msgData.error}</span>`;
    }
    
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
    return bubble;
}

function renderVideoToBubble(bubble, url) {
    bubble.innerHTML = `
        <div class="video-container">
            <video controls autoplay loop playsinline><source src="${url}" type="video/webm"></video>
            <a href="${url}" download="signbridge_video.webm" class="download-btn">Скачать</a>
        </div>
    `;
}

function renderSkeleton(bubble) {
    bubble.innerHTML = `
        <div class="skeleton-container">
            <div class="skeleton-shimmer"></div>
            <div class="status-container">
                <span class="spinner"></span>
                <span class="status-text-anim">Устанавливаем нейро-контакт...</span>
            </div>
        </div>
    `;
}

window.regenerateVideo = function(msgId, glosses) {
    const row = document.getElementById('msg_' + msgId);
    if (!row) return;
    const bubble = row.querySelector('.bubble');
    SoundFX.playPop();
    triggerFetch(glosses, msgId, bubble);
}

function triggerGenerate() {
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
        saveSessions();
    }
    session.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    saveSessions();
    appendUserMessageToDOM(text);
    SoundFX.playPop();
    const msgId = 'msg_' + Date.now();
    const assistantMsgData = { role: 'assistant', msgId: msgId, glosses: text, timestamp: Date.now(), taskId: null };
    session.messages.push(assistantMsgData);
    saveSessions();
    welcomeScreen.style.opacity = '0';
    welcomeScreen.style.visibility = 'hidden';
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.id = 'msg_' + msgId;
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    row.appendChild(bubble);
    chatMessages.appendChild(row);
    scrollToBottom();
    triggerFetch(text, msgId, bubble);
}

async function triggerFetch(text, msgId, bubbleNode) {
    renderSkeleton(bubbleNode);
    try {
        const response = await fetch('/api/v1/video/generate-async', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                glosses: text, 
                avatar: selectedAvatar, 
                background: selectedBgColor,
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
        bubbleNode.innerHTML = `<span class="error-text">❌ Ошибка: ${err.message}</span>`;
    }
}

function attachTaskListener(taskId, msgId, bubbleNode) {
    // If it's a restore, the skeleton might be missing
    if (!bubbleNode.querySelector('.skeleton-container')) {
        renderSkeleton(bubbleNode);
    }
    const statusTextNode = bubbleNode.querySelector('.status-text-anim');
    const es = new EventSource('/api/v1/video/status/' + taskId);
    
    es.onmessage = (event) => {
        const sseData = JSON.parse(event.data);
        if (sseData.error) {
            es.close();
            updateSessionParam(msgId, { error: sseData.error, videoUrl: null, taskId: null });
            bubbleNode.innerHTML = `<span class="error-text">❌ Ошибка: ${sseData.error}</span>`;
            return;
        }

        if (sseData.message && statusTextNode) {
            statusTextNode.innerText = sseData.message;
        }

        if (sseData.progress === 100 && sseData.downloadUrl) {
            es.close();
            // Local update only! Server handles sessions.json update itself.
            updateSessionParam(msgId, { videoUrl: sseData.downloadUrl, timestamp: Date.now(), error: null, taskId: null }, false);
            SoundFX.playChime();
            renderVideoToBubble(bubbleNode, sseData.downloadUrl);
            scrollToBottom();
        }


    };
    es.onerror = (e) => { 
        console.error('[SSE] Connection error:', e);
        es.close(); 
        if (statusTextNode) {
            statusTextNode.innerHTML = `<span style="color:var(--text-muted)">⚠️ Связь прервана... (обновите страницу)</span>`;
        }
    };
}

function updateSessionParam(msgId, data, shouldSyncToServer = true) {
    const session = sessions.find(s => s.id === currentSessionId);
    if (session) {
        const msg = session.messages.find(m => m.msgId === msgId);
        if (msg) { 
            Object.assign(msg, data); 
            if (shouldSyncToServer) saveSessions(); 
            else renderSidebar();
        }
    }
}


// Start app
init();

