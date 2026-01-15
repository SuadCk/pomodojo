// Pomodojo Core Logic - Polished & Hardened

// --- State Management ---
const startOfDay = () => new Date().setHours(0,0,0,0);
const todayKey = () => `pomodojo_daily_${startOfDay()}`;

// Safe Load Helper
function safeLoad(key, fallback) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : fallback;
    } catch (e) {
        console.warn(`Failed to parse ${key}, using fallback.`);
        return fallback;
    }
}

const state = {
    // Timer Prefs
    focusDuration: parseInt(localStorage.getItem('pomodojo_focus') || '25'),
    breakDuration: parseInt(localStorage.getItem('pomodojo_break') || '5'),
    customFocus: parseInt(localStorage.getItem('pomodojo_custom_focus') || '60'),
    isMuted: localStorage.getItem('pomodojo_muted') === 'true',
    
    // UI Prefs
    isZenMode: localStorage.getItem('pomodojo_zen') === 'true',
    
    // Data
    daily: safeLoad(todayKey(), { minutes: 0, sessions: 0, date: startOfDay() }),
    history: safeLoad('pomodojo_history', []), // Array of { timestamp, duration, task }
    
    // Runtime Persistence
    savedRunState: safeLoad('pomodojo_run_state', null),
    
    // Real-time State
    mode: 'focus', 
    timeLeft: 25 * 60,
    isRunning: false,
    timerInterval: null,
    targetEndTime: null, 
    
    // Ritual State
    currentTask: localStorage.getItem('pomodojo_current_task') || "",
    
    // UI State
    isCustomVisible: false
};

// --- DOM Elements ---
const el = {
    display: document.getElementById('timer-display'),
    modeLabel: document.getElementById('mode-label'),
    startBtn: document.getElementById('btn-start'),
    resetBtn: document.getElementById('btn-reset'),
    
    // Identity
    dailyTime: document.getElementById('daily-time'),
    dailySessions: document.getElementById('daily-sessions'),
    weeklyTime: document.getElementById('weekly-time'),
    weeklySessions: document.getElementById('weekly-sessions'),
    
    // Rituals
    taskInput: document.getElementById('task-input'),
    reflectionUi: document.getElementById('reflection-ui'),
    reflectionBtns: document.querySelectorAll('.reflection-options .btn-tiny'),
    
    // Controls
    focusPills: document.querySelectorAll('#focus-options .pill-btn'),
    breakPills: document.querySelectorAll('#break-options .pill-btn'),
    soundBtn: document.getElementById('btn-sound'),
    soundOn: document.querySelector('.icon-sound-on'),
    soundOff: document.querySelector('.icon-sound-off'),
    zenBtn: document.getElementById('btn-zen'),
    
    // Data Controls
    exportBtn: document.getElementById('btn-export'),
    resetDataBtn: document.getElementById('btn-reset-data'),
    
    // Custom Time
    customToggle: document.getElementById('btn-custom-toggle'),
    customContainer: document.getElementById('custom-focus-container'),
    customInput: document.getElementById('custom-focus-input')
};

// --- Audio System ---
let audioCtx = null;
function initAudio() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(e => console.log("Audio resume failed:", e));
    } catch (e) {
        console.warn("Web Audio API not supported", e);
    }
}
function playTone(type) {
    if (state.isMuted) return;
    initAudio();
    if (!audioCtx) return;
    try {
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        const freq = type === 'focus' ? 880 : 440; 
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.05, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);
        osc.start(now);
        osc.stop(now + 1.2);
    } catch (e) {
        console.warn("Audio play failed", e);
    }
}

// --- Persistence Helpers ---
function savePrefs() {
    localStorage.setItem('pomodojo_focus', state.focusDuration);
    localStorage.setItem('pomodojo_break', state.breakDuration);
    localStorage.setItem('pomodojo_muted', state.isMuted);
    localStorage.setItem('pomodojo_custom_focus', state.customFocus);
    localStorage.setItem('pomodojo_zen', state.isZenMode);
}

function saveRunState() {
    const runState = {
        mode: state.mode,
        timeLeft: state.timeLeft,
        isRunning: state.isRunning,
        targetEndTime: state.targetEndTime,
        timestamp: Date.now()
    };
    localStorage.setItem('pomodojo_run_state', JSON.stringify(runState));
    localStorage.setItem('pomodojo_current_task', state.currentTask);
}

function clearRunState() {
    const runState = {
        mode: state.mode,
        timeLeft: state.timeLeft, 
        isRunning: false,
        targetEndTime: null,
        timestamp: Date.now()
    };
    localStorage.setItem('pomodojo_run_state', JSON.stringify(runState));
}

function saveStats() {
    localStorage.setItem(todayKey(), JSON.stringify(state.daily));
    localStorage.setItem('pomodojo_history', JSON.stringify(state.history));
}

// --- Weekly Stats Logic ---
function getWeeklyStats() {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(now.setDate(diff)).setHours(0,0,0,0);
    
    const weeklySessions = state.history.filter(h => h.timestamp >= monday);
    const minutes = weeklySessions.reduce((acc, curr) => acc + curr.duration, 0);
    
    return {
        minutes: minutes,
        sessions: weeklySessions.length
    };
}

function updateIdentityUI() {
    // Daily Reset check
    if (state.daily.date && state.daily.date !== startOfDay()) {
        state.daily = { minutes: 0, sessions: 0, date: startOfDay() };
        saveStats();
    } else if (!state.daily.date) {
        state.daily.date = startOfDay();
        saveStats();
    }
    
    if (el.dailyTime) el.dailyTime.textContent = `${state.daily.minutes}m`;
    if (el.dailySessions) el.dailySessions.textContent = state.daily.sessions;
    
    // Weekly
    const weekly = getWeeklyStats();
    if (el.weeklyTime) el.weeklyTime.textContent = `${weekly.minutes}m`;
    if (el.weeklySessions) el.weeklySessions.textContent = weekly.sessions;
}

// --- Data Controls ---
function exportData() {
    const csvContent = "data:text/csv;charset=utf-8," 
        + "Timestamp,Duration (mins),Task,Date\n"
        + state.history.map(e => {
            const date = new Date(e.timestamp).toISOString();
            return `${e.timestamp},${e.duration},"${e.task || ''}",${date}`;
        }).join("\n");
        
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "pomodojo_history.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function resetData() {
    if (confirm("Are you sure? This will delete all your focus history and stats permanently.")) {
        localStorage.clear();
        location.reload();
    }
}

// --- Recovery Logic ---
function restoreState() {
    document.body.classList.remove('timer-running');
    const saved = state.savedRunState;
    if (saved) {
        if (['focus', 'break'].includes(saved.mode)) state.mode = saved.mode;
        if (el.taskInput) el.taskInput.value = state.currentTask;
        
        if (saved.isRunning && saved.targetEndTime) {
            const now = Date.now();
            const delta = Math.ceil((saved.targetEndTime - now) / 1000);
            if (delta > 0) {
                state.timeLeft = delta;
                state.targetEndTime = saved.targetEndTime;
                state.isRunning = true;
                document.body.classList.add('timer-running');
                if (el.startBtn) {
                     el.startBtn.textContent = "Pause";
                     el.startBtn.classList.replace('btn-primary', 'btn-outline');
                }
                state.timerInterval = setInterval(tick, 200); 
            } else {
                state.timeLeft = 0;
                state.isRunning = false;
                switchMode(); 
            }
        } else {
            const max = (state.mode === 'focus' ? state.focusDuration : state.breakDuration) * 60;
            if (saved.timeLeft > 0 && saved.timeLeft <= max) {
                state.timeLeft = saved.timeLeft;
            } else {
                state.timeLeft = max;
            }
            state.isRunning = false;
        }
    } else {
         state.timeLeft = state.focusDuration * 60; 
    }
    updateDisplay();
    updatePills();
    updateZenMode();
    
    if (state.mode === 'break') {
        showReflection();
    } else {
        showTaskInput();
    }
}


// --- DOM/UI Logic ---
function showTaskInput() {
    if (el.taskInput && el.reflectionUi) {
        el.taskInput.style.display = 'block';
        el.reflectionUi.style.display = 'none';
        // Only clear if empty or previously submitted? 
        // Let's keep input persistent until session complete.
    }
}
function showReflection() {
    if (el.taskInput && el.reflectionUi) {
        el.taskInput.style.display = 'none';
        el.reflectionUi.style.display = 'flex';
    }
}

function formatTime(s) {
    if (s < 0) s = 0; 
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2,'0')}:${sec.toString().padStart(2,'0')}`;
}

function updateDisplay() {
    if (el.display) el.display.textContent = formatTime(state.timeLeft);
    document.title = `${formatTime(state.timeLeft)} - ${state.mode === 'focus' ? 'Focus' : 'Break'}`;
    document.body.classList.toggle('mode-break', state.mode === 'break');
    if (el.modeLabel) {
       // Only update text node, keep button
       const text = state.mode === 'focus' ? (state.isRunning ? "Focusing..." : "Focus Time") : "Break Time";
       el.modeLabel.childNodes[0].nodeValue = text; // Assumes text is first child
    }
}

function logSession() {
    const entry = {
        timestamp: Date.now(),
        duration: state.focusDuration,
        task: state.currentTask
    };
    state.history.push(entry);
    state.daily.sessions++;
    state.daily.minutes += state.focusDuration;
    saveStats();
}

function switchMode() {
    playTone(state.mode);
    if (state.mode === 'focus') {
        logSession(); 
        updateIdentityUI();
        
        state.mode = 'break';
        state.timeLeft = state.breakDuration * 60;
        
        startTimerInternal(false); 
        showReflection();
        
    } else {
        state.mode = 'focus';
        state.timeLeft = state.focusDuration * 60;
        
        pauseTimerInternal(); 
        showTaskInput();
        state.currentTask = ""; 
    }
    saveRunState();
    updateDisplay();
}

function tick() {
    if (!state.isRunning) return;
    const now = Date.now();
    if (state.targetEndTime) {
         const delta = Math.ceil((state.targetEndTime - now) / 1000);
         state.timeLeft = delta;
    } else {
        state.timeLeft--;
    }
    if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        switchMode();
    } else {
        updateDisplay();
    }
}

function startTimerInternal(reset = false) {
    if (state.isRunning && !reset) return; 
    initAudio();
    updateIdentityUI();
    
    state.isRunning = true;
    document.body.classList.add('timer-running');
    const now = Date.now();
    state.targetEndTime = now + (state.timeLeft * 1000); 

    if (el.startBtn) {
        el.startBtn.textContent = 'Pause';
        el.startBtn.classList.replace('btn-primary', 'btn-outline');
    }
    
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(tick, 200); 
    saveRunState();
}

function pauseTimerInternal() {
    state.isRunning = false;
    document.body.classList.remove('timer-running');
    state.targetEndTime = null; 
    if (state.timerInterval) clearInterval(state.timerInterval);
    if (el.startBtn) {
        el.startBtn.textContent = 'Start';
        el.startBtn.classList.replace('btn-outline', 'btn-primary');
    }
    saveRunState();
}

// --- Interaction ---
function toggleTimer() {
    if (state.isRunning) {
        pauseTimerInternal();
    } else {
        if (state.mode === 'focus') {
             state.currentTask = el.taskInput ? el.taskInput.value.trim() : "";
        }
        startTimerInternal();
    }
}

function resetTimer() {
    pauseTimerInternal();
    state.mode = 'focus';
    state.timeLeft = state.focusDuration * 60;
    showTaskInput();
    updateDisplay();
    updatePills();
    saveRunState();
}

function setFocus(val) {
    if (state.isRunning) return;
    state.focusDuration = val;
    state.timeLeft = val * 60;
    if (![25, 30, 45].includes(val)) state.customFocus = val;
    savePrefs();
    updatePills();
    updateDisplay();
    saveRunState();
}

function setBreak(val) {
    if (state.isRunning) return;
    state.breakDuration = val;
    savePrefs();
    updatePills();
    saveRunState();
}

// Custom Time
function toggleCustom() {
    state.isCustomVisible = !state.isCustomVisible;
    if (el.customContainer) el.customContainer.style.display = state.isCustomVisible ? 'flex' : 'none';
    if (state.isCustomVisible) {
        if (el.customInput) {
            el.customInput.value = state.customFocus;
            el.customInput.focus();
        }
        if (state.focusDuration !== state.customFocus) setFocus(state.customFocus);
    }
    updatePills();
}

function handleCustomInput() {
    if (!el.customInput) return;
    let val = parseInt(el.customInput.value);
    if (isNaN(val)) val = 25; 
    val = Math.max(10, Math.min(90, val));
    el.customInput.value = val;
    state.customFocus = val;
    setFocus(val);
}

function updatePills() {
    if (!el.focusPills) return;
    const isPreset = [25, 30, 45].includes(state.focusDuration);
    el.focusPills.forEach(b => {
        if (b.id === 'btn-custom-toggle') {
            if (!isPreset) b.classList.add('active');
            else b.classList.toggle('active', state.isCustomVisible);
        } else {
            b.classList.toggle('active', parseInt(b.dataset.value) === state.focusDuration);
        }
    });

    if (el.customContainer) {
        if (!isPreset) {
            el.customContainer.style.display = 'flex';
            state.isCustomVisible = true;
        } else if (!state.isCustomVisible) {
            el.customContainer.style.display = 'none';
        }
    }

    el.breakPills.forEach(b => b.classList.toggle('active', parseInt(b.dataset.value) === state.breakDuration));
    if (el.soundOn) el.soundOn.style.display = state.isMuted ? 'none' : 'block';
    if (el.soundOff) el.soundOff.style.display = state.isMuted ? 'block' : 'none';
}

function updateZenMode() {
    document.body.classList.toggle('zen-mode', state.isZenMode);
}

// --- Event Binding ---
function bind(el, event, handler) {
    if (el) el.addEventListener(event, handler);
}

bind(el.startBtn, 'click', toggleTimer);
bind(el.resetBtn, 'click', resetTimer);
bind(el.soundBtn, 'click', () => { 
    state.isMuted = !state.isMuted; 
    savePrefs(); 
    updatePills(); 
});
bind(el.customToggle, 'click', toggleCustom);
bind(el.zenBtn, 'click', () => {
    state.isZenMode = !state.isZenMode;
    savePrefs();
    updateZenMode();
});
bind(el.exportBtn, 'click', exportData);
bind(el.resetDataBtn, 'click', resetData);


if (el.customInput) {
    bind(el.customInput, 'change', handleCustomInput);
    bind(el.customInput, 'blur', handleCustomInput);
    bind(el.customInput, 'keydown', (e) => { if (e.key==='Enter') { handleCustomInput(); el.customInput.blur(); } });
}

el.focusPills.forEach(b => {
    if (b.id !== 'btn-custom-toggle') {
        bind(b, 'click', () => { state.isCustomVisible = false; setFocus(parseInt(b.dataset.value)); });
    }
});
el.breakPills.forEach(b => bind(b, 'click', () => setBreak(parseInt(b.dataset.value))));
el.reflectionBtns.forEach(b => bind(b, 'click', (e) => { showTaskInput(); }));

// Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW fail:', err));
    });
}

// Init
try {
    restoreState();
} catch(e) {
    console.warn("Restore state failed", e);
    state.timeLeft = 25 * 60;
    updateDisplay();
}
updateIdentityUI();
updatePills();

// Classroom Init
function checkClassroomParams() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
        const bar = document.getElementById('classroom-bar');
        const nameEl = document.getElementById('classroom-name');
        if (bar && nameEl) {
            bar.style.display = 'inline-flex';
            nameEl.textContent = room;
        }
        const duration = parseInt(params.get('duration'));
        if (duration && !state.isRunning) {
             if (state.focusDuration !== duration) setFocus(duration);
        }
    }
}
checkClassroomParams();

// Global Safe
window.addEventListener('error', (e) => {
    console.error("Global error caught:", e.message);
    if (state.isRunning) pauseTimerInternal();
});
