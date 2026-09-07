import { Document, History } from "./engine.js";
import { SamClient, defaultSamUrl } from "./sam.js";
import { TOOLS, createTools } from "./tools.js";
import { applyTransform, drawTransformOverlay, drawTransformedLayer, startTransform } from "./transform.js";

const view = document.getElementById("view");
const vctx = view.getContext("2d");
const stage = document.getElementById("stage-wrap");
const hint = document.getElementById("hint");
const toolbar = document.getElementById("toolbar");
const layerList = document.getElementById("layer-list");
const options = document.getElementById("tool-options");
const samStatus = document.getElementById("sam-status");
const samUrlInput = document.getElementById("sam-url");
const textInput = document.getElementById("text-input");

const app = {
  doc: new Document(1280, 720),
  history: new History(),
  sam: new SamClient(),
  tools: null,
  tool: "smart",
  color: "#1c1917",
  brushSize: 24,
  brushOpacity: 1,
  smartPoints: [],
  space: false,
  panning: false,
  panLast: null,
  ants: 0,
  textPos: null,
  xf: null,
  setStatus(msg) {
    options.dataset.note = msg;
    renderOptions();
  },
  beginText(pos) {
    this.textPos = pos;
    textInput.hidden = false;
    const r = stage.getBoundingClientRect();
    const s = screenFromDoc(pos.x, pos.y);
    textInput.style.left = `${s.x - r.left}px`;
    textInput.style.top = `${s.y - r.top}px`;
    textInput.style.fontSize = `${Math.max(16, this.brushSize)}px`;
    textInput.style.color = this.color;
    textInput.value = "";
    textInput.focus();
  },
};

app.tools = createTools(app);
samUrlInput.value = defaultSamUrl();

const ICONS = {
  move: '<svg viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M7 7l5-5 5 5M7 17l5 5 5-5"/></svg>',
  smart: '<svg viewBox="0 0 24 24"><path d="M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/><circle cx="18" cy="18" r="3"/></svg>',
  lasso: '<svg viewBox="0 0 24 24"><path d="M7 16c-2-2-3-5-1-8 2-4 8-6 12-3 3 2 3 7 1 10-2 4-8 5-12 2z"/></svg>',
  mask: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 12h16"/></svg>',
  crop: '<svg viewBox="0 0 24 24"><path d="M6 2v14h14M18 22V8H4"/></svg>',
  brush: '<svg viewBox="0 0 24 24"><path d="M14 4l6 6-9 9H5v-6z"/></svg>',
  eraser: '<svg viewBox="0 0 24 24"><path d="M4 16l8-8 6 6-6 6H6z"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M12 6v14M8 20h8"/></svg>',
  transform: '<svg viewBox="0 0 24 24"><rect x="5" y="6" width="14" height="12"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
};

function renderToolbar() {
  toolbar.innerHTML = TOOLS.map(
    (t) =>
      `<button class="tool${app.tool === t.id ? " active" : ""}" data-tool="${t.id}" title="${t.name} (${t.key.toUpperCase()})">${ICONS[t.id]}</button>`
  ).join("");
}

function renderOptions() {
  const bits = [];
  if (app.tool === "smart") {
    bits.push(`<button type="button" data-act="extract-cut">Extract (cut)</button>`);
    bits.push(`<button type="button" data-act="extract-copy">Extract (copy)</button>`);
    bits.push(`<button type="button" data-act="deselect">Deselect</button>`);
    bits.push(`<span>Click object · Shift add · Alt subtract</span>`);
  } else if (app.tool === "lasso") {
    bits.push(`<button type="button" data-act="extract-cut">Extract (cut)</button>`);
    bits.push(`<button type="button" data-act="deselect">Deselect</button>`);
    bits.push(`<span>Draw around the object</span>`);
  } else if (app.tool === "mask") {
    bits.push(`<span>Quick Mask — paint to add, Alt-paint to subtract, Q to exit</span>`);
  } else if (app.tool === "crop") {
    bits.push(`<button type="button" data-act="crop-sel">Crop to selection</button>`);
    bits.push(`<span>Drag a rectangle, or crop the current selection</span>`);
  } else if (app.tool === "text") {
    bits.push(`<span>Click to type. Size slider sets type size.</span>`);
  } else if (app.tool === "move") {
    bits.push(`<span>Drag the active layer</span>`);
  } else if (app.tool === "transform") {
    bits.push(`<button type="button" data-act="apply-xf">Apply</button>`);
    bits.push(`<button type="button" data-act="cancel-xf">Cancel</button>`);
    bits.push(`<span>Drag handles to scale · rotate knob · Shift constrains · Enter applies</span>`);
  }
  if (options.dataset.note) bits.push(`<span>${escapeHtml(options.dataset.note)}</span>`);
  options.innerHTML = bits.join("");
}

function renderLayers() {
  const layers = [...app.doc.layers].reverse();
  layerList.innerHTML = layers
    .map((l) => {
      const active = l.id === app.doc.activeId ? " active" : "";
      const hidden = l.visible ? "" : " hidden-layer";
      return `<li class="${active}${hidden}" data-id="${l.id}">
        <span class="eye" data-eye="${l.id}">${l.visible ? "◉" : "○"}</span>
        <input type="text" value="${escapeAttr(l.name)}" data-rename="${l.id}" />
      </li>`;
    })
    .join("");
  const op = Math.round((app.doc.active?.opacity ?? 1) * 100);
  document.getElementById("layer-opacity").value = String(op);
  document.getElementById("layer-opacity-val").textContent = `${op}%`;
  renderCanvasSize();
}

function renderCanvasSize() {
  const w = document.getElementById("canvas-w");
  const h = document.getElementById("canvas-h");
  if (document.activeElement === w || document.activeElement === h) return;
  w.value = String(app.doc.width);
  h.value = String(app.doc.height);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

function screenFromDoc(x, y) {
  const r = view.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const vw = view.width / dpr;
  const vh = view.height / dpr;
  const ox = vw / 2 + app.doc.panX - (app.doc.width * app.doc.zoom) / 2;
  const oy = vh / 2 + app.doc.panY - (app.doc.height * app.doc.zoom) / 2;
  return { x: r.left + ox + x * app.doc.zoom, y: r.top + oy + y * app.doc.zoom };
}

function docFromEvent(ev) {
  const r = view.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const vw = view.width / dpr;
  const vh = view.height / dpr;
  const ox = vw / 2 + app.doc.panX - (app.doc.width * app.doc.zoom) / 2;
  const oy = vh / 2 + app.doc.panY - (app.doc.height * app.doc.zoom) / 2;
  return {
    x: (ev.clientX - r.left - ox) / app.doc.zoom,
    y: (ev.clientY - r.top - oy) / app.doc.zoom,
  };
}

function resizeView() {
  const dpr = window.devicePixelRatio || 1;
  const { clientWidth, clientHeight } = stage;
  view.width = Math.max(1, Math.floor(clientWidth * dpr));
  view.height = Math.max(1, Math.floor(clientHeight * dpr));
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawChecker(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = "#cfc8b8";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#b8b09e";
  const s = 10;
  for (let iy = 0; iy < h; iy += s) {
    for (let ix = 0; ix < w; ix += s) {
      if (((ix / s) + (iy / s)) % 2 === 0) ctx.fillRect(x + ix, y + iy, s, s);
    }
  }
  ctx.restore();
}

function composite() {
  const { width, height, layers } = app.doc;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (app.xf) commitTransform(false);
  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.canvas, layer.x, layer.y);
    ctx.restore();
  }
  return out;
}

function frame() {
  const dpr = window.devicePixelRatio || 1;
  const vw = view.width / dpr;
  const vh = view.height / dpr;
  vctx.clearRect(0, 0, vw, vh);

  const z = app.doc.zoom;
  const x = vw / 2 + app.doc.panX - (app.doc.width * z) / 2;
  const y = vh / 2 + app.doc.panY - (app.doc.height * z) / 2;

  drawChecker(vctx, x, y, app.doc.width * z, app.doc.height * z);
  vctx.save();
  vctx.translate(x, y);
  vctx.scale(z, z);

  for (const layer of app.doc.layers) {
    if (!layer.visible) continue;
    if (app.xf && app.xf.layerId === layer.id) {
      drawTransformedLayer(vctx, layer, app.xf);
      continue;
    }
    vctx.save();
    vctx.globalAlpha = layer.opacity;
    vctx.drawImage(layer.canvas, layer.x, layer.y);
    vctx.restore();
  }

  if (app.doc.quickMask || app.tool === "mask") {
    vctx.save();
    vctx.fillStyle = "rgba(192, 40, 40, 0.45)";
    vctx.globalCompositeOperation = "source-over";
    const inv = document.createElement("canvas");
    inv.width = app.doc.width;
    inv.height = app.doc.height;
    const ic = inv.getContext("2d");
    ic.fillStyle = "#fff";
    ic.fillRect(0, 0, inv.width, inv.height);
    ic.globalCompositeOperation = "destination-out";
    ic.drawImage(app.doc.selCanvas, 0, 0);
    vctx.drawImage(inv, 0, 0);
    vctx.restore();
  } else if (app.doc.hasSelection) {
    vctx.save();
    vctx.globalAlpha = 0.22;
    vctx.fillStyle = "#7ec8ff";
    vctx.drawImage(app.doc.selCanvas, 0, 0);
    vctx.restore();
    const box = app.doc.selectionBounds();
    if (box) {
      app.ants = (app.ants + 0.4) % 12;
      vctx.save();
      vctx.strokeStyle = "#111";
      vctx.setLineDash([6, 6]);
      vctx.lineDashOffset = -app.ants;
      vctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
      vctx.strokeStyle = "#fff";
      vctx.lineDashOffset = 6 - app.ants;
      vctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
      vctx.restore();
    }
  }

  const lasso = app.tools.getLasso();
  if (lasso.length > 1 && (app.tool === "lasso" || app.tool === "crop")) {
    vctx.beginPath();
    vctx.moveTo(lasso[0].x, lasso[0].y);
    for (let i = 1; i < lasso.length; i++) vctx.lineTo(lasso[i].x, lasso[i].y);
    vctx.strokeStyle = app.tool === "crop" ? "#e0a14a" : "#7ec8ff";
    vctx.lineWidth = 1 / z;
    vctx.stroke();
  }

  if (app.xf) drawTransformOverlay(vctx, app.xf, z);

  vctx.restore();
  requestAnimationFrame(frame);
}

function beginTransform() {
  const layer = app.doc.active;
  if (!layer || layer.locked) {
    app.setStatus("Select an unlocked layer to transform");
    return false;
  }
  app.xf = startTransform(layer);
  return true;
}

function commitTransform(record = true) {
  if (!app.xf) return;
  const layer = app.doc.layers.find((l) => l.id === app.xf.layerId);
  if (layer) {
    if (record) app.history.push(app.doc);
    applyTransform(layer, app.xf);
    app.sam.sessionId = null;
  }
  app.xf = null;
  renderLayers();
}

function cancelTransform() {
  app.xf = null;
  renderOptions();
}

function setTool(id) {
  if (app.tool === "transform" && id !== "transform") commitTransform();
  if (id === "mask") {
    app.doc.quickMask = !app.doc.quickMask;
    app.tool = app.doc.quickMask ? "mask" : "smart";
  } else {
    if (id !== "mask") app.doc.quickMask = false;
    app.tool = id;
  }
  if (app.tool === "transform") beginTransform();
  renderToolbar();
  renderOptions();
}

function commitText() {
  const text = textInput.value;
  textInput.hidden = true;
  if (!text || !app.textPos) return;
  const layer = app.doc.active;
  if (!layer || layer.locked) return;
  app.history.push(app.doc);
  layer.ctx.save();
  layer.ctx.font = `${Math.max(12, app.brushSize * 1.6)}px "Avenir Next", "Segoe UI", sans-serif`;
  layer.ctx.fillStyle = app.color;
  layer.ctx.textBaseline = "top";
  layer.ctx.fillText(text, app.textPos.x - layer.x, app.textPos.y - layer.y);
  layer.ctx.restore();
  layer.touch();
  app.textPos = null;
}

async function importFiles(files) {
  const images = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const bmp = await createImageBitmap(file);
    images.push({ bmp, name: file.name.replace(/\.[^.]+$/, "") });
  }
  if (!images.length) return;
  app.history.push(app.doc);
  const empty = app.doc.layers.length === 1 && !app.doc.layers[0].revision;
  if (empty) {
    app.doc.fitToImage(images[0].bmp);
    images[0].bmp.close();
    for (const extra of images.slice(1)) {
      app.doc.addImageLayer(extra.bmp, extra.name);
      extra.bmp.close();
    }
  } else {
    for (const extra of images) {
      app.doc.addImageLayer(extra.bmp, extra.name);
      extra.bmp.close();
    }
  }
  hint.classList.add("hidden");
  renderLayers();
  renderCanvasSize();
}

function exportPng() {
  const out = composite();
  out.toBlob((blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "freetoshop.png";
    a.click();
    URL.revokeObjectURL(a.href);
  }, "image/png");
}

function newDoc() {
  const w = Number(prompt("Width", app.doc.width)) || 1280;
  const h = Number(prompt("Height", app.doc.height)) || 720;
  app.doc = new Document(w, h);
  app.history = new History();
  app.history.push(app.doc);
  app.smartPoints = [];
  hint.classList.remove("hidden");
  app.xf = null;
  renderLayers();
}

function act(name) {
  if (name === "new") newDoc();
  if (name === "export") exportPng();
  if (name === "add-layer") {
    app.history.push(app.doc);
    app.doc.addLayer(`Layer ${app.doc.layers.length + 1}`);
    renderLayers();
  }
  if (name === "dup-layer") {
    app.history.push(app.doc);
    app.doc.duplicateActive();
    renderLayers();
  }
  if (name === "del-layer") {
    app.history.push(app.doc);
    app.doc.deleteActive();
    renderLayers();
  }
  if (name === "fill-layer") {
    app.history.push(app.doc);
    app.doc.fillActive(app.color);
  }
  if (name === "extract-cut" || name === "extract-copy") {
    if (!app.doc.hasSelection) {
      app.setStatus("Nothing selected");
      return;
    }
    app.history.push(app.doc);
    app.doc.extract(name === "extract-cut");
    app.smartPoints = [];
    renderLayers();
    app.setStatus("Cutout layer created");
  }
  if (name === "deselect") {
    app.doc.clearSelection();
    app.smartPoints = [];
    app.setStatus("");
  }
  if (name === "crop-sel") {
    if (!app.doc.hasSelection) return;
    app.history.push(app.doc);
    app.doc.cropToSelection();
    renderCanvasSize();
  }
  if (name === "resize-canvas") {
    const w = Number(document.getElementById("canvas-w").value);
    const h = Number(document.getElementById("canvas-h").value);
    if (!w || !h) return;
    if (app.xf) commitTransform();
    app.history.push(app.doc);
    app.doc.resizeCanvas(w, h, document.getElementById("canvas-anchor").value);
    renderCanvasSize();
    hint.classList.add("hidden");
  }
  if (name === "fit-canvas") {
    if (app.xf) commitTransform();
    app.history.push(app.doc);
    app.doc.fitCanvasToContent();
    renderCanvasSize();
  }
  if (name === "apply-xf") {
    commitTransform();
    if (app.tool === "transform") beginTransform();
    renderOptions();
  }
  if (name === "cancel-xf") cancelTransform();
}

document.addEventListener("click", (ev) => {
  const toolBtn = ev.target.closest("[data-tool]");
  if (toolBtn) setTool(toolBtn.dataset.tool);
  const actBtn = ev.target.closest("[data-act]");
  if (actBtn) act(actBtn.dataset.act);
  const eye = ev.target.closest("[data-eye]");
  if (eye) {
    const layer = app.doc.layers.find((l) => l.id === eye.dataset.eye);
    if (layer) {
      layer.visible = !layer.visible;
      renderLayers();
    }
  }
  const row = ev.target.closest("#layer-list li");
  if (row && !ev.target.closest("[data-eye]") && row.dataset.id) {
    if (app.xf && row.dataset.id !== app.xf.layerId) commitTransform();
    app.doc.activeId = row.dataset.id;
    app.smartPoints = [];
    app.sam.sessionId = null;
    if (app.tool === "transform") beginTransform();
    renderLayers();
    renderOptions();
  }
});

layerList.addEventListener("change", (ev) => {
  const input = ev.target.closest("[data-rename]");
  if (!input) return;
  const layer = app.doc.layers.find((l) => l.id === input.dataset.rename);
  if (layer) layer.name = input.value;
});

document.getElementById("file-open").addEventListener("change", (ev) => {
  importFiles([...ev.target.files]);
  ev.target.value = "";
});

document.getElementById("color").addEventListener("input", (ev) => {
  app.color = ev.target.value;
});

document.getElementById("brush-size").addEventListener("input", (ev) => {
  app.brushSize = Number(ev.target.value);
  document.getElementById("brush-size-val").textContent = String(app.brushSize);
});

document.getElementById("brush-opacity").addEventListener("input", (ev) => {
  app.brushOpacity = Number(ev.target.value) / 100;
  document.getElementById("brush-opacity-val").textContent = `${ev.target.value}%`;
});

for (const id of ["canvas-w", "canvas-h"]) {
  document.getElementById(id).addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") act("resize-canvas");
  });
}

document.getElementById("layer-opacity").addEventListener("input", (ev) => {
  if (!app.doc.active) return;
  app.doc.active.opacity = Number(ev.target.value) / 100;
  document.getElementById("layer-opacity-val").textContent = `${ev.target.value}%`;
});

samUrlInput.addEventListener("change", () => {
  app.sam.setUrl(samUrlInput.value);
  pingSam();
});

textInput.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") commitText();
  if (ev.key === "Escape") {
    textInput.hidden = true;
    app.textPos = null;
  }
});
textInput.addEventListener("blur", commitText);

stage.addEventListener("dragover", (ev) => ev.preventDefault());
stage.addEventListener("drop", (ev) => {
  ev.preventDefault();
  importFiles([...ev.dataTransfer.files]);
});

view.addEventListener("pointerdown", (ev) => {
  if (app.space || ev.button === 1) {
    app.panning = true;
    app.panLast = { x: ev.clientX, y: ev.clientY };
    view.setPointerCapture(ev.pointerId);
    return;
  }
  view.setPointerCapture(ev.pointerId);
  app.tools.pointerdown(app.tool, ev, docFromEvent(ev));
});

view.addEventListener("pointermove", (ev) => {
  if (app.panning && app.panLast) {
    app.doc.panX += ev.clientX - app.panLast.x;
    app.doc.panY += ev.clientY - app.panLast.y;
    app.panLast = { x: ev.clientX, y: ev.clientY };
    return;
  }
  const pos = docFromEvent(ev);
  app.tools.pointermove(app.tool, ev, pos);
  if (app.tool === "transform" && app.xf) {
    const hit = app.tools.hover(app.tool, pos);
    view.style.cursor = hit === "rotate" ? "crosshair" : hit === "move" ? "move" : hit ? "nwse-resize" : "default";
  } else if (!app.panning) {
    view.style.cursor = "";
  }
});

view.addEventListener("pointerup", (ev) => {
  if (app.panning) {
    app.panning = false;
    app.panLast = null;
    return;
  }
  app.tools.pointerup(app.tool, ev, docFromEvent(ev));
});

stage.addEventListener("wheel", (ev) => {
  ev.preventDefault();
  const factor = ev.deltaY < 0 ? 1.08 : 1 / 1.08;
  app.doc.zoom = Math.min(8, Math.max(0.08, app.doc.zoom * factor));
}, { passive: false });

window.addEventListener("keydown", (ev) => {
  if (ev.target.matches("input, textarea")) return;
  if (ev.code === "Space") {
    app.space = true;
    ev.preventDefault();
  }
  const key = ev.key.toLowerCase();
  if ((ev.metaKey || ev.ctrlKey) && key === "z") {
    ev.preventDefault();
    app.xf = null;
    if (ev.shiftKey) app.history.redo(app.doc);
    else app.history.undo(app.doc);
    renderLayers();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && key === "d") {
    ev.preventDefault();
    act("deselect");
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && key === "j") {
    ev.preventDefault();
    act(ev.shiftKey ? "extract-cut" : "extract-copy");
    return;
  }
  if (key === "[" ) app.brushSize = Math.max(1, app.brushSize - 2);
  if (key === "]" ) app.brushSize = Math.min(200, app.brushSize + 2);
  if (key === "[" || key === "]") {
    document.getElementById("brush-size").value = String(app.brushSize);
    document.getElementById("brush-size-val").textContent = String(app.brushSize);
  }
  if (key === "g") act("fill-layer");
  if (key === "enter" && app.xf) {
    ev.preventDefault();
    commitTransform();
    if (app.tool === "transform") beginTransform();
    renderOptions();
    return;
  }
  if (key === "escape" && app.xf) {
    ev.preventDefault();
    cancelTransform();
    return;
  }
  if ((ev.metaKey || ev.ctrlKey) && key === "t") {
    ev.preventDefault();
    setTool("transform");
    return;
  }
  const found = TOOLS.find((t) => t.key === key);
  if (found && !ev.metaKey && !ev.ctrlKey) setTool(found.id);
});

window.addEventListener("keyup", (ev) => {
  if (ev.code === "Space") app.space = false;
});

async function pingSam() {
  const h = await app.sam.ping();
  samStatus.classList.remove("ok", "demo", "down");
  if (!h.ok) {
    samStatus.classList.add("down");
    samStatus.textContent = "SAM offline";
    samStatus.title = "Start sam-server — see SAM.md";
    return;
  }
  if (h.demo) {
    samStatus.classList.add("demo");
    samStatus.textContent = "SAM demo";
    samStatus.title = `${h.model} — flood-fill only. Install SAM 2 for real cutouts.`;
    return;
  }
  samStatus.classList.add("ok");
  samStatus.textContent = `SAM ${h.device}`;
  samStatus.title = h.model;
}

window.addEventListener("resize", resizeView);
renderToolbar();
renderOptions();
renderLayers();
resizeView();
pingSam();
setInterval(pingSam, 8000);
requestAnimationFrame(frame);
window.freetoshop = app;
