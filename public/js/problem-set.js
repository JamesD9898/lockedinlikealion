// problem-set.js — two-column layout, notepad, per-part reveal, resizable panels

const PSApp = (() => {
  const cfg = window.__PS;

  // ── State ──────────────────────────────────────────────────────────────────
  let current     = 0;
  let total       = cfg.totalQ;
  let seconds     = (cfg.existing && cfg.existing.timeSpent) || 0;
  let timerRunning = true;
  let timerPaused  = false;
  let timerInterval = null;
  let timerMode    = cfg.timeLimit ? 'down' : 'up'; // countdown if time limit set
  let timerLimit   = cfg.timeLimit ? cfg.timeLimit * 60 : null; // in seconds

  let toolsOpen  = true;
  let desmosCalc = null;
  let desmosInited = false;

  let grades = {};          // { qi: 'correct'|'partial'|'incorrect' }
  let revealed = {};        // { qi: true } for single-answer reveals
  let revealedParts = {};   // { qi: Set<pi> } for per-part reveals

  // ── Notepad storage ────────────────────────────────────────────────────────
  function noteKey(qi) { return 'note-' + cfg.qIds[qi]; }

  function saveNote() {
    const el = document.getElementById('ps-notepad');
    if (!el) return;
    try { localStorage.setItem(noteKey(current), el.value); } catch (_) {}
  }

  function loadNote(qi) {
    const el = document.getElementById('ps-notepad');
    if (!el) return;
    try { el.value = localStorage.getItem(noteKey(qi)) || ''; } catch (_) { el.value = ''; }
  }

  function clearNote() {
    const el = document.getElementById('ps-notepad');
    if (!el) return;
    el.value = '';
    try { localStorage.removeItem(noteKey(current)); } catch (_) {}
  }

  // ── Desmos ─────────────────────────────────────────────────────────────────
  const DESMOS_OPTS = {
    keypad: true,
    expressions: true,
    settingsMenu: true,
    zoomButtons: true,
    border: false,
    expressionsTopbar: false,
    backgroundColor: '#faf8f4'
  };

  function initDesmos() {
    if (desmosInited) return;
    const el = document.getElementById('desmos-container');
    if (el && typeof Desmos !== 'undefined') {
      desmosCalc = Desmos.GraphingCalculator(el, DESMOS_OPTS);
      desmosInited = true;
      setTimeout(() => desmosCalc && desmosCalc.resize(), 80);
    }
  }

  // ── Column resizer (question ↔ tools) ──────────────────────────────────────
  const TOOLS_W_KEY = 'ps-tools-w';
  const TOOLS_W_DEFAULT = 400;
  const TOOLS_W_MIN = 260;

  function applyToolsWidth(px) {
    const max = Math.floor(window.innerWidth * 0.65);
    const w = Math.max(TOOLS_W_MIN, Math.min(max, Math.round(px)));
    document.documentElement.style.setProperty('--ps-tools-w', w + 'px');
    return w;
  }

  function initColumnResizer() {
    // Load saved width
    try {
      const s = localStorage.getItem(TOOLS_W_KEY);
      if (s) applyToolsWidth(parseFloat(s));
      else applyToolsWidth(TOOLS_W_DEFAULT);
    } catch (_) { applyToolsWidth(TOOLS_W_DEFAULT); }

    const handle = document.getElementById('ps-col-resizer');
    if (!handle) return;

    let dragging = false, startX = 0, startW = 0;

    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      const toolsCol = document.getElementById('ps-tools-col');
      startW = toolsCol ? toolsCol.getBoundingClientRect().width : TOOLS_W_DEFAULT;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging) return;
      e.preventDefault();
      const w = applyToolsWidth(startW + (startX - e.clientX));
      try { localStorage.setItem(TOOLS_W_KEY, String(w)); } catch (_) {}
      if (desmosCalc) desmosCalc.resize();
    });
    handle.addEventListener('pointerup', e => {
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    handle.addEventListener('pointercancel', e => {
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    window.addEventListener('resize', () => {
      const cur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ps-tools-w')) || TOOLS_W_DEFAULT;
      applyToolsWidth(cur);
      if (desmosCalc) desmosCalc.resize();
    }, { passive: true });
  }

  // ── Row resizer (notepad ↔ calc within tools column) ──────────────────────
  const ROW_H_KEY = 'ps-notepad-h';

  function initRowResizer() {
    try {
      const s = localStorage.getItem(ROW_H_KEY);
      if (s) {
        const wrap = document.getElementById('ps-notepad-wrap');
        if (wrap) { wrap.style.height = s + 'px'; wrap.style.flex = 'none'; }
      }
    } catch (_) {}

    const handle = document.getElementById('ps-tools-row-divider');
    const notepadWrap = document.getElementById('ps-notepad-wrap');
    if (!handle || !notepadWrap) return;

    let dragging = false, startY = 0, startH = 0;

    handle.addEventListener('pointerdown', e => {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startH = notepadWrap.getBoundingClientRect().height;
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
      if (!dragging) return;
      e.preventDefault();
      const maxH = window.innerHeight * 0.75;
      const newH = Math.max(60, Math.min(maxH, startH + (e.clientY - startY)));
      notepadWrap.style.height = newH + 'px';
      notepadWrap.style.flex = 'none';
      try { localStorage.setItem(ROW_H_KEY, String(Math.round(newH))); } catch (_) {}
      if (desmosCalc) desmosCalc.resize();
    });
    handle.addEventListener('pointerup', e => {
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    });
    handle.addEventListener('pointercancel', e => {
      dragging = false;
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
    });
  }

  // ── Toggle tools panel ─────────────────────────────────────────────────────
  function toggleTools() {
    toolsOpen = !toolsOpen;
    const main = document.getElementById('ps-main');
    const resizer = document.getElementById('ps-col-resizer');
    const btn = document.getElementById('btn-calc');
    if (main) main.classList.toggle('tools-panel-hidden', !toolsOpen);
    if (resizer) resizer.style.display = toolsOpen ? '' : 'none';
    if (btn) btn.classList.toggle('active', toolsOpen);
    if (toolsOpen) {
      initDesmos();
      setTimeout(() => desmosCalc && desmosCalc.resize(), 80);
    }
  }

  // ── Timer ──────────────────────────────────────────────────────────────────
  function startTimer() {
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      if (!timerPaused) {
        seconds++;
        updateTimerDisplay();
        checkTimeExpired();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const el = document.getElementById('timer-display');
    if (!el) return;
    let display;
    if (timerMode === 'down' && timerLimit !== null) {
      const remaining = Math.max(0, timerLimit - seconds);
      const m = Math.floor(remaining / 60);
      const s = remaining % 60;
      display = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    } else {
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      display = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    el.textContent = display;
  }

  function checkTimeExpired() {
    if (timerMode === 'down' && timerLimit !== null && seconds >= timerLimit) {
      document.getElementById('timer-display')?.classList.add('timer-expired');
    }
  }

  function toggleTimer() {
    timerPaused = !timerPaused;
    const btn = document.getElementById('btn-timer-pause');
    if (btn) btn.textContent = timerPaused ? '▶' : '⏸';
    const el = document.getElementById('timer-display');
    if (el) el.classList.toggle('timer-paused', timerPaused);
  }

  function openTimerSettings() {
    const modal = document.getElementById('timer-modal');
    if (!modal) return;
    // Sync current state to modal inputs
    const modeSelect = document.getElementById('timer-mode-select');
    const limitInput = document.getElementById('timer-limit-input');
    if (modeSelect) modeSelect.value = timerMode;
    if (limitInput && timerLimit) limitInput.value = String(Math.round(timerLimit / 60));
    modal.classList.remove('hidden');
  }

  function closeTimerSettings() {
    document.getElementById('timer-modal')?.classList.add('hidden');
  }

  function applyTimerSettings() {
    const modeSelect = document.getElementById('timer-mode-select');
    const limitInput = document.getElementById('timer-limit-input');
    const resetCb    = document.getElementById('timer-reset-cb');
    if (modeSelect) timerMode = modeSelect.value;
    if (limitInput) {
      const mins = parseFloat(limitInput.value);
      if (!isNaN(mins) && mins > 0) timerLimit = mins * 60;
    }
    if (resetCb && resetCb.checked) {
      seconds = 0;
      resetCb.checked = false;
    }
    // Update the "/45:00" display
    const ofEl = document.querySelector('.ps-timer-of');
    if (ofEl && timerLimit) {
      const m = Math.floor(timerLimit / 60);
      ofEl.textContent = '/' + String(m).padStart(2, '0') + ':00';
      ofEl.style.display = '';
    }
    updateTimerDisplay();
    checkTimeExpired();
    closeTimerSettings();
  }

  // ── Navigation ─────────────────────────────────────────────────────────────
  function go(idx) {
    saveNote();
    showSlide(idx);
  }

  function prev() {
    if (current > 0) go(current - 1);
  }

  function next() {
    if (current < total - 1) go(current + 1);
    else finish();
  }

  function showSlide(idx) {
    document.getElementById('end-screen')?.classList.add('hidden');
    document.querySelectorAll('.question-slide').forEach(s => s.classList.remove('active'));
    const slide = document.getElementById('slide-' + idx);
    if (!slide) return;
    slide.classList.add('active');
    current = idx;

    // Restore any revealed state
    if (revealed[idx]) {
      const sol = document.getElementById('sol-' + idx);
      const btn = document.getElementById('reveal-' + idx);
      if (sol) sol.classList.remove('hidden');
      if (btn) btn.classList.add('hidden');
    }
    const rp = revealedParts[idx];
    if (rp) {
      rp.forEach(pi => {
        document.getElementById('sol-' + idx + '-' + pi)?.classList.remove('hidden');
        document.getElementById('reveal-' + idx + '-' + pi)?.classList.add('hidden');
      });
    }
    if (grades[idx]) {
      applyGradeUI(idx, grades[idx]);
      if (revealed[idx] || (rp && rp.size > 0)) {
        document.getElementById('grade-bar-' + idx)?.classList.remove('hidden');
      }
    }

    // Update navigation UI
    document.getElementById('nav-pos').textContent = (idx + 1) + ' / ' + total;
    updateDots();
    updateHud();
    loadNote(idx);

    // Scroll question column to top
    const qCol = document.getElementById('ps-question-col');
    if (qCol) qCol.scrollTop = 0;
  }

  function updateHud() {
    const el = document.getElementById('ps-hud-pos');
    if (!el) return;
    const qn = cfg.qNums[current] || String(current + 1);
    const n  = cfg.partsLayout[current];
    el.textContent = n > 0 ? 'Q' + qn + ' · ' + n + ' parts' : 'Q' + qn;
  }

  function updateDots() {
    document.querySelectorAll('.pdot').forEach((dot, i) => {
      dot.classList.toggle('pdot-current', i === current);
      // Grade classes applied in grade()
    });
    // Scroll the active dot into view
    const activeDot = document.getElementById('pdot-' + current);
    if (activeDot) activeDot.scrollIntoView({ inline: 'nearest', behavior: 'smooth' });
  }

  function updateNavButtons() {
    const prevBtn = document.getElementById('btn-prev');
    const nextBtn = document.getElementById('btn-next');
    if (prevBtn) prevBtn.disabled = current === 0;
    if (nextBtn) nextBtn.disabled = false; // can always "next" (finish if last)
  }

  // ── Reveal ─────────────────────────────────────────────────────────────────
  // Single-answer reveal
  function reveal(qi) {
    if (revealed[qi]) return;
    revealed[qi] = true;
    const sol = document.getElementById('sol-' + qi);
    const btn = document.getElementById('reveal-' + qi);
    if (sol) { sol.classList.remove('hidden'); sol.classList.add('sol-appear'); }
    if (btn) btn.classList.add('hidden');
    document.getElementById('grade-bar-' + qi)?.classList.remove('hidden');
  }

  // Per-part reveal (only shows that part's answer)
  function revealPart(qi, pi) {
    if (!revealedParts[qi]) revealedParts[qi] = new Set();
    if (revealedParts[qi].has(pi)) return;
    revealedParts[qi].add(pi);

    const sol = document.getElementById('sol-' + qi + '-' + pi);
    const btn = document.getElementById('reveal-' + qi + '-' + pi);
    if (sol) { sol.classList.remove('hidden'); sol.classList.add('sol-appear'); }
    if (btn) btn.classList.add('hidden');

    // Show grade bar once any part is revealed
    document.getElementById('grade-bar-' + qi)?.classList.remove('hidden');
  }

  // ── Grading ────────────────────────────────────────────────────────────────
  function grade(qi, g) {
    grades[qi] = g;
    applyGradeUI(qi, g);
    updateDot(qi);
  }

  function applyGradeUI(qi, g) {
    document.getElementById('grade-bar-' + qi)?.querySelectorAll('.grade-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.grade === g);
    });
  }

  function updateDot(qi) {
    const dot = document.getElementById('pdot-' + qi);
    if (!dot) return;
    dot.classList.remove('pdot-correct', 'pdot-partial', 'pdot-incorrect');
    if (grades[qi]) dot.classList.add('pdot-' + grades[qi]);
  }

  // ── Answers collection ─────────────────────────────────────────────────────
  function collectAnswers() {
    const out = [];
    document.querySelectorAll('.answer-input').forEach(ta => {
      const slide = ta.closest('.question-slide');
      if (!slide) return;
      const qi = parseInt(slide.dataset.index, 10);
      const row = { questionId: ta.dataset.qid, response: ta.value, selfGrade: grades[qi] || null };
      if (ta.dataset.part !== undefined) row.part = parseInt(ta.dataset.part, 10);
      out.push(row);
    });
    return out;
  }

  function restoreAnswers() {
    const ex = cfg.existing;
    if (!ex || !ex.answers) return;
    ex.answers.forEach(a => {
      if (!a.questionId) return;
      const id = String(a.questionId);
      document.querySelectorAll('.answer-input').forEach(ta => {
        if (String(ta.dataset.qid) !== id) return;
        if (ta.dataset.part !== undefined) {
          if (a.part != null && String(ta.dataset.part) === String(a.part)) ta.value = a.response || '';
        } else if (a.part == null) {
          ta.value = a.response || '';
        }
      });
    });
  }

  // ── Auto-save ──────────────────────────────────────────────────────────────
  async function autoSave() {
    saveNote();
    if (cfg.psId.startsWith('practice-')) return; // don't save practice sessions
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        courseId: cfg.courseId,
        problemSetId: cfg.psId,
        answers: collectAnswers(),
        timeSpent: seconds,
        completed: false
      })
    }).catch(() => {});
  }

  // ── Finish ─────────────────────────────────────────────────────────────────
  function finish() {
    clearInterval(timerInterval);
    timerPaused = true;
    saveNote();

    if (!cfg.psId.startsWith('practice-')) {
      fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: cfg.courseId,
          problemSetId: cfg.psId,
          answers: collectAnswers(),
          timeSpent: seconds,
          completed: true
        })
      });
    }

    showEndScreen();
  }

  function showEndScreen() {
    document.querySelectorAll('.question-slide').forEach(s => s.classList.remove('active'));
    const es = document.getElementById('end-screen');
    es.classList.remove('hidden');

    const m = Math.floor(seconds / 60), s = seconds % 60;
    document.getElementById('end-time').textContent =
      'time: ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');

    const counts = { correct: 0, partial: 0, incorrect: 0, ungraded: 0 };
    for (let i = 0; i < total; i++) {
      const g = grades[i];
      if (g) counts[g]++; else counts.ungraded++;
    }

    document.getElementById('end-grades').innerHTML = `
      <div class="end-grade-item correct"><span class="end-grade-num">${counts.correct}</span><span>correct</span></div>
      <div class="end-grade-item partial"><span class="end-grade-num">${counts.partial}</span><span>partial</span></div>
      <div class="end-grade-item incorrect"><span class="end-grade-num">${counts.incorrect}</span><span>missed</span></div>
      ${counts.ungraded > 0 ? `<div class="end-grade-item ungraded"><span class="end-grade-num">${counts.ungraded}</span><span>ungraded</span></div>` : ''}
    `;

    let html = '';
    for (let i = 0; i < total; i++) {
      const g = grades[i] || 'ungraded';
      const qn = cfg.qNums[i] || String(i + 1);
      html += `<div class="end-q-row ${g}" onclick="PSApp.go(${i})"><span class="end-q-num">Q${qn}</span><span class="end-q-grade">${g}</span></div>`;
    }
    document.getElementById('end-breakdown').innerHTML = html;
  }

  function restart() {
    document.getElementById('end-screen')?.classList.add('hidden');
    revealed = {}; revealedParts = {}; grades = {}; seconds = 0;
    timerPaused = false;
    const pauseBtn = document.getElementById('btn-timer-pause');
    if (pauseBtn) pauseBtn.textContent = '⏸';

    document.querySelectorAll('.qpart-solution, .qpart-solution').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('[id^="sol-"]').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.btn-reveal-part').forEach(b => b.classList.remove('hidden'));
    document.querySelectorAll('.grade-bar').forEach(b => b.classList.add('hidden'));
    document.querySelectorAll('.grade-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.answer-input').forEach(ta => ta.value = '');
    document.querySelectorAll('.pdot').forEach(d => {
      d.classList.remove('pdot-correct', 'pdot-partial', 'pdot-incorrect', 'pdot-current');
    });

    startTimer();
    updateTimerDisplay();
    showSlide(0);
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────
  function onKey(e) {
    if (document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'SELECT') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); prev(); }
    if (e.key === ' ')  { e.preventDefault(); reveal(current); }
    if (e.key === '1')  grade(current, 'correct');
    if (e.key === '2')  grade(current, 'partial');
    if (e.key === '3')  grade(current, 'incorrect');
    if (e.key === 'c' || e.key === 'C') toggleTools();
    if (e.key === 'Escape') {
      closeTimerSettings();
      document.getElementById('end-screen')?.classList.add('hidden');
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    // Restore grades from existing progress
    if (cfg.existing && cfg.existing.answers) {
      cfg.existing.answers.forEach(a => {
        if (!a.questionId || !a.selfGrade) return;
        const idx = cfg.qIds.findIndex(id => String(id) === String(a.questionId));
        if (idx >= 0) grades[idx] = a.selfGrade;
      });
    }

    restoreAnswers();

    // Apply saved grades to dots
    for (let i = 0; i < total; i++) {
      if (grades[i]) updateDot(i);
    }

    // Init tools panel — open by default
    initDesmos();
    initColumnResizer();
    initRowResizer();

    // Start showing from question 0
    showSlide(0);
    updateNavButtons();

    // Start timer
    startTimer();
    updateTimerDisplay();

    // Auto-save every 30s
    setInterval(autoSave, 30000);

    // Keyboard
    document.addEventListener('keydown', onKey);

    // Auto-save note on notepad changes
    const notepad = document.getElementById('ps-notepad');
    if (notepad) {
      notepad.addEventListener('input', () => {
        try { localStorage.setItem(noteKey(current), notepad.value); } catch (_) {}
      });
    }
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init,
    go, prev, next,
    reveal, revealPart,
    grade,
    toggleTools,
    toggleTimer,
    openTimerSettings, closeTimerSettings, applyTimerSettings,
    clearNote,
    finish, restart
  };
})();

document.addEventListener('DOMContentLoaded', PSApp.init);
