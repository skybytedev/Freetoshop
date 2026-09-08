import { fillPolygon, paintMask, setMaskFromImage, withSelectionClip } from "./selection.js";
import { applyHandle, hitTransform } from "./transform.js";

export const TOOLS = [
  { id: "move", name: "Move", key: "v" },
  { id: "hand", name: "Hand", key: "h" },
  { id: "zoom", name: "Zoom", key: "z" },
  { id: "transform", name: "Free Transform", key: "f" },
  { id: "smart", name: "Smart Select", key: "w" },
  { id: "lasso", name: "Lasso", key: "l" },
  { id: "mask", name: "Quick Mask", key: "q" },
  { id: "crop", name: "Crop", key: "c" },
  { id: "brush", name: "Brush", key: "b" },
  { id: "eraser", name: "Eraser", key: "e" },
  { id: "text", name: "Text", key: "t" },
];

/** Tools whose stroke diameter matches the brush size slider. */
export function usesSizeCursor(tool) {
  return tool === "brush" || tool === "eraser" || tool === "mask";
}

/** Screen-space distance from a point to the view center. */
export function radialDistance(point, center) {
  return Math.hypot(point.x - center.x, point.y - center.y);
}

/**
 * Zoom in when the pointer moves farther from screen center (positive distDelta),
 * zoom out when it moves closer. Clamped to [min, max].
 */
export function nextZoomFromRadialDelta(zoom, distDelta, opts = {}) {
  const sensitivity = opts.sensitivity ?? 0.008;
  const min = opts.min ?? 0.08;
  const max = opts.max ?? 8;
  const factor = Math.exp(distDelta * sensitivity);
  return Math.min(max, Math.max(min, zoom * factor));
}

/** Draw a diameter preview circle in document space (ctx already zoom-transformed). */
export function drawSizeCursor(ctx, pos, size, zoom) {
  if (!pos || !(size > 0)) return;
  const r = size / 2;
  const lw = 1 / zoom;
  ctx.save();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
  ctx.lineWidth = lw;
  ctx.strokeStyle = "rgba(0,0,0,0.85)";
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, Math.max(0, r - lw), 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.stroke();
  ctx.restore();
}
export function createTools(app) {
  const drag = {
    down: false,
    last: null,
    points: [],
    startPositions: null,
    origin: null,
    xfStart: null,
    zoomLast: null,
  };

  function color() {
    return app.color;
  }

  function size() {
    return app.brushSize;
  }

  function alpha() {
    return app.brushOpacity;
  }

  function modeFromEvent(ev) {
    if (ev.altKey) return "subtract";
    if (ev.shiftKey) return "add";
    return "replace";
  }

  return {
    pointerdown(tool, ev, pos) {
      drag.down = true;
      drag.last = pos;
      drag.points = [pos];
      drag.origin = pos;
      drag.startPositions = null;
      drag.zoomLast = null;

      if (tool === "hand") {
        app.panning = true;
        app.panLast = { x: ev.clientX, y: ev.clientY };
        return;
      }

      if (tool === "zoom") {
        drag.zoomLast = { x: ev.clientX, y: ev.clientY };
        return;
      }

      if (tool === "move") {
        const hit = app.doc.hitTestLayer(pos.x, pos.y);
        if (hit && hit.id !== app.doc.activeId) {
          app.selectLayer?.(hit.id);
        }
        const peers = app.doc.linkedLayers(app.doc.active);
        drag.startPositions = Object.fromEntries(
          peers.filter((l) => !l.locked).map((l) => [l.id, { x: l.x, y: l.y }])
        );
      } else if (tool === "brush" || tool === "eraser") {
        app.history.push(app.doc);
        stroke(app, tool, pos, pos);
      } else if (tool === "mask") {
        app.history.push(app.doc);
        app.doc.quickMask = true;
        paintMask(app.doc, pos, pos, size(), !ev.altKey);
      } else if (tool === "fill") {
        app.history.push(app.doc);
        app.doc.fillActive(color());
      } else if (tool === "text") {
        app.beginText(pos);
      } else if (tool === "smart") {
        smartClick(app, pos, modeFromEvent(ev));
      } else if (tool === "transform" && app.xf) {
        const handle = hitTransform(app.xf, pos, app.doc.zoom);
        if (handle) {
          drag.xfStart = {
            handle,
            origin: pos,
            cx: app.xf.cx,
            cy: app.xf.cy,
            w: app.xf.w,
            h: app.xf.h,
            rotation: app.xf.rotation,
            scaleX: app.xf.scaleX ?? 1,
            scaleY: app.xf.scaleY ?? 1,
          };
        }
      }
    },

    pointermove(tool, ev, pos) {
      if (!drag.down) return;
      if (tool === "hand" || app.panning) return;
      if (tool === "zoom" && drag.zoomLast) {
        const center = app.viewCenter?.() || { x: 0, y: 0 };
        const cur = { x: ev.clientX, y: ev.clientY };
        const delta = radialDistance(cur, center) - radialDistance(drag.zoomLast, center);
        app.doc.zoom = nextZoomFromRadialDelta(app.doc.zoom, delta);
        app.zoomDragDir = delta === 0 ? app.zoomDragDir : delta > 0 ? "in" : "out";
        drag.zoomLast = cur;
      } else if (tool === "brush" || tool === "eraser") {
        stroke(app, tool, drag.last, pos);
      } else if (tool === "mask") {
        paintMask(app.doc, drag.last, pos, size(), !ev.altKey);
      } else if (tool === "lasso" || tool === "crop") {
        drag.points.push(pos);
      } else if (tool === "move" && drag.startPositions && drag.origin) {
        const dx = pos.x - drag.origin.x;
        const dy = pos.y - drag.origin.y;
        for (const layer of app.doc.layers) {
          const start = drag.startPositions[layer.id];
          if (!start) continue;
          layer.x = start.x + dx;
          layer.y = start.y + dy;
        }
      } else if (tool === "transform" && drag.xfStart && app.xf) {
        applyHandle(app.xf, drag.xfStart, pos, ev.shiftKey);
      }
      drag.last = pos;
    },

    pointerup(tool, ev, pos) {
      if (!drag.down) return;
      drag.down = false;
      if (tool === "zoom") {
        drag.zoomLast = null;
        app.zoomDragDir = null;
      } else if (tool === "lasso") {
        drag.points.push(pos);
        if (drag.points.length >= 3) {
          app.history.push(app.doc);
          fillPolygon(app.doc, drag.points, modeFromEvent(ev));
        }
        drag.points = [];
      } else if (tool === "crop" && drag.points.length >= 2) {
        const a = drag.origin;
        const b = pos;
        const rect = [
          { x: a.x, y: a.y },
          { x: b.x, y: a.y },
          { x: b.x, y: b.y },
          { x: a.x, y: b.y },
        ];
        app.history.push(app.doc);
        fillPolygon(app.doc, rect, "replace");
        app.doc.cropToSelection();
        drag.points = [];
      } else if (tool === "move" && drag.startPositions) {
        for (const id of Object.keys(drag.startPositions)) {
          const layer = app.doc.layers.find((l) => l.id === id);
          layer?.touch();
        }
        drag.startPositions = null;
      } else if (tool === "transform") {
        drag.xfStart = null;
      }
    },

    hover(tool, pos) {
      if (tool !== "transform" || !app.xf) return "";
      return hitTransform(app.xf, pos, app.doc.zoom) || "";
    },

    getLasso() {
      return drag.points;
    },
  };
}

function stroke(app, tool, from, to) {
  const layer = app.doc.active;
  if (!layer || layer.locked) return;
  withSelectionClip(app.doc, layer, (ctx) => {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = app.brushSize;
    ctx.globalAlpha = app.brushOpacity;
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "#000";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = app.color;
    }
    ctx.beginPath();
    ctx.moveTo(from.x - layer.x, from.y - layer.y);
    ctx.lineTo(to.x - layer.x, to.y - layer.y);
    ctx.stroke();
    ctx.restore();
  });
  layer.touch();
}

async function smartClick(app, pos, mode) {
  const layer = app.doc.active;
  if (!layer) return;
  app.setStatus("Selecting…");
  try {
    const lx = pos.x - layer.x;
    const ly = pos.y - layer.y;
    if (lx < 0 || ly < 0 || lx >= layer.canvas.width || ly >= layer.canvas.height) {
      app.setStatus("Click the object on this layer");
      return;
    }
    const label = mode === "subtract" ? 0 : 1;
    if (mode === "replace") app.smartPoints = [];
    app.smartPoints.push({ x: lx, y: ly, label });
    const blob = await app.sam.predict(layer, app.smartPoints);
    const bmp = await createImageBitmap(blob);
    app.history.push(app.doc);
    setMaskFromImage(app.doc, bmp, layer.x, layer.y, mode === "replace" ? "replace" : mode);
    bmp.close();
    app.setStatus(app.sam.health.demo ? "Demo mask — install SAM 2" : "Object selected — Extract to cut out");
  } catch (err) {
    app.setStatus(err.message || "SAM failed — see SAM.md");
  }
}
