import { describe, expect, it } from "vitest";
import { Document } from "../../js/engine.js";
import {
  documentFromProject,
  isProjectFile,
  isProjectPayload,
  serializeDocument,
} from "../../js/project.js";
import { fillPolygon } from "../../js/selection.js";
import { pixel } from "./helpers.js";

describe("project save/load", () => {
  it("round-trips layers, opacity, and pixels", async () => {
    const doc = new Document(24, 16);
    doc.active.ctx.fillStyle = "#c44840";
    doc.active.ctx.fillRect(0, 0, 24, 16);
    doc.active.touch();
    const paint = doc.addLayer("Paint", 10, 10, 4, 3);
    paint.ctx.fillStyle = "#3d5a4c";
    paint.ctx.fillRect(0, 0, 10, 10);
    paint.opacity = 0.5;
    paint.touch();
    doc.activeId = paint.id;

    const payload = serializeDocument(doc);
    expect(isProjectPayload(payload)).toBe(true);
    expect(payload.layers).toHaveLength(2);

    const loaded = await documentFromProject(payload);
    expect(loaded.width).toBe(24);
    expect(loaded.height).toBe(16);
    expect(loaded.layers).toHaveLength(2);
    expect(loaded.active.name).toBe("Paint");
    expect(loaded.active.opacity).toBe(0.5);
    expect(loaded.active.x).toBe(4);
    expect(loaded.active.y).toBe(3);
    expect(pixel(loaded.layers[0], 2, 2).slice(0, 3)).toEqual([196, 72, 64]);
    expect(pixel(loaded.active, 1, 1).slice(0, 3)).toEqual([61, 90, 76]);
  });

  it("round-trips linked layers", async () => {
    const doc = new Document(12, 12);
    const a = doc.addLayer("A");
    const b = doc.addLayer("B");
    doc.activeId = a.id;
    doc.toggleLink(b.id);
    const group = a.linkGroup;
    const loaded = await documentFromProject(serializeDocument(doc));
    const la = loaded.layers.find((l) => l.name === "A");
    const lb = loaded.layers.find((l) => l.name === "B");
    expect(la.linkGroup).toBe(group);
    expect(lb.linkGroup).toBe(group);
    expect(loaded.layers.map((l) => l.name)).toEqual(["Background", "A", "B"]);
  });

  it("preserves selection masks", async () => {
    const doc = new Document(20, 20);
    fillPolygon(doc, [
      { x: 2, y: 2 },
      { x: 10, y: 2 },
      { x: 10, y: 10 },
      { x: 2, y: 10 },
    ]);
    expect(doc.hasSelection).toBe(true);
    const loaded = await documentFromProject(serializeDocument(doc));
    expect(loaded.hasSelection).toBe(true);
    expect(pixel(loaded.selCanvas, 5, 5)[3]).toBeGreaterThan(10);
    expect(pixel(loaded.selCanvas, 18, 18)[3]).toBe(0);
  });

  it("rejects empty or foreign payloads", async () => {
    expect(isProjectPayload(null)).toBe(false);
    expect(isProjectPayload({ format: "other", layers: [] })).toBe(false);
    await expect(documentFromProject({ format: "freetoshop", layers: "nope" })).rejects.toThrow();
  });

  it("detects project filenames", () => {
    expect(isProjectFile({ name: "collage.freetoshop.json" })).toBe(true);
    expect(isProjectFile({ name: "shot.png", type: "image/png" })).toBe(false);
  });

  it("handles a document with no layers in the file by adding a background", async () => {
    const loaded = await documentFromProject({
      format: "freetoshop",
      version: 1,
      width: 8,
      height: 8,
      layers: [],
    });
    expect(loaded.layers).toHaveLength(1);
    expect(loaded.active.name).toBe("Background");
  });
});
