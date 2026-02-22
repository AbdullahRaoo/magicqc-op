# MagicQC Operator Panel — Complete Project Analysis

This document provides a thorough analysis of the **Operator Panel** codebase: structure, architecture, data flow, security, and key knowledge for development and maintenance.

---

## 1. Project Overview

**Name:** Operator Panel (operatorPannel / MagicQC Operator Panel)  
**Version:** 1.0.0 (UI shows v4.0)  
**Purpose:** Desktop application for garment quality control operators. Operators log in with a PIN, select brands/articles/purchase orders, and perform **camera-based measurements** on garments (front/back, multiple sizes). Measurements are compared against specs from a central MagicQC API and results are saved back to the server.

**Stack:**
- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS
- **Desktop shell:** Electron 30
- **Backend (local):** Python 3 (Flask API + OpenCV/MagicCamera SDK)
- **Backend (remote):** MagicQC Laravel API (GraphQL + REST) — brands, POs, articles, annotations, measurement results

---

## 2. Repository Structure

```
operatorPannel-main/
├── electron/                 # Electron main process + preload
│   ├── main.ts               # App lifecycle, security gates, IPC, Python spawn
│   ├── preload.ts            # contextBridge: window.api, window.measurement
│   ├── api-client.ts         # GraphQL client for MagicQC API
│   ├── apiConfig.ts          # .env → MAGICQC_*, PYTHON_* URLs/keys
│   ├── config-vault.ts       # Encrypted config loading (prod)
│   ├── security.ts           # Anti-debug, VM, DLL, SDK, integrity
│   ├── hwid.ts               # Hardware fingerprint (license binding)
│   ├── license.ts            # AES-256-GCM license file (first-launch create)
│   └── keystore.ts           # Split keys for license encryption
├── src/                      # React renderer
│   ├── main.tsx
│   ├── App.tsx               # AuthProvider, Login / ArticlesList, Settings, Calibration modal
│   ├── context/AuthContext.tsx
│   ├── components/
│   │   ├── Login.tsx
│   │   ├── ArticlesList.tsx   # Main workflow: Brand → Article → PO → Size → Measure
│   │   ├── PurchaseOrdersList.tsx
│   │   ├── OperatorsList.tsx
│   ├── types/database.ts     # Brand, Article, PO, MeasurementSpec, Operator, etc.
│   ├── utils/measurementUtils.ts
│   └── electron-api.d.ts     # window.api, window.measurement, window.ipcRenderer
├── python-core/              # Measurement & calibration engine
│   ├── core_main.py          # Entry: Flask API server OR worker (measurement/calibration)
│   ├── integration.py        # LiveKeypointDistanceMeasurer (OpenCV + MagicCamera)
│   ├── measurement_worker.py # Headless measurement subprocess
│   ├── calibration_worker.py # Camera calibration subprocess
│   ├── worker_logger.py      # File logging for workers
│   └── mvsdk.py              # MagicCamera SDK bindings (MVCAMSDK_X64.dll)
├── public/                   # Static assets
│   ├── icon.ico
│   ├── MagicQC logo.png
│   ├── sdk_missing.html      # Shown when camera SDK not found
│   └── unauthorized.html    # Shown when license/VM/SDK fails
├── runtime/                  # Created at runtime (writable, outside asar)
│   ├── logs/                 # python_server.log, security.log, etc.
│   ├── storage/measurement_results/
│   ├── temp_annotations/
│   ├── temp_measure/
│   └── secure/               # Binary integrity hash store
├── measurement_config.json   # Written by Python API for measurement worker
├── camera_calibration.json   # Written by calibration worker / upload
├── .env                      # MAGICQC_API_*, PYTHON_API_* (not in repo)
├── package.json
├── vite.config.ts            # Vite + electron plugin
└── electron-builder.json5    # Win build / asar
```

**Build output:**
- `dist/` — Vite React build (index.html + assets)
- `dist-electron/` — main.js, preload.mjs
- Production: `resources/app.asar` (read-only) + `resources/` (python-core, .env) at `process.resourcesPath`; writable data under `runtime/` at `APP_ROOT`.

---

## 3. Architecture & Data Flow

### 3.1 Process Model

1. **Electron Main** (`main.ts`)
   - Single-instance lock.
   - **Security gates (production only):** anti-debug → debug tools → DLL injection → VM detection → hardware license → Camera SDK presence → `magicqc_core.exe` existence → binary integrity. On failure: show `unauthorized.html` or `sdk_missing.html` and do not register IPC.
   - Creates `runtime/` dirs (logs, storage, temp_annotations, temp_measure, measurement_results, secure).
   - Loads secure config from vault (prod).
   - Starts **Python server**: dev = `python core_main.py`, prod = `magicqc_core.exe` in `python-core/dist/`.
   - Waits for `GET /health` on Python API; then registers IPC handlers.
   - **API heartbeat:** periodic GraphQL ping, broadcasts `api:connectivity-changed` to renderer.
   - **Measurement IPC:** proxies to `PYTHON_API_URL` (e.g. `http://localhost:5000`).
   - On quit: stops Python server.

2. **Renderer (React)**
   - Uses only `window.api` and `window.measurement` (no Node). Auth: PIN → `api.verifyPin` → store operator in context + localStorage.
   - Main UI: `ArticlesList` — Brand → Article Type → Article → PO → PO Article → Size; then load specs, annotations, start/stop measurement, poll live results, save to API.

3. **Python**
   - **Flask server** (`core_main.py`): `/health`, `/api/measurement/start|stop|status`, `/api/results/live`, `/api/calibration/*`, etc. Reads/writes `measurement_config.json`, `camera_calibration.json`, and runtime paths.
   - **Measurement start:** accepts keypoints/target_distances/placement_box/image from API (database-first) or falls back to file-based annotations; writes config and spawns **measurement worker** subprocess (`core_main.py --worker measurement`).
   - **Measurement worker** (`measurement_worker.py`): loads `measurement_config.json`, instantiates `LiveKeypointDistanceMeasurer` from `integration.py`, initializes MagicCamera, loads calibration and annotation, runs `transfer_keypoints_to_live(headless=True)`. Writes live results to `measurement_results/live_measurements.json`.
   - **Calibration worker:** separate subprocess for camera calibration (two-point scale); can be launched from UI.

### 3.2 Key Data Flows

- **Login:** Renderer → `api.verifyPin(pin)` → Main → `apiClient.verifyPin()` → MagicQC GraphQL → operator object → AuthContext + localStorage.
- **Annotations / reference image:** Renderer → `api.operatorFetch(articleStyle, size, side, color)` → Main → REST/GraphQL → annotation (keypoints_pixels, target_distances, placement_box, image dimensions) + reference image base64. Used when starting measurement.
- **Start measurement:** Renderer → `measurement.start(config)` → Main → `POST /api/measurement/start` with annotation_name, article_style, side, garment_color, keypoints_pixels, target_distances, placement_box, image_width/height, image_data (base64), measurement_specs. Python writes config and spawns worker; worker reads config and runs CV pipeline.
- **Live results:** Renderer polls `measurement.getLiveResults()` → Main → `GET /api/results/live` → Python reads `live_measurements.json` and returns it. UI maps to measurement spec codes and shows PASS/FAIL.
- **Save results:** Renderer → `api.saveMeasurementResultsDetailed(...)` / `api.saveMeasurementSession(...)` → Main → GraphQL mutations.

---

## 4. Frontend (React) Deep Dive

### 4.1 Entry & Shell

- `main.tsx`: mounts `App`, optionally subscribes to `main-process-message`.
- `App.tsx`: `AuthProvider` wraps `AppContent`. If no operator → `Login`. If operator → header (logo, operator card, Settings, Logout) + `<ArticlesList />` + Settings modal + Calibration modal.

### 4.2 Auth

- **AuthContext:** `operator`, `isLoading`, `error`, `serviceStatus` ('checking'|'available'|'unavailable'). Persists operator in `localStorage` key `magicqc_operator`. Listens to `api.onConnectivityChanged` and `api.getConnectivity()` for status; also `online`/`offline`. `login(pin)` → `api.verifyPin(pin)`; on success stores operator and returns true.

### 4.3 Main Workflow (ArticlesList)

- **Cascade:** Brands (API) → Article Types (by brand) → Articles (by brand, optional type) → Purchase Orders (by brand) → PO Articles (by PO) → select PO Article + Size.
- **Sizes:** From `api.getAvailableSizes(articleId)`.
- **Measurement specs:** From `api.getMeasurementSpecs(articleId, size)` — code, name, expected_value, tol_plus, tol_minus, unit.
- **Annotation + image:** `api.operatorFetch(articleStyle, size, side, color)` for front/back and optional color (white/black/other → w/b/z). Can also use `measurement.saveTempFiles` for temp_measure and `measurement.fetchLaravelImage` for image.
- **Start measurement:** Builds config with keypoints_pixels, target_distances, placement_box, image dimensions, image_data (base64), measurement_specs, etc., then `measurement.start(config)`. Polling `measurement.getLiveResults()` until stable; then merge into front/back measured values and show QC result (PASS/FAIL).
- **Save:** `api.saveMeasurementResultsDetailed` / `api.saveMeasurementSession` with operator_id, po_article_id, size, side, measurements.
- **State:** Many useState/useRef for selection, measurement lifecycle, calibration status, QC popup, editable tolerances, unit toggle (cm/inch), etc.

### 4.4 Settings & Calibration

- **Settings modal:** Calibration entry, display options (toggles), theme (light/dark via `document.documentElement.classList` + localStorage `theme`).
- **Calibration modal:** Steps: check existing (getCalibrationStatus) → choose “Upload JSON” or “Run Camera”. Upload: file input → validate JSON (pixels_per_cm, reference_length_cm, is_calibrated) → `measurement.uploadCalibration(data)`. Run camera: optional reference distance input → `measurement.startCalibration()` then poll status until calibrated.

### 4.5 Exposed APIs (Preload)

- **window.api:** ping, getBrands, getArticleTypes, getArticles, getPurchaseOrders, getAllPurchaseOrders, getPOArticles, getMeasurementSpecs, getAvailableSizes, getMeasurementResults, saveMeasurementResults, saveMeasurementResultsDetailed, saveMeasurementSession, verifyPin, getOperators, operatorFetch, fetchImageBase64, getConnectivity, onConnectivityChanged.
- **window.measurement:** start, stop, getStatus, getLiveResults, loadTestImage, startCalibration, getCalibrationStatus, cancelCalibration, uploadCalibration, fetchLaravelImage, saveTempFiles.

---

## 5. Electron Main Process

### 5.1 Paths

- **APP_ROOT:** packaged = `process.resourcesPath`; dev = project root (parent of dist-electron). All writable paths (runtime, python-core as parent for exe) under APP_ROOT.
- **ASAR_ROOT:** `app.getAppPath()` (asar or dev root). Used for loading preload, renderer index, static HTML (sdk_missing, unauthorized).

### 5.2 Security (production only)

- **security.ts:** checkForDebugger (execArgv, NODE_OPTIONS, timing), checkForDebugTools (banned process names), checkForDllInjection, checkForVM (hardware/registry hints), checkCameraSDK (MagicCamera DLL), checkBinaryIntegrity (magicqc_core.exe SHA-256 vs stored hash in runtime/secure). Failures block app or show unauthorized/sdk_missing.
- **license.ts:** First launch creates `license.dat` (AES-256-GCM + HMAC) with hardware fingerprint; subsequent launches validate fingerprint. No network; binding is local.
- **hwid.ts:** Fingerprint from CPU ID, MAC, motherboard UUID, disk serial (Windows wmic).

### 5.3 Python Server Lifecycle

- Spawn: dev `python core_main.py`, prod `magicqc_core.exe`. CWD = APP_ROOT. stdout/stderr → `runtime/logs/python_server.log`. No console window (windowsHide, CREATE_NO_WINDOW).
- Health: poll `GET ${PYTHON_API_URL}/health` with retries/delay until OK.
- On quit: taskkill (Windows) or SIGTERM; close log stream.
- Optional heartbeat in prod: if Python process dies, app quits.

### 5.4 IPC Handlers

- **API handlers:** Each maps to `apiClient` method (GraphQL or REST). Errors return `{ success: false, error: string }`.
- **Measurement handlers:** HTTP to Python API (start, stop, status, live results, calibration, fetchLaravelImage, saveTempFiles). Retry on failure; optional Python restart and retry for start.

---

## 6. Python Core

### 6.1 core_main.py

- **Modes:** No args → Flask API server. `--worker measurement` → measurement worker; `--worker calibration` → calibration worker. PROJECT_ROOT resolved for both dev and PyInstaller frozen.
- **Flask routes:** health, measurement status/start/stop, results/live, results/latest, calibration status/upload/start/cancel, annotations list/export, register (shirt registration; worker not implemented).
- **Measurement start logic:** Prefer database payload: keypoints_pixels + image_data (base64) → write temp annotation JSON + reference image under temp_annotations, with optional upscale to “native” camera resolution. Fallbacks: percentage annotation conversion; keypoints only + local file image; file-based lookup (side-specific then generic then size-only then folder). Writes `measurement_config.json` (annotation_json_path, reference_image_path, results_path, side, garment_color, measurement_specs), then spawns worker in background thread.

### 6.2 integration.py (LiveKeypointDistanceMeasurer)

- **Role:** OpenCV + MagicCamera; load calibration (camera_calibration.json), annotation (keypoints, target_distances, placement_box), reference image; run live keypoint transfer (homography/feature matching), compute distances in cm using pixels_per_cm, write live_measurements.json.
- **Concepts:** Front/back sides, garment color (white/black/other) for gain, corner vs normal keypoints, stabilization, pause, zoom/pan. Large file (~3000+ lines).

### 6.3 measurement_worker.py

- Sets up file logging via worker_logger. Reads measurement_config.json, creates LiveKeypointDistanceMeasurer, set_garment_color, assigns measurement_specs and paths, initialize_camera(headless=True), load_calibration, load_annotation, load_reference_image, optional back side, then transfer_keypoints_to_live(headless=True). No interactive prompts.

### 6.4 calibration_worker.py

- Separate process for two-point camera calibration; writes camera_calibration.json (pixels_per_cm, reference_length_cm, is_calibrated). Invoked by Flask `/api/calibration/start`.

---

## 7. Configuration & Environment

- **.env (APP_ROOT):**  
  MAGICQC_API_URL (GraphQL), MAGICQC_API_BASE (REST), MAGICQC_API_KEY, PYTHON_API_HOST, PYTHON_API_PORT.  
  Loaded in main via config-vault in prod; apiConfig.ts loads for main process (dotenv from APP_ROOT).
- **measurement_config.json:** Written by Flask when starting measurement; read by measurement worker. Contains annotation_name, article_style, side, garment_color, annotation_json_path, reference_image_path, results_path, measurement_specs.
- **camera_calibration.json:** pixels_per_cm, reference_length_cm, is_calibrated, calibration_date. Under PROJECT_ROOT (or runtime if app redirects).
- **registration_config.json:** Used by registration API (worker not implemented).

---

## 8. Types (Database / API)

- **database.ts:** Brand, Article, ArticleWithRelations, MeasurementSpec, PurchaseOrder, POArticle, Operator, MeasurementResult, ArticleAnnotation, JobCardSummary, etc. Align with GraphQL/REST responses.
- **electron-api.d.ts:** Interfaces for window.api (MagicQCAPI) and window.measurement (MeasurementAPI), plus IPC invoke signatures.

---

## 9. Build & Run

- **Dev:** `npm run dev` → Vite dev server + Electron; main loads from source; Python = `python core_main.py`.
- **Build:** `npm run build` → tsc, vite build, electron-builder. `build:prod` adds obfuscation and `--win`.
- **Production:** Expects `python-core/dist/magicqc_core.exe` (PyInstaller build of core_main.py) and MagicCamera SDK on the machine. License and runtime dirs under APP_ROOT.

---

## 10. Summary Table

| Layer        | Technology        | Responsibility |
|-------------|-------------------|----------------|
| UI          | React + Tailwind  | Login, brand/article/PO/size selection, measurement flow, live results, save, settings, calibration |
| Bridge      | Electron preload  | Expose window.api, window.measurement (IPC invoke) |
| Main        | Electron main.ts  | Security, license, Python spawn, API client, measurement proxy, heartbeat |
| Remote API  | MagicQC Laravel   | GraphQL: brands, POs, articles, specs, results, sessions; REST: ping, operatorFetch, images |
| Local API   | Flask (Python)    | Measurement start/stop/status, live results, calibration, annotations list |
| CV / Camera | Python (integration.py + worker) | MagicCamera, keypoint transfer, distances, live_measurements.json |

This document reflects the codebase as of the analysis date and can be updated as the project evolves.
