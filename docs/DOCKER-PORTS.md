# SkyByte Docker Port Allocation Guide

Running multiple projects simultaneously requires unique **host-facing ports** for each stack. This document tracks every port assignment and explains how to add new projects.

---

## How It Works

Each Docker Compose project creates its own **isolated network** (e.g., `scoop`, `babyByteNet`, `freetoshop`). Inside a network, containers communicate using **service names and internal ports** — these never change:

- The API container connects to `mysql:3306` (the service name, not `localhost`)
- phpMyAdmin connects to `mysql:3306`
- The web app connects to the API on port `80`
- Freetoshop’s editor talks to SAM on the **host** URL `http://127.0.0.1:8765` (published port)

What **must be unique** are the **host-facing ports** — the left side of the `:` in port mappings. These are the ports you use from your Mac (browser, MySQL client, etc.).

```
ports:
  - '8082:80'
     ^     ^
     |     └── Container port (internal, never changes)
     └── Host port (must be unique across all projects)
```

---

## Port Allocation Table

| Project          | API Port | MySQL Port | Vite Port | phpMyAdmin Port | Web App Port |
|------------------|----------|------------|-----------|-----------------|--------------|
| **BabyByte**     | 80       | 3306       | 5173      | 8091            | 3000         |
| **SCOOP**        | 8082     | 3307       | 5174      | 8080            | 3002         |
| **KokolekoX API**| 8083     | 3308       | 5175      | 8093            | 3003         |
| **Kokoleko API** | 8084     | 3309       | 5176      | 8094            | 3004         |
| **Echoes**       | 8085     | 3310       | 5177      | 8095            | 3005         |
| **AlphaCompass** | 8086     | 3311       | 5178      | 8096            | 3006         |
| **SkyByte**      | 8087     | —          | 5179      | 8097            | 3007         |
| **MusicByte**    | —        | —          | —         | —               | 3008         |
| **MainFrame**    | —        | —          | —         | —               | 3009         |
| **iThink / VibeStorm** | 8090 | 3315     | 5181      | 8100            | 3010         |
| **MindWeave**    | 8092     | 3316       | 5182      | 8101            | 3011         |
| *(next Sail project)* | 8098 | 3317    | 5183      | 8102            | 3012         |

### MindWeave extras

| Service | Host port | Notes |
|---------|-----------|--------|
| Redis   | 6384      | `6384→6379` |
| Chroma  | 8105      | `8105→8000` |

### CREATE / SkyByte stacks (run alongside the table above)

These stacks use a **separate host port block** (`8190+`, `3320+`, `3020+`, etc.) so you can run them on the **same machine** as the Sail projects without colliding with `80`–`8101` or `3000`–`3011`. Defaults are baked into each repo’s `compose.yaml`; override any value in that project’s `.env` if needed.

| Project | API | MySQL | Vite | phpMyAdmin | Redis | MongoDB | Web / extra fronts |
|--------|-----|-------|------|------------|-------|---------|---------------------|
| **DREAMx12** | 8190 | 3320 | 5190 | 8191 | — | 27020 | React `3020`, XC `3021`, GameScribe `3022`, dream-apps `3023` |
| **CHiME-API** | 8192 | 3321 | 5191 | — | — | — | CHiME-WEB `3024` |
| **insight-ai** | 8193 | 3322 | 5192 | 8194 | — | — | insight-lab `3025` |
| **loopapi (LOOP)** | 8195 | 3323 | 5193 | 8196 | — | — | theloop `3026` |
| **MIRAGExAPI** | 8197 | 3324 | 5194 | 8198 | — | — | — |
| **icAPI** | 8199 | 3325 | 5195 | 8200 | — | — | — |
| **cryptoByte_api** | 8201 | 3326 | — | 8202 | 6380 | — | cryptoByte_web `3027` |
| **learnByte_api** | 8000 | 3327 | 5197 | 8204 | 6381 | — | learnByte_web `3028` |
| **GlareAPI / skyapi** | 8205 | 3328 | 5198 | 8206 | 6382 | — | sky_web / glare `3029` |
| **Freetoshop** | SAM `8765` | — | — | — | — | — | editor `3030` |

| Project | API URL | phpMyAdmin | Primary web / notes |
|--------|---------|------------|---------------------|
| **DREAMx12** | `http://localhost:8190` | `http://localhost:8191` | React `3020`, XC `3021`, GameScribe `3022`, static apps `3023`, Mongo `localhost:27020` |
| **CHiME-API** | `http://localhost:8192` | — | `http://localhost:3024` |
| **insight-ai** | `http://localhost:8193` | `http://localhost:8194` | `http://localhost:3025` |
| **loopapi** | `http://localhost:8195` | `http://localhost:8196` | `http://localhost:3026` |
| **MIRAGExAPI** | `http://localhost:8197` | `http://localhost:8198` | — |
| **icAPI** | `http://localhost:8199` | `http://localhost:8200` | — |
| **cryptoByte_api** | `http://localhost:8201` | `http://localhost:8202` | Vite `3027`, Redis host `6380` |
| **learnByte_api** | `http://localhost:8000` | `http://localhost:8204` | Vite `3028`, Redis host `6381` |
| **GlareAPI / skyapi** | `http://localhost:8205` (proxy) | `http://localhost:8206` | Vite `3029`, Redis host `6382` |
| **Freetoshop** | SAM `http://localhost:8765` | — | Editor `http://localhost:3030` |

### Access URLs When All Running

| Project          | API                    | phpMyAdmin              | Web App                |
|------------------|------------------------|-------------------------|------------------------|
| **BabyByte**     | `localhost:80`         | `localhost:8091`        | `localhost:3000`       |
| **SCOOP**        | `localhost:8082`       | `localhost:8080`        | `localhost:3002`       |
| **KokolekoX API**| `localhost:8083`       | `localhost:8093`        | `localhost:3003`       |
| **Kokoleko API** | `localhost:8084`       | `localhost:8094`        | `localhost:3004`       |
| **Echoes**       | `localhost:8085`       | `localhost:8095`        | `localhost:3005`       |
| **AlphaCompass** | `localhost:8086`       | `localhost:8096`        | `localhost:3006`       |
| **SkyByte**      | `localhost:8087`       | `localhost:8097`        | `localhost:3007`       |
| **MusicByte**    | —                      | —                       | `localhost:3008`       |
| **MainFrame**    | —                      | —                       | `localhost:3009`       |
| **iThink / VibeStorm** | `localhost:8090` | `localhost:8100`      | `localhost:3010`       |
| **MindWeave**    | `localhost:8092`       | `localhost:8101`        | `localhost:3011`       |
| **learnByte**    | `localhost:8000`       | `localhost:8204`        | `localhost:3028`       |
| **Glare / skyapi** | `localhost:8205`     | `localhost:8206`        | `localhost:3029`       |
| **Freetoshop**   | SAM `localhost:8765`   | —                       | `localhost:3030`       |

---

## Step-by-Step: Configure a Project

### 1. Add port variables to `.env`

Add these three lines to the project's `.env` file (pick values from the table above):

```env
APP_PORT=8083
FORWARD_DB_PORT=3308
VITE_PORT=5175
```

**Do NOT change `DB_PORT=3306`** — that's the internal port Laravel uses to talk to MySQL inside the Docker network.

### 2. Update phpMyAdmin host port in `compose.yaml`

If the project has a phpMyAdmin service, update its default port to match the table:

```yaml
phpmyadmin:
    ports:
        - '${FORWARD_PHPMYADMIN_PORT:-8093}:80'
        #                              ^^^^
        #                              Change this default
```

### 3. Update hardcoded web app ports in `compose.yaml`

If the project has a React/web service with a hardcoded port, change only the **left** (host) side:

```yaml
react-app:
    ports:
        - "3003:8080"
        #  ^^^^
        #  Change host port only; keep container port as-is
```

### 4. Update frontend API base URL

If the web app connects to the API, make sure it uses the correct port. Check for `REACT_APP_API_URL`, `VITE_API_URL`, `FRONTEND_URL`, or similar in the web app's `.env`:

```env
REACT_APP_API_URL=http://localhost:8083
```

### 5. Verify no conflicts

Before starting, double-check no two projects share a host port:

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}"
```

---

## What Each Variable Controls

| `.env` Variable            | What it does                                    | Internal impact? |
|----------------------------|-------------------------------------------------|------------------|
| `APP_PORT`                 | Host port for the Laravel API                   | None — container always listens on 80 |
| `FORWARD_DB_PORT`          | Host port to reach MySQL from your Mac          | None — API connects to `mysql:3306` internally |
| `VITE_PORT`                | Host + container port for Vite dev server        | Both sides change (Vite binds dynamically) |
| `FORWARD_PHPMYADMIN_PORT`  | Host port for phpMyAdmin web UI                 | None — phpMyAdmin always listens on 80 internally |
| `DB_PORT`                  | Port Laravel uses to connect to MySQL           | **Do not change** — always 3306 |
| `WEB_PORT`                 | Host port for a static/React web container      | None — keep container listen port as in compose |
| `FORWARD_SAM_PORT`         | Host port for Freetoshop SAM (`8765`)           | Container still listens on `8765` |
| `FORWARD_REDIS_PORT`       | Host port for Redis                             | None — apps use `redis:6379` internally |

---

## Adding a New Project

1. Pick the next available slot from the table (row marked *next Sail project*, or the next free CREATE-block ports)
2. Add `APP_PORT`, `FORWARD_DB_PORT`, and `VITE_PORT` to the project's `.env` (as applicable)
3. Update the `compose.yaml` phpMyAdmin default port and any hardcoded web app ports
4. Add the project to the table above
5. Increment the *next* row for whoever comes after

### Port formula for Sail slot N (starting from 0 = BabyByte):

| Port type    | Formula         | Example (slot 7) |
|--------------|-----------------|-------------------|
| API          | 8080 + N        | 8087              |
| MySQL        | 3306 + N        | 3313              |
| Vite         | 5173 + N        | 5180              |
| phpMyAdmin   | 8090 + N        | 8097              |
| Web App      | 3000 + N        | 3007              |

> **Exception**: BabyByte (slot 0) uses the bare defaults (80, 3306, 5173) instead of 8080, since it was the first project.

> **Note**: Some stacks skipped slots or added extras (MindWeave Redis/Chroma, Freetoshop SAM `8765`). Always check `docker ps` before claiming a port.

---

## Per-Project Changes Needed

Below are the specific changes required for each project that hasn't been configured yet.

### BabyByte — No changes needed (uses defaults)

### SCOOP — Already configured

`.env`:
```env
APP_PORT=8082
FORWARD_DB_PORT=3307
VITE_PORT=5174
```

`docker-compose.yml` — react-app port changed to `3002:3000`.

### KokolekoX API (`Kokoleko/kokolekoxapi`)

`.env` — add:
```env
APP_PORT=8083
FORWARD_DB_PORT=3308
VITE_PORT=5175
FORWARD_PHPMYADMIN_PORT=8093
```

`compose.yaml` — change react-app port:
```yaml
# from
- "3000:8080"
# to
- "3003:8080"
```

### Kokoleko API (`Kokoleko/kokolekoapi`)

`.env` — add:
```env
APP_PORT=8084
FORWARD_DB_PORT=3309
VITE_PORT=5176
FORWARD_PHPMYADMIN_PORT=8094
```

`compose.yaml` — change react-app port:
```yaml
# from
- "3000:8080"
# to
- "3004:8080"
```

### Echoes (`iGhost/Echoes`)

`.env` — add:
```env
APP_PORT=8085
FORWARD_DB_PORT=3310
VITE_PORT=5177
FORWARD_PHPMYADMIN_PORT=8095
```

`compose.yaml` — change Echoes_Web port:
```yaml
# from
- "3000:3000"
# to
- "3005:3000"
```

### AlphaCompass (`AlphaCompass/alpha-compass-api`) — configured

`.env`:
```env
APP_PORT=8086
FORWARD_DB_PORT=3311
VITE_PORT=5178
FORWARD_PHPMYADMIN_PORT=8096
```

Web `3006→8080`, phpMyAdmin `8096`.

### SkyByte — configured

| Host | Maps to |
|------|---------|
| API `8087` | `80` |
| Vite `5179` | `5179` |
| phpMyAdmin `8097` | `80` |
| Web `3007` | `8080` |

### MusicByte / MainFrame — web only

| Project | Web |
|---------|-----|
| MusicByte | `3008→8080` |
| MainFrame | `3009→8080` |

### iThink / VibeStorm (`vibestorm_api`) — configured

`.env`:
```env
APP_PORT=8090
FORWARD_DB_PORT=3315
VITE_PORT=5181
FORWARD_PHPMYADMIN_PORT=8100
FRONTEND_URL=http://localhost:3010
```

Web `3010→3000`, phpMyAdmin default `8100`.

### MindWeave (`mindweave_api`) — configured

```env
APP_PORT=8092
FORWARD_DB_PORT=3316
VITE_PORT=5182
FORWARD_PHPMYADMIN_PORT=8101
FORWARD_REDIS_PORT=6384
FRONTEND_URL=http://localhost:3011
```

Extras: Chroma `8105→8000`, web `3011→3011`.

### Freetoshop (`SkyByte/Freetoshop`) — configured

Static editor + SAM 2 (no MySQL / Vite / phpMyAdmin).

```env
WEB_PORT=3030
FORWARD_SAM_PORT=8765
SAM_SIZE=small
```

```bash
cd /path/to/Freetoshop
cp .env.example .env   # optional
docker compose up -d --build
```

| Service | URL |
|---------|-----|
| Editor (`Freetoshop_Web`) | `http://localhost:3030` |
| SAM (`Freetoshop_SAM`) | `http://localhost:8765` |

The editor’s default SAM field is already `http://127.0.0.1:8765`, so it matches the published port.

For real Smart Select (not demo flood-fill), clone `sam2/` and download a checkpoint on the host first (see `SAM.md`), then recreate the `sam` service so `/sam2` is mounted with weights. macOS Docker has no MPS — expect `cpu` (or set `SAM_DEMO=1` for flood-fill only). NVIDIA hosts can set `SAM_DEVICE=cuda` and use a CUDA base image / GPU flags as in `SAM.md`.

### CREATE / SkyByte stacks — `.env` (optional; compose defaults match the table)

If you rely on **defaults in `compose.yaml`**, you can skip these. Add or override in each project’s `.env` when you need different host ports.

**DREAMx12** (`DREAMx/DREAMx12`):

```env
APP_PORT=8190
FORWARD_DB_PORT=3320
VITE_PORT=5190
FORWARD_PHPMYADMIN_PORT=8191
WEB_PORT=3020
FORWARD_MONGO_PORT=27020
XC_WEB_PORT=3021
GAMESCRIBE_PORT=3022
DREAM_APPS_PORT=3023
```

Point `dream_web` at the API with `http://localhost:8190` (or your proxy URL) if the frontend calls the host.

**CHiME-API** (`CHiME-AI/CHiME-API`):

```env
APP_PORT=8192
FORWARD_DB_PORT=3321
VITE_PORT=5191
WEB_PORT=3024
```

**insight-ai** (`Insight/insight-ai`):

```env
APP_PORT=8193
FORWARD_DB_PORT=3322
VITE_PORT=5192
FORWARD_PHPMYADMIN_PORT=8194
WEB_PORT=3025
```

**loopapi** (`LOOP/loopapi`):

```env
APP_PORT=8195
FORWARD_DB_PORT=3323
VITE_PORT=5193
FORWARD_PHPMYADMIN_PORT=8196
WEB_PORT=3026
```

**MIRAGExAPI** (`DREAMx/MIRAGExAPI`):

```env
APP_PORT=8197
FORWARD_DB_PORT=3324
VITE_PORT=5194
FORWARD_PHPMYADMIN_PORT=8198
```

**icAPI** (`mobileApps/icAPI`):

```env
APP_PORT=8199
FORWARD_DB_PORT=3325
VITE_PORT=5195
FORWARD_PHPMYADMIN_PORT=8200
```

**cryptoByte_api** (`SkyByte/CryptoByte/cryptoByte_api`):

```env
APP_PORT=8201
FORWARD_DB_PORT=3326
FORWARD_PHPMYADMIN_PORT=8202
FORWARD_REDIS_PORT=6380
WEB_PORT=3027
```

**learnByte_api** (`SkyByte/LearnByte/learnByte_api`) — host API is **8000** (not 8203):

```env
APP_PORT=8000
FORWARD_DB_PORT=3327
VITE_PORT=5197
FORWARD_PHPMYADMIN_PORT=8204
FORWARD_REDIS_PORT=6381
WEB_PORT=3028
```

**GlareAPI / skyapi** (`SkyByte/Glare/glareAPI`):

```env
APP_PORT=8205
FORWARD_DB_PORT=3328
VITE_PORT=5198
FORWARD_PHPMYADMIN_PORT=8206
FORWARD_REDIS_PORT=6382
WEB_PORT=3029
FRONTEND_URL=http://localhost:3029
```

**Freetoshop** (`SkyByte/Freetoshop`):

```env
WEB_PORT=3030
FORWARD_SAM_PORT=8765
SAM_SIZE=small
```

---

## Next Project Checklist

When adding a new **Sail** project, use the *(next Sail project)* row, then update it for the following project:

1. **`.env`** — add:
   ```env
   APP_PORT=8098
   FORWARD_DB_PORT=3317
   VITE_PORT=5183
   FORWARD_PHPMYADMIN_PORT=8102   # if using phpMyAdmin
   FRONTEND_URL=http://localhost:3012   # if has web app
   ```

2. **`compose.yaml`** — set phpMyAdmin default to `8102`, web app port to `3012:3000` (or `3012:8080` for React).

3. **Add project to table** — insert new row, bump *(next Sail project)* to: `8099`, `3318`, `5184`, `8103`, `3013`.

When adding another **CREATE / SkyByte** stack after Freetoshop, prefer free ports such as web `3031+`, API `8207+`, MySQL `3329+`, Vite `5199+`, and avoid `8765` (Freetoshop SAM).

---

## Troubleshooting

**Sail keeps binding API to port 80**: The `vendor/laravel/sail/bin/sail` script runs `export APP_PORT=${APP_PORT:-80}` after loading `.env`. If `APP_PORT` is missing from `.env`, Sail forces **80** for the rest of the session, which overrides `${APP_PORT:-8193}` (or any other default) in `compose.yaml` — Compose substitutes the **exported** value. **Fix:** set `APP_PORT` (and `FORWARD_DB_PORT`, `VITE_PORT`, etc.) explicitly in that project’s `.env`.

**Port already in use error**: Run `lsof -i :<port>` to see what's using it, or `docker ps` to check running containers.

**API can't connect to database**: Make sure `DB_HOST=mysql` and `DB_PORT=3306` in `.env`. These are internal Docker values and should never match the `FORWARD_DB_PORT`.

**Web app can't reach API**: Update the frontend's API base URL env variable to use the correct `APP_PORT` for that project.

**Freetoshop SAM shows demo / offline**: Confirm `curl http://127.0.0.1:8765/health`. For `"demo": true`, mount a real `sam2/` + checkpoint (see `SAM.md`). Docker on Mac will not get `mps` — use `cpu` or run SAM on the host / a GPU machine instead.
