class ImageDataShim {
  constructor(dataOrW, h, maybeH) {
    if (typeof dataOrW === "number") {
      this.width = dataOrW;
      this.height = h;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    } else {
      this.data = dataOrW;
      this.width = h;
      this.height = maybeH;
    }
  }
}

function clampByte(n) {
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

function parseColor(c) {
  if (typeof c !== "string") return [0, 0, 0, 255];
  if (c === "#fff" || c === "#ffffff" || c === "white") return [255, 255, 255, 255];
  if (c === "#000" || c === "#000000" || c === "black") return [0, 0, 0, 255];
  const hex = c.replace("#", "");
  if (hex.length === 3) {
    return [
      parseInt(hex[0] + hex[0], 16),
      parseInt(hex[1] + hex[1], 16),
      parseInt(hex[2] + hex[2], 16),
      255,
    ];
  }
  if (hex.length === 6) {
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
      255,
    ];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const p = m[1].split(",").map((x) => Number(x.trim()));
    return [p[0] || 0, p[1] || 0, p[2] || 0, p[3] == null ? 255 : Math.round(p[3] * 255)];
  }
  return [0, 0, 0, 255];
}

class Fake2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.globalAlpha = 1;
    this.globalCompositeOperation = "source-over";
    this.fillStyle = "#000000";
    this.strokeStyle = "#000000";
    this.lineWidth = 1;
    this.lineCap = "butt";
    this.lineJoin = "miter";
    this.imageSmoothingEnabled = true;
    this.imageSmoothingQuality = "low";
    this._path = [];
    this._stack = [];
    this._a = 1;
    this._b = 0;
    this._c = 0;
    this._d = 1;
    this._e = 0;
    this._f = 0;
  }

  save() {
    this._stack.push({
      globalAlpha: this.globalAlpha,
      globalCompositeOperation: this.globalCompositeOperation,
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      a: this._a,
      b: this._b,
      c: this._c,
      d: this._d,
      e: this._e,
      f: this._f,
    });
  }

  restore() {
    const s = this._stack.pop();
    if (!s) return;
    Object.assign(this, s);
    this._a = s.a;
    this._b = s.b;
    this._c = s.c;
    this._d = s.d;
    this._e = s.e;
    this._f = s.f;
  }

  translate(x, y) {
    this._e += this._a * x + this._c * y;
    this._f += this._b * x + this._d * y;
  }

  rotate(r) {
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const { _a, _b, _c, _d } = this;
    this._a = _a * cos + _c * sin;
    this._b = _b * cos + _d * sin;
    this._c = _c * cos - _a * sin;
    this._d = _d * cos - _b * sin;
  }

  setTransform(a, b, c, d, e, f) {
    this._a = a;
    this._b = b;
    this._c = c;
    this._d = d;
    this._e = e;
    this._f = f;
  }

  _map(x, y) {
    return {
      x: this._a * x + this._c * y + this._e,
      y: this._b * x + this._d * y + this._f,
    };
  }

  _put(x, y, r, g, b, a) {
    x = Math.round(x);
    y = Math.round(y);
    const { width, height, data } = this.canvas;
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = (y * width + x) * 4;
    const op = this.globalCompositeOperation;
    const srcA = (a / 255) * this.globalAlpha;
    if (op === "destination-out") {
      data[i + 3] = clampByte(data[i + 3] * (1 - srcA));
      return;
    }
    if (op === "destination-in") {
      data[i + 3] = clampByte(data[i + 3] * srcA);
      return;
    }
    if (a <= 0) return;
    if (op === "lighten") {
      data[i] = Math.max(data[i], r);
      data[i + 1] = Math.max(data[i + 1], g);
      data[i + 2] = Math.max(data[i + 2], b);
      data[i + 3] = Math.max(data[i + 3], a);
      return;
    }
    const da = data[i + 3] / 255;
    const outA = srcA + da * (1 - srcA);
    if (outA <= 0) {
      data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      return;
    }
    data[i] = clampByte((r * srcA + data[i] * da * (1 - srcA)) / outA);
    data[i + 1] = clampByte((g * srcA + data[i + 1] * da * (1 - srcA)) / outA);
    data[i + 2] = clampByte((b * srcA + data[i + 2] * da * (1 - srcA)) / outA);
    data[i + 3] = clampByte(outA * 255);
  }

  fillRect(x, y, w, h) {
    const [r, g, b, a] = parseColor(this.fillStyle);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const p = this._map(x0 + ix, y0 + iy);
        this._put(p.x, p.y, r, g, b, a);
      }
    }
  }

  clearRect(x, y, w, h) {
    const { width, height, data } = this.canvas;
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const px = Math.round(x + ix);
        const py = Math.round(y + iy);
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const i = (py * width + px) * 4;
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
      }
    }
  }

  getImageData(x, y, w, h) {
    const out = new Uint8ClampedArray(w * h * 4);
    const { width, height, data } = this.canvas;
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const sx = x + ix;
        const sy = y + iy;
        const di = (iy * w + ix) * 4;
        if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
        const si = (sy * width + sx) * 4;
        out[di] = data[si];
        out[di + 1] = data[si + 1];
        out[di + 2] = data[si + 2];
        out[di + 3] = data[si + 3];
      }
    }
    return new ImageDataShim(out, w, h);
  }

  putImageData(img, x, y) {
    const { width, height, data } = this.canvas;
    for (let iy = 0; iy < img.height; iy++) {
      for (let ix = 0; ix < img.width; ix++) {
        const dx = x + ix;
        const dy = y + iy;
        if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
        const di = (dy * width + dx) * 4;
        const si = (iy * img.width + ix) * 4;
        data[di] = img.data[si];
        data[di + 1] = img.data[si + 1];
        data[di + 2] = img.data[si + 2];
        data[di + 3] = img.data[si + 3];
      }
    }
  }

  drawImage(src, dx, dy, dw, dh) {
    const sw = src.width;
    const sh = src.height;
    const srcData = src.data || src.getContext?.("2d").canvas.data;
    const destW = dw == null ? sw : dw;
    const destH = dh == null ? sh : dh;
    if (!srcData) return;
    for (let iy = 0; iy < destH; iy++) {
      for (let ix = 0; ix < destW; ix++) {
        const sx = Math.min(sw - 1, Math.floor((ix * sw) / destW));
        const sy = Math.min(sh - 1, Math.floor((iy * sh) / destH));
        const si = (sy * sw + sx) * 4;
        const p = this._map(dx + ix, dy + iy);
        this._put(p.x, p.y, srcData[si], srcData[si + 1], srcData[si + 2], srcData[si + 3]);
      }
    }
  }

  beginPath() {
    this._path = [];
  }

  moveTo(x, y) {
    this._path.push({ t: "M", x, y });
  }

  lineTo(x, y) {
    this._path.push({ t: "L", x, y });
  }

  closePath() {
    this._path.push({ t: "Z" });
  }

  _poly() {
    const pts = [];
    for (const p of this._path) {
      if (p.t === "M" || p.t === "L") pts.push({ x: p.x, y: p.y });
    }
    return pts;
  }

  fill() {
    const [r, g, b, a] = parseColor(this.fillStyle);
    const pts = this._poly();
    if (pts.length < 3) return;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const minx = Math.floor(Math.min(...xs));
    const maxx = Math.ceil(Math.max(...xs));
    const miny = Math.floor(Math.min(...ys));
    const maxy = Math.ceil(Math.max(...ys));
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        if (pointInPoly(x + 0.5, y + 0.5, pts)) this._put(x, y, r, g, b, a);
      }
    }
  }

  stroke() {
    const [r, g, b, a] = parseColor(this.strokeStyle);
    const pts = this._poly();
    const rad = Math.max(1, Math.round(this.lineWidth / 2));
    for (let i = 1; i < pts.length; i++) {
      strokeSegment(pts[i - 1], pts[i], rad, (x, y) => this._put(x, y, r, g, b, a));
    }
  }

  fillText() {}
}

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function strokeSegment(a, b, rad, plot) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const steps = Math.ceil(len);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    for (let oy = -rad; oy <= rad; oy++) {
      for (let ox = -rad; ox <= rad; ox++) {
        if (ox * ox + oy * oy <= rad * rad) plot(Math.round(cx + ox), Math.round(cy + oy));
      }
    }
  }
}

class FakeCanvas {
  constructor(w = 1, h = 1) {
    this._width = Math.max(1, w);
    this._height = Math.max(1, h);
    this.data = new Uint8ClampedArray(this._width * this._height * 4);
    this._ctx = new Fake2D(this);
  }

  get width() {
    return this._width;
  }

  set width(v) {
    this._width = Math.max(1, v);
    this.data = new Uint8ClampedArray(this._width * this._height * 4);
  }

  get height() {
    return this._height;
  }

  set height(v) {
    this._height = Math.max(1, v);
    this.data = new Uint8ClampedArray(this._width * this._height * 4);
  }

  getContext() {
    return this._ctx;
  }

  toBlob(cb, type = "image/png") {
    cb(new Blob([this.data], { type }));
  }
}

const store = new Map();

globalThis.ImageData = ImageDataShim;
globalThis.Blob = globalThis.Blob || class Blob {
  constructor(parts, opts = {}) {
    this.parts = parts;
    this.type = opts.type || "";
    this.size = parts.reduce((n, p) => n + (p.byteLength || p.length || 0), 0);
  }
};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  createElement(tag) {
    if (tag === "canvas") return new FakeCanvas(1, 1);
    throw new Error(`createElement(${tag})`);
  },
};
globalThis.FormData = class FormData {
  constructor() {
    this._ = [];
  }
  append(k, v, name) {
    this._.push([k, v, name]);
  }
};
