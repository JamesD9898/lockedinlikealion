// whiteboard.js — single full-screen canvas, per-key localStorage, normalized strokes

const WB = (() => {
  let canvas = null;
  let ctx = null;
  let container = null;
  let ro = null;

  let activeKey = null;
  let strokes = [];

  let tool = 'pen';
  let color = '#1c1c1c';
  let baseWidth = 2;
  let pencilOnly = false;

  let logicalW = 1;
  let logicalH = 1;

  let drawing = false;
  let currentStroke = null;
  let pointerId = null;

  function storageKeyForPad(key) {
    return 'wb-' + key;
  }

  function legacyMainId(padKey) {
    const m = String(padKey).match(/^(.+)-main$/);
    return m ? m[1] : null;
  }

  function parseStrokes(json) {
    try {
      const data = JSON.parse(json);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function loadStrokesForKey(padKey) {
    const k = storageKeyForPad(padKey);
    let raw = localStorage.getItem(k);
    if (raw) return parseStrokes(raw);
    if (padKey.endsWith('-main')) {
      const qid = legacyMainId(padKey);
      if (qid) {
        raw = localStorage.getItem('wb-' + qid);
        if (raw) return parseStrokes(raw);
      }
    }
    return [];
  }

  function saveStrokesToKey(padKey, list) {
    try {
      localStorage.setItem(storageKeyForPad(padKey), JSON.stringify(list));
    } catch (e) {
      console.warn('WB: localStorage', e);
    }
  }

  function calcWidth(pressure) {
    const min = baseWidth * 0.4;
    const max = baseWidth * 2.2;
    return min + pressure * (max - min);
  }

  function calcWidthFromBase(pressure, base) {
    const min = base * 0.4;
    const max = base * 2.2;
    return min + pressure * (max - min);
  }

  function getEraserRadius(base) {
    return base * 8;
  }

  function replayStroke(c, stroke, w, h) {
    if (!stroke.pts || stroke.pts.length === 0) return;
    const pts = stroke.pts.map(([nx, ny, p]) => [nx * w, ny * h, p]);

    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
      c.globalCompositeOperation = 'destination-out';
      const er = getEraserRadius(stroke.width);
      if (pts.length === 1) {
        c.beginPath();
        c.arc(pts[0][0], pts[0][1], er, 0, Math.PI * 2);
        c.fill();
      } else {
        c.lineWidth = er * 2;
        c.beginPath();
        c.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
        c.stroke();
      }
    } else if (stroke.tool === 'highlighter') {
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = stroke.color || 'rgba(255, 214, 102, 0.38)';
      replayPenLike(c, pts, stroke.width, true);
    } else if (stroke.tool === 'strike') {
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = stroke.color || 'rgba(196, 48, 48, 0.88)';
      replayPenLike(c, pts, stroke.width, true);
    } else {
      c.globalCompositeOperation = 'source-over';
      c.strokeStyle = stroke.color;
      replayPenLike(c, pts, stroke.width, false);
    }
    c.restore();
  }

  function replayPenLike(c, pts, widthScale, fixedWidth) {
    if (pts.length === 1) {
      const r = fixedWidth ? widthScale / 2 : calcWidthFromBase(pts[0][2], widthScale) / 2;
      c.fillStyle = c.strokeStyle;
      c.beginPath();
      c.arc(pts[0][0], pts[0][1], r, 0, Math.PI * 2);
      c.fill();
      return;
    }
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      c.lineWidth = fixedWidth ? widthScale : calcWidthFromBase((p0[2] + p1[2]) / 2, widthScale);
      c.beginPath();
      if (i >= 2) {
        const prev = pts[i - 2];
        const midX1 = (prev[0] + p0[0]) / 2;
        const midY1 = (prev[1] + p0[1]) / 2;
        const midX2 = (p0[0] + p1[0]) / 2;
        const midY2 = (p0[1] + p1[1]) / 2;
        c.moveTo(midX1, midY1);
        c.quadraticCurveTo(p0[0], p0[1], midX2, midY2);
      } else {
        c.moveTo(p0[0], p0[1]);
        c.lineTo(p1[0], p1[1]);
      }
      c.stroke();
    }
  }

  function redraw() {
    if (!ctx) return;
    const w = logicalW;
    const h = logicalH;
    ctx.save();
    ctx.fillStyle = '#fbf9f4';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(180, 175, 160, 0.1)';
    const dot = 14;
    for (let y = 0; y < h; y += dot) {
      for (let x = 0; x < w; x += dot) {
        ctx.beginPath();
        ctx.arc(x + dot / 2, y + dot / 2, 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    for (const s of strokes) replayStroke(ctx, s, w, h);
  }

  function getCanvasCoords(e) {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const lw = canvas.width / dpr;
    const lh = canvas.height / dpr;
    const x = ((e.clientX - rect.left) / rect.width) * lw;
    const y = ((e.clientY - rect.top) / rect.height) * lh;
    const p = e.pressure > 0 ? e.pressure : 0.5;
    return { x, y, p };
  }

  function isPencil(e) {
    return e.pointerType === 'pen' || e.pointerType === 'stylus';
  }

  function shouldDraw(e) {
    if (pencilOnly) return isPencil(e);
    return true;
  }

  function strokeColorForTool() {
    if (tool === 'highlighter') return 'rgba(255, 214, 102, 0.42)';
    if (tool === 'strike') return 'rgba(196, 48, 48, 0.9)';
    return color;
  }

  function strokeWidthForTool() {
    if (tool === 'highlighter') return baseWidth * 2.8;
    if (tool === 'strike') return baseWidth * 2.6;
    return baseWidth;
  }

  function onDown(e) {
    if (e.target !== canvas) return;
    e.preventDefault();
    if (!shouldDraw(e)) return;

    pointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    drawing = true;

    const pos = getCanvasCoords(e);
    const w = logicalW;
    const h = logicalH;
    currentStroke = {
      v: 2,
      tool,
      color: tool === 'eraser' ? null : strokeColorForTool(),
      width: strokeWidthForTool(),
      pts: [[pos.x / w, pos.y / h, pos.p]]
    };

    ctx.save();
    ctx.beginPath();
    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.arc(pos.x, pos.y, getEraserRadius(baseWidth), 0, Math.PI * 2);
      ctx.fill();
    } else if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = currentStroke.color;
      ctx.arc(pos.x, pos.y, strokeWidthForTool() / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (tool === 'strike') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = currentStroke.color;
      ctx.arc(pos.x, pos.y, strokeWidthForTool() / 2.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = color;
      ctx.arc(pos.x, pos.y, calcWidth(pos.p) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawSegment(pts, fixedWidth) {
    const w = logicalW;
    const h = logicalH;
    if (pts.length >= 3) {
      const i = pts.length - 1;
      const prev2 = pts[i - 2], prev1 = pts[i - 1], curr = pts[i];
      const ax = prev2[0] * w, ay = prev2[1] * h;
      const bx = prev1[0] * w, by = prev1[1] * h;
      const cx = curr[0] * w, cy = curr[1] * h;
      const midX1 = (ax + bx) / 2;
      const midY1 = (ay + by) / 2;
      const midX2 = (bx + cx) / 2;
      const midY2 = (by + cy) / 2;
      const lw = fixedWidth ? strokeWidthForTool() : calcWidth((prev1[2] + curr[2]) / 2);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(midX1, midY1);
      ctx.quadraticCurveTo(bx, by, midX2, midY2);
      ctx.stroke();
    } else if (pts.length === 2) {
      const prev = pts[0];
      const nx = prev[0] * w;
      const ny = prev[1] * h;
      const pos = pts[1];
      const px = pos[0] * w;
      const py = pos[1] * h;
      ctx.lineWidth = fixedWidth ? strokeWidthForTool() : calcWidth(pos[2]);
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
  }

  function onMove(e) {
    if (!drawing || !currentStroke || e.pointerId !== pointerId) return;
    if (e.target !== canvas) return;
    e.preventDefault();

    const pts = currentStroke.pts;
    const pos = getCanvasCoords(e);
    const w = logicalW;
    const h = logicalH;
    pts.push([pos.x / w, pos.y / h, pos.p]);

    ctx.save();

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      const prev = pts[pts.length - 2];
      ctx.lineWidth = getEraserRadius(baseWidth) * 2;
      ctx.lineCap = 'round';
      ctx.moveTo(prev[0] * w, prev[1] * h);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentStroke.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawSegment(pts, true);
    } else if (tool === 'strike') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentStroke.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawSegment(pts, true);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawSegment(pts, false);
    }
    ctx.restore();
  }

  function onUp() {
    if (!drawing) return;
    drawing = false;
    pointerId = null;

    if (currentStroke && currentStroke.pts.length > 0 && activeKey) {
      strokes.push(currentStroke);
      saveStrokesToKey(activeKey, strokes);
    }
    currentStroke = null;
  }

  function bindCanvas() {
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  function syncToolbar() {
    const tb = document.getElementById('wb-main-toolbar');
    if (!tb) return;
    tb.querySelectorAll('.wbc-tool').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    tb.querySelectorAll('.wbc-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === color && tool !== 'eraser');
    });
    tb.querySelectorAll('.wbc-size').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.w) === baseWidth);
    });
  }

  function wireToolbar() {
    const tb = document.getElementById('wb-main-toolbar');
    if (!tb) return;

    tb.querySelectorAll('.wbc-tool').forEach(btn => {
      btn.addEventListener('click', () => {
        setTool(btn.dataset.tool);
        tb.querySelectorAll('.wbc-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
      });
    });
    tb.querySelectorAll('.wbc-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        setColor(btn.dataset.color);
        tb.querySelectorAll('.wbc-swatch').forEach(b =>
          b.classList.toggle('active', b.dataset.color === color && tool !== 'eraser')
        );
      });
    });
    tb.querySelectorAll('.wbc-size').forEach(btn => {
      btn.addEventListener('click', () => {
        setWidth(parseFloat(btn.dataset.w));
        tb.querySelectorAll('.wbc-size').forEach(b =>
          b.classList.toggle('active', parseFloat(b.dataset.w) === baseWidth)
        );
      });
    });
    tb.querySelector('[data-wb-undo]')?.addEventListener('click', () => undo());
    tb.querySelector('[data-wb-clear]')?.addEventListener('click', () => {
      if (confirm('clear this sheet?')) clear();
    });
    tb.querySelector('[data-wb-finger]')?.addEventListener('click', e => {
      pencilOnly = !pencilOnly;
      e.currentTarget.classList.toggle('active', !pencilOnly);
    });
  }

  function resize() {
    if (!canvas || !ctx || !container) return;
    const rect = container.getBoundingClientRect();
    logicalW = rect.width;
    logicalH = rect.height;
    if (logicalW < 8 || logicalH < 8) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = logicalW * dpr;
    canvas.height = logicalH * dpr;
    canvas.style.width = logicalW + 'px';
    canvas.style.height = logicalH + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = true;
    redraw();
  }

  function init(canvasId, containerId) {
    canvas = document.getElementById(canvasId);
    container = document.getElementById(containerId);
    if (!canvas || !container) return;
    ctx = canvas.getContext('2d', { willReadFrequently: false });
    bindCanvas();
    wireToolbar();
    ro = new ResizeObserver(() => resize());
    ro.observe(container);
    resize();
    syncToolbar();
  }

  function switchPad(padKey) {
    if (!padKey) return;
    if (activeKey === padKey) {
      resize();
      return;
    }
    if (activeKey) saveStrokesToKey(activeKey, strokes);
    activeKey = padKey;
    strokes = loadStrokesForKey(padKey);
    redraw();
  }

  function saveToStorage() {
    if (activeKey) saveStrokesToKey(activeKey, strokes);
  }

  function setTool(t) {
    tool = t;
    syncToolbar();
  }

  function setColor(c) {
    color = c;
    if (tool === 'eraser') tool = 'pen';
    syncToolbar();
  }

  function setWidth(w) {
    baseWidth = w;
    syncToolbar();
  }

  function undo() {
    if (strokes.length === 0) return;
    strokes.pop();
    redraw();
    if (activeKey) saveStrokesToKey(activeKey, strokes);
  }

  function clear() {
    strokes = [];
    redraw();
    if (activeKey) saveStrokesToKey(activeKey, strokes);
  }

  function allStrokeKeysForQuestion(qId) {
    const id = String(qId);
    const out = [];
    if (localStorage.getItem('wb-' + id)) out.push(id);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('wb-' + id + '-')) continue;
      out.push(k.slice(3));
    }
    return [...new Set(out)];
  }

  function renderThumbnail(canvasEl, qId) {
    const keys = allStrokeKeysForQuestion(qId);
    if (keys.length === 0) return false;
    const merged = [];
    keys.forEach(k => merged.push(...loadStrokesForKey(k)));
    if (merged.length === 0) return false;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvasEl.width / dpr;
    const ch = canvasEl.height / dpr;
    const c = canvasEl.getContext('2d');
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.scale(dpr, dpr);
    c.fillStyle = '#f5f3ee';
    c.fillRect(0, 0, cw, ch);
    for (const s of merged) replayStroke(c, s, cw, ch);
    c.restore();
    return true;
  }

  function hasNotes(qId) {
    return allStrokeKeysForQuestion(qId).some(k => loadStrokesForKey(k).length > 0);
  }

  function getActiveKey() {
    return activeKey;
  }

  return {
    init,
    switchPad,
    saveToStorage,
    setTool,
    setColor,
    setWidth,
    undo,
    clear,
    renderThumbnail,
    hasNotes,
    getActiveKey,
    resize
  };
})();
