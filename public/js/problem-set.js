// problem-set.js — per-part scratch pads, calculator column, focus mode

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
  let focusPadKey = null;

  let revealed = {};
  let grades = {};

  let desmosCalc = null;
  let calcExpanded = false;

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
    if (desmosCalc) return;
    const el = document.getElementById('desmos-container');
    if (el && typeof Desmos !== 'undefined') {
      desmosCalc = Desmos.GraphingCalculator(el, DESMOS_OPTS);
    }
  }

  function defaultPadKeyForSlide(qi) {
    const slide = document.getElementById('slide-' + qi);
    const first = slide && slide.querySelector('[data-wb-root]');
    if (first && first.dataset.wbKey) return first.dataset.wbKey;
    const qId = cfg.qIds && cfg.qIds[qi];
    return qId ? qId + '-main' : null;
  }

  function initColumnResizer() {
    const main = document.getElementById('ps-main');
    const handle = document.getElementById('ps-col-resizer');
    if (!main || !handle) return;

    const clamp = () => {
      const max = Math.min(window.innerWidth * 0.72, 760);
      const min = 240;
      const raw = parseFloat(getComputedStyle(main).getPropertyValue('--ps-tools-w')) || 400;
      const v = Math.max(min, Math.min(max, raw));
      main.style.setProperty('--ps-tools-w', v + 'px');
    };
    clamp();
    window.addEventListener('resize', clamp);

    let dragging = false;
    handle.addEventListener('mousedown', e => {
      dragging = true;
      e.preventDefault();
      document.body.style.cursor = 'col-resize';
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const rect = main.getBoundingClientRect();
      const w = rect.right - e.clientX;
      const max = Math.min(window.innerWidth * 0.72, 760);
      const tw = Math.max(240, Math.min(max, w));
      main.style.setProperty('--ps-tools-w', tw + 'px');
    });
    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = '';
      }
    });
  }

  function init() {
    if (typeof WB !== 'undefined') {
      WB.initFocusCanvas('wb-focus-canvas');
    }

    initDesmos();
    setTimeout(() => desmosCalc && desmosCalc.resize(), 120);

    const slide0 = document.getElementById('slide-0');
    if (slide0 && typeof WB !== 'undefined') WB.ensurePadsInSlide(slide0);

    showSlide(0);

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

    document.addEventListener('keydown', onKey);

    setInterval(autoSave, 30000);

    document.querySelector('#ps-tools-col')?.addEventListener('touchmove', e => {
      if (e.touches.length === 1) e.preventDefault();
    }, { passive: false });

    initColumnResizer();
  }

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

    if (typeof WB !== 'undefined') {
      WB.switchQuestion();
      WB.ensurePadsInSlide(slide);
    }

    if (grades[idx]) applyGradeUI(idx, grades[idx]);
    if (revealed[idx]) {
      document.getElementById('sol-' + idx)?.classList.remove('hidden');
      document.getElementById('reveal-btn-' + idx)?.classList.add('hidden');
      document.getElementById('grade-bar-' + idx)?.classList.remove('hidden');
    }

    document.getElementById('nav-pos').textContent = (idx + 1) + ' / ' + total;
    document.getElementById('btn-prev').disabled = idx === 0;
    document.getElementById('btn-next').textContent = idx === total - 1 ? 'finish →' : '→';

    document.querySelectorAll('.pdot').forEach((dot, i) => {
      dot.classList.toggle('pdot-current', i === idx);
    });

    if (inFocus) {
      updateFocusStrip(idx);
      const key = defaultPadKeyForSlide(idx);
      if (key && typeof WB !== 'undefined') {
        WB.ensurePadsInSlide(slide);
        if (WB.getPad(key)) {
          focusPadKey = key;
          WB.enterFocusMode(key);
        }
      }
    }

    setTimeout(() => desmosCalc && desmosCalc.resize(), 50);
  }

  function go(idx)  { showSlide(idx); }
  function prev()   { if (current > 0) showSlide(current - 1); }
  function next()   { if (current < total - 1) showSlide(current + 1); else finish(); }

  function onKey(e) {
    if (document.activeElement.tagName === 'TEXTAREA') return;
    if (inFocus) {
      if (e.key === 'ArrowRight') { e.preventDefault(); nextFromFocus(); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); prevFromFocus(); }
      if (e.key === 'Escape')     { e.preventDefault(); exitFocus(); }
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

  function enterFocus(idx) {
    const key = defaultPadKeyForSlide(idx);
    enterFocusForPad(key);
  }

  function enterFocusForPad(padKey) {
    if (!padKey || typeof WB === 'undefined') return;
    if (!WB.getPad(padKey)) {
      const slide = document.getElementById('slide-' + current);
      if (slide) WB.ensurePadsInSlide(slide);
    }
    if (!WB.getPad(padKey)) return;

    focusPadKey = padKey;
    inFocus = true;
    document.getElementById('focus-overlay').classList.remove('hidden');
    updateFocusStrip(current);
    WB.enterFocusMode(padKey);
  }

  function exitFocus() {
    if (typeof WB !== 'undefined') WB.exitFocusMode();
    inFocus = false;
    focusPadKey = null;
    document.getElementById('focus-overlay').classList.add('hidden');
  }

  function prevFromFocus() { if (current > 0) { showSlide(current - 1); } }
  function nextFromFocus() { if (current < total - 1) { showSlide(current + 1); } else { exitFocus(); finish(); } }

  function revealFromFocus() {
    reveal(current);
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

  function expandCalc() {
    initDesmos();
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
    calcBody.appendChild(container);
    document.getElementById('calc-modal').classList.add('hidden');
    calcExpanded = false;
    if (desmosCalc) setTimeout(() => desmosCalc.resize(), 80);
  }

  function toggleTools() {
    toolsVisible = !toolsVisible;
    const col = document.getElementById('ps-tools-col');
    const rz = document.getElementById('ps-col-resizer');
    const main = document.getElementById('ps-main');
    col.classList.toggle('tools-hidden', !toolsVisible);
    if (rz) rz.classList.toggle('hidden', !toolsVisible);
    main?.classList.toggle('tools-panel-hidden', !toolsVisible);
    document.getElementById('tools-toggle-icon').textContent = toolsVisible ? '›' : '‹';
  }

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
    if (typeof WB !== 'undefined') WB.saveToStorage();
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
    if (typeof WB !== 'undefined') WB.saveToStorage();
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
    toggleTimer, toggleTools, expandCalc, collapseCalc,
    enterFocus, enterFocusForPad, exitFocus, prevFromFocus, nextFromFocus, revealFromFocus,
    finish, restart
  };
})();

document.addEventListener('DOMContentLoaded', PSApp.init);
