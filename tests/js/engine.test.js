import { describe, expect, it } from "vitest";
import { Document, History } from "../../js/engine.js";
import { fillPolygon } from "../../js/selection.js";
import { pixel } from "./helpers.js";

describe("layers", () => {
  it("starts with a background layer", () => {
    const doc = new Document(64, 48);
    expect(doc.width).toBe(64);
    expect(doc.height).toBe(48);
    expect(doc.layers).toHaveLength(1);
    expect(doc.active.name).toBe("Background");
  });

  it("adds, duplicates, and refuses to delete the last layer", () => {
    const doc = new Document(32, 32);
    const extra = doc.addLayer("Paint");
    extra.ctx.fillStyle = "#c44840";
    extra.ctx.fillRect(0, 0, 32, 32);
    extra.touch();
    expect(doc.layers).toHaveLength(2);
    doc.duplicateActive();
    expect(doc.layers).toHaveLength(3);
    expect(doc.active.name).toBe("Paint copy");
    expect(pixel(doc.active, 4, 4).slice(0, 3)).toEqual([196, 72, 64]);
    doc.deleteActive();
    doc.deleteActive();
    expect(doc.layers).toHaveLength(1);
    doc.deleteActive();
    expect(doc.layers).toHaveLength(1);
  });

  it("reorders the active layer", () => {
    const doc = new Document(16, 16);
    doc.addLayer("A");
    doc.addLayer("B");
    const names = () => doc.layers.map((l) => l.name);
    expect(names()).toEqual(["Background", "A", "B"]);
    doc.moveActive(-1);
    expect(names()).toEqual(["Background", "B", "A"]);
    doc.moveActive(-1);
    expect(names()).toEqual(["B", "Background", "A"]);
  });

  it("reorders a layer by index", () => {
    const doc = new Document(16, 16);
    doc.addLayer("A");
    doc.addLayer("B");
    const names = () => doc.layers.map((l) => l.name);
    expect(doc.reorder(2, 0)).toBe(true);
    expect(names()).toEqual(["B", "Background", "A"]);
    expect(doc.reorder(0, 0)).toBe(false);
    expect(doc.reorder(-1, 1)).toBe(false);
    expect(doc.moveLayer(doc.layers[2].id, 1)).toBe(true);
    expect(names()).toEqual(["B", "A", "Background"]);
  });

  it("hit-tests the topmost opaque visible layer", () => {
    const doc = new Document(40, 40);
    doc.active.ctx.fillStyle = "#c44840";
    doc.active.ctx.fillRect(0, 0, 40, 40);
    const top = doc.addLayer("Top", 20, 20, 5, 5);
    top.ctx.fillStyle = "#224488";
    top.ctx.fillRect(0, 0, 20, 20);
    expect(doc.hitTestLayer(10, 10)?.name).toBe("Top");
    expect(doc.hitTestLayer(30, 30)?.name).toBe("Background");
    top.visible = false;
    expect(doc.hitTestLayer(10, 10)?.name).toBe("Background");
    expect(doc.hitTestLayer(100, 100)).toBeNull();
  });

  it("skips fully transparent pixels during hit-test", () => {
    const doc = new Document(20, 20);
    doc.active.ctx.fillStyle = "#c44840";
    doc.active.ctx.fillRect(0, 0, 10, 10);
    expect(doc.hitTestLayer(2, 2)?.name).toBe("Background");
    expect(doc.hitTestLayer(15, 15)).toBeNull();
  });
});

describe("linked layers", () => {
  it("links layers into a group without changing stack order", () => {
    const doc = new Document(16, 16);
    const a = doc.addLayer("A");
    const b = doc.addLayer("B");
    doc.activeId = a.id;
    expect(doc.toggleLink(b.id)).toBe(true);
    expect(a.linkGroup).toBeTruthy();
    expect(b.linkGroup).toBe(a.linkGroup);
    expect(doc.layers.map((l) => l.name)).toEqual(["Background", "A", "B"]);
    expect(doc.linkedLayers(a).map((l) => l.name)).toEqual(["A", "B"]);
  });

  it("unlinks and prunes singleton groups", () => {
    const doc = new Document(16, 16);
    const a = doc.addLayer("A");
    const b = doc.addLayer("B");
    doc.activeId = a.id;
    doc.toggleLink(b.id);
    expect(doc.toggleLink(b.id)).toBe(true);
    expect(b.linkGroup).toBeNull();
    expect(a.linkGroup).toBeNull();
  });

  it("does not link a layer to itself", () => {
    const doc = new Document(16, 16);
    const a = doc.addLayer("A");
    doc.activeId = a.id;
    expect(doc.toggleLink(a.id)).toBe(false);
  });

  it("clears a link group when a peer is deleted", () => {
    const doc = new Document(16, 16);
    const a = doc.addLayer("A");
    const b = doc.addLayer("B");
    doc.activeId = a.id;
    doc.toggleLink(b.id);
    doc.activeId = b.id;
    doc.deleteActive();
    expect(a.linkGroup).toBeNull();
  });

  it("preserves link groups across undo snapshots", () => {
    const doc = new Document(16, 16);
    const a = doc.addLayer("A");
    const b = doc.addLayer("B");
    doc.activeId = a.id;
    doc.toggleLink(b.id);
    const hist = new History();
    hist.push(doc);
    doc.unlink(b.id);
    expect(a.linkGroup).toBeNull();
    hist.undo(doc);
    expect(doc.layers.find((l) => l.id === a.id).linkGroup).toBeTruthy();
    expect(doc.layers.find((l) => l.id === b.id).linkGroup).toBe(
      doc.layers.find((l) => l.id === a.id).linkGroup
    );
  });
});

describe("fill layer", () => {
  it("paints the whole active layer", () => {
    const doc = new Document(20, 20);
    doc.fillActive("#3d5a4c");
    expect(pixel(doc.active, 0, 0)).toEqual([61, 90, 76, 255]);
    expect(pixel(doc.active, 19, 19)).toEqual([61, 90, 76, 255]);
  });

  it("does not paint a locked layer", () => {
    const doc = new Document(10, 10);
    doc.active.locked = true;
    doc.fillActive("#ffffff");
    expect(pixel(doc.active, 5, 5)[3]).toBe(0);
  });

  it("fills only the selection when one exists", () => {
    const doc = new Document(40, 40);
    fillPolygon(doc, [
      { x: 5, y: 5 },
      { x: 15, y: 5 },
      { x: 15, y: 15 },
      { x: 5, y: 15 },
    ]);
    doc.fillActive("#e0a14a");
    expect(pixel(doc.active, 8, 8).slice(0, 3)).toEqual([224, 161, 74]);
    expect(pixel(doc.active, 30, 30)[3]).toBe(0);
  });
});

describe("canvas size", () => {
  it("resizes from the top left without moving layers", () => {
    const doc = new Document(100, 80);
    doc.active.x = 10;
    doc.resizeCanvas(200, 50, "top-left");
    expect(doc.width).toBe(200);
    expect(doc.height).toBe(50);
    expect(doc.active.x).toBe(10);
  });

  it("recenters layers when the anchor is center", () => {
    const doc = new Document(100, 100);
    doc.active.x = 0;
    doc.active.y = 0;
    doc.resizeCanvas(200, 120, "center");
    expect(doc.width).toBe(200);
    expect(doc.height).toBe(120);
    expect(doc.active.x).toBe(50);
    expect(doc.active.y).toBe(10);
  });

  it("clamps size to 1..8192", () => {
    const doc = new Document(10, 10);
    doc.resizeCanvas(0, 99999, "top-left");
    expect(doc.width).toBe(1);
    expect(doc.height).toBe(8192);
  });

  it("fits the canvas to layer bounds", () => {
    const doc = new Document(200, 200);
    doc.layers[0].x = 20;
    doc.layers[0].y = 30;
    doc.fitCanvasToContent();
    expect(doc.width).toBe(200);
    expect(doc.height).toBe(200);
    expect(doc.layers[0].x).toBe(0);
    expect(doc.layers[0].y).toBe(0);
  });
});

describe("import and extract", () => {
  it("fits the document to an image-like source", () => {
    const doc = new Document(10, 10);
    const src = document.createElement("canvas");
    src.width = 80;
    src.height = 40;
    src.getContext("2d").fillStyle = "#224488";
    src.getContext("2d").fillRect(0, 0, 80, 40);
    doc.fitToImage(src);
    expect(doc.width).toBe(80);
    expect(doc.height).toBe(40);
    expect(doc.layers).toHaveLength(1);
    expect(pixel(doc.active, 2, 2).slice(0, 3)).toEqual([34, 68, 136]);
  });

  it("adds an image layer without growing the canvas", () => {
    const doc = new Document(50, 50);
    const src = document.createElement("canvas");
    src.width = 90;
    src.height = 60;
    doc.addImageLayer(src, "Photo");
    expect(doc.width).toBe(50);
    expect(doc.height).toBe(50);
    expect(doc.active.name).toBe("Photo");
    expect(doc.active.canvas.width).toBe(90);
  });

  it("extracts a cutout and punches the source", () => {
    const doc = new Document(60, 60);
    doc.fillActive("#c44840");
    fillPolygon(doc, [
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 10, y: 30 },
    ]);
    const cut = doc.extract(true);
    expect(cut.name).toBe("Cutout");
    expect(cut.x).toBe(10);
    expect(cut.y).toBe(10);
    expect(cut.canvas.width).toBe(20);
    expect(cut.canvas.height).toBe(20);
    expect(pixel(cut, 2, 2).slice(0, 3)).toEqual([196, 72, 64]);
    const src = doc.layers[0];
    expect(pixel(src, 15, 15)[3]).toBe(0);
    expect(pixel(src, 40, 40).slice(0, 3)).toEqual([196, 72, 64]);
    expect(doc.hasSelection).toBe(false);
  });

  it("extract copy leaves the source intact", () => {
    const doc = new Document(40, 40);
    doc.fillActive("#224488");
    fillPolygon(doc, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
    doc.extract(false);
    expect(doc.active.name).toBe("Copy");
    expect(pixel(doc.layers[0], 2, 2).slice(0, 3)).toEqual([34, 68, 136]);
  });

  it("crops the document to the selection", () => {
    const doc = new Document(80, 80);
    doc.fillActive("#111111");
    fillPolygon(doc, [
      { x: 20, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 40 },
      { x: 20, y: 40 },
    ]);
    doc.cropToSelection();
    expect(doc.width).toBe(30);
    expect(doc.height).toBe(30);
    expect(doc.layers[0].x).toBe(0);
    expect(doc.layers[0].y).toBe(0);
  });
});

describe("history", () => {
  it("undoes and redoes a fill", () => {
    const doc = new Document(16, 16);
    const hist = new History();
    hist.push(doc);
    doc.fillActive("#c44840");
    expect(pixel(doc.active, 1, 1).slice(0, 3)).toEqual([196, 72, 64]);
    expect(hist.undo(doc)).toBe(true);
    expect(pixel(doc.active, 1, 1)[3]).toBe(0);
    expect(hist.redo(doc)).toBe(true);
    expect(pixel(doc.active, 1, 1).slice(0, 3)).toEqual([196, 72, 64]);
  });

  it("returns false when stacks are empty", () => {
    const doc = new Document(8, 8);
    const hist = new History();
    expect(hist.undo(doc)).toBe(false);
    expect(hist.redo(doc)).toBe(false);
  });
});
