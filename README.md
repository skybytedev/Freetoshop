# Freetoshop

A lightweight, browser-based image editor for cutouts and collages. Layers, brushes, and a local **SAM 2** Smart Select tool so you can click an object and extract it onto its own layer.

The editor is static HTML/JS. Smart Select talks to a Python server on your machine (Mac MPS or NVIDIA GPU). Nothing is sent to a cloud API.

## Features

- Import images (Open or drag-and-drop)
- Layers: add, duplicate, delete, hide, opacity
- Smart Select (SAM 2) with Shift-add / Alt-subtract
- Quick Mask to refine a selection
- Extract cut / copy to a new layer
- Lasso, crop, brush, eraser, text
- Fill layer with a color
- Free Transform: scale, rotate, move (`F` or `Ctrl/Cmd+T`)
- Canvas size: width, height, anchor, fit to content

## Requirements

- Python 3.10+
- `curl` (to download a SAM checkpoint)
- macOS (Apple Silicon recommended) or an NVIDIA box such as a DGX Spark
- The [facebookresearch/sam2](https://github.com/facebookresearch/sam2) repo, cloned next to this project as `sam2/` (not shipped in this repository)

## First-time setup

From the repo root:

```bash
# 1. Official SAM 2 source (folder must be named sam2)
git clone https://github.com/facebookresearch/sam2.git sam2

# 2. Python env for the inference server
cd sam-server
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install -r requirements.txt
pip install torch torchvision

# 3. Install the local SAM 2 package (skip CUDA kernels on Mac)
SAM2_BUILD_CUDA=0 pip install -e ../sam2

# 4. One checkpoint is enough. "small" is the Mac default.
curl -L -o ../sam2/checkpoints/sam2.1_hiera_small.pt \
  https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
```

On an NVIDIA DGX Spark, install a Spark-tested CUDA build of PyTorch instead of the default Mac wheel, then use `SAM_SIZE=large` and the large checkpoint (see [Model sizes](#model-sizes)).

**Do not run the SAM server from the Freetoshop project root.** That folder is also named `sam2` and it shadows the Python package. Always start it from `sam-server/` (or use `./start.sh`, which already does this).

## Launch with the shell scripts

Day to day you only need these.

```bash
./start.sh
```

That script:

1. Starts the editor at [http://127.0.0.1:8080/](http://127.0.0.1:8080/)
2. Starts SAM 2 at [http://127.0.0.1:8765/](http://127.0.0.1:8765/)
3. Opens the browser
4. Stays in the foreground so **Ctrl+C** stops both processes

Stop without Ctrl+C:

```bash
./stop.sh
```

On macOS you can also double-click **`Freetoshop.command`** in Finder. Leave that Terminal window open while you work.

If something is already running on those ports, `start.sh` reuses it and just opens the app. Logs and pid files go in `.run/`.

Make the scripts executable once if `git` dropped the bit:

```bash
chmod +x start.sh stop.sh Freetoshop.command
```

### Ports

| What | URL | Override |
|---|---|---|
| Editor | `http://127.0.0.1:8080/` | `EDITOR_PORT=9090 ./start.sh` |
| SAM | `http://127.0.0.1:8765/` | `SAM_PORT=8766 ./start.sh` |

In the editor, the SAM field should match the server (default `http://127.0.0.1:8765`).

### Check that SAM is real

```bash
curl http://127.0.0.1:8765/health
```

You want `"demo": false` and a device of `mps` (Mac) or `cuda` (Spark). If you see `"demo": true`, the model or checkpoint did not load and Smart Select is using color flood-fill only.

## Using Smart Select

1. Open an image
2. Choose **Smart Select** (`W`)
3. Click the object (Shift-click to add, Alt-click to subtract)
4. Optional: **Quick Mask** (`Q`) and paint to refine
5. **Extract (cut)** or `Ctrl/Cmd+Shift+J` — the object becomes its own layer

The first click on a layer encodes the image (slow). Later clicks on the same pixels are fast.

### Model sizes

Set `SAM_SIZE` before `start.sh` or `python server.py`. The server looks in `sam2/checkpoints/` for the matching file.

| `SAM_SIZE` | File | Best on |
|---|---|---|
| `tiny` | `sam2.1_hiera_tiny.pt` | Older Macs / CPU |
| `small` (default) | `sam2.1_hiera_small.pt` | Apple Silicon |
| `base` | `sam2.1_hiera_base_plus.pt` | Fast Mac / Spark |
| `large` | `sam2.1_hiera_large.pt` | DGX Spark |

Download extras from Meta:

```text
https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt
https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
```

### Demo mode (no GPU / no weights)

The rest of the editor still works if SAM is down. To force flood-fill:

```bash
cd sam-server
source .venv/bin/activate
SAM_DEMO=1 python server.py
```

Useful for UI work. Edges on people and mixed-color objects will be wrong.

## Tools and shortcuts

| Key | Tool |
|---|---|
| `V` | Move layer |
| `F` or `Ctrl/Cmd+T` | Free Transform |
| `W` | Smart Select |
| `L` | Lasso |
| `Q` | Quick Mask |
| `C` | Crop |
| `B` | Brush |
| `E` | Eraser |
| `T` | Text |
| `G` | Fill layer |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` | Redo |
| `Ctrl/Cmd+J` | Extract copy |
| `Ctrl/Cmd+Shift+J` | Extract cut |
| `Ctrl/Cmd+D` | Deselect |
| `[` `]` | Brush size |
| Space + drag | Pan |
| Scroll | Zoom |
| Enter / Esc | Apply / cancel transform |

## Manual start (without the scripts)

```bash
# terminal 1 — from the repo root
python3 -m http.server 8080 --bind 127.0.0.1

# terminal 2 — from sam-server, never from the repo root
cd sam-server
source .venv/bin/activate
python server.py
```

Then open [http://127.0.0.1:8080/](http://127.0.0.1:8080/). MAMP works too if this folder is already under `htdocs`.

## Environment variables (SAM)

| Variable | Default | Meaning |
|---|---|---|
| `SAM_SIZE` | `small` | Local checkpoint: `tiny` / `small` / `base` / `large` |
| `SAM_DEVICE` | auto (`cuda` > `mps` > `cpu`) | Force device |
| `SAM_CHECKPOINT` | unset | Explicit `.pt` path |
| `SAM_CONFIG` | unset | YAML for `build_sam2` (required with `SAM_CHECKPOINT`) |
| `SAM_MODEL` | `facebook/sam2.1-hiera-small` | Hugging Face fallback if no local `.pt` |
| `SAM_DEMO` | unset | `1` forces flood-fill |
| `SAM_PORT` | `8765` | Bind port |
| `SAM_HOST` | `127.0.0.1` | Use `0.0.0.0` if the editor is on another machine |

## Cursor rules (for agents)

This repo ships a Cursor project rule so an agent can connect SAM after someone clones GitHub, without you pasting the setup again.

| File | Role |
|---|---|
| [`.cursor/rules/sam-setup.mdc`](.cursor/rules/sam-setup.mdc) | Always-on rule. Tells Cursor to treat “enable SAM / Smart Select” as a setup job and to follow `SAM.md`. |
| [`.cursor/rules/unit-tests.mdc`](.cursor/rules/unit-tests.mdc) | Always-on rule. Every feature needs unit tests; agents must add and run them. |
| [`SAM.md`](SAM.md) | Full playbook, including **Instructions for coding agents** (detect what is missing, install, verify `"demo": false`). |

After you open the project in [Cursor](https://cursor.com), the rule loads automatically (`alwaysApply: true`). Then say something like:

- “Enable SAM”
- “Connect Smart Select”
- “Set up SAM 2 on this machine”

The agent should clone `sam2/`, create `sam-server/.venv`, install torch, download the small checkpoint, run `./start.sh`, and check `curl http://127.0.0.1:8765/health`.

If the rule does not appear in **Cursor Settings → Rules**, confirm `.cursor/rules/sam-setup.mdc` was cloned (it is not gitignored) and reopen the folder.

You can still `@SAM.md` in chat if you want the agent to read the runbook explicitly.

## Tests

```bash
npm install          # once
npm test             # Vitest — editor engine, selection, transform, SAM client
./test.sh            # JS + Python SAM server tests
```

Python tests use `SAM_DEMO=1` and `sam-server/.venv`. They do not need the GPU checkpoint.

| Code | Tests |
|---|---|
| Layers, fill, canvas size, extract, crop, undo | `tests/js/engine.test.js` |
| Lasso / Quick Mask / clip | `tests/js/selection.test.js` |
| Free Transform | `tests/js/transform.test.js` |
| Smart Select client + tool list | `tests/js/sam.test.js` |
| SAM `/health`, sessions, demo predict | `tests/test_sam_server.py` |

## Layout

```text
Freetoshop/
  start.sh / stop.sh / Freetoshop.command
  index.html, css/, js/          editor
  sam-server/                    FastAPI + SAM 2 predictor
  sam2/                          official Meta clone (you add this)
  sam2/checkpoints/*.pt          weights (you download these)
  .cursor/rules/sam-setup.mdc    Cursor rule: enable SAM via SAM.md
  .cursor/rules/unit-tests.mdc   Cursor rule: unit tests for every feature
  tests/                         Vitest + Python unittest
  SAM.md                         SAM runbook + agent instructions
```

## License

Editor code in this repo is yours to use with the project. SAM 2 source and checkpoints are covered by Meta’s [Apache 2.0](https://github.com/facebookresearch/sam2/blob/main/LICENSE) license.
