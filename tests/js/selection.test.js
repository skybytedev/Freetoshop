import { describe, expect, it } from "vitest";
import { Document, makeCanvas } from "../../js/engine.js";
import { applyMaskCanvas, fillPolygon, paintMask, setMaskFromImage, withSelectionClip } from "../../js/selection.js";
import { pixel } from "./helpers.js";

function rect(x, y, w, h) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

describe("selection mask", () => {
  it("fills a polygon and reports bounds", () => {
    const doc = new Document(50, 50);
    fillPolygon(doc, rect(8, 12, 20, 10));
    expect(doc.hasSelection).toBe(true);
    const box = doc.selectionBounds();
    expect(box.x).toBeGreaterThanOrEqual(8);
    expect(box.y).toBeGreaterThanOrEqual(12);
    expect(box.w).toBeGreaterThanOrEqual(18);
    expect(box.h).toBeGreaterThanOrEqual(8);
  });

  it("does nothing for fewer than 3 points", () => {
    const doc = new Document(20, 20);
    fillPolygon(doc, [{ x: 1, y: 1 }, { x: 2, y: 2 }]);
    expect(doc.hasSelection).toBe(false);
  });

  it("adds and subtracts masks", () => {
    const doc = new Document(40, 40);
    fillPolygon(doc, rect(0, 0, 20, 20), "replace");
    const extra = makeCanvas(40, 40);
    extra.ctx.fillStyle = "#fff";
    extra.ctx.fillRect(15, 0, 15, 20);
    applyMaskCanvas(doc, extra.canvas, "add");
    expect(doc.selCtx.getImageData(18, 5, 1, 1).data[3]).toBeGreaterThan(8);
    applyMaskCanvas(doc, extra.canvas, "subtract");
    expect(doc.selCtx.getImageData(18, 5, 1, 1).data[3]).toBeLessThanOrEqual(8);
  });

  it("paints a quick-mask stroke", () => {
    const doc = new Document(40, 40);
    paintMask(doc, { x: 5, y: 5 }, { x: 25, y: 5 }, 6, true);
    expect(doc.hasSelection).toBe(true);
    paintMask(doc, { x: 5, y: 5 }, { x: 25, y: 5 }, 8, false);
    expect(doc.selCtx.getImageData(15, 5, 1, 1).data[3]).toBeLessThanOrEqual(8);
  });

  it("converts a grayscale image into selection alpha", () => {
    const doc = new Document(16, 16);
    const src = document.createElement("canvas");
    src.width = 8;
    src.height = 8;
    const ctx = src.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 4, 8);
    ctx.fillStyle = "#000000";
    ctx.fillRect(4, 0, 4, 8);
    setMaskFromImage(doc, src, 0, 0, "replace");
    expect(doc.hasSelection).toBe(true);
    expect(doc.selCtx.getImageData(1, 1, 1, 1).data[3]).toBeGreaterThan(200);
    expect(doc.selCtx.getImageData(6, 1, 1, 1).data[3]).toBeLessThan(20);
  });

  it("clips paint to the selection", () => {
    const doc = new Document(30, 30);
    fillPolygon(doc, rect(0, 0, 10, 30));
    withSelectionClip(doc, doc.active, (ctx) => {
      ctx.fillStyle = "#224488";
      ctx.fillRect(0, 0, 30, 30);
    });
    expect(pixel(doc.active, 2, 2).slice(0, 3)).toEqual([34, 68, 136]);
    expect(pixel(doc.active, 20, 2)[3]).toBe(0);
  });
});
