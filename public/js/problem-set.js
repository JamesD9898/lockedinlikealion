// problem-set.js — immersive one-at-a-time with canvas integration

const PSApp = (() => {
  const cfg = window.__PS;

  let current = 0;
  let total = cfg.totalQ;
  let seconds = (cfg.existing && cfg.existing.timeSpent) || 0;
  let timerRunning = true;
  let timerVisible = false;
  let timerInterval = null;
  let toolsVisible = true;
  let inFocus = false;
  let activeTab = 'canvas';

  let revealed = {};
  let grades = {};

  let desmosCalc = null;
  let desmosModal = null;
  let calcExpanded = false;

  // ── Init ──────────────────────────────────────────────

  function init() {
    // Init whiteboard with main canvas and focus canvas
    if (typeof WB !== 'undefined') {
      WB.init('wb-canvas', 'wb-focus-canvas');
    }

    // Load first question's canvas
    if (cfg.qIds && cfg.qIds[0]) {
      WB.switchQuestion(cfg.qIds[0]);
    }

    showSlide(0);

    // Timer
    timerInterval = setInterval(() => {
      if (timerRunning) {
        seconds++;
        updateTimerDisplay();
        if (cfg.timeLimit && seconds >= cfg.timeLimit * 60) {
          document.getElementById('timer-display').classList.add('timer-expired');
        }
      }
    }, 1000);
    updateTimerDisplay();

    // Keyboard
    document.addEventListener('keydown', onKey);

    // Auto-save every 30s
    setInterval(autoSave, 30000);

    // Prevent rubber-band scroll on iPad while drawing
    document.querySelector('#ps-tools-col')?.addEventListener('touchmove', e => {
      if (e.touches.length === 1) e.preventDefault();
    }, { passive: false });
  }

  // ── Navigation ────────────────────────────────────────

  function showSlide(idx) {
    document.querySelectorAll('.question-slide').forEach(s => {
      s.classList.remove('active');
    });
    document.getElementById('end-screen').classList.add('hidden');

    if (idx >= total) { finish(); return; }

    const slide = document.getElementById('slide-' + idx);
    if (!slide) return;
    slide.classList.add('active');
    current = idx;

    // Switch canvas to this question
    const qId = cfg.qIds && cfg.qIds[idx];
    if (qId) WB.switchQuestion(qId);

    // Restore UI state
    if (grades[idx]) applyGradeUI(idx, grades[idx]);
    if (revealed[idx]) {
      document.getElementById('sol-' + idx)?.classList.remove('hidden');
      document.getElementById('reveal-btn-' + idx)?.classList.add('hidden');
      document.getElementById('grade-bar-' + idx)?.classList.remove('hidden');
    }

    // Update nav
    document.getElementById('nav-pos').textContent = (idx + 1) + ' / ' + total;
    document.getElementById('btn-prev').disabled = idx === 0;
    document.getElementById('btn-next').textContent = idx === total - 1 ? 'finish →' : '→';

    // Update progress dots
    document.querySelectorAll('.pdot').forEach((dot, i) => {
      dot.classList.toggle('pdot-current', i === idx);
    });

    // If in focus mode, update the strip
    if (inFocus) updateFocusStrip(idx);
  }

  function go(idx)  { showSlide(idx); }
  function prev()   { if (current > 0) showSlide(current - 1); }
  function next()   { if (current < total - 1) showSlide(current + 1); else finish(); }

  function onKey(e) {
    if (document.activeElement.tagName === 'TEXTAREA') return;
    if (inFocus) {
      if (e.key === 'ArrowRight') { e.preventDefault(); nextFromFocus(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); prevFromFocus(); }
      if (e.key === 'Escape')     exitFocus();
      return;
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')  { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')    { e.preventDefault(); prev(); }
    if (e.key === ' ')  { e.preventDefault(); reveal(current); }
    if (e.key === '1')  grade(current, 'correct');
    if (e.key === '2')  grade(current, 'partial');
    if (e.key === '3')  grade(current, 'incorrect');
    if (e.key === 'f' || e.key === 'F') enterFocus(current);
  }

  // ── Focus Mode ────────────────────────────────────────

  function enterFocus(idx) {
    inFocus = true;
    const overlay = document.getElementById('focus-overlay');
    overlay.classList.remove('hidden');
    updateFocusStrip(idx);
    WB.enterFocusMode();
  }

  function exitFocus() {
    WB.exitFocusMode();
    inFocus = false;
    document.getElementById('focus-overlay').classList.add('hidden');
  }

  function prevFromFocus() { if (current > 0) { showSlide(current - 1); } }
  function nextFromFocus() { if (current < total - 1) { showSlide(current + 1); } else { exitFocus(); finish(); } }

  function revealFromFocus() {
    reveal(current);
    // Show solution in the focus strip
    const sol = document.getElementById('sol-' + current);
    if (sol) {
      const texts = Array.from(sol.querySelectorAll('.solution-text')).map(el => el.textContent.trim()).join(' · ');
      document.getElementById('focus-q-text').textContent = texts.substring(0, 200);
    }
    document.getElementById('focus-reveal-btn').style.display = 'none';
  }

  function updateFocusStrip(idx) {
    const label = document.getElementById('focus-q-label');
    const text  = document.getElementById('focus-q-text');
    const revBtn = document.getElementById('focus-reveal-btn');
    if (label) label.textContent = 'Q' + (cfg.qNums[idx] || (idx + 1));
    if (text)  text.textContent  = cfg.qTexts[idx] || '';
    if (revBtn) revBtn.style.display = revealed[idx] ? 'none' : '';
  }

  // ── Tabs ──────────────────────────────────────────────

  function switchTab(name) {
    activeTab = name;
    document.querySelectorAll('.tool-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.panel === name);
    });
    document.querySelectorAll('.tool-panel').forEach(p => {
      p.classList.toggle('hidden', p.id !== 'panel-' + name);
    });

    // Init Desmos lazily when calc tab is first opened
    if (name === 'calc' && !desmosCalc) {
      const el = document.getElementById('desmos-container');
      if (el && typeof Desmos !== 'undefined') {
        desmosCalc = Desmos.GraphingCalculator(el, {
          keypad: true, expressions: true, settingsMenu: false,
          zoomButtons: true, border: false, expressionsTopbar: false,
          backgroundColor: '#17171a'
        });
      }
    }
  }

  function expandCalc() {
    const modal = document.getElementById('calc-modal');
    modal.classList.remove('hidden');
    calcExpanded = true;
    const container = document.getElementById('desmos-container');
    document.getElementById('desmos-modal-container').appendChild(container);
    if (desmosCalc) setTimeout(() => desmosCalc.resize(), 80);
  }

  function collapseCalc() {
    const container = document.getElementById('desmos-container');
    const calcBody  = document.getElementById('panel-calc');
    calcBody.insertBefore(container, calcBody.firstChild);
    document.getElementById('calc-modal').classList.add('hidden');
    calcExpanded = false;
    if (desmosCalc) setTimeout(() => desmosCalc.resize(), 80);
  }

  // ── Tools panel toggle ────────────────────────────────

  function toggleTools() {
    toolsVisible = !toolsVisible;
    document.getElementById('ps-tools-col').classList.toggle('tools-hidden', !toolsVisible);
    document.getElementById('tools-toggle-icon').textContent = toolsVisible ? '›' : '‹';
  }

  // ── Timer ─────────────────────────────────────────────

  function toggleTimer() {
    timerVisible = !timerVisible;
    const el = document.getElementById('timer-display');
    el.classList.toggle('hidden', !timerVisible);
  }

  function updateTimerDisplay() {
    const m = Math.floor(seconds / 60), s = seconds % 60;
    document.getElementById('timer-display').textContent =
      String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  // ── Reveal & Grade ────────────────────────────────────

  function reveal(idx) {
    if (revealed[idx]) return;
    revealed[idx] = true;
    const sol    = document.getElementById('sol-' + idx);
    const revBtn = document.getElementById('reveal-btn-' + idx);
    const gradeBar = document.getElementById('grade-bar-' + idx);
    if (sol)      { sol.classList.remove('hidden'); sol.classList.add('sol-appear'); }
    if (revBtn)   revBtn.classList.add('hidden');
    if (gradeBar) gradeBar.classList.remove('hidden');
  }

  function grade(idx, g) {
    grades[idx] = g;
    applyGradeUI(idx, g);
    updateDot(idx);
  }

  function applyGradeUI(idx, g) {
    document.getElementById('grade-bar-' + idx)?.querySelectorAll('.grade-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.grade === g);
    });
  }

  function updateDot(idx) {
    const dot = document.getElementById('pdot-' + idx);
    if (!dot) return;
    dot.classList.remove('pdot-correct', 'pdot-partial', 'pdot-incorrect', 'pdot-answered');
    if (grades[idx]) dot.classList.add('pdot-' + grades[idx]);
  }

  // ── Progress saving ───────────────────────────────────

  function collectAnswers() {
    const out = [];
    document.querySelectorAll('.answer-input').forEach(ta => {
      const slide = ta.closest('.question-slide');
      if (!slide) return;
      out.push({
        questionId: ta.dataset.qid,
        response: ta.value,
        selfGrade: grades[parseInt(slide.dataset.index)] || null
      });
    });
    return out;
  }

  async function autoSave() {
    WB.saveToStorage();
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

  function finish() {
    clearInterval(timerInterval);
    timerRunning = false;
    WB.saveToStorage();
    if (inFocus) exitFocus();

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

    showEndScreen();
  }

  function showEndScreen() {
    document.querySelectorAll('.question-slide:not(#end-screen)').forEach(s => s.classList.remove('active'));
    const es = document.getElementById('end-screen');
    es.classList.remove('hidden');
    es.classList.add('active');

    const m = Math.floor(seconds / 60), s = seconds % 60;
    document.getElementById('end-time').textContent =
      'time: ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');

    const counts = { correct: 0, partial: 0, incorrect: 0, ungraded: 0 };
    for (let i = 0; i < total; i++) {
      const g = grades[i];
      if (g) counts[g]++; else counts.ungraded++;
    }

    document.getElementById('end-grades').innerHTML = `
      <div class="end-grade-item correct">  <span class="end-grade-num">${counts.correct}</span>  <span>correct</span></div>
      <div class="end-grade-item partial">  <span class="end-grade-num">${counts.partial}</span>  <span>partial</span></div>
      <div class="end-grade-item incorrect"><span class="end-grade-num">${counts.incorrect}</span><span>incorrect</span></div>
      ${counts.ungraded > 0 ? `<div class="end-grade-item ungraded"><span class="end-grade-num">${counts.ungraded}</span><span>ungraded</span></div>` : ''}
    `;

    let html = '';
    for (let i = 0; i < total; i++) {
      const g = grades[i] || 'ungraded';
      html += `<div class="end-q-row ${g}" onclick="PSApp.go(${i})"><span class="end-q-num">Q${i+1}</span><span class="end-q-grade">${g}</span></div>`;
    }
    document.getElementById('end-breakdown').innerHTML = html;
  }

  function restart() {
    revealed = {}; grades = {}; seconds = 0; timerRunning = true;
    document.querySelectorAll('.qcard-solution').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.btn-reveal').forEach(b => b.classList.remove('hidden'));
    document.querySelectorAll('.grade-bar').forEach(b => b.classList.add('hidden'));
    document.querySelectorAll('.grade-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.answer-input').forEach(ta => ta.value = '');
    document.querySelectorAll('.pdot').forEach(d => {
      d.classList.remove('pdot-correct','pdot-partial','pdot-incorrect','pdot-answered');
    });
    timerInterval = setInterval(() => {
      if (timerRunning) { seconds++; updateTimerDisplay(); }
    }, 1000);
    showSlide(0);
  }

  return {
    init, go, prev, next, reveal, grade,
    toggleTimer, toggleTools, switchTab, expandCalc, collapseCalc,
    enterFocus, exitFocus, prevFromFocus, nextFromFocus, revealFromFocus,
    finish, restart
  };
})();

document.addEventListener('DOMContentLoaded', PSApp.init);
