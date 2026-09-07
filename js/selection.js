import { makeCanvas } from "./engine.js";

export function setMaskFromImage(doc, image, dx = 0, dy = 0, mode = "replace") {
  const src = makeCanvas(image.width, image.height);
  src.ctx.drawImage(image, 0, 0);
  const pixels = src.ctx.getImageData(0, 0, src.canvas.width, src.canvas.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const lum = pixels.data[i];
    const alpha = pixels.data[i + 3];
    const cover = alpha < 255 ? alpha : lum;
    pixels.data[i] = 255;
    pixels.data[i + 1] = 255;
    pixels.data[i + 2] = 255;
    pixels.data[i + 3] = cover;
  }
  src.ctx.putImageData(pixels, 0, 0);
  const dest = makeCanvas(doc.width, doc.height);
  dest.ctx.drawImage(src.canvas, dx, dy);
  applyMaskCanvas(doc, dest.canvas, mode);
}

export function applyMaskCanvas(doc, maskCanvas, mode = "replace") {
  if (mode === "replace") {
    doc.selCtx.clearRect(0, 0, doc.width, doc.height);
    doc.selCtx.drawImage(maskCanvas, 0, 0);
  } else if (mode === "add") {
    doc.selCtx.globalCompositeOperation = "lighten";
    doc.selCtx.drawImage(maskCanvas, 0, 0);
    doc.selCtx.globalCompositeOperation = "source-over";
  } else if (mode === "subtract") {
    doc.selCtx.globalCompositeOperation = "destination-out";
    doc.selCtx.drawImage(maskCanvas, 0, 0);
    doc.selCtx.globalCompositeOperation = "source-over";
  }
  refreshHasSelection(doc);
}

export function fillPolygon(doc, points, mode = "replace") {
  if (points.length < 3) return;
  const { canvas, ctx } = makeCanvas(doc.width, doc.height);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fillStyle = "#fff";
  ctx.fill();
  applyMaskCanvas(doc, canvas, mode);
}

export function paintMask(doc, from, to, size, add = true) {
  doc.selCtx.save();
  doc.selCtx.lineCap = "round";
  doc.selCtx.lineJoin = "round";
  doc.selCtx.lineWidth = size;
  doc.selCtx.strokeStyle = add ? "#fff" : "#000";
  doc.selCtx.globalCompositeOperation = add ? "source-over" : "destination-out";
  doc.selCtx.beginPath();
  doc.selCtx.moveTo(from.x, from.y);
  doc.selCtx.lineTo(to.x, to.y);
  doc.selCtx.stroke();
  doc.selCtx.restore();
  refreshHasSelection(doc);
}

export function refreshHasSelection(doc) {
  doc.invalidateSelection();
  const { data } = doc.selCtx.getImageData(0, 0, doc.width, doc.height);
  for (let i = 3; i < data.length; i += 16) {
    if (data[i] > 8) {
      doc.hasSelection = true;
      return;
    }
  }
  doc.hasSelection = false;
}

export function withSelectionClip(doc, layer, fn) {
  if (!doc.hasSelection) {
    fn(layer.ctx);
    return;
  }
  const tmp = makeCanvas(layer.canvas.width, layer.canvas.height);
  fn(tmp.ctx);
  tmp.ctx.globalCompositeOperation = "destination-in";
  tmp.ctx.drawImage(doc.selCanvas, -layer.x, -layer.y);
  layer.ctx.drawImage(tmp.canvas, 0, 0);
}
