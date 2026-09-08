let nextId = 1;
const uid = (p) => `${p}-${nextId++}`;

/** Keep new layer ids unique after loading a saved project. */
export function syncUidCounter(ids) {
  let max = nextId;
  for (const id of ids) {
    const m = String(id).match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]) + 1);
  }
  nextId = max;
}

export function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  return { canvas: c, ctx };
}

function cloneCanvas(src) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

export class Layer {
  constructor(name, w, h, x = 0, y = 0) {
    this.id = uid("layer");
    this.name = name;
    this.visible = true;
    this.locked = false;
    this.opacity = 1;
    this.x = x;
    this.y = y;
    this.linkGroup = null;
    const { canvas, ctx } = makeCanvas(w, h);
    this.canvas = canvas;
    this.ctx = ctx;
    this.revision = 0;
  }

  touch() {
    this.revision += 1;
  }
}

export class Document {
  constructor(width = 1280, height = 720) {
    this.width = width;
    this.height = height;
    this.layers = [];
    this.activeId = null;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    const sel = makeCanvas(width, height);
    this.selCanvas = sel.canvas;
    this.selCtx = sel.ctx;
    this.hasSelection = false;
    this.selBoundsCache = undefined;
    this.quickMask = false;
    this.addLayer("Background");
  }

  get active() {
    return this.layers.find((l) => l.id === this.activeId) || null;
  }

  addLayer(name, w = this.width, h = this.height, x = 0, y = 0) {
    const layer = new Layer(name, w, h, x, y);
    this.layers.push(layer);
    this.activeId = layer.id;
    return layer;
  }

  duplicateActive() {
    const src = this.active;
    if (!src) return null;
    const layer = this.addLayer(`${src.name} copy`, src.canvas.width, src.canvas.height, src.x, src.y);
    layer.ctx.drawImage(src.canvas, 0, 0);
    layer.opacity = src.opacity;
    return layer;
  }

  deleteActive() {
    if (this.layers.length <= 1) return;
    const i = this.layers.findIndex((l) => l.id === this.activeId);
    if (i < 0) return;
    const removed = this.layers[i];
    const group = removed.linkGroup;
    this.layers.splice(i, 1);
    this.activeId = this.layers[Math.max(0, i - 1)].id;
    if (group) this.pruneLinkGroup(group);
  }

  /** Topmost visible layer with opaque pixels at document (x, y), or null. */
  hitTestLayer(x, y, alphaThreshold = 8) {
    for (let i = this.layers.length - 1; i >= 0; i--) {
      const layer = this.layers[i];
      if (!layer.visible) continue;
      const lx = Math.floor(x - layer.x);
      const ly = Math.floor(y - layer.y);
      if (lx < 0 || ly < 0 || lx >= layer.canvas.width || ly >= layer.canvas.height) continue;
      if (layer.ctx.getImageData(lx, ly, 1, 1).data[3] > alphaThreshold) return layer;
    }
    return null;
  }

  linkedLayers(layerOrId) {
    const layer = typeof layerOrId === "string"
      ? this.layers.find((l) => l.id === layerOrId)
      : layerOrId;
    if (!layer?.linkGroup) return layer ? [layer] : [];
    return this.layers.filter((l) => l.linkGroup === layer.linkGroup);
  }

  pruneLinkGroup(group) {
    if (!group) return;
    const peers = this.layers.filter((l) => l.linkGroup === group);
    if (peers.length <= 1) {
      for (const l of peers) l.linkGroup = null;
    }
  }

  /**
   * Toggle link between `layerId` and the active layer (Photoshop-style).
   * Same group moves together; stack order is unchanged.
   */
  toggleLink(layerId) {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    const active = this.active;
    if (layer.linkGroup) {
      const group = layer.linkGroup;
      layer.linkGroup = null;
      this.pruneLinkGroup(group);
      return true;
    }
    if (!active || active.id === layer.id) return false;
    if (active.linkGroup) {
      layer.linkGroup = active.linkGroup;
    } else {
      const group = uid("link");
      active.linkGroup = group;
      layer.linkGroup = group;
    }
    return true;
  }

  unlink(layerId) {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer?.linkGroup) return false;
    const group = layer.linkGroup;
    layer.linkGroup = null;
    this.pruneLinkGroup(group);
    return true;
  }

  moveActive(dir) {
    const i = this.layers.findIndex((l) => l.id === this.activeId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.layers.length) return;
    const [row] = this.layers.splice(i, 1);
    this.layers.splice(j, 0, row);
  }

  /** Move a layer to a new stack index (0 = bottom). Returns true if order changed. */
  reorder(fromIndex, toIndex) {
    const n = this.layers.length;
    if (fromIndex < 0 || fromIndex >= n) return false;
    const to = Math.max(0, Math.min(n - 1, toIndex | 0));
    if (fromIndex === to) return false;
    const [row] = this.layers.splice(fromIndex, 1);
    this.layers.splice(to, 0, row);
    return true;
  }

  moveLayer(id, toIndex) {
    const from = this.layers.findIndex((l) => l.id === id);
    if (from < 0) return false;
    return this.reorder(from, toIndex);
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
    const prev = this.selCanvas;
    const sel = makeCanvas(w, h);
    sel.ctx.drawImage(prev, 0, 0);
    this.selCanvas = sel.canvas;
    this.selCtx = sel.ctx;
  }

  resizeCanvas(w, h, anchor = "top-left") {
    w = Math.max(1, Math.min(8192, Math.round(w)));
    h = Math.max(1, Math.min(8192, Math.round(h)));
    const dw = w - this.width;
    const dh = h - this.height;
    let ox = 0;
    let oy = 0;
    if (anchor === "center") {
      ox = Math.round(dw / 2);
      oy = Math.round(dh / 2);
    }
    const prevSel = this.selCanvas;
    if (ox || oy) {
      for (const layer of this.layers) {
        layer.x += ox;
        layer.y += oy;
      }
    }
    const sel = makeCanvas(w, h);
    sel.ctx.drawImage(prevSel, ox, oy);
    this.selCanvas = sel.canvas;
    this.selCtx = sel.ctx;
    this.width = w;
    this.height = h;
    this.invalidateSelection();
  }

  fitCanvasToContent() {
    if (!this.layers.length) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const layer of this.layers) {
      x0 = Math.min(x0, layer.x);
      y0 = Math.min(y0, layer.y);
      x1 = Math.max(x1, layer.x + layer.canvas.width);
      y1 = Math.max(y1, layer.y + layer.canvas.height);
    }
    if (!Number.isFinite(x0)) return;
    const prevSel = this.selCanvas;
    for (const layer of this.layers) {
      layer.x -= x0;
      layer.y -= y0;
    }
    const w = Math.max(1, Math.ceil(x1 - x0));
    const h = Math.max(1, Math.ceil(y1 - y0));
    const sel = makeCanvas(w, h);
    sel.ctx.drawImage(prevSel, -x0, -y0);
    this.selCanvas = sel.canvas;
    this.selCtx = sel.ctx;
    this.width = w;
    this.height = h;
    this.invalidateSelection();
  }

  fitToImage(img) {
    this.resize(img.width, img.height);
    this.layers = [];
    const layer = this.addLayer("Background", img.width, img.height);
    layer.ctx.drawImage(img, 0, 0);
    layer.touch();
    this.clearSelection();
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
  }

  addImageLayer(img, name = "Image") {
    const layer = this.addLayer(name, img.width, img.height, 0, 0);
    layer.ctx.drawImage(img, 0, 0);
    layer.touch();
    return layer;
  }

  clearSelection() {
    this.selCtx.clearRect(0, 0, this.width, this.height);
    this.hasSelection = false;
    this.selBoundsCache = null;
  }

  invalidateSelection() {
    this.selBoundsCache = undefined;
  }

  selectionBounds() {
    if (!this.hasSelection) return null;
    if (this.selBoundsCache !== undefined) return this.selBoundsCache;
    const { data, width, height } = this.selCtx.getImageData(0, 0, this.width, this.height);
    let x0 = width, y0 = height, x1 = 0, y1 = 0, found = false;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 10) {
          found = true;
          if (x < x0) x0 = x;
          if (y < y0) y0 = y;
          if (x > x1) x1 = x;
          if (y > y1) y1 = y;
        }
      }
    }
    this.selBoundsCache = found ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
    return this.selBoundsCache;
  }

  extract(cut = true) {
    const src = this.active;
    if (!src || !this.hasSelection) return null;
    const box = this.selectionBounds();
    if (!box) return null;
    const name = cut ? "Cutout" : "Copy";
    const dest = this.addLayer(name, box.w, box.h, box.x, box.y);
    dest.ctx.drawImage(src.canvas, src.x - box.x, src.y - box.y);
    dest.ctx.globalCompositeOperation = "destination-in";
    dest.ctx.drawImage(this.selCanvas, -box.x, -box.y);
    dest.ctx.globalCompositeOperation = "source-over";
    dest.touch();
    if (cut && !src.locked) {
      src.ctx.save();
      src.ctx.globalCompositeOperation = "destination-out";
      src.ctx.drawImage(this.selCanvas, -src.x, -src.y);
      src.ctx.restore();
      src.touch();
    }
    this.clearSelection();
    return dest;
  }

  cropToSelection() {
    const box = this.selectionBounds();
    if (!box) return;
    for (const layer of this.layers) {
      const next = makeCanvas(box.w, box.h);
      next.ctx.drawImage(layer.canvas, layer.x - box.x, layer.y - box.y);
      layer.canvas = next.canvas;
      layer.ctx = next.ctx;
      layer.x = 0;
      layer.y = 0;
      layer.touch();
    }
    const sel = makeCanvas(box.w, box.h);
    sel.ctx.drawImage(this.selCanvas, -box.x, -box.y);
    this.selCanvas = sel.canvas;
    this.selCtx = sel.ctx;
    this.width = box.w;
    this.height = box.h;
    this.hasSelection = false;
    this.clearSelection();
  }

  fillActive(color) {
    const layer = this.active;
    if (!layer || layer.locked) return;
    layer.ctx.save();
    if (this.hasSelection) {
      const clip = makeCanvas(layer.canvas.width, layer.canvas.height);
      clip.ctx.drawImage(this.selCanvas, -layer.x, -layer.y);
      layer.ctx.globalCompositeOperation = "source-over";
      layer.ctx.fillStyle = color;
      const tmp = makeCanvas(layer.canvas.width, layer.canvas.height);
      tmp.ctx.fillStyle = color;
      tmp.ctx.fillRect(0, 0, tmp.canvas.width, tmp.canvas.height);
      tmp.ctx.globalCompositeOperation = "destination-in";
      tmp.ctx.drawImage(clip.canvas, 0, 0);
      layer.ctx.drawImage(tmp.canvas, 0, 0);
    } else {
      layer.ctx.globalCompositeOperation = "source-over";
      layer.ctx.fillStyle = color;
      layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
    }
    layer.ctx.restore();
    layer.touch();
  }

  snapshot() {
    return {
      width: this.width,
      height: this.height,
      activeId: this.activeId,
      hasSelection: this.hasSelection,
      sel: cloneCanvas(this.selCanvas),
      layers: this.layers.map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        opacity: l.opacity,
        x: l.x,
        y: l.y,
        linkGroup: l.linkGroup,
        revision: l.revision,
        canvas: cloneCanvas(l.canvas),
      })),
    };
  }

  restore(snap) {
    this.width = snap.width;
    this.height = snap.height;
    this.activeId = snap.activeId;
    this.hasSelection = snap.hasSelection;
    this.selBoundsCache = undefined;
    this.selCanvas = cloneCanvas(snap.sel);
    this.selCtx = this.selCanvas.getContext("2d", { willReadFrequently: true });
    this.layers = snap.layers.map((s) => {
      const l = new Layer(s.name, 1, 1, s.x, s.y);
      l.id = s.id;
      l.visible = s.visible;
      l.locked = s.locked;
      l.opacity = s.opacity;
      l.linkGroup = s.linkGroup || null;
      l.revision = s.revision;
      l.canvas = cloneCanvas(s.canvas);
      l.ctx = l.canvas.getContext("2d", { willReadFrequently: true });
      return l;
    });
  }
}

export class History {
  constructor(limit = 30) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  push(doc) {
    this.undoStack.push(doc.snapshot());
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(doc) {
    if (!this.undoStack.length) return false;
    this.redoStack.push(doc.snapshot());
    doc.restore(this.undoStack.pop());
    return true;
  }

  redo(doc) {
    if (!this.redoStack.length) return false;
    this.undoStack.push(doc.snapshot());
    doc.restore(this.redoStack.pop());
    return true;
  }
}
