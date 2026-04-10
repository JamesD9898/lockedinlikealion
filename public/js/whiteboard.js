// whiteboard.js
// Apple Pencil-first canvas with pointer events, pressure sensitivity,
// palm rejection, bezier smoothing, per-question stroke storage.

const WB = (() => {
  // ── State ──────────────────────────────────────────────
  let mainCanvas, mainCtx;
  let focusCanvas, focusCtx;
  let activeCanvas, activeCtx;

  let drawing = false;
  let currentStroke = null;
  let strokes = [];        // completed strokes for current question
  let currentQId = null;
  let focusMode = false;
  let pointerId = null;

  let tool = 'pen';
  let color = '#e8e8e8';
  let baseWidth = 2;

  // Allow touch drawing toggle (off by default = palm rejection)
  let pencilOnly = true;

  // ── Init ───────────────────────────────────────────────

  function init(mainId, focusId) {
    mainCanvas = document.getElementById(mainId);
    focusCanvas = document.getElementById(focusId);
    if (!mainCanvas) return;

    mainCtx = mainCanvas.getContext('2d', { willReadFrequently: false });
    if (focusCanvas) focusCtx = focusCanvas.getContext('2d', { willReadFrequently: false });

    activeCanvas = mainCanvas;
    activeCtx = mainCtx;

    setupCanvas(mainCanvas, mainCtx);
    if (focusCanvas) setupCanvas(focusCanvas, focusCtx);

    bindEvents(mainCanvas);
    if (focusCanvas) bindEvents(focusCanvas);

    // Resize observer
    const ro = new ResizeObserver(() => {
      resizeCanvas(mainCanvas, mainCtx);
    });
    const container = mainCanvas.parentElement;
    if (container) ro.observe(container);
  }

  function setupCanvas(canvas, ctx) {
    resizeCanvas(canvas, ctx);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = true;
  }

  function resizeCanvas(canvas, ctx) {
    const container = canvas.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = rect.width || container.offsetWidth;
    const h = rect.height || container.offsetHeight;
    if (w === 0 || h === 0) return;

    // Save existing content
    let saved = null;
    if (canvas.width > 0 && canvas.height > 0) {
      try { saved = ctx.getImageData(0, 0, canvas.width, canvas.height); } catch(e) {}
    }

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Redraw from strokes (crisp on resize)
    if (ctx === activeCtx || ctx === mainCtx) redraw();
  }

  // ── Pointer Events ─────────────────────────────────────

  function bindEvents(canvas) {
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  function isPencil(e) {
    return e.pointerType === 'pen' || e.pointerType === 'stylus';
  }

  function shouldDraw(e) {
    if (pencilOnly) return isPencil(e);
    return true;
  }

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      p: e.pressure > 0 ? e.pressure : 0.5  // default 0.5 for mouse
    };
  }

  function onDown(e) {
    e.preventDefault();
    if (!shouldDraw(e)) return;
    if (e.target !== activeCanvas) return;

    pointerId = e.pointerId;
    e.target.setPointerCapture(e.pointerId);
    drawing = true;

    const pos = getPos(e, e.target);
    currentStroke = {
      tool,
      color: tool === 'eraser' ? null : color,
      width: baseWidth,
      pts: [[pos.x, pos.y, pos.p]]
    };

    // Draw a dot immediately
    const ctx = activeCtx;
    ctx.save();
    ctx.beginPath();
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.arc(pos.x, pos.y, getEraserRadius(), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
      ctx.arc(pos.x, pos.y, calcWidth(pos.p) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function onMove(e) {
    e.preventDefault();
    if (!drawing || !currentStroke || e.pointerId !== pointerId) return;

    const pts = currentStroke.pts;
    const pos = getPos(e, activeCanvas);
    pts.push([pos.x, pos.y, pos.p]);

    const ctx = activeCtx;
    ctx.save();

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      const prev = pts[pts.length - 2];
      ctx.lineWidth = getEraserRadius() * 2;
      ctx.lineCap = 'round';
      ctx.moveTo(prev[0], prev[1]);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (pts.length >= 3) {
        // Bezier through midpoints for smoothness
        const i = pts.length - 1;
        const prev2 = pts[i - 2], prev1 = pts[i - 1], curr = pts[i];
        const midX1 = (prev2[0] + prev1[0]) / 2;
        const midY1 = (prev2[1] + prev1[1]) / 2;
        const midX2 = (prev1[0] + curr[0]) / 2;
        const midY2 = (prev1[1] + curr[1]) / 2;
        const w = calcWidth((prev1[2] + curr[2]) / 2);
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(midX1, midY1);
        ctx.quadraticCurveTo(prev1[0], prev1[1], midX2, midY2);
        ctx.stroke();
      } else if (pts.length === 2) {
        const prev = pts[0];
        ctx.lineWidth = calcWidth(pos.p);
        ctx.beginPath();
        ctx.moveTo(prev[0], prev[1]);
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function onUp(e) {
    if (!drawing) return;
    drawing = false;
    pointerId = null;

    if (currentStroke && currentStroke.pts.length > 0) {
      // Normalize points to 0-1 for storage
      const dpr = window.devicePixelRatio || 1;
      const w = activeCanvas.width / dpr;
      const h = activeCanvas.height / dpr;
      const normalized = currentStroke.pts.map(([x, y, p]) => [
        parseFloat((x / w).toFixed(4)),
        parseFloat((y / h).toFixed(4)),
        parseFloat(p.toFixed(3))
      ]);
      strokes.push({ ...currentStroke, pts: normalized });
      saveToStorage();
    }
    currentStroke = null;
  }

  // ── Drawing helpers ────────────────────────────────────

  function calcWidth(pressure) {
    // Maps pressure 0-1 → width range based on base width
    const min = baseWidth * 0.4;
    const max = baseWidth * 2.2;
    return min + pressure * (max - min);
  }

  function getEraserRadius() {
    return baseWidth * 8;
  }

  // ── Redraw all strokes ─────────────────────────────────

  function redraw(ctx, canvas) {
    const c = ctx || activeCtx;
    const cv = canvas || activeCanvas;
    if (!c || !cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.width / dpr;
    const h = cv.height / dpr;

    c.clearRect(0, 0, w, h);
    c.save();

    for (const stroke of strokes) {
      replayStroke(c, stroke, w, h);
    }
    c.restore();
  }

  function replayStroke(ctx, stroke, w, h) {
    if (!stroke.pts || stroke.pts.length === 0) return;
    const pts = stroke.pts.map(([nx, ny, p]) => [nx * w, ny * h, p]);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], stroke.width * 8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = stroke.width * 16;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;

      if (pts.length === 1) {
        const r = calcWidthFromBase(pts[0][2], stroke.width) / 2;
        ctx.fillStyle = stroke.color;
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Bezier replay with pressure variation
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1], p1 = pts[i];
          ctx.lineWidth = calcWidthFromBase((p0[2] + p1[2]) / 2, stroke.width);
          ctx.beginPath();
          if (i >= 2) {
            const prev = pts[i - 2];
            const midX1 = (prev[0] + p0[0]) / 2;
            const midY1 = (prev[1] + p0[1]) / 2;
            const midX2 = (p0[0] + p1[0]) / 2;
            const midY2 = (p0[1] + p1[1]) / 2;
            ctx.moveTo(midX1, midY1);
            ctx.quadraticCurveTo(p0[0], p0[1], midX2, midY2);
          } else {
            ctx.moveTo(p0[0], p0[1]);
            ctx.lineTo(p1[0], p1[1]);
          }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  function calcWidthFromBase(pressure, base) {
    const min = base * 0.4;
    const max = base * 2.2;
    return min + pressure * (max - min);
  }

  // ── Question switching ─────────────────────────────────

  function switchQuestion(qId) {
    if (currentQId === qId) return;
    if (currentQId) saveToStorage();
    currentQId = qId;
    loadFromStorage(qId);
  }

  // ── Storage ────────────────────────────────────────────

  function storageKey(qId) { return 'wb-' + qId; }

  function saveToStorage() {
    if (!currentQId) return;
    try {
      localStorage.setItem(storageKey(currentQId), JSON.stringify(strokes));
    } catch(e) { console.warn('WB: localStorage full', e); }
  }

  function loadFromStorage(qId) {
    try {
      const saved = localStorage.getItem(storageKey(qId));
      strokes = saved ? JSON.parse(saved) : [];
    } catch(e) { strokes = []; }
    redraw();
  }

  // ── Tools ──────────────────────────────────────────────

  function setTool(t) {
    tool = t;
    updateToolUI();
  }

  function setColor(c) {
    color = c;
    if (tool === 'eraser') tool = 'pen';
    updateToolUI();
    document.querySelectorAll('.wbc-swatch.active').forEach(s => s.classList.remove('active'));
    const swatch = document.querySelector(`.wbc-swatch[data-color="${c}"]`);
    if (swatch) swatch.classList.add('active');
  }

  function setWidth(w) {
    baseWidth = w;
    document.querySelectorAll('.wbc-size.active').forEach(s => s.classList.remove('active'));
    const sizeBtn = document.querySelector(`.wbc-size[data-w="${w}"]`);
    if (sizeBtn) sizeBtn.classList.add('active');
  }

  function undo() {
    if (strokes.length === 0) return;
    strokes.pop();
    redraw();
    saveToStorage();
  }

  function clear() {
    strokes = [];
    redraw();
    saveToStorage();
  }

  function updateToolUI() {
    document.querySelectorAll('.wbc-tool').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
  }

  // ── Focus mode ─────────────────────────────────────────

  function enterFocusMode() {
    if (!focusCanvas || !focusCtx) return;
    focusMode = true;
    activeCanvas = focusCanvas;
    activeCtx = focusCtx;

    // Size focus canvas
    resizeCanvas(focusCanvas, focusCtx);

    // Copy strokes to focus canvas (same stroke data, different size)
    redraw(focusCtx, focusCanvas);
  }

  function exitFocusMode() {
    if (!focusMode) return;
    focusMode = false;
    // Save current strokes (same strokes array, we've been adding to it in focus mode)
    saveToStorage();
    activeCanvas = mainCanvas;
    activeCtx = mainCtx;
    // Redraw main canvas
    redraw(mainCtx, mainCanvas);
  }

  // ── Notes thumbnail rendering ──────────────────────────

  function renderThumbnail(canvasEl, qId) {
    try {
      const saved = localStorage.getItem(storageKey(qId));
      if (!saved) return;
      const thumbStrokes = JSON.parse(saved);
      if (!thumbStrokes || thumbStrokes.length === 0) return;

      const ctx = canvasEl.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvasEl.width / dpr;
      const h = canvasEl.height / dpr;
      ctx.save();
      for (const stroke of thumbStrokes) {
        replayStroke(ctx, stroke, w, h);
      }
      ctx.restore();
      return true;
    } catch(e) { return false; }
  }

  function hasNotes(qId) {
    try {
      const saved = localStorage.getItem(storageKey(qId));
      if (!saved) return false;
      const s = JSON.parse(saved);
      return s && s.length > 0;
    } catch(e) { return false; }
  }

  return {
    init, switchQuestion, setTool, setColor, setWidth, undo, clear,
    enterFocusMode, exitFocusMode, renderThumbnail, hasNotes,
    saveToStorage
  };
})();
