// problem-set.js — fullscreen canvas, collapsible problem + calc, part navigation

const PSApp = (() => {
  const cfg = window.__PS;

  let current = 0;
  let currentPart = 0;
  let total = cfg.totalQ;
  let seconds = (cfg.existing && cfg.existing.timeSpent) || 0;
  let timerRunning = true;
  let timerInterval = null;

  let questionPanelOpen = false;
  let calcOpen = false;

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

  function padKey(qi, part) {
    const qId = cfg.qIds[qi];
    const n = cfg.partsLayout[qi];
    if (n > 0) return qId + '-p' + part;
    return qId + '-main';
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
          if (a.part != null && String(ta.dataset.part) === String(a.part)) {
            ta.value = a.response || '';
          }
        } else if (a.part == null || a.part === undefined) {
          ta.value = a.response || '';
        }
      });
    });
  }

  function init() {
    if (cfg.existing && cfg.existing.answers) {
      cfg.existing.answers.forEach(a => {
        if (!a.questionId || !a.selfGrade) return;
        const idx = cfg.qIds.findIndex(id => String(id) === String(a.questionId));
        if (idx >= 0) {
          grades[idx] = a.selfGrade;
        }
      });
    }

    if (typeof WB !== 'undefined') {
      WB.init('wb-main-canvas', 'ps-canvas-shell');
    }

    initDesmos();
    setTimeout(() => desmosCalc && desmosCalc.resize(), 150);

    document.getElementById('ps-question-panel')?.addEventListener('click', e => {
      if (e.target.id === 'ps-question-panel') toggleQuestionPanel();
    });

    restoreAnswers();
    for (let i = 0; i < total; i++) {
      if (grades[i]) {
        applyGradeUI(i, grades[i]);
        updateDot(i);
      }
    }

    showSlide(0);
    requestAnimationFrame(() => {
      if (typeof WB !== 'undefined' && WB.resize) WB.resize();
    });

    timerInterval = setInterval(() => {
      if (timerRunning) {
        seconds++;
        updateTimerDisplay();
        if (cfg.timeLimit && seconds >= cfg.timeLimit * 60) {
          document.getElementById('timer-display')?.classList.add('timer-expired');
        }
      }
    }, 1000);
    updateTimerDisplay();

    document.addEventListener('keydown', onKey);
    setInterval(autoSave, 30000);
  }

  function showSlide(idx) {
    document.getElementById('end-screen')?.classList.add('hidden');
    document.querySelectorAll('.ps-q-slide').forEach(s => {
      s.classList.remove('active');
    });

    if (idx >= total) { finish(); return; }

    const slide = document.getElementById('slide-' + idx);
    if (!slide) return;
    slide.classList.add('active');
    current = idx;

    if (typeof WB !== 'undefined') {
      WB.saveToStorage();
      WB.switchPad(padKey(idx, currentPart));
    }

    if (grades[idx]) applyGradeUI(idx, grades[idx]);
    if (revealed[idx]) {
      document.getElementById('sol-' + idx)?.classList.remove('hidden');
      document.getElementById('reveal-btn-' + idx)?.classList.add('hidden');
      document.getElementById('grade-bar-' + idx)?.classList.remove('hidden');
    }

    document.getElementById('nav-pos').textContent = (idx + 1) + ' / ' + total;
    updateNavButtons();

    document.querySelectorAll('.pdot').forEach((dot, i) => {
      dot.classList.toggle('pdot-current', i === idx);
    });

    updateHud();
    highlightActivePart();
    setTimeout(() => desmosCalc && desmosCalc.resize(), 50);
  }

  function updateHud() {
    const el = document.getElementById('ps-hud-pos');
    if (!el) return;
    const qn = cfg.qNums[current] || String(current + 1);
    const n = cfg.partsLayout[current];
    if (n > 0) {
      el.textContent = 'Q' + qn + ' · ' + (currentPart + 1) + '/' + n;
    } else {
      el.textContent = 'Q' + qn;
    }
  }

  function highlightActivePart() {
    document.querySelectorAll('.qpart').forEach(p => p.classList.remove('qpart-active'));
    const slide = document.getElementById('slide-' + current);
    if (!slide) return;
    const n = cfg.partsLayout[current];
    if (n > 0) {
      const part = slide.querySelector('.qpart[data-part-index="' + currentPart + '"]');
      part?.classList.add('qpart-active');
    }
  }

  function go(idx) {
    currentPart = 0;
    showSlide(idx);
  }

  function prev() {
    const n = cfg.partsLayout[current];
    if (n > 0 && currentPart > 0) {
      currentPart--;
      if (typeof WB !== 'undefined') {
        WB.saveToStorage();
        WB.switchPad(padKey(current, currentPart));
      }
      updateHud();
      highlightActivePart();
      updateNavButtons();
    } else if (current > 0) {
      const prevQ = current - 1;
      const pn = cfg.partsLayout[prevQ];
      currentPart = pn > 0 ? pn - 1 : 0;
      showSlide(prevQ);
    }
  }

  function next() {
    const n = cfg.partsLayout[current];
    if (n > 0 && currentPart < n - 1) {
      currentPart++;
      if (typeof WB !== 'undefined') {
        WB.saveToStorage();
        WB.switchPad(padKey(current, currentPart));
      }
      updateHud();
      highlightActivePart();
      updateNavButtons();
    } else {
      currentPart = 0;
      if (current < total - 1) showSlide(current + 1);
      else finish();
    }
  }

  function toggleQuestionPanel() {
    questionPanelOpen = !questionPanelOpen;
    document.body.classList.toggle('ps-question-open', questionPanelOpen);
    const p = document.getElementById('ps-question-panel');
    if (p) {
      p.setAttribute('aria-hidden', questionPanelOpen ? 'false' : 'true');
    }
    document.getElementById('btn-toggle-problem')?.classList.toggle('active', questionPanelOpen);
  }

  function toggleCalc() {
    calcOpen = !calcOpen;
    document.body.classList.toggle('ps-calc-open', calcOpen);
    const d = document.getElementById('ps-calc-drawer');
    if (d) d.setAttribute('aria-hidden', calcOpen ? 'false' : 'true');
    document.getElementById('btn-toggle-calc')?.classList.toggle('active', calcOpen);
    if (calcOpen) {
      initDesmos();
      setTimeout(() => desmosCalc && desmosCalc.resize(), 80);
    }
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
    document.getElementById('panel-calc').appendChild(container);
    document.getElementById('calc-modal').classList.add('hidden');
    calcExpanded = false;
    if (desmosCalc) setTimeout(() => desmosCalc.resize(), 80);
  }

  function onKey(e) {
    if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); next(); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); prev(); }
    if (e.key === ' ') { e.preventDefault(); reveal(current); }
    if (e.key === '1') grade(current, 'correct');
    if (e.key === '2') grade(current, 'partial');
    if (e.key === '3') grade(current, 'incorrect');
    if (e.key === 'p' || e.key === 'P') toggleQuestionPanel();
    if (e.key === 'c' || e.key === 'C') toggleCalc();
  }

  function updateTimerDisplay() {
    const m = Math.floor(seconds / 60), s = seconds % 60;
    const el = document.getElementById('timer-display');
    if (el) {
      el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
  }

  function reveal(idx) {
    if (revealed[idx]) return;
    revealed[idx] = true;
    const sol = document.getElementById('sol-' + idx);
    const revBtn = document.getElementById('reveal-btn-' + idx);
    const gradeBar = document.getElementById('grade-bar-' + idx);
    if (sol) { sol.classList.remove('hidden'); sol.classList.add('sol-appear'); }
    if (revBtn) revBtn.classList.add('hidden');
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
      const qi = parseInt(slide.dataset.index, 10);
      const row = {
        questionId: ta.dataset.qid,
        response: ta.value,
        selfGrade: grades[qi] || null
      };
      if (ta.dataset.part !== undefined) row.part = parseInt(ta.dataset.part, 10);
      out.push(row);
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
    if (calcExpanded) collapseCalc();
    if (calcOpen) toggleCalc();
    if (questionPanelOpen) toggleQuestionPanel();

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
    document.querySelectorAll('.ps-q-slide').forEach(s => s.classList.remove('active'));
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
      <div class="end-grade-item incorrect"><span class="end-grade-num">${counts.incorrect}</span><span>incorrect</span></div>
      ${counts.ungraded > 0 ? `<div class="end-grade-item ungraded"><span class="end-grade-num">${counts.ungraded}</span><span>ungraded</span></div>` : ''}
    `;

    let html = '';
    for (let i = 0; i < total; i++) {
      const g = grades[i] || 'ungraded';
      html += `<div class="end-q-row ${g}" onclick="PSApp.go(${i})"><span class="end-q-num">Q${i + 1}</span><span class="end-q-grade">${g}</span></div>`;
    }
    document.getElementById('end-breakdown').innerHTML = html;
  }

  function restart() {
    document.getElementById('end-screen')?.classList.add('hidden');
    revealed = {}; grades = {}; seconds = 0; timerRunning = true;
    document.querySelectorAll('.qcard-solution').forEach(s => s.classList.add('hidden'));
    document.querySelectorAll('.btn-reveal').forEach(b => b.classList.remove('hidden'));
    document.querySelectorAll('.grade-bar').forEach(b => b.classList.add('hidden'));
    document.querySelectorAll('.grade-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.answer-input').forEach(ta => ta.value = '');
    document.querySelectorAll('.pdot').forEach(d => {
      d.classList.remove('pdot-correct', 'pdot-partial', 'pdot-incorrect', 'pdot-answered');
    });
    timerInterval = setInterval(() => {
      if (timerRunning) { seconds++; updateTimerDisplay(); }
    }, 1000);
    currentPart = 0;
    showSlide(0);
  }

  return {
    init, go, prev, next, reveal, grade,
    toggleQuestionPanel, toggleCalc, expandCalc, collapseCalc,
    finish, restart
  };
})();

document.addEventListener('DOMContentLoaded', PSApp.init);
