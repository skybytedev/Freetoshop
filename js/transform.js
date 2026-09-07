import { makeCanvas } from "./engine.js";

function cloneCanvas(src) {
  const { canvas, ctx } = makeCanvas(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  return canvas;
}

export function startTransform(layer) {
  if (!layer || layer.locked) return null;
  const w = layer.canvas.width;
  const h = layer.canvas.height;
  return {
    layerId: layer.id,
    src: cloneCanvas(layer.canvas),
    w,
    h,
    cx: layer.x + w / 2,
    cy: layer.y + h / 2,
    rotation: 0,
  };
}

export function toLocal(xf, x, y) {
  const dx = x - xf.cx;
  const dy = y - xf.cy;
  const c = Math.cos(-xf.rotation);
  const s = Math.sin(-xf.rotation);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}

export function toWorld(xf, lx, ly) {
  const c = Math.cos(xf.rotation);
  const s = Math.sin(xf.rotation);
  return { x: xf.cx + lx * c - ly * s, y: xf.cy + lx * s + ly * c };
}

export function xfCorners(xf) {
  const hw = xf.w / 2;
  const hh = xf.h / 2;
  return [
    toWorld(xf, -hw, -hh),
    toWorld(xf, hw, -hh),
    toWorld(xf, hw, hh),
    toWorld(xf, -hw, hh),
  ];
}

const HANDLE_IDS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

function handleLocal(xf, id) {
  const hw = xf.w / 2;
  const hh = xf.h / 2;
  switch (id) {
    case "nw": return { x: -hw, y: -hh };
    case "n": return { x: 0, y: -hh };
    case "ne": return { x: hw, y: -hh };
    case "e": return { x: hw, y: 0 };
    case "se": return { x: hw, y: hh };
    case "s": return { x: 0, y: hh };
    case "sw": return { x: -hw, y: hh };
    case "w": return { x: -hw, y: 0 };
    default: return { x: 0, y: 0 };
  }
}

export function rotateHandle(xf) {
  return toWorld(xf, 0, -xf.h / 2 - 28);
}

export function hitTransform(xf, pos, zoom) {
  const rad = Math.max(10, 12 / zoom);
  const rot = rotateHandle(xf);
  if (Math.hypot(pos.x - rot.x, pos.y - rot.y) <= rad) return "rotate";
  for (const id of HANDLE_IDS) {
    const p = toWorld(xf, handleLocal(xf, id).x, handleLocal(xf, id).y);
    if (Math.hypot(pos.x - p.x, pos.y - p.y) <= rad) return id;
  }
  const loc = toLocal(xf, pos.x, pos.y);
  if (Math.abs(loc.x) <= xf.w / 2 && Math.abs(loc.y) <= xf.h / 2) return "move";
  return null;
}

const ANCHOR = {
  nw: [1, 1],
  n: [0, 1],
  ne: [-1, 1],
  e: [-1, 0],
  se: [-1, -1],
  s: [0, -1],
  sw: [1, -1],
  w: [1, 0],
};

export function applyHandle(xf, start, pos, shiftKey) {
  if (start.handle === "move") {
    xf.cx = start.cx + (pos.x - start.origin.x);
    xf.cy = start.cy + (pos.y - start.origin.y);
    return;
  }
  if (start.handle === "rotate") {
    const a0 = Math.atan2(start.origin.y - start.cy, start.origin.x - start.cx);
    const a1 = Math.atan2(pos.y - start.cy, pos.x - start.cx);
    let rot = start.rotation + (a1 - a0);
    if (shiftKey) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
    xf.rotation = rot;
    return;
  }

  const [axSign, aySign] = ANCHOR[start.handle];
  const loc = toLocal({ ...start, rotation: start.rotation, cx: start.cx, cy: start.cy }, pos.x, pos.y);
  let mx = loc.x;
  let my = loc.y;
  const ax = axSign * (start.w / 2);
  const ay = aySign * (start.h / 2);
  if (start.handle === "n" || start.handle === "s") mx = -ax;
  if (start.handle === "e" || start.handle === "w") my = -ay;

  let newW = Math.max(8, Math.abs(mx - ax));
  let newH = Math.max(8, Math.abs(my - ay));
  if (shiftKey && start.w > 0 && start.h > 0) {
    const ratio = start.w / start.h;
    if (start.handle === "n" || start.handle === "s") newW = newH * ratio;
    else if (start.handle === "e" || start.handle === "w") newH = newW / ratio;
    else if (newW / newH > ratio) newH = newW / ratio;
    else newW = newH * ratio;
  }

  const dirX = mx >= ax ? 1 : -1;
  const dirY = my >= ay ? 1 : -1;
  const midX = ax + dirX * (newW / 2);
  const midY = ay + dirY * (newH / 2);
  const world = toWorld({ cx: start.cx, cy: start.cy, rotation: start.rotation }, midX, midY);
  xf.w = newW;
  xf.h = newH;
  xf.cx = world.x;
  xf.cy = world.y;
  xf.rotation = start.rotation;
}

export function applyTransform(layer, xf) {
  const corners = xfCorners(xf);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const minx = Math.floor(Math.min(...xs));
  const miny = Math.floor(Math.min(...ys));
  const maxx = Math.ceil(Math.max(...xs));
  const maxy = Math.ceil(Math.max(...ys));
  const nw = Math.max(1, maxx - minx);
  const nh = Math.max(1, maxy - miny);
  const next = makeCanvas(nw, nh);
  next.ctx.imageSmoothingEnabled = true;
  next.ctx.imageSmoothingQuality = "high";
  next.ctx.translate(xf.cx - minx, xf.cy - miny);
  next.ctx.rotate(xf.rotation);
  next.ctx.drawImage(xf.src, -xf.w / 2, -xf.h / 2, xf.w, xf.h);
  layer.canvas = next.canvas;
  layer.ctx = next.ctx;
  layer.x = minx;
  layer.y = miny;
  layer.touch();
}

export function drawTransformOverlay(ctx, xf, zoom) {
  const corners = xfCorners(xf);
  ctx.save();
  ctx.strokeStyle = "#e0a14a";
  ctx.lineWidth = 1 / zoom;
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.stroke();

  const top = toWorld(xf, 0, -xf.h / 2);
  const rot = rotateHandle(xf);
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(rot.x, rot.y);
  ctx.stroke();

  const r = 5 / zoom;
  ctx.fillStyle = "#1c1917";
  ctx.strokeStyle = "#e0a14a";
  for (const id of HANDLE_IDS) {
    const p = toWorld(xf, handleLocal(xf, id).x, handleLocal(xf, id).y);
    ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
    ctx.strokeRect(p.x - r, p.y - r, r * 2, r * 2);
  }
  ctx.beginPath();
  ctx.arc(rot.x, rot.y, 6 / zoom, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawTransformedLayer(ctx, layer, xf) {
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(xf.cx, xf.cy);
  ctx.rotate(xf.rotation);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(xf.src, -xf.w / 2, -xf.h / 2, xf.w, xf.h);
  ctx.restore();
}

export { HANDLE_IDS };
