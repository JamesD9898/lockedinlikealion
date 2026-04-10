// whiteboard.js — per-part pads, scroll/zoom, focus overlay, localStorage

const WB = (() => {
  const DOC_W = 1000;
  const DOC_H = 1600;

  const pads = new Map();

  let focusCanvas = null;
  let focusCtx = null;
  let focusPadKey = null;
  let focusMode = false;

  let tool = 'pen';
  let color = '#1c1c1c';
  let baseWidth = 2;
  let pencilOnly = true;

  let drawing = false;
  let currentStroke = null;
  let pointerId = null;
  let activePad = null;

  function storageKeyForPad(key) {
    return 'wb-' + key;
  }

  function legacyQuestionId(padKey) {
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
      const qid = legacyQuestionId(padKey);
      if (qid) {
        raw = localStorage.getItem('wb-' + qid);
        if (raw) return parseStrokes(raw);
      }
    }
    return [];
  }

  function saveStrokes(padKey, strokes) {
    try {
      localStorage.setItem(storageKeyForPad(padKey), JSON.stringify(strokes));
    } catch (e) {
      console.warn('WB: localStorage', e);
    }
  }

  function setCanvasPixels(canvas, ctx) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = DOC_W * dpr;
    canvas.height = DOC_H * dpr;
    canvas.style.width = DOC_W + 'px';
    canvas.style.height = DOC_H + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.imageSmoothingEnabled = true;
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

  function replayStroke(ctx, stroke, w, h) {
    if (!stroke.pts || stroke.pts.length === 0) return;
    const pts = stroke.pts.map(([nx, ny, p]) => [nx * w, ny * h, p]);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      const er = getEraserRadius(stroke.width);
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], er, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.lineWidth = er * 2;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    } else if (stroke.tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color || 'rgba(255, 214, 102, 0.38)';
      replayPenLike(ctx, pts, stroke.width, true);
    } else if (stroke.tool === 'strike') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color || 'rgba(196, 48, 48, 0.88)';
      replayPenLike(ctx, pts, stroke.width, true);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = stroke.color;
      replayPenLike(ctx, pts, stroke.width, false);
    }
    ctx.restore();
  }

  function replayPenLike(ctx, pts, widthScale, fixedWidth) {
    if (pts.length === 1) {
      const r = fixedWidth ? widthScale / 2 : calcWidthFromBase(pts[0][2], widthScale) / 2;
      ctx.fillStyle = ctx.strokeStyle;
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], r, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1], p1 = pts[i];
      ctx.lineWidth = fixedWidth ? widthScale : calcWidthFromBase((p0[2] + p1[2]) / 2, widthScale);
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

  function redrawPad(pad, ctx, canvas) {
    const c = ctx || pad.ctx;
    const cv = canvas || pad.canvas;
    if (!c || !cv) return;
    const w = DOC_W;
    const h = DOC_H;
    c.save();
    c.fillStyle = '#fbf9f4';
    c.fillRect(0, 0, w, h);
    c.fillStyle = 'rgba(180, 175, 160, 0.11)';
    const dot = 14;
    for (let y = 0; y < h; y += dot) {
      for (let x = 0; x < w; x += dot) {
        c.beginPath();
        c.arc(x + dot / 2, y + dot / 2, 0.55, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.restore();
    for (const s of pad.strokes) replayStroke(c, s, w, h);
  }

  function getCanvasCoords(e, canvas) {
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

  function padFromEventTarget(target) {
    const root = target.closest('[data-wb-root]');
    if (!root) return null;
    const key = root.dataset.wbKey;
    return key ? pads.get(key) : null;
  }

  function onDown(e) {
    const canvasEl = focusMode ? focusCanvas : e.target;
    if (!focusMode && e.target.classList?.contains?.('wb-pad-canvas') === false) return;
    if (focusMode && e.target !== focusCanvas) return;

    e.preventDefault();
    if (!shouldDraw(e)) return;

    const pad = focusMode ? pads.get(focusPadKey) : padFromEventTarget(e.target);
    if (!pad) return;

    activePad = pad;
    pointerId = e.pointerId;
    canvasEl.setPointerCapture(e.pointerId);
    drawing = true;

    const pos = getCanvasCoords(e, canvasEl);
    currentStroke = {
      v: 2,
      tool,
      color: tool === 'eraser' ? null : strokeColorForTool(),
      width: strokeWidthForTool(),
      pts: [[pos.x / DOC_W, pos.y / DOC_H, pos.p]]
    };

    const ctx = canvasEl.getContext('2d');
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

  function drawSegment(ctx, pts, fixedWidth) {
    if (pts.length >= 3) {
      const i = pts.length - 1;
      const prev2 = pts[i - 2], prev1 = pts[i - 1], curr = pts[i];
      const ax = prev2[0] * DOC_W, ay = prev2[1] * DOC_H;
      const bx = prev1[0] * DOC_W, by = prev1[1] * DOC_H;
      const cx = curr[0] * DOC_W, cy = curr[1] * DOC_H;
      const midX1 = (ax + bx) / 2;
      const midY1 = (ay + by) / 2;
      const midX2 = (bx + cx) / 2;
      const midY2 = (by + cy) / 2;
      const w = fixedWidth ? strokeWidthForTool() : calcWidth((prev1[2] + curr[2]) / 2);
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(midX1, midY1);
      ctx.quadraticCurveTo(bx, by, midX2, midY2);
      ctx.stroke();
    } else if (pts.length === 2) {
      const prev = pts[0];
      const nx = prev[0] * DOC_W;
      const ny = prev[1] * DOC_H;
      const pos = pts[1];
      const px = pos[0] * DOC_W;
      const py = pos[1] * DOC_H;
      ctx.lineWidth = fixedWidth ? strokeWidthForTool() : calcWidth(pos[2]);
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(px, py);
      ctx.stroke();
    }
  }

  function onMove(e) {
    if (!drawing || !currentStroke || e.pointerId !== pointerId) return;
    const canvasEl = focusMode ? focusCanvas : activePad?.canvas;
    if (!canvasEl || e.target !== canvasEl) return;

    e.preventDefault();
    const pts = currentStroke.pts;
    const pos = getCanvasCoords(e, canvasEl);
    pts.push([pos.x / DOC_W, pos.y / DOC_H, pos.p]);

    const ctx = canvasEl.getContext('2d');
    ctx.save();

    if (tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      const prev = pts[pts.length - 2];
      ctx.lineWidth = getEraserRadius(baseWidth) * 2;
      ctx.lineCap = 'round';
      ctx.moveTo(prev[0] * DOC_W, prev[1] * DOC_H);
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    } else if (tool === 'highlighter') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentStroke.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawSegment(ctx, pts, true);
    } else if (tool === 'strike') {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = currentStroke.color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawSegment(ctx, pts, true);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawSegment(ctx, pts, false);
    }
    ctx.restore();
  }

  function onUp() {
    if (!drawing) return;
    drawing = false;
    pointerId = null;

    const pad = focusMode ? pads.get(focusPadKey) : activePad;
    if (currentStroke && currentStroke.pts.length > 0 && pad) {
      pad.strokes.push(currentStroke);
      saveStrokes(pad.key, pad.strokes);
    }
    currentStroke = null;
  }

  function bindCanvas(canvas) {
    canvas.addEventListener('pointerdown', onDown, { passive: false });
    canvas.addEventListener('pointermove', onMove, { passive: false });
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  function setPadZoom(pad, z) {
    const nz = Math.min(3.2, Math.max(0.35, z));
    pad.zoom = nz;
    if (pad.sheet) {
      pad.sheet.style.transform = `scale(${nz})`;
      pad.sheet.style.transformOrigin = 'top left';
    }
    const zl = pad.root.querySelector('.wb-zoom-label');
    if (zl) zl.textContent = Math.round(nz * 100) + '%';
  }

  function onViewportWheel(e, pad) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaY;
    const factor = delta > 0 ? 0.9 : 1.11;
    setPadZoom(pad, pad.zoom * factor);
  }

  function wireToolbar(root, padKey) {
    const tb = root.querySelector('.wbc-toolbar');
    if (!tb) return;
    tb.querySelectorAll('.wbc-tool').forEach(btn => {
      btn.addEventListener('click', () => {
        setTool(btn.dataset.tool);
        activePad = pads.get(padKey);
        tb.querySelectorAll('.wbc-tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
      });
    });
    tb.querySelectorAll('.wbc-swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        setColor(btn.dataset.color);
        activePad = pads.get(padKey);
        tb.querySelectorAll('.wbc-swatch').forEach(b =>
          b.classList.toggle('active', b.dataset.color === color && tool !== 'eraser')
        );
      });
    });
    tb.querySelectorAll('.wbc-size').forEach(btn => {
      btn.addEventListener('click', () => {
        setWidth(parseFloat(btn.dataset.w));
        activePad = pads.get(padKey);
        tb.querySelectorAll('.wbc-size').forEach(b =>
          b.classList.toggle('active', parseFloat(b.dataset.w) === baseWidth)
        );
      });
    });
    const undoBtn = tb.querySelector('[data-wb-undo]');
    if (undoBtn) undoBtn.addEventListener('click', () => { activePad = pads.get(padKey); undo(); });
    const clrBtn = tb.querySelector('[data-wb-clear]');
    if (clrBtn) {
      clrBtn.addEventListener('click', () => {
        activePad = pads.get(padKey);
        if (confirm('clear this page?')) clearPad();
      });
    }
    const zin = tb.querySelector('[data-wb-zoom-in]');
    const zout = tb.querySelector('[data-wb-zoom-out]');
    if (zin) zin.addEventListener('click', () => setPadZoom(pads.get(padKey), pads.get(padKey).zoom * 1.15));
    if (zout) zout.addEventListener('click', () => setPadZoom(pads.get(padKey), pads.get(padKey).zoom / 1.15));
    const fs = tb.querySelector('[data-wb-fullscreen]');
    if (fs) {
      fs.addEventListener('click', () => {
        if (typeof PSApp !== 'undefined' && PSApp.enterFocusForPad) PSApp.enterFocusForPad(padKey);
      });
    }
    const ex = tb.querySelector('[data-wb-expand]');
    if (ex) {
      ex.addEventListener('click', () => {
        root.classList.toggle('part-scratch-expanded');
        ex.setAttribute('aria-expanded', root.classList.contains('part-scratch-expanded'));
        ex.textContent = root.classList.contains('part-scratch-expanded') ? 'shrink' : 'expand';
      });
    }
    const finger = tb.querySelector('[data-wb-finger]');
    if (finger) {
      finger.addEventListener('click', () => {
        pencilOnly = !pencilOnly;
        finger.classList.toggle('active', !pencilOnly);
        finger.title = pencilOnly ? 'finger drawing off (apple pencil only)' : 'finger drawing on';
      });
    }
  }

  function createPad(root) {
    const key = root.dataset.wbKey;
    if (!key || pads.has(key)) return pads.get(key);

    const canvas = root.querySelector('.wb-pad-canvas');
    const viewport = root.querySelector('.wb-pad-viewport');
    const sheet = root.querySelector('.wb-pad-sheet');
    if (!canvas || !viewport || !sheet) return null;

    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    setCanvasPixels(canvas, ctx);

    const pad = {
      key,
      root,
      canvas,
      ctx,
      viewport,
      sheet,
      strokes: loadStrokesForKey(key),
      zoom: 1
    };

    bindCanvas(canvas);
    viewport.addEventListener('wheel', e => onViewportWheel(e, pad), { passive: false });

    canvas.addEventListener('pointerdown', () => {
      activePad = pad;
      syncAllToolbars();
    });

    redrawPad(pad);
    pads.set(key, pad);
    wireToolbar(root, key);
    return pad;
  }

  function syncAllToolbars() {
    document.querySelectorAll('[data-wb-root] .wbc-toolbar').forEach(tb => {
      tb.querySelectorAll('.wbc-tool').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
      });
      tb.querySelectorAll('.wbc-swatch').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.color === color && tool !== 'eraser');
      });
      tb.querySelectorAll('.wbc-size').forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.w) === baseWidth);
      });
    });
    document.querySelectorAll('.focus-toolbar .wbc-tool').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    document.querySelectorAll('.focus-toolbar .wbc-swatch').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.color === color && tool !== 'eraser');
    });
    document.querySelectorAll('.focus-toolbar .wbc-size').forEach(btn => {
      btn.classList.toggle('active', parseFloat(btn.dataset.w) === baseWidth);
    });
  }

  function ensurePadsInSlide(slideEl) {
    if (!slideEl) return;
    slideEl.querySelectorAll('[data-wb-root]').forEach(root => createPad(root));
  }

  function saveAllPads() {
    pads.forEach(pad => saveStrokes(pad.key, pad.strokes));
  }

  function initFocusCanvas(focusId) {
    focusCanvas = document.getElementById(focusId);
    if (!focusCanvas) return;
    focusCtx = focusCanvas.getContext('2d', { willReadFrequently: false });
    setCanvasPixels(focusCanvas, focusCtx);
    bindCanvas(focusCanvas);
  }

  function enterFocusMode(padKey) {
    if (!focusCanvas || !focusCtx || !pads.has(padKey)) return;
    if (focusMode && focusPadKey && focusPadKey !== padKey) {
      const prev = pads.get(focusPadKey);
      if (prev) saveStrokes(prev.key, prev.strokes);
    }
    focusMode = true;
    focusPadKey = padKey;
    const pad = pads.get(padKey);
    activePad = pad;
    setCanvasPixels(focusCanvas, focusCtx);
    redrawPad(pad, focusCtx, focusCanvas);
    syncAllToolbars();
  }

  function exitFocusMode() {
    if (!focusMode) return;
    const pad = focusPadKey ? pads.get(focusPadKey) : null;
    if (pad) saveStrokes(pad.key, pad.strokes);
    focusMode = false;
    focusPadKey = null;
    if (pad) redrawPad(pad);
  }

  function setTool(t) {
    tool = t;
    syncAllToolbars();
  }

  function setColor(c) {
    color = c;
    if (tool === 'eraser') tool = 'pen';
    syncAllToolbars();
  }

  function setWidth(w) {
    baseWidth = w;
    syncAllToolbars();
  }

  function undo() {
    const pad = focusMode ? pads.get(focusPadKey) : activePad;
    if (!pad || pad.strokes.length === 0) return;
    pad.strokes.pop();
    if (focusMode) redrawPad(pad, focusCtx, focusCanvas);
    else redrawPad(pad);
    saveStrokes(pad.key, pad.strokes);
  }

  function clearPad() {
    const pad = focusMode ? pads.get(focusPadKey) : activePad;
    if (!pad) return;
    pad.strokes = [];
    if (focusMode) redrawPad(pad, focusCtx, focusCanvas);
    else redrawPad(pad);
    saveStrokes(pad.key, pad.strokes);
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
    keys.forEach(k => {
      merged.push(...loadStrokesForKey(k));
    });
    if (merged.length === 0) return false;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvasEl.width / dpr;
    const ch = canvasEl.height / dpr;
    const ctx = canvasEl.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#f5f3ee';
    ctx.fillRect(0, 0, cw, ch);
    for (const s of merged) replayStroke(ctx, s, cw, ch);
    ctx.restore();
    return true;
  }

  function hasNotes(qId) {
    return allStrokeKeysForQuestion(qId).some(k => {
      const strokes = loadStrokesForKey(k);
      return strokes && strokes.length > 0;
    });
  }

  function switchQuestion() {
    saveAllPads();
  }

  return {
    DOC_W,
    DOC_H,
    initFocusCanvas,
    ensurePadsInSlide,
    enterFocusMode,
    exitFocusMode,
    saveToStorage: saveAllPads,
    setTool,
    setColor,
    setWidth,
    undo,
    clear: clearPad,
    renderThumbnail,
    hasNotes,
    switchQuestion,
    setPadZoom,
    getPad: k => pads.get(k)
  };
})();
