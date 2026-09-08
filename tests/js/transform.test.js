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
    expect(xf.scaleX).toBe(1);
    expect(xf.scaleY).toBe(1);
    doc.active.locked = true;
    expect(startTransform(doc.active)).toBeNull();
  });

  it("hits handles, the body, and empty space", () => {
    const xf = { cx: 100, cy: 100, w: 80, h: 60, rotation: 0, scaleX: 1, scaleY: 1 };
    expect(hitTransform(xf, { x: 140, y: 130 }, 1)).toBe("se");
    expect(hitTransform(xf, { x: 100, y: 100 }, 1)).toBe("move");
    expect(hitTransform(xf, { x: 100, y: 42 }, 1)).toBe("rotate");
    expect(hitTransform(xf, { x: 300, y: 300 }, 1)).toBeNull();
  });

  it("moves and scales from a corner", () => {
    const xf = { cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 };
    applyHandle(xf, { handle: "move", origin: { x: 50, y: 50 }, cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 }, { x: 70, y: 55 }, false);
    expect(xf.cx).toBe(70);
    expect(xf.cy).toBe(55);

    const scaled = { cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 };
    applyHandle(
      scaled,
      { handle: "se", origin: { x: 70, y: 60 }, cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 },
      { x: 90, y: 70 },
      false
    );
    expect(scaled.w).toBeGreaterThan(40);
    expect(scaled.h).toBeGreaterThan(20);
  });

  it("preserves width when dragging the north edge", () => {
    const xf = { cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 };
    applyHandle(
      xf,
      { handle: "n", origin: { x: 50, y: 40 }, cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 },
      { x: 50, y: 30 },
      false
    );
    expect(xf.w).toBe(40);
    expect(xf.h).toBeGreaterThan(20);
    expect(xf.scaleY).toBe(1);
  });

  it("flips horizontally when the east handle crosses the west edge", () => {
    const xf = { cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 };
    applyHandle(
      xf,
      { handle: "e", origin: { x: 70, y: 50 }, cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 },
      { x: 10, y: 50 },
      false
    );
    expect(xf.scaleX).toBe(-1);
    expect(xf.scaleY).toBe(1);
    expect(xf.w).toBeGreaterThanOrEqual(8);
    expect(xf.h).toBe(20);
  });

  it("flips vertically when the south handle crosses the north edge", () => {
    const xf = { cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 };
    applyHandle(
      xf,
      { handle: "s", origin: { x: 50, y: 60 }, cx: 50, cy: 50, w: 40, h: 20, rotation: 0, scaleX: 1, scaleY: 1 },
      { x: 50, y: 20 },
      false
    );
    expect(xf.scaleY).toBe(-1);
    expect(xf.scaleX).toBe(1);
    expect(xf.h).toBeGreaterThanOrEqual(8);
    expect(xf.w).toBe(40);
  });

  it("snaps rotation to 15 degrees with Shift", () => {
    const xf = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0, scaleX: 1, scaleY: 1 };
    applyHandle(
      xf,
      { handle: "rotate", origin: { x: 10, y: 0 }, cx: 0, cy: 0, w: 10, h: 10, rotation: 0, scaleX: 1, scaleY: 1 },
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

  it("mirrors pixels when scaleX is negative", () => {
    const doc = new Document(20, 10);
    doc.active.ctx.fillStyle = "#c44840";
    doc.active.ctx.fillRect(0, 0, 10, 10);
    doc.active.ctx.fillStyle = "#224488";
    doc.active.ctx.fillRect(10, 0, 10, 10);
    const xf = startTransform(doc.active);
    xf.scaleX = -1;
    applyTransform(doc.active, xf);
    expect(pixel(doc.active, 2, 5).slice(0, 3)).toEqual([34, 68, 136]);
    expect(pixel(doc.active, 17, 5).slice(0, 3)).toEqual([196, 72, 64]);
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
