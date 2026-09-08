#!/usr/bin/env python3
"""Local SAM 2 inference server for Freetoshop Smart Select."""

from __future__ import annotations

import argparse
import io
import os
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field

SESSIONS: dict[str, dict] = {}
PREDICTOR = None
DEVICE = "cpu"
MODEL_NAME = "demo"
DEMO_MODE = False
SESSION_TTL_SEC = 30 * 60

ROOT = Path(__file__).resolve().parents[1]
LOCAL_SAM2 = ROOT / "sam2"
CKPT_DIR = LOCAL_SAM2 / "checkpoints"
VARIANTS = {
    "tiny": ("sam2.1_hiera_tiny.pt", "configs/sam2.1/sam2.1_hiera_t.yaml"),
    "small": ("sam2.1_hiera_small.pt", "configs/sam2.1/sam2.1_hiera_s.yaml"),
    "base": ("sam2.1_hiera_base_plus.pt", "configs/sam2.1/sam2.1_hiera_b+.yaml"),
    "base-plus": ("sam2.1_hiera_base_plus.pt", "configs/sam2.1/sam2.1_hiera_b+.yaml"),
    "large": ("sam2.1_hiera_large.pt", "configs/sam2.1/sam2.1_hiera_l.yaml"),
}


def detect_device(forced: Optional[str] = None) -> str:
    if forced:
        return forced
    try:
        import platform
        import torch

        if torch.cuda.is_available():
            return "cuda"
        # Intel Mac / x86_64 torch can report MPS available while missing ops
        # (e.g. upsample_bicubic2d). Only use MPS on Apple Silicon.
        if (
            platform.machine() == "arm64"
            and hasattr(torch.backends, "mps")
            and torch.backends.mps.is_available()
        ):
            return "mps"
    except Exception:
        pass
    return "cpu"


def resolve_local_weights() -> tuple[Optional[str], Optional[str]]:
    checkpoint = os.environ.get("SAM_CHECKPOINT")
    config = os.environ.get("SAM_CONFIG")
    if checkpoint:
        if not config:
            raise RuntimeError("SAM_CHECKPOINT requires SAM_CONFIG")
        return checkpoint, config

    variant = os.environ.get("SAM_SIZE", "small").lower()
    preferred = [variant] + [k for k in VARIANTS if k != variant]
    for key in preferred:
        filename, cfg = VARIANTS[key]
        path = CKPT_DIR / filename
        if path.is_file():
            return str(path), cfg
    return None, None


def load_predictor():
    global PREDICTOR, DEVICE, MODEL_NAME, DEMO_MODE

    if os.environ.get("SAM_DEMO") == "1":
        DEMO_MODE = True
        MODEL_NAME = "demo-floodfill"
        DEVICE = "cpu"
        print("SAM_DEMO=1 — flood-fill only")
        return

    DEVICE = detect_device(os.environ.get("SAM_DEVICE"))
    model_id = os.environ.get("SAM_MODEL", "facebook/sam2.1-hiera-small")

    try:
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        checkpoint, config = resolve_local_weights()
        if checkpoint:
            print(f"Loading local SAM 2 {checkpoint} ({config}) on {DEVICE}")
            model = build_sam2(config, checkpoint, device=DEVICE)
            PREDICTOR = SAM2ImagePredictor(model)
            MODEL_NAME = Path(checkpoint).name
        elif hasattr(SAM2ImagePredictor, "from_pretrained"):
            print(f"No local checkpoint in {CKPT_DIR} — loading {model_id}")
            PREDICTOR = SAM2ImagePredictor.from_pretrained(model_id, device=DEVICE)
            MODEL_NAME = model_id
        else:
            raise RuntimeError(
                f"Install the local clone (SAM2_BUILD_CUDA=0 pip install -e {LOCAL_SAM2}) "
                "and download a .pt into sam2/checkpoints/. See SAM.md."
            )

        if DEVICE == "mps":
            PREDICTOR.model.to(dtype=torch.float32)
        DEMO_MODE = False
        print(f"SAM 2 ready ({MODEL_NAME} / {DEVICE})")
    except Exception as exc:
        DEMO_MODE = True
        MODEL_NAME = "demo-floodfill"
        DEVICE = "cpu"
        PREDICTOR = None
        print(f"SAM 2 unavailable ({exc}). Demo flood-fill is on. See SAM.md.")


def purge_sessions() -> None:
    now = time.time()
    dead = [sid for sid, s in SESSIONS.items() if now - s["ts"] > SESSION_TTL_SEC]
    for sid in dead:
        SESSIONS.pop(sid, None)


def flood_mask(rgb: np.ndarray, x: int, y: int, tolerance: int = 36) -> np.ndarray:
    h, w = rgb.shape[:2]
    x = int(np.clip(x, 0, w - 1))
    y = int(np.clip(y, 0, h - 1))
    target = rgb[y, x].astype(np.int16)
    seen = np.zeros((h, w), dtype=np.uint8)
    mask = np.zeros((h, w), dtype=np.uint8)
    q = deque([(x, y)])
    seen[y, x] = 1
    while q:
        cx, cy = q.popleft()
        if np.max(np.abs(rgb[cy, cx].astype(np.int16) - target)) > tolerance:
            continue
        mask[cy, cx] = 255
        for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny, nx]:
                seen[ny, nx] = 1
                q.append((nx, ny))
    return mask


def encode_mask_png(mask: np.ndarray) -> bytes:
    if mask.dtype != np.uint8:
        mask = (mask > 0).astype(np.uint8) * 255
    rgba = np.zeros((*mask.shape, 4), dtype=np.uint8)
    rgba[..., 0:3] = 255
    rgba[..., 3] = mask
    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG")
    return buf.getvalue()


def best_mask(masks: np.ndarray, scores: np.ndarray) -> np.ndarray:
    if masks.ndim == 2:
        chosen = masks
    else:
        chosen = masks[int(np.argmax(scores))]
    return (chosen.astype(np.uint8)) * 255 if chosen.max() <= 1 else chosen.astype(np.uint8)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_predictor()
    yield
    SESSIONS.clear()


app = FastAPI(title="Freetoshop SAM", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class Point(BaseModel):
    x: float
    y: float
    label: int = Field(1, description="1 include, 0 exclude")


class PredictBody(BaseModel):
    points: list[Point] = Field(default_factory=list)
    box: Optional[list[float]] = None
    multimask: bool = False


@app.get("/health")
def health():
    return {
        "ok": True,
        "demo": DEMO_MODE,
        "device": DEVICE,
        "model": MODEL_NAME,
        "sessions": len(SESSIONS),
    }


@app.post("/v1/sessions")
async def create_session(image: UploadFile = File(...)):
    purge_sessions()
    raw = await image.read()
    if not raw:
        raise HTTPException(400, "empty image")
    try:
        pil = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        raise HTTPException(400, f"could not read image: {exc}") from exc

    rgb = np.array(pil)
    sid = str(uuid.uuid4())
    SESSIONS[sid] = {"rgb": rgb, "ts": time.time(), "embedded": False}

    if PREDICTOR is not None and not DEMO_MODE:
        try:
            PREDICTOR.set_image(rgb)
            SESSIONS[sid]["embedded"] = True
            SESSIONS[sid]["owns_predictor"] = True
            for other, data in SESSIONS.items():
                if other != sid:
                    data["embedded"] = False
                    data["owns_predictor"] = False
        except Exception as exc:
            print(f"set_image failed: {exc}")
            SESSIONS[sid]["embedded"] = False

    return {"session_id": sid, "width": rgb.shape[1], "height": rgb.shape[0]}


@app.post("/v1/sessions/{session_id}/predict")
def predict(session_id: str, body: PredictBody):
    session = SESSIONS.get(session_id)
    if not session:
        raise HTTPException(404, "unknown session — upload the layer again")
    session["ts"] = time.time()
    rgb = session["rgb"]
    h, w = rgb.shape[:2]

    if not body.points and not body.box:
        raise HTTPException(400, "need at least one point or a box")

    if DEMO_MODE or PREDICTOR is None:
        if not body.points:
            raise HTTPException(400, "demo mode needs a point")
        p = body.points[0]
        mask = flood_mask(rgb, int(p.x), int(p.y))
        for extra in body.points[1:]:
            extra_mask = flood_mask(rgb, int(extra.x), int(extra.y))
            if extra.label == 1:
                mask = np.maximum(mask, extra_mask)
            else:
                mask = np.where(extra_mask > 0, 0, mask)
        return Response(encode_mask_png(mask), media_type="image/png")

    try:
        if not session.get("embedded"):
            PREDICTOR.set_image(rgb)
            session["embedded"] = True
            for other, data in SESSIONS.items():
                if other != session_id:
                    data["embedded"] = False

        point_coords = None
        point_labels = None
        if body.points:
            point_coords = np.array([[p.x, p.y] for p in body.points], dtype=np.float32)
            point_labels = np.array([p.label for p in body.points], dtype=np.int32)
        box = np.array(body.box, dtype=np.float32) if body.box else None

        masks, scores, _ = PREDICTOR.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            box=box,
            multimask_output=body.multimask,
        )
        mask = best_mask(np.asarray(masks), np.asarray(scores))
        if mask.shape != (h, w):
            mask = np.array(Image.fromarray(mask).resize((w, h), Image.NEAREST))
        return Response(encode_mask_png(mask), media_type="image/png")
    except Exception as exc:
        raise HTTPException(500, f"predict failed: {exc}") from exc


@app.delete("/v1/sessions/{session_id}")
def drop_session(session_id: str):
    SESSIONS.pop(session_id, None)
    return {"ok": True}


def main():
    parser = argparse.ArgumentParser(description="Freetoshop SAM 2 server")
    parser.add_argument("--host", default=os.environ.get("SAM_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SAM_PORT", "8765")))
    args = parser.parse_args()
    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
