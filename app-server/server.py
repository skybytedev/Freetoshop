"""
Freetoshop app server — static editor + temp / fts / output session storage.

Replaces `python -m http.server` so clone + ./start-with-app.sh can persist work.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

ROOT = Path(os.environ.get("FREETOSHOP_ROOT", Path(__file__).resolve().parent.parent))
TEMP_DIR = Path(os.environ.get("FREETOSHOP_TEMP", ROOT / "temp"))
FTS_DIR = Path(os.environ.get("FREETOSHOP_FTS", ROOT / "fts"))
OUTPUT_DIR = Path(os.environ.get("FREETOSHOP_OUTPUT", ROOT / "output"))
HOST = os.environ.get("APP_HOST", "127.0.0.1")
PORT = int(os.environ.get("APP_PORT", "8080"))

BOOT_SNIPPET = '\n<script type="module" src="/js/session-boot.js"></script>\n'
MAIN_PATCH = """
;window.freetoshopRefresh = function freetoshopRefresh() {
  try {
    if (typeof renderLayers === "function") renderLayers();
    if (typeof renderOptions === "function") renderOptions();
    if (typeof renderToolbar === "function") renderToolbar();
    if (typeof renderCanvasSize === "function") renderCanvasSize();
  } catch (e) { console.warn("freetoshopRefresh", e); }
};
"""

SAFE_NAME = re.compile(r"[^a-zA-Z0-9._-]+")


def ensure_dirs() -> None:
    for d in (TEMP_DIR, FTS_DIR, OUTPUT_DIR):
        d.mkdir(parents=True, exist_ok=True)


def slugify(name: str, fallback: str = "project") -> str:
    s = SAFE_NAME.sub("-", (name or "").strip()).strip("-._")
    return (s[:80] or fallback).lower()


def uid() -> str:
    return uuid.uuid4().hex[:12]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def session_id_from_path(path: Path) -> str:
    name = path.name
    suffix = ".freetoshop.json"
    if name.endswith(suffix):
        return name[: -len(suffix)]
    return path.stem


def session_meta(path: Path, data: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    data = data or read_json(path)
    st = path.stat()
    return {
        "id": session_id_from_path(path),
        "name": data.get("sessionName") or data.get("name") or session_id_from_path(path),
        "updatedAt": data.get("updatedAt")
        or datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
        "createdAt": data.get("createdAt"),
        "width": data.get("width"),
        "height": data.get("height"),
        "layerCount": len(data.get("layers") or []),
        "mtime": st.st_mtime,
        "size": st.st_size,
    }


app = FastAPI(title="Freetoshop App", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "freetoshop-app",
        "temp": str(TEMP_DIR),
        "fts": str(FTS_DIR),
        "output": str(OUTPUT_DIR),
    }


@app.get("/api/temp")
def list_temp() -> dict[str, Any]:
    items = []
    for path in TEMP_DIR.glob("*.freetoshop.json"):
        try:
            items.append(session_meta(path))
        except Exception:
            continue
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return {"sessions": items}


@app.get("/api/temp/{session_id}")
def get_temp(session_id: str) -> Any:
    path = TEMP_DIR / f"{session_id}.freetoshop.json"
    if not path.is_file():
        raise HTTPException(404, "temp session not found")
    return read_json(path)


@app.put("/api/temp/{session_id}")
async def put_temp(session_id: str, request: Request) -> dict[str, Any]:
    sid = slugify(session_id, uid())
    try:
        data = await request.json()
    except Exception as exc:
        raise HTTPException(400, "invalid JSON body") from exc
    if not isinstance(data, dict):
        raise HTTPException(400, "JSON object required")
    data["sessionId"] = sid
    data["updatedAt"] = utc_now()
    data.setdefault("createdAt", utc_now())
    path = TEMP_DIR / f"{sid}.freetoshop.json"
    write_json(path, data)
    return {"ok": True, "id": sid, "path": path.name, "updatedAt": data["updatedAt"]}


@app.post("/api/temp")
async def create_temp(request: Request) -> dict[str, Any]:
    sid = uid()
    try:
        data = await request.json()
    except Exception:
        data = {}
    if not isinstance(data, dict):
        data = {}
    data["sessionId"] = sid
    data["createdAt"] = utc_now()
    data["updatedAt"] = data["createdAt"]
    data.setdefault("sessionName", "Untitled")
    path = TEMP_DIR / f"{sid}.freetoshop.json"
    write_json(path, data)
    return {"ok": True, "id": sid, "path": path.name}


@app.delete("/api/temp/{session_id}")
def delete_temp(session_id: str) -> dict[str, Any]:
    path = TEMP_DIR / f"{session_id}.freetoshop.json"
    if path.is_file():
        path.unlink()
        return {"ok": True, "deleted": True}
    return {"ok": True, "deleted": False}


@app.get("/api/fts")
def list_fts(limit: int = 100) -> dict[str, Any]:
    items = []
    for path in FTS_DIR.glob("*.freetoshop.json"):
        try:
            items.append(session_meta(path))
        except Exception:
            continue
    items.sort(key=lambda x: x["mtime"], reverse=True)
    capped = items[: max(1, min(limit, 500))]
    return {"recent": capped[:12], "sessions": capped}


@app.get("/api/fts/{session_id}")
def get_fts(session_id: str) -> Any:
    path = FTS_DIR / f"{session_id}.freetoshop.json"
    if not path.is_file():
        raise HTTPException(404, "saved session not found")
    return read_json(path)


@app.post("/api/fts")
async def save_fts(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(400, "invalid JSON body") from exc
    name = str(body.get("name") or body.get("sessionName") or "Untitled").strip() or "Untitled"
    data = body.get("document") if isinstance(body.get("document"), dict) else body
    if not isinstance(data, dict) or "layers" not in data:
        raise HTTPException(400, "document with layers required")
    data = dict(data)
    sid = f"{slugify(name)}-{uid()}"
    data["sessionId"] = sid
    data["sessionName"] = name
    data["updatedAt"] = utc_now()
    data.setdefault("createdAt", utc_now())
    path = FTS_DIR / f"{sid}.freetoshop.json"
    write_json(path, data)

    temp_id = body.get("tempId") or body.get("fromTempId")
    if temp_id:
        tpath = TEMP_DIR / f"{temp_id}.freetoshop.json"
        if tpath.is_file():
            tpath.unlink()

    return {"ok": True, "id": sid, "name": name, "path": path.name}


@app.delete("/api/fts/{session_id}")
def delete_fts(session_id: str) -> dict[str, Any]:
    path = FTS_DIR / f"{session_id}.freetoshop.json"
    if not path.is_file():
        raise HTTPException(404, "saved session not found")
    path.unlink()
    return {"ok": True, "deleted": True}


@app.get("/api/output")
def list_output(limit: int = 100) -> dict[str, Any]:
    items = []
    for path in OUTPUT_DIR.glob("*.png"):
        st = path.stat()
        items.append(
            {
                "name": path.name,
                "mtime": st.st_mtime,
                "updatedAt": datetime.fromtimestamp(st.st_mtime, timezone.utc).isoformat(),
                "size": st.st_size,
                "url": f"/api/output/{path.name}",
            }
        )
    items.sort(key=lambda x: x["mtime"], reverse=True)
    return {"files": items[: max(1, min(limit, 500))]}


@app.get("/api/output/{filename}")
def get_output(filename: str) -> FileResponse:
    safe = Path(filename).name
    if not safe.endswith(".png"):
        raise HTTPException(400, "png only")
    path = OUTPUT_DIR / safe
    if not path.is_file():
        raise HTTPException(404, "file not found")
    return FileResponse(path, media_type="image/png", filename=safe)


@app.post("/api/output")
async def post_output(
    file: UploadFile = File(...),
    name: Optional[str] = None,
) -> dict[str, Any]:
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "empty file")
    base = slugify(name or (file.filename or "freetoshop").rsplit(".", 1)[0], "freetoshop")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    filename = f"{stamp}-{base}.png"
    path = OUTPUT_DIR / filename
    path.write_bytes(raw)
    return {
        "ok": True,
        "name": filename,
        "path": filename,
        "url": f"/api/output/{filename}",
        "size": len(raw),
    }


def inject_boot(html: str) -> str:
    if "session-boot.js" in html:
        return html
    if "</body>" in html:
        return html.replace("</body>", BOOT_SNIPPET + "</body>", 1)
    return html + BOOT_SNIPPET


def patch_main_js(source: str) -> str:
    if "freetoshopRefresh" in source:
        return source
    needle = "window.freetoshop = app;"
    if needle in source:
        return source.replace(needle, needle + MAIN_PATCH, 1)
    return source + MAIN_PATCH


@app.get("/", response_class=HTMLResponse)
def editor_index() -> HTMLResponse:
    path = ROOT / "index.html"
    if not path.is_file():
        raise HTTPException(404, "index.html missing")
    return HTMLResponse(inject_boot(path.read_text(encoding="utf-8")))


@app.get("/sessions", response_class=HTMLResponse)
@app.get("/sessions.html", response_class=HTMLResponse)
def sessions_page() -> HTMLResponse:
    path = ROOT / "sessions.html"
    if not path.is_file():
        raise HTTPException(404, "sessions.html missing")
    return HTMLResponse(path.read_text(encoding="utf-8"))


@app.get("/{path:path}")
async def static_files(path: str) -> Response:
    if path.startswith("api/"):
        raise HTTPException(404)
    target = (ROOT / path).resolve()
    try:
        target.relative_to(ROOT.resolve())
    except ValueError as exc:
        raise HTTPException(404) from exc
    if not target.is_file():
        raise HTTPException(404)
    # Do not expose live session/json blobs via static catch-all
    if TEMP_DIR in target.parents or FTS_DIR in target.parents or OUTPUT_DIR in target.parents:
        raise HTTPException(404)
    if target.name == "index.html":
        return HTMLResponse(inject_boot(target.read_text(encoding="utf-8")))
    if path.replace("\\", "/") == "js/main.js":
        return Response(
            patch_main_js(target.read_text(encoding="utf-8")),
            media_type="text/javascript",
        )
    return FileResponse(target)


def main() -> None:
    import uvicorn

    ensure_dirs()
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
