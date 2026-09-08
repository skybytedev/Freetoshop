import { Document, Layer, makeCanvas, syncUidCounter } from "./engine.js";
import { refreshHasSelection } from "./selection.js";

export const PROJECT_FORMAT = "freetoshop";
export const PROJECT_VERSION = 1;
export const PROJECT_EXT = ".freetoshop.json";

function u8ToBase64(u8) {
  if (typeof Buffer !== "undefined") return Buffer.from(u8).toString("base64");
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    s += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToU8(b64) {
  if (typeof Buffer !== "undefined") return new Uint8ClampedArray(Buffer.from(b64, "base64"));
  const bin = atob(b64);
  const out = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode canvas pixels for a project file (PNG data URL, or raw RGBA for test shims). */
export function encodeCanvas(canvas) {
  if (typeof canvas.toDataURL === "function") {
    try {
      const url = canvas.toDataURL("image/png");
      if (typeof url === "string" && url.startsWith("data:image/png")) {
        return { type: "png", data: url };
      }
      if (typeof url === "string" && url.startsWith("data:application/x-freetoshop-rgba")) {
        return { type: "png", data: url };
      }
    } catch {
      /* fall through to raw */
    }
  }
  const ctx = canvas.getContext("2d");
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    type: "rgba",
    width,
    height,
    data: u8ToBase64(data),
  };
}

async function paintEncoded(target, encoded) {
  if (!encoded) return;
  if (encoded.type === "rgba") {
    const w = encoded.width;
    const h = encoded.height;
    target.canvas.width = w;
    target.canvas.height = h;
    const pixels = base64ToU8(encoded.data);
    target.ctx.putImageData(new ImageData(pixels, w, h), 0, 0);
    return;
  }
  if (encoded.type === "png" && typeof encoded.data === "string") {
    if (encoded.data.startsWith("data:application/x-freetoshop-rgba")) {
      const m = encoded.data.match(/^data:application\/x-freetoshop-rgba;(\d+)x(\d+);base64,(.+)$/);
      if (!m) throw new Error("bad rgba data URL");
      return paintEncoded(target, {
        type: "rgba",
        width: Number(m[1]),
        height: Number(m[2]),
        data: m[3],
      });
    }
    const bmp = await createImageBitmap(await (await fetch(encoded.data)).blob());
    target.canvas.width = bmp.width;
    target.canvas.height = bmp.height;
    target.ctx.clearRect(0, 0, bmp.width, bmp.height);
    target.ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    return;
  }
  throw new Error("unknown layer image encoding");
}

export function serializeDocument(doc) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    width: doc.width,
    height: doc.height,
    activeId: doc.activeId,
    zoom: doc.zoom,
    panX: doc.panX,
    panY: doc.panY,
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      x: layer.x,
      y: layer.y,
      linkGroup: layer.linkGroup,
      revision: layer.revision,
      image: encodeCanvas(layer.canvas),
    })),
    selection: doc.hasSelection ? encodeCanvas(doc.selCanvas) : null,
  };
}

export function isProjectPayload(data) {
  return Boolean(data && data.format === PROJECT_FORMAT && Array.isArray(data.layers));
}

export function isProjectFile(file) {
  if (!file || !file.name) return false;
  const name = file.name.toLowerCase();
  return name.endsWith(PROJECT_EXT) || name.endsWith(".freetoshop") || name.endsWith(".json");
}

export async function documentFromProject(data) {
  if (!isProjectPayload(data)) throw new Error("Not a Freetoshop project file");
  const version = Number(data.version) || 1;
  if (version > PROJECT_VERSION) {
    throw new Error(`Project version ${version} is newer than this app`);
  }

  const doc = new Document(1, 1);
  doc.layers = [];
  doc.resize(Math.max(1, data.width | 0), Math.max(1, data.height | 0));
  doc.zoom = Number(data.zoom) || 1;
  doc.panX = Number(data.panX) || 0;
  doc.panY = Number(data.panY) || 0;

  const ids = [];
  for (const src of data.layers) {
    const layer = new Layer(src.name || "Layer", 1, 1, src.x || 0, src.y || 0);
    layer.id = src.id || layer.id;
    layer.visible = src.visible !== false;
    layer.locked = Boolean(src.locked);
    layer.opacity = src.opacity == null ? 1 : Number(src.opacity);
    layer.linkGroup = src.linkGroup || null;
    layer.revision = Number(src.revision) || 0;
    await paintEncoded(layer, src.image);
    doc.layers.push(layer);
    ids.push(layer.id);
    if (layer.linkGroup) ids.push(layer.linkGroup);
  }

  if (!doc.layers.length) doc.addLayer("Background");
  syncUidCounter(ids);

  const wantActive = data.activeId && doc.layers.some((l) => l.id === data.activeId);
  doc.activeId = wantActive ? data.activeId : doc.layers[doc.layers.length - 1].id;

  doc.clearSelection();
  if (data.selection) {
    const sel = makeCanvas(doc.width, doc.height);
    await paintEncoded({ canvas: sel.canvas, ctx: sel.ctx }, data.selection);
    doc.selCtx.clearRect(0, 0, doc.width, doc.height);
    doc.selCtx.drawImage(sel.canvas, 0, 0);
    doc.invalidateSelection();
    refreshHasSelection(doc);
  }

  return doc;
}

export async function readProjectFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Project file is not valid JSON");
  }
  return documentFromProject(data);
}

export function downloadProject(doc, filename = `project${PROJECT_EXT}`) {
  const payload = serializeDocument(doc);
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename.endsWith(".json") ? filename : `${filename}${PROJECT_EXT}`;
  a.click();
  URL.revokeObjectURL(a.href);
  return payload;
}
