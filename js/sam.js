const STORAGE_KEY = "freetoshopSamUrl";

export function defaultSamUrl() {
  return localStorage.getItem(STORAGE_KEY) || "http://127.0.0.1:8765";
}

export function saveSamUrl(url) {
  localStorage.setItem(STORAGE_KEY, url.replace(/\/$/, ""));
}

export class SamClient {
  constructor(url = defaultSamUrl()) {
    this.url = url.replace(/\/$/, "");
    this.sessionId = null;
    this.sessionKey = null;
    this.health = { ok: false, demo: false, device: "", model: "" };
  }

  setUrl(url) {
    this.url = url.replace(/\/$/, "");
    saveSamUrl(this.url);
    this.sessionId = null;
    this.sessionKey = null;
  }

  async ping() {
    try {
      const res = await fetch(`${this.url}/health`, { cache: "no-store" });
      if (!res.ok) throw new Error("bad health");
      this.health = await res.json();
      this.health.ok = true;
    } catch {
      this.health = { ok: false, demo: false, device: "", model: "" };
    }
    return this.health;
  }

  async ensureSession(layer) {
    const key = `${layer.id}:${layer.revision}:${layer.canvas.width}x${layer.canvas.height}`;
    if (this.sessionId && this.sessionKey === key) return this.sessionId;
    const blob = await canvasPng(layer.canvas);
    const body = new FormData();
    body.append("image", blob, "layer.png");
    const res = await fetch(`${this.url}/v1/sessions`, { method: "POST", body });
    if (!res.ok) throw new Error(await readError(res));
    const data = await res.json();
    this.sessionId = data.session_id;
    this.sessionKey = key;
    return this.sessionId;
  }

  async predict(layer, points, box = null) {
    const sid = await this.ensureSession(layer);
    const res = await fetch(`${this.url}/v1/sessions/${sid}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        points: points.map((p) => ({ x: p.x, y: p.y, label: p.label })),
        box,
        multimask: false,
      }),
    });
    if (!res.ok) throw new Error(await readError(res));
    return res.blob();
  }
}

function canvasPng(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("png failed"))), "image/png");
  });
}

async function readError(res) {
  try {
    const data = await res.json();
    return data.detail || JSON.stringify(data);
  } catch {
    return res.statusText;
  }
}
