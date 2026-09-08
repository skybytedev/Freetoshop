import { beforeEach, describe, expect, it, vi } from "vitest";
import { Document } from "../../js/engine.js";
import { SamClient, defaultSamUrl, saveSamUrl } from "../../js/sam.js";
import { TOOLS } from "../../js/tools.js";

describe("tools list", () => {
  it("exposes every shipping tool with a unique key", () => {
    const ids = TOOLS.map((t) => t.id);
    expect(ids).toEqual([
      "move",
      "hand",
      "zoom",
      "transform",
      "smart",
      "lasso",
      "mask",
      "crop",
      "brush",
      "eraser",
      "text",
    ]);
    expect(new Set(TOOLS.map((t) => t.key)).size).toBe(TOOLS.length);
  });
});

describe("SamClient", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("defaults the URL and strips a trailing slash", () => {
    expect(defaultSamUrl()).toBe("http://127.0.0.1:8765");
    saveSamUrl("http://example.test:9/");
    expect(defaultSamUrl()).toBe("http://example.test:9");
    const client = new SamClient("http://127.0.0.1:8765/");
    expect(client.url).toBe("http://127.0.0.1:8765");
  });

  it("marks health ok on a live server", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ demo: false, device: "mps", model: "sam2.1_hiera_small.pt" }),
    }));
    const client = new SamClient("http://127.0.0.1:8765");
    const h = await client.ping();
    expect(h.ok).toBe(true);
    expect(h.demo).toBe(false);
    expect(h.device).toBe("mps");
  });

  it("marks health down when fetch fails", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    const client = new SamClient();
    const h = await client.ping();
    expect(h.ok).toBe(false);
  });

  it("reuses a session until the layer revision changes", async () => {
    const calls = [];
    vi.stubGlobal("fetch", async (url, opts = {}) => {
      calls.push({ url, method: opts.method || "GET" });
      if (String(url).endsWith("/v1/sessions")) {
        return { ok: true, json: async () => ({ session_id: "abc" }) };
      }
      return {
        ok: true,
        blob: async () => new Blob([new Uint8Array([1])], { type: "image/png" }),
      };
    });
    const doc = new Document(8, 8);
    const client = new SamClient("http://127.0.0.1:8765");
    const a = await client.ensureSession(doc.active);
    const b = await client.ensureSession(doc.active);
    expect(a).toBe("abc");
    expect(b).toBe("abc");
    expect(calls.filter((c) => c.url.includes("/v1/sessions") && !c.url.includes("predict")).length).toBe(1);
    doc.active.touch();
    await client.ensureSession(doc.active);
    expect(calls.filter((c) => c.url.includes("/v1/sessions") && !c.url.includes("predict")).length).toBe(2);
  });

  it("posts layer-local points to predict", async () => {
    let body;
    vi.stubGlobal("fetch", async (url, opts = {}) => {
      if (String(url).endsWith("/v1/sessions")) {
        return { ok: true, json: async () => ({ session_id: "sid-1" }) };
      }
      body = JSON.parse(opts.body);
      return { ok: true, blob: async () => new Blob([new Uint8Array([9])], { type: "image/png" }) };
    });
    const doc = new Document(8, 8);
    const client = new SamClient();
    await client.predict(doc.active, [{ x: 3, y: 4, label: 1 }]);
    expect(body.points).toEqual([{ x: 3, y: 4, label: 1 }]);
    expect(body.multimask).toBe(false);
  });
});
