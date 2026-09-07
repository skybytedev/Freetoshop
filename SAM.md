# Running SAM / SAM 2 locally for Freetoshop

Smart Select does **not** run in the browser. The editor (`js/sam.js`) calls a local FastAPI process in `sam-server/`, which loads Meta SAM 2 from a sibling folder named `sam2/` plus a `.pt` checkpoint.

Day to day, after setup:

```bash
./start.sh          # editor :8080 + SAM :8765, then opens the browser
./stop.sh           # or Ctrl+C in the start.sh terminal
```

macOS: double-click `Freetoshop.command`. Leave that Terminal window open.

**Do not run Python from the Freetoshop project root.** The ignored clone is also named `sam2` and will shadow the real package. Always start the server from `sam-server/` (the shell scripts already do this).

A fresh `git clone` of this repo does **not** include `sam2/`, `.venv`, or weights. Someone (you or an agent) must connect them once. That playbook is next.

---

## Instructions for coding agents (Cursor and similar)

Use this section when the user cloned Freetoshop from GitHub and asks you to **set up, connect, enable, or fix SAM / Smart Select**.

### Goal

Leave Smart Select working on this machine:

- `GET http://127.0.0.1:8765/health` returns JSON with `"ok": true` and `"demo": false`
- `"device"` is `mps` (Apple Silicon), `cuda` (NVIDIA), or `cpu` (slow but valid)
- `"model"` is a real checkpoint name such as `sam2.1_hiera_small.pt`
- The editor SAM field is `http://127.0.0.1:8765` (or the host you bound)
- `./start.sh` can launch both processes

Do **not** treat `"demo": true` as success unless the user asked for flood-fill only.

### Hard rules

1. Read this file and `README.md` before installing. Do not invent a cloud SAM API or an in-browser ONNX port.
2. Work from the repo root unless a command below `cd`s into `sam-server/`.
3. Never `cd` to the repo root and then `python -c "import sam2"` or `python sam-server/server.py` from there.
4. Do not commit `sam2/`, `sam-server/.venv/`, `*.pt`, or `.run/`.
5. Do not force-push, skip git hooks, or change git config.
6. Do not download every checkpoint. Default is **small** on Mac, **large** only if the user is on a DGX Spark / large NVIDIA GPU and asks for it.
7. If `./start.sh` is already healthy, do not kill it and reinstall. Verify first.

### Detect what is missing

From the repo root, inspect:

| Path | Meaning if missing |
|---|---|
| `sam2/sam2/build_sam.py` | Official Meta repo not cloned |
| `sam-server/.venv/bin/python` | venv not created |
| `sam2/checkpoints/sam2.1_hiera_small.pt` (or the size they asked for) | weights not downloaded |
| `start.sh` executable bit | run `chmod +x start.sh stop.sh Freetoshop.command` |

Quick probe (run from `sam-server/` only if the venv exists):

```bash
curl -sf http://127.0.0.1:8765/health || true
```

If that already prints `"demo": false`, tell the user SAM is connected and stop.

### Enable SAM (idempotent)

Run only the steps that are still needed. Prefer the repo venv at `sam-server/.venv`.

```bash
# 0. Scripts
chmod +x start.sh stop.sh Freetoshop.command

# 1. Official SAM 2 clone (directory name MUST be sam2)
test -f sam2/sam2/build_sam.py || git clone https://github.com/facebookresearch/sam2.git sam2

# 2. venv + Python deps
cd sam-server
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt

# 3. PyTorch for THIS machine, then the local SAM 2 package
#    Mac / Apple Silicon:
pip install torch torchvision
SAM2_BUILD_CUDA=0 pip install -e ../sam2
#    Ignore "Failed to build the SAM 2 CUDA extension" on Mac.

# 4. Default Mac checkpoint (~176 MB). Skip if the file already exists.
test -f ../sam2/checkpoints/sam2.1_hiera_small.pt || curl -L --fail \
  -o ../sam2/checkpoints/sam2.1_hiera_small.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt

# 5. Confirm import from sam-server/, not the repo root
python -c "from sam2.build_sam import build_sam2; print('sam2 ok')"
```

On **DGX Spark / NVIDIA ARM64**: do not `pip install torch` from the default index. Install a Spark-tested CUDA wheel or NGC PyTorch image first (see [DGX Spark](#dgx-spark-blackwell-arm64)), then `pip install -e ../sam2` (CUDA build allowed), and download `sam2.1_hiera_large.pt` with `SAM_SIZE=large`.

### Start and verify

From the repo root:

```bash
./stop.sh 2>/dev/null || true
./start.sh
```

`start.sh` blocks that terminal. If you need the shell back, start the two processes yourself (still never from the repo root for SAM):

```bash
python3 -m http.server 8080 --bind 127.0.0.1
# other terminal:
cd sam-server && source .venv/bin/activate && python server.py
```

Then:

```bash
curl -s http://127.0.0.1:8765/health
```

Pass: `"demo": false`. Fail: read `.run/sam.log` (or the server stdout) and fix install/weights. Do not silently leave demo mode on.

Tell the user:

- Open [http://127.0.0.1:8080/](http://127.0.0.1:8080/)
- Smart Select is **W**; first click encodes the layer (slow once)
- Extract (cut) punches the object onto a new layer
- Keep the `start.sh` / `.command` window open

### If the user only wants the editor

Skip the clone/weights. `./start.sh` will still serve the UI; Smart Select stays offline until `/health` is up. Say that clearly.

### What “connected” means in the editor

`js/sam.js` posts to `localStorage.freetoshopSamUrl` or `http://127.0.0.1:8765`.

- `POST /v1/sessions` — multipart field `image` (active layer PNG)
- `POST /v1/sessions/{id}/predict` — `{ points: [{x,y,label}], box, multimask }`
- Coordinates are **layer pixels**, not screen pixels
- Mask PNG: **255 = selected** (RGBA alpha or luminance)

Do not change that contract unless the user asks to.

---

## How the editor uses SAM

```
Freetoshop (browser)
    |  1. POST /v1/sessions     layer pixels (PNG)
    |  2. POST /v1/sessions/:id/predict   click / box prompts
    v
sam-server (FastAPI + PyTorch)
    |  set_image() once  ->  cache embedding
    |  predict() per click  ->  mask
    v
SAM 2 image predictor
    Mac:  MPS (Apple Silicon) or CPU
    Spark: CUDA (Blackwell)
```

1. **Image encoding** (`set_image`) — slow, once per layer snapshot.
2. **Mask decoding** (`predict`) — milliseconds if the embedding is cached.

After a mask returns, the editor turns it into the document selection. Quick Mask / lasso refine it. **Extract (cut)** copies selected pixels to a new layer and punches them out of the source.

---

## API

Base URL: `http://127.0.0.1:8765`

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Device, model, `demo` flag |
| `POST` | `/v1/sessions` | Multipart `image` → `{ session_id, width, height }` |
| `POST` | `/v1/sessions/{id}/predict` | JSON prompts → PNG mask |
| `DELETE` | `/v1/sessions/{id}` | Drop cached embedding |

Predict body:

```json
{
  "points": [{ "x": 120, "y": 80, "label": 1 }],
  "box": null,
  "multimask": false
}
```

- `label: 1` include (click / Shift-click)
- `label: 0` exclude (Alt-click)
- `box` optional `[x1, y1, x2, y2]` in image pixels

CORS is open for localhost.

---

## Model sizes

| `SAM_SIZE` | File | Best on |
|---|---|---|
| `tiny` | `sam2.1_hiera_tiny.pt` | Older Macs / CPU |
| `small` (default) | `sam2.1_hiera_small.pt` | Apple Silicon |
| `base` | `sam2.1_hiera_base_plus.pt` | Fast Mac / Spark |
| `large` | `sam2.1_hiera_large.pt` | DGX Spark |

```text
https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt
https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
```

YAML names for `build_sam2`:

- tiny → `configs/sam2.1/sam2.1_hiera_t.yaml`
- small → `configs/sam2.1/sam2.1_hiera_s.yaml`
- base → `configs/sam2.1/sam2.1_hiera_b+.yaml`
- large → `configs/sam2.1/sam2.1_hiera_l.yaml`

If no local `.pt` exists, the server may fall back to Hugging Face (`SAM_MODEL`, default `facebook/sam2.1-hiera-small`).

---

## Human first-time setup

Same steps as the agent playbook. Short form:

```bash
git clone https://github.com/facebookresearch/sam2.git sam2
cd sam-server
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
pip install torch torchvision
SAM2_BUILD_CUDA=0 pip install -e ../sam2
curl -L -o ../sam2/checkpoints/sam2.1_hiera_small.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
cd ..
chmod +x start.sh stop.sh Freetoshop.command
./start.sh
```

`curl http://127.0.0.1:8765/health` should show `"demo": false` and `"device": "mps"` on Apple Silicon.

---

## Mac (Apple Silicon)

```bash
cd sam-server
source .venv/bin/activate
pip install torch torchvision
SAM2_BUILD_CUDA=0 pip install -e ../sam2
export SAM_SIZE=small
export SAM_DEVICE=mps
python server.py
```

Skip the CUDA extension on Mac. Image Smart Select does not need it.

- The server forces **fp32 on MPS**.
- If an op is missing: `SAM_DEVICE=cpu` and `SAM_SIZE=tiny`.
- Huge 8K layers on an 8 GB Mac will hitch. Shrink the layer or use tiny.

Intel Mac: CPU torch, several seconds per encode.

---

## DGX Spark (Blackwell, ARM64)

1. GPU is Blackwell (`sm_121`). Old x86 CUDA 12 wheels will not work.
2. CPU is Grace (`aarch64`).

Preferred: NVIDIA NGC PyTorch image listed for DGX Spark / GB10, then:

```bash
docker run --gpus all -it --rm \
  -p 8765:8765 \
  -v "$PWD/sam-server:/app" \
  -v "$PWD/sam2:/sam2" \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  nvcr.io/nvidia/pytorch:25.10-py3

cd /app
pip install -r requirements.txt
pip install -e /sam2
export SAM_SIZE=large
export SAM_DEVICE=cuda
python server.py --host 0.0.0.0 --port 8765
```

Bare metal: install Spark-tested ARM64 + CUDA torch first, then the same `pip install -e` of the local clone.

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

If that is `False`, fix torch — not SAM.

Point the Mac editor at `http://<spark-ip>:8765` and bind with `--host 0.0.0.0`.

---

## Offline / air-gapped

```bash
export SAM_CHECKPOINT=/models/sam2.1_hiera_small.pt
export SAM_CONFIG=configs/sam2.1/sam2.1_hiera_s.yaml
python server.py
```

`SAM_CONFIG` is the name `build_sam2()` expects after `pip install -e ../sam2`.

---

## Demo mode

If SAM 2 or the checkpoint cannot load, `/health` is `"demo": true` and predict is color flood-fill. The cutout UI still works; contours will be wrong.

```bash
export SAM_DEMO=1
python server.py
```

---

## Quality loop

1. Smart Select click (Shift add, Alt subtract)
2. **Q** Quick Mask — paint the mask, not the photo
3. Extract (cut)

Click the center of the object. Encode the **active layer**, not the flattened stack.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Editor says SAM offline | Server down / wrong URL | `curl :8765/health`; check the SAM field |
| `"demo": true` | `sam2` or `.pt` missing | Finish the agent/human setup; unset `SAM_DEMO` |
| `import sam2` fails / shadowing | Started Python from repo root | `cd sam-server` first |
| `start.sh` / `EDITOR_PORT` errors | Old script or encoding | Use current `start.sh`; `chmod +x` |
| First click slow, later fast | Encode once | Expected |
| Every click slow | New session every time | Do not re-upload unless the layer changed |
| MPS `not implemented` | Op missing on Mac GPU | `SAM_DEVICE=cpu` |
| CUDA false on Spark | Wrong torch wheel | NGC / Spark ARM64 + Blackwell torch |
| OOM on Mac | Large model + huge layer | `SAM_SIZE=tiny`; shrink the layer |
| CORS | Odd origin | Use `http://127.0.0.1:8080/` |

---

## Environment variables

| Variable | Default | Meaning |
|---|---|---|
| `SAM_SIZE` | `small` | `tiny` / `small` / `base` / `large` |
| `SAM_MODEL` | `facebook/sam2.1-hiera-small` | Hub fallback if no local `.pt` |
| `SAM_DEVICE` | auto (`cuda` > `mps` > `cpu`) | Force device |
| `SAM_CHECKPOINT` | unset | Explicit `.pt` |
| `SAM_CONFIG` | unset | YAML for `build_sam2` |
| `SAM_DEMO` | unset | `1` forces flood-fill |
| `SAM_PORT` | `8765` | Bind port |
| `SAM_HOST` | `127.0.0.1` | `0.0.0.0` on Spark |
| `EDITOR_PORT` | `8080` | Used by `start.sh` only |

---

## What not to do

- Do not bundle SAM in the browser.
- Do not re-encode the image on every click.
- Do not send the flattened layer stack.
- Do not skip Quick Mask. SAM is coarse; the mask brush finishes the cutout.
