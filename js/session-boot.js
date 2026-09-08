/**
 * Injected by app-server when serving the editor.
 * Autosaves to temp/, archives to fts/, mirrors PNG exports to output/.
 */
import { Document, History } from "./engine.js";
import { downloadProject, documentFromProject, serializeDocument } from "./project.js";

const API = "/api";
const AUTOSAVE_MS = 2500;
const TEMP_KEY = "freetoshop.tempId";
const DIRTY_KEY = "freetoshop.dirty";

function tempId() {
  let id = localStorage.getItem(TEMP_KEY);
  if (!id) {
    id = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    localStorage.setItem(TEMP_KEY, id);
  }
  return id;
}

function setTempId(id) {
  localStorage.setItem(TEMP_KEY, id);
}

function markDirty(v = true) {
  sessionStorage.setItem(DIRTY_KEY, v ? "1" : "0");
}

function isDirty() {
  return sessionStorage.getItem(DIRTY_KEY) === "1";
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, opts);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.detail || body.message || msg;
    } catch {
      /* ignore */
    }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

function waitForApp() {
  return new Promise((resolve) => {
    const tick = () => {
      if (window.freetoshop?.doc) resolve(window.freetoshop);
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

function refreshUi() {
  window.freetoshopRefresh?.();
}

function compositeDoc(app) {
  const { width, height, layers } = app.doc;
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  for (const layer of layers) {
    if (!layer.visible) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.canvas, layer.x, layer.y);
    ctx.restore();
  }
  return out;
}

function payloadFromApp(app, name) {
  const data = serializeDocument(app.doc);
  data.sessionName = name || data.sessionName || "Untitled";
  data.sessionId = tempId();
  return data;
}

async function autosave(app) {
  if (!app?.doc) return;
  try {
    const body = payloadFromApp(app);
    await api(`/temp/${tempId()}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn("autosave failed", err);
  }
}

async function restoreTemp(app) {
  const id = localStorage.getItem(TEMP_KEY);
  if (!id) return false;
  try {
    const data = await api(`/temp/${id}`);
    const doc = await documentFromProject(data);
    app.doc = doc;
    app.history = new History();
    app.history.push(app.doc);
    app.smartPoints = [];
    app.xf = null;
    app.setStatus?.("Restored draft from temp/");
    document.getElementById("hint")?.classList.add("hidden");
    refreshUi();
    return true;
  } catch {
    return false;
  }
}

async function saveToFts(app, name) {
  const document = payloadFromApp(app, name);
  const res = await api("/fts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, document, tempId: tempId() }),
  });
  markDirty(false);
  return res;
}

async function discardTemp() {
  const id = localStorage.getItem(TEMP_KEY);
  if (id) {
    try {
      await api(`/temp/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }
  localStorage.removeItem(TEMP_KEY);
  markDirty(false);
}

function promptSaveName(defaultName = "Untitled") {
  const name = window.prompt("Save session as:", defaultName);
  return name == null ? null : name.trim();
}

/**
 * OK → save to fts (prompt name). Cancel → discard temp draft.
 * Returns saved | discard | cancel (empty name after OK).
 */
async function confirmSaveFlow(app, { title = "Save this session?" } = {}) {
  const choice = window.confirm(`${title}\n\nOK = save to FTS library\nCancel = discard draft`);
  if (!choice) {
    await discardTemp();
    return "discard";
  }
  const name = promptSaveName("Untitled");
  if (!name) return "cancel";
  await saveToFts(app, name);
  app.setStatus?.(`Saved “${name}” to fts/`);
  return "saved";
}

function downloadBlob(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function exportPngMirrored(app) {
  const canvas = compositeDoc(app);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not encode PNG");

  const filename = `freetoshop-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  downloadBlob(blob, filename);

  const fd = new FormData();
  fd.append("file", blob, filename);
  fd.append("name", filename.replace(/\.png$/i, ""));
  try {
    const res = await api("/output", { method: "POST", body: fd });
    app.setStatus?.(`Exported — copy kept in output/${res.name}`);
  } catch (err) {
    app.setStatus?.(`Exported download only — output archive failed (${err.message})`);
  }
}

function startNewDocument(app, w, h) {
  setTempId(crypto.randomUUID().replace(/-/g, "").slice(0, 12));
  app.doc = new Document(w, h);
  app.history = new History();
  app.history.push(app.doc);
  app.smartPoints = [];
  app.xf = null;
  markDirty(false);
  document.getElementById("hint")?.classList.remove("hidden");
  refreshUi();
  autosave(app);
}

function wireUi(app) {
  document.addEventListener(
    "click",
    async (ev) => {
      const btn = ev.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;

      if (act === "export") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        try {
          await exportPngMirrored(app);
        } catch (err) {
          app.setStatus?.(err.message || "Export failed");
        }
        return;
      }

      if (act === "new") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        const result = await confirmSaveFlow(app, { title: "Start a new document?" });
        if (result === "cancel") return;
        const w = Number(prompt("Width", app.doc.width)) || 1280;
        const h = Number(prompt("Height", app.doc.height)) || 720;
        startNewDocument(app, w, h);
        return;
      }

      if (act === "save") {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        const name = promptSaveName("Untitled");
        if (!name) return;
        try {
          await saveToFts(app, name);
          downloadProject(app.doc, `${name}.freetoshop.json`);
          app.setStatus?.(`Saved “${name}” to fts/ and downloaded a copy`);
        } catch (err) {
          app.setStatus?.(err.message || "Save failed");
        }
      }
    },
    true
  );

  window.addEventListener("beforeunload", (ev) => {
    if (!isDirty()) return;
    ev.preventDefault();
    ev.returnValue = "";
  });

  // Mark dirty when the user paints / transforms (canvas pointer interaction)
  const view = document.getElementById("view");
  view?.addEventListener("pointerup", () => {
    markDirty(true);
  });
}

function addSessionsLink() {
  if (document.getElementById("sessions-link")) return;
  const link = document.createElement("a");
  link.id = "sessions-link";
  link.href = "/sessions";
  link.textContent = "Sessions";
  link.title = "Saved FTS sessions";
  link.style.cssText =
    "margin-left:12px;color:inherit;opacity:0.9;font-size:13px;text-decoration:none;border:1px solid currentColor;padding:2px 8px;border-radius:4px;";
  const host =
    document.querySelector(".brand") ||
    document.querySelector("header") ||
    document.getElementById("toolbar") ||
    document.body;
  host.appendChild(link);
}

async function openFtsSession(app, id) {
  const data = await api(`/fts/${encodeURIComponent(id)}`);
  const doc = await documentFromProject(data);
  setTempId(crypto.randomUUID().replace(/-/g, "").slice(0, 12));
  app.doc = doc;
  app.history = new History();
  app.history.push(app.doc);
  app.smartPoints = [];
  app.xf = null;
  markDirty(true);
  document.getElementById("hint")?.classList.add("hidden");
  refreshUi();
  await autosave(app);
  app.setStatus?.(`Opened “${data.sessionName || id}”`);
  history.replaceState({}, "", "/");
}

async function boot() {
  try {
    const h = await api("/health");
    if (!h?.ok) return;
  } catch {
    return;
  }

  const app = await waitForApp();
  addSessionsLink();

  const params = new URLSearchParams(location.search);
  const openId = params.get("openFts");
  if (openId) {
    try {
      await openFtsSession(app, openId);
    } catch (err) {
      app.setStatus?.(err.message || "Could not open session");
      history.replaceState({}, "", "/");
    }
  } else {
    const restored = await restoreTemp(app);
    if (!restored) {
      setTempId(tempId());
      await autosave(app);
    }
    markDirty(Boolean(restored));
  }

  wireUi(app);
  setInterval(() => autosave(app), AUTOSAVE_MS);
}

boot().catch((err) => console.warn("session-boot", err));
