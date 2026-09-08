import { describe, expect, it, vi } from "vitest";
import { Document, makeCanvas } from "../../js/engine.js";
import {
  createTools,
  drawSizeCursor,
  nextZoomFromRadialDelta,
  radialDistance,
  usesSizeCursor,
} from "../../js/tools.js";
import { pixel } from "./helpers.js";

function makeApp(doc) {
  const app = {
    doc,
    history: { push: vi.fn() },
    tool: "move",
    color: "#000",
    brushSize: 10,
    brushOpacity: 1,
    smartPoints: [],
    panning: false,
    panLast: null,
    zoomDragDir: null,
    xf: null,
    viewCenter: () => ({ x: 100, y: 100 }),
    selectLayer: vi.fn((id) => {
      doc.activeId = id;
    }),
    setStatus: vi.fn(),
    beginText: vi.fn(),
    sam: { predict: vi.fn(), health: {} },
  };
  app.tools = createTools(app);
  return app;
}

describe("size cursor", () => {
  it("is used by brush, eraser, and quick mask only", () => {
    expect(usesSizeCursor("brush")).toBe(true);
    expect(usesSizeCursor("eraser")).toBe(true);
    expect(usesSizeCursor("mask")).toBe(true);
    expect(usesSizeCursor("move")).toBe(false);
    expect(usesSizeCursor("hand")).toBe(false);
    expect(usesSizeCursor("lasso")).toBe(false);
  });

  it("draws a ring whose diameter matches the brush size", () => {
    const { canvas, ctx } = makeCanvas(60, 60);
    drawSizeCursor(ctx, { x: 30, y: 30 }, 20, 1);
    // Rim pixels near radius 10 should be marked; center stays empty.
    expect(pixel(canvas, 30, 30)[3]).toBe(0);
    expect(pixel(canvas, 40, 30)[3]).toBeGreaterThan(0);
    expect(pixel(canvas, 20, 30)[3]).toBeGreaterThan(0);
  });

  it("ignores empty positions or non-positive sizes", () => {
    const { canvas, ctx } = makeCanvas(20, 20);
    drawSizeCursor(ctx, null, 10, 1);
    drawSizeCursor(ctx, { x: 10, y: 10 }, 0, 1);
    expect(pixel(canvas, 10, 10)[3]).toBe(0);
  });
});

describe("zoom tool math", () => {
  it("measures radial distance from the screen center", () => {
    expect(radialDistance({ x: 103, y: 104 }, { x: 100, y: 100 })).toBeCloseTo(5, 6);
  });

  it("zooms in when dragging away from center and out when toward it", () => {
    const base = 1;
    const inZoom = nextZoomFromRadialDelta(base, 40);
    const outZoom = nextZoomFromRadialDelta(base, -40);
    expect(inZoom).toBeGreaterThan(base);
    expect(outZoom).toBeLessThan(base);
  });

  it("clamps zoom to the editor range", () => {
    expect(nextZoomFromRadialDelta(7.5, 500)).toBe(8);
    expect(nextZoomFromRadialDelta(0.1, -500)).toBe(0.08);
  });

  it("updates document zoom while dragging radially", () => {
    const doc = new Document(20, 20);
    doc.zoom = 1;
    const app = makeApp(doc);
    app.tools.pointerdown("zoom", { clientX: 100, clientY: 140 }, { x: 0, y: 0 });
    app.tools.pointermove("zoom", { clientX: 100, clientY: 180 }, { x: 0, y: 0 });
    expect(doc.zoom).toBeGreaterThan(1);
    expect(app.zoomDragDir).toBe("in");
    const afterIn = doc.zoom;
    app.tools.pointermove("zoom", { clientX: 100, clientY: 120 }, { x: 0, y: 0 });
    expect(doc.zoom).toBeLessThan(afterIn);
    expect(app.zoomDragDir).toBe("out");
  });
});

describe("move tool", () => {
  it("auto-selects the topmost layer under the pointer", () => {
    const doc = new Document(40, 40);
    doc.active.ctx.fillStyle = "#c44840";
    doc.active.ctx.fillRect(0, 0, 40, 40);
    const top = doc.addLayer("Top", 20, 20, 5, 5);
    top.ctx.fillStyle = "#224488";
    top.ctx.fillRect(0, 0, 20, 20);
    doc.activeId = doc.layers[0].id;

    const app = makeApp(doc);
    app.tools.pointerdown("move", {}, { x: 10, y: 10 });
    expect(app.selectLayer).toHaveBeenCalledWith(top.id);
  });

  it("moves linked layers together and keeps stack order", () => {
    const doc = new Document(40, 40);
    const a = doc.addLayer("A", 10, 10, 0, 0);
    const b = doc.addLayer("B", 10, 10, 20, 10);
    a.ctx.fillStyle = "#c44840";
    a.ctx.fillRect(0, 0, 10, 10);
    b.ctx.fillStyle = "#224488";
    b.ctx.fillRect(0, 0, 10, 10);
    doc.activeId = a.id;
    doc.toggleLink(b.id);

    const app = makeApp(doc);
    app.tools.pointerdown("move", {}, { x: 2, y: 2 });
    app.tools.pointermove("move", {}, { x: 12, y: 7 });
    app.tools.pointerup("move", {}, { x: 12, y: 7 });

    expect(a.x).toBe(10);
    expect(a.y).toBe(5);
    expect(b.x).toBe(30);
    expect(b.y).toBe(15);
    expect(doc.layers.map((l) => l.name)).toEqual(["Background", "A", "B"]);
  });

  it("skips locked peers when moving a link group", () => {
    const doc = new Document(40, 40);
    const a = doc.addLayer("A", 10, 10, 0, 0);
    const b = doc.addLayer("B", 10, 10, 20, 0);
    a.ctx.fillRect(0, 0, 10, 10);
    b.ctx.fillRect(0, 0, 10, 10);
    b.locked = true;
    doc.activeId = a.id;
    doc.toggleLink(b.id);

    const app = makeApp(doc);
    app.tools.pointerdown("move", {}, { x: 2, y: 2 });
    app.tools.pointermove("move", {}, { x: 12, y: 2 });
    expect(a.x).toBe(10);
    expect(b.x).toBe(20);
  });
});

describe("hand tool", () => {
  it("starts a pan on pointer down", () => {
    const doc = new Document(20, 20);
    const app = makeApp(doc);
    app.tools.pointerdown("hand", { clientX: 100, clientY: 50 }, { x: 0, y: 0 });
    expect(app.panning).toBe(true);
    expect(app.panLast).toEqual({ x: 100, y: 50 });
  });
});
