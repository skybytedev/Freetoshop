import { describe, expect, it } from "vitest";
import { Document } from "../../js/engine.js";
import {
  applyHandle,
  applyTransform,
  hitTransform,
  startTransform,
  toLocal,
  toWorld,
  xfCorners,
} from "../../js/transform.js";
import { pixel } from "./helpers.js";

describe("free transform math", () => {
  it("round-trips local and world coordinates", () => {
    const xf = { cx: 100, cy: 40, rotation: Math.PI / 2, w: 20, h: 10 };
    const world = toWorld(xf, 10, 0);
    const back = toLocal(xf, world.x, world.y);
    expect(back.x).toBeCloseTo(10, 6);
    expect(back.y).toBeCloseTo(0, 6);
  });

  it("starts a session from an unlocked layer", () => {
    const doc = new Document(40, 20);
    doc.active.x = 10;
    doc.active.y = 4;
    const xf = startTransform(doc.active);
    expect(xf.layerId).toBe(doc.active.id);
    expect(xf.w).toBe(40);
    expect(xf.h).toBe(20);
    expect(xf.cx).toBe(30);
    expect(xf.cy).toBe(14);
    expect(xf.rotation).toBe(0);
    doc.active.locked = true;
    expect(startTransform(doc.active)).toBeNull();
  });

  it("hits handles, the body, and empty space", () => {
    const xf = { cx: 100, cy: 100, w: 80, h: 60, rotation: 0 };
    expect(hitTransform(xf, { x: 140, y: 130 }, 1)).toBe("se");
    expect(hitTransform(xf, { x: 100, y: 100 }, 1)).toBe("move");
    expect(hitTransform(xf, { x: 100, y: 42 }, 1)).toBe("rotate");
    expect(hitTransform(xf, { x: 300, y: 300 }, 1)).toBeNull();
  });

  it("moves and scales from a corner", () => {
    const xf = { cx: 50, cy: 50, w: 40, h: 20, rotation: 0 };
    applyHandle(xf, { handle: "move", origin: { x: 50, y: 50 }, cx: 50, cy: 50, w: 40, h: 20, rotation: 0 }, { x: 70, y: 55 }, false);
    expect(xf.cx).toBe(70);
    expect(xf.cy).toBe(55);

    const scaled = { cx: 50, cy: 50, w: 40, h: 20, rotation: 0 };
    applyHandle(
      scaled,
      { handle: "se", origin: { x: 70, y: 60 }, cx: 50, cy: 50, w: 40, h: 20, rotation: 0 },
      { x: 90, y: 70 },
      false
    );
    expect(scaled.w).toBeGreaterThan(40);
    expect(scaled.h).toBeGreaterThan(20);
  });

  it("snaps rotation to 15 degrees with Shift", () => {
    const xf = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    applyHandle(
      xf,
      { handle: "rotate", origin: { x: 10, y: 0 }, cx: 0, cy: 0, w: 10, h: 10, rotation: 0 },
      { x: 10, y: 2 },
      true
    );
    expect(xf.rotation % (Math.PI / 12)).toBeCloseTo(0, 6);
  });
});

describe("applyTransform", () => {
  it("rasterizes a scaled layer onto a new canvas", () => {
    const doc = new Document(20, 20);
    doc.active.ctx.fillStyle = "#c44840";
    doc.active.ctx.fillRect(0, 0, 20, 20);
    const xf = startTransform(doc.active);
    xf.w = 40;
    xf.h = 20;
    applyTransform(doc.active, xf);
    expect(doc.active.canvas.width).toBeGreaterThanOrEqual(40);
    expect(pixel(doc.active, 4, 4).slice(0, 3)).toEqual([196, 72, 64]);
  });

  it("grows the AABB when rotated", () => {
    const doc = new Document(20, 20);
    doc.active.ctx.fillStyle = "#224488";
    doc.active.ctx.fillRect(0, 0, 20, 20);
    const xf = startTransform(doc.active);
    xf.rotation = Math.PI / 4;
    applyTransform(doc.active, xf);
    const box = xfCorners(xf);
    const xs = box.map((p) => p.x);
    const ys = box.map((p) => p.y);
    expect(doc.active.canvas.width).toBeGreaterThanOrEqual(Math.floor(Math.max(...xs) - Math.min(...xs)));
    expect(doc.active.canvas.height).toBeGreaterThanOrEqual(Math.floor(Math.max(...ys) - Math.min(...ys)));
  });
});
