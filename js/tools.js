import { fillPolygon, paintMask, setMaskFromImage, withSelectionClip } from "./selection.js";
import { applyHandle, hitTransform } from "./transform.js";

export const TOOLS = [
  { id: "move", name: "Move", key: "v" },
  { id: "transform", name: "Free Transform", key: "f" },
  { id: "smart", name: "Smart Select", key: "w" },
  { id: "lasso", name: "Lasso", key: "l" },
  { id: "mask", name: "Quick Mask", key: "q" },
  { id: "crop", name: "Crop", key: "c" },
  { id: "brush", name: "Brush", key: "b" },
  { id: "eraser", name: "Eraser", key: "e" },
  { id: "text", name: "Text", key: "t" },
];

export function createTools(app) {
  const drag = {
    down: false,
    last: null,
    points: [],
    startLayer: null,
    origin: null,
    xfStart: null,
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
      drag.startLayer = app.doc.active ? { x: app.doc.active.x, y: app.doc.active.y } : null;

      if (tool === "brush" || tool === "eraser") {
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
          };
        }
      }
    },

    pointermove(tool, ev, pos) {
      if (!drag.down) return;
      if (tool === "brush" || tool === "eraser") {
        stroke(app, tool, drag.last, pos);
      } else if (tool === "mask") {
        paintMask(app.doc, drag.last, pos, size(), !ev.altKey);
      } else if (tool === "lasso" || tool === "crop") {
        drag.points.push(pos);
      } else if (tool === "move" && app.doc.active && !app.doc.active.locked) {
        app.doc.active.x = drag.startLayer.x + (pos.x - drag.origin.x);
        app.doc.active.y = drag.startLayer.y + (pos.y - drag.origin.y);
      } else if (tool === "transform" && drag.xfStart && app.xf) {
        applyHandle(app.xf, drag.xfStart, pos, ev.shiftKey);
      }
      drag.last = pos;
    },

    pointerup(tool, ev, pos) {
      if (!drag.down) return;
      drag.down = false;
      if (tool === "lasso") {
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
      } else if (tool === "move" && app.doc.active) {
        app.doc.active.touch();
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
