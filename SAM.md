# Running SAM / SAM 2 locally for Freetoshop

Day to day, just run `./start.sh` (or double-click `Freetoshop.command`). That starts the editor and SAM, then opens the browser. `./stop.sh` or Ctrl+C shuts both down.

Manual start (if you ever need it): editor via MAMP or `python3 -m http.server 8080`; Smart Select at `http://127.0.0.1:8765`.

The Meta SAM 2 repo already lives at `sam2/` (the official clone). The editor talks to `sam-server/`, which loads weights from `sam2/checkpoints/`.

**Do not run Python from the Freetoshop project root.** The folder is also named `sam2`, and that shadows the real package. Always start the server from `sam-server/`.

Quick start on this Mac (local clone + small checkpoint):

```bash
cd sam-server
source .venv/bin/activate
pip install torch torchvision
SAM2_BUILD_CUDA=0 pip install -e ../sam2

# one checkpoint is enough — small is the Mac default
curl -L -o ../sam2/checkpoints/sam2.1_hiera_small.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt

python server.py
```

`curl http://127.0.0.1:8765/health` should show `"demo": false` and `"device": "mps"`.

Demo flood-fill (no GPU / no weights):

```bash
SAM_DEMO=1 python server.py
```

On the Spark, use the same clone and `SAM_SIZE=large` after a CUDA torch install (below).

Freetoshop’s Smart Select tool talks to a **local inference server**, not a cloud API and not an in-browser model. You click an object in the editor; the server returns a contour mask; the editor cuts that object onto its own layer.

This file is the runbook for that server on a **Mac** or an **NVIDIA DGX Spark**.

## How the editor uses SAM

```
Freetoshop (browser)
    │  1. POST /v1/sessions     layer pixels (PNG)
    │  2. POST /v1/sessions/:id/predict   click / box prompts
    ▼
sam-server (FastAPI + PyTorch)
    │  set_image() once  →  cache embedding
    │  predict() per click  →  mask
    ▼
SAM 2 image predictor
    Mac:  MPS (Apple Silicon) or CPU
    Spark: CUDA (Blackwell)
```

SAM 2 is split into two steps:

1. **Image encoding** (`set_image`) — the slow part. Done once per layer snapshot.
2. **Mask decoding** (`predict`) — milliseconds. Reused for every add/subtract click on that image.

The server caches the embedding per session so Shift-click / Alt-click refinement stays interactive.

After a mask comes back, Freetoshop:

- turns it into the document selection
- lets you refine it with Quick Mask, lasso, or more SAM clicks
- **Extract (cut)** copies the selected pixels to a new layer and punches them out of the source

That last step is the cutout.

## API the prototype expects

Base URL defaults to `http://127.0.0.1:8765`. Override in the editor UI or with `localStorage.freetoshopSamUrl`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Device, model name, whether demo mode is on |
| `POST` | `/v1/sessions` | Upload a PNG/JPEG. Body: multipart `image`. Returns `{ session_id, width, height }` |
| `POST` | `/v1/sessions/{id}/predict` | JSON prompts → PNG mask (`image/png`, grayscale, 255 = object) |
| `DELETE` | `/v1/sessions/{id}` | Drop cached embedding |

Predict body:

```json
{
  "points": [{ "x": 120, "y": 80, "label": 1 }],
  "box": null,
  "multimask": false
}
```

- `label: 1` = include this point (click / Shift-click)
- `label: 0` = exclude this point (Alt-click)
- `box` is optional `[x1, y1, x2, y2]` in image pixels
- Coordinates are **layer-local**, not screen pixels

CORS is open for localhost so MAMP, Vite, or `python -m http.server` can all call it.

## Which model to pick

| Checkpoint | VRAM / unified mem | Quality | Use on |
|---|---|---|---|
| `facebook/sam2.1-hiera-tiny` | ~1 GB | Good enough for UI work | Older Macs, CPU fallback |
| `facebook/sam2.1-hiera-small` | ~2 GB | Best default | Apple Silicon Mac |
| `facebook/sam2.1-hiera-base-plus` | ~4 GB | Sharper edges | Fast Mac / Spark |
| `facebook/sam2.1-hiera-large` | ~6 GB+ | Best cutouts | **DGX Spark** |

SAM 2.1 is the right default. SAM 1 (`vit_h` etc.) works but is slower and worse on thin structures (hair, straps, fingers). You do not need video SAM for this app.

Pick a size with `SAM_SIZE` (`tiny` / `small` / `base` / `large`). The server looks in `sam2/checkpoints/` for the matching `sam2.1_hiera_*.pt`. Hugging Face ids (`SAM_MODEL=facebook/sam2.1-hiera-small`) are only the fallback if no local `.pt` is present.

## Install the server (common)

From the repo root:

```bash
cd sam-server
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
```

`requirements.txt` does **not** pin a CUDA/MPS build of PyTorch. Install torch for your machine first (sections below), then the rest.

Start it:

```bash
source .venv/bin/activate
python server.py
```

Or:

```bash
uvicorn server:app --host 127.0.0.1 --port 8765
```

Check:

```bash
curl http://127.0.0.1:8765/health
```

You want `"demo": false` and a real `device` (`mps` or `cuda`). If you see `"demo": true`, the SAM 2 package or checkpoint did not load and the server is using color flood-fill so the editor UI still works.

The first real prediction downloads the Hugging Face weights (a few hundred MB to a few GB). After that they stay in `~/.cache/huggingface`.

---

## Mac (Apple Silicon)

Torch on macOS uses **MPS**. That is enough for Tiny/Small/Base+ at typical collage resolutions (1–4K).

```bash
cd sam-server
source .venv/bin/activate
pip install torch torchvision
SAM2_BUILD_CUDA=0 pip install -e ../sam2
export SAM_SIZE=small
export SAM_DEVICE=mps
python server.py
```

Skip the CUDA extension on Mac (`SAM2_BUILD_CUDA=0`). Image Smart Select does not need it. A “Failed to build the SAM 2 CUDA extension” message is safe to ignore.

Notes:

- Use **fp32 on MPS**. bfloat16 is flaky on some macOS / torch combos; the server already forces this.
- If MPS errors on a particular op, `export SAM_DEVICE=cpu` and use `hiera-tiny`.
- Activity Monitor should show the Python process using GPU (Intel: it will be CPU-only and slow).
- Keep the editor document at the image’s native size. Sending a 8K layer to Small on an 8 GB Mac will hitch; downsample huge imports first or use Tiny.

Intel Mac: install the same CPU torch wheel and expect several seconds per encode. Smart Select will work; it will not feel instant.

---

## DGX Spark (Blackwell, ARM64)

Spark is the right machine for **Large** and for staying at native resolution. Two Spark-specific facts matter:

1. The GPU is **Blackwell (sm_121)**. Stock older PyTorch wheels will not target it.
2. The CPU is **Grace (aarch64)**. x86_64 wheels and many pinned `linux-64` install scripts will fail.

### Preferred: NVIDIA NGC PyTorch container

This avoids nightly-wheel and CUDA 12 vs 13 fights.

```bash
# example tag — use the current Spark-tested NGC pytorch image
docker run --gpus all -it --rm \
  -p 8765:8765 \
  -v "$PWD/sam-server:/app" \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  nvcr.io/nvidia/pytorch:25.10-py3

cd /app
pip install -r requirements.txt
export SAM_MODEL=facebook/sam2.1-hiera-large
export SAM_DEVICE=cuda
python server.py --host 0.0.0.0 --port 8765
```

If you use a different NGC tag, pick one that NVIDIA lists for DGX Spark / GB10 (CUDA 13, ARM64).

### Bare metal on Spark

1. Create the venv with the **ARM64 + CUDA** torch that matches the box (NGC-installed torch, or a Spark playbook / nightly `cu128` wheel — not the default `pip install torch` x86 CUDA 12 wheel).
2. Then:

```bash
pip install -r requirements.txt
export SAM_MODEL=facebook/sam2.1-hiera-large
export SAM_DEVICE=cuda
python server.py --host 0.0.0.0 --port 8765
```

Confirm the GPU before blaming SAM:

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

If that is `False`, the SAM package is fine and the torch/CUDA install is not.

### Spark networking

The editor on your Mac can point Smart Select at the Spark:

1. Bind the server to `0.0.0.0` (already supported by `server.py --host 0.0.0.0`).
2. In the editor, set the SAM URL to `http://<spark-ip>:8765`.
3. Open that port on the Spark firewall, or use Tailscale / the NVIDIA “connect to your Spark” LAN playbook.

Embeddings live in RAM on the machine that runs `server.py`. There is no reason to run the browser on the Spark.

---

## Offline / air-gapped checkpoints

If Hugging Face is blocked, download a `.pt` + config and point the server at files:

```bash
export SAM_CHECKPOINT=/models/sam2.1_hiera_small.pt
export SAM_CONFIG=configs/sam2.1/sam2.1_hiera_s.yaml
python server.py
```

Official weights and YAML names live in [facebookresearch/sam2](https://github.com/facebookresearch/sam2). The config path is the one `build_sam2()` expects (package-relative), not a random local filename unless you also set `SAM_CONFIG` to a real file path the install can see.

---

## Demo mode (no GPU / no weights)

`python server.py` always starts. If `sam2` or the checkpoint cannot be loaded, `/health` reports `"demo": true` and `/predict` uses a color flood-fill around the click.

That is only for exercising the editor’s cutout pipeline. It is not a contour model. Edges on people, hair, and mixed-color objects will be wrong. Install the real stack when you want Smart Select to mean Smart Select.

Force demo:

```bash
export SAM_DEMO=1
python server.py
```

---

## Quality loop that actually matters

SAM will miss holes, glasses, and hair. That is expected. The editor path is:

1. Smart Select click (and Shift/Alt refine)
2. **Q** Quick Mask — paint the mask, do not paint the photo
3. Extract (cut) to a new layer

Do not try to make SAM perfect. Make the mask editable.

Tips that improve the first click:

- Click the **center of the object**, not the edge
- Alt-click obvious bleed (adjacent sofa, sky through legs)
- A loose box prompt around the subject beats a bad click; the editor can send one later
- Encode the **layer you are cutting**, not the flattened composite, or you will select objects on layers below

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Editor says SAM offline | Server not running / wrong URL | `curl :8765/health`; check the URL in the editor |
| `"demo": true` | `sam2` or weights missing | Install torch + `pip install -r requirements.txt`; unset `SAM_DEMO` |
| First click takes 30s, later clicks are fast | Download + encode | Normal once; later clicks should be ~instant |
| Every click is slow | Embedding not reused / new session every time | One session per layer snapshot; do not re-upload unless pixels changed |
| MPS `not implemented` | Op missing on Mac GPU | `SAM_DEVICE=cpu` or smaller image |
| CUDA false on Spark | Wrong torch wheel / x86 package | NGC container or Spark-tested ARM64 + Blackwell torch |
| Mask is shifted | Coordinates in screen space | Server expects layer pixel coords; the editor already converts |
| Mask is inverted | Demo vs model polarity | Editor treats **255 = selected**. Server must follow that |
| OOM on Mac | Large model + 4K+ layer | `hiera-tiny` / `hiera-small`; shrink the layer |
| CORS error | Non-localhost origin | Use `http://127.0.0.1/...` or add the origin in `server.py` |

---

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `SAM_SIZE` | `small` | Local checkpoint: `tiny` / `small` / `base` / `large` |
| `SAM_MODEL` | `facebook/sam2.1-hiera-small` | Hugging Face fallback if no local `.pt` |
| `SAM_DEVICE` | auto (`cuda` > `mps` > `cpu`) | Force device |
| `SAM_CHECKPOINT` | unset | Explicit `.pt` path (skips auto-detect) |
| `SAM_CONFIG` | unset | Local / package YAML for `build_sam2` |
| `SAM_DEMO` | unset | `1` forces flood-fill |
| `SAM_PORT` | `8765` | Bind port |
| `SAM_HOST` | `127.0.0.1` | Bind host (`0.0.0.0` on Spark) |

---

## What not to do

- Do not bundle SAM into the browser for this project. You have a Mac and a Spark; use them.
- Do not re-encode the image on every click.
- Do not send the whole layer stack. Send the active layer.
- Do not skip Quick Mask. SAM is the coarse tool; the mask brush is the finishing tool.
