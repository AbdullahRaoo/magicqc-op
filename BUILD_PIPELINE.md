# Magic QC Operator Panel — Production Windows EXE Build Pipeline

This document describes the project structure, dependency graph, path flow, and the production-ready build pipeline for a single distributable Windows EXE with no runtime dependency on Node.js, Python, pip, or compilers on the client PC.

---

## 1. Project structure and dependency graph

### 1.1 High-level architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Electron (main process)                                                     │
│  main.ts → security gates, license, spawn Python, IPC, API client           │
├─────────────────────────────────────────────────────────────────────────────┤
│  Preload (preload.ts) → contextBridge: window.api, window.measurement       │
├─────────────────────────────────────────────────────────────────────────────┤
│  Renderer (React) → Login, ArticlesList, Settings, Calibration              │
│  Polls: measurement.getLiveResults() → main → HTTP GET Python /api/results/live
└─────────────────────────────────────────────────────────────────────────────┘
         │                                    │
         │ IPC (api:*, measurement:*)         │ HTTP (localhost:5000)
         ▼                                    ▼
┌──────────────────────┐            ┌────────────────────────────────────────┐
│  MagicQC server      │            │  Python CV core (subprocess)            │
│  GraphQL + REST      │            │  magicqc_core.exe (PyInstaller onefile) │
│  Auth, POs, specs,   │            │  Entry: core_main.py → Flask or worker │
│  save results        │            │  Worker: measurement_worker →          │
└──────────────────────┘            │    integration.LiveKeypointDistance...  │
                                    │  Writes: live_measurements.json        │
                                    │    to results_path (RESULTS_PATH)      │
                                    └────────────────────────────────────────┘
```

### 1.2 Critical paths (dev vs production)

| Concept | Dev | Production (packaged) |
|--------|-----|------------------------|
| **APP_ROOT** | Project root (parent of dist-electron) | `process.resourcesPath` (e.g. `…/MagicQC/resources`) |
| **Python exe** | `python core_main.py` | `resources/python-core/dist/magicqc_core.exe` |
| **Python CWD** | Set by main.ts to APP_ROOT | Same: `process.env.APP_ROOT` |
| **PROJECT_ROOT (Python frozen)** | N/A | `dirname(sys.executable)` = `resources/python-core/dist` |
| **RESULTS_PATH (Flask)** | `PROJECT_ROOT/storage/measurement_results` | `resources/python-core/dist/storage/measurement_results` |
| **Runtime dirs (Electron)** | `APP_ROOT/runtime/{logs,storage,...}` | Same under resources |
| **.env** | Project root `.env` | `resources/.env` (via extraResources or first-run copy) |

Live measurements flow: **integration.py** uses `measurer.results_path` (set from config by measurement_worker) → writes `live_measurements.json` under that path. Flask serves it via `/api/results/live`. UI polls via `measurement.getLiveResults()` → main process → fetch(PYTHON_API_URL + `/api/results/live`). No change to this flow in production.

### 1.3 IPC channels (must remain intact)

- **api:** verifyPin, ping, getBrands, getArticleTypes, getArticles, getPurchaseOrders, getAllPurchaseOrders, getPOArticles, getMeasurementSpecs, getAvailableSizes, getMeasurementResults, saveMeasurementResults, saveMeasurementResultsDetailed, saveMeasurementSession, getOperators, operatorFetch, fetchImageBase64, getConnectivity, onConnectivityChanged
- **measurement:** start, stop, getStatus, getLiveResults, loadTestImage, startCalibration, getCalibrationStatus, cancelCalibration, uploadCalibration, fetchLaravelImage, saveTempFiles

### 1.4 Python module dependency graph

```
core_main.py
  ├── worker_logger (setup_file_logging)
  ├── flask, flask_cors
  ├── measurement_worker (--worker measurement) → integration.LiveKeypointDistanceMeasurer
  ├── calibration_worker (--worker calibration)
  └── (registration worker not implemented)

measurement_worker.py
  └── integration.LiveKeypointDistanceMeasurer
        ├── cv2, numpy, scipy.ndimage, mvsdk (MindVision SDK)
        ├── PIL (optional)
        └── json, os, time, math, base64
```

Interfaces used by Electron/worker (do not change): `initialize_camera`, `load_annotation`, `load_calibration`, `transfer_keypoints_to_live(headless=True)`, `save_live_measurements`, `check_qc`, `current_side`, `results_path`, `measurement_specs`, `current_annotation_name`.

### 1.5 JSON / API contracts (do not change)

- **live_measurements.json:** `timestamp`, `annotation_name`, `side`, `is_calibrated`, `pixels_per_cm`, `garment_color`, `measurements[]` with `id`, `name`, `spec_id`, `spec_code`, `actual_cm` (number or null), `qc_passed`, `is_fallback`, etc.
- **measurement_config.json:** Written by Flask; read by worker. Contains `annotation_name`, `article_style`, `side`, `garment_color`, `annotation_json_path`, `reference_image_path`, `results_path`, `measurement_specs`.
- GraphQL/REST: Existing mutations and queries only; no new endpoints.

---

## 2. Build pipeline overview

1. **Prerequisites (build machine only)**  
   Node.js 18+, npm, Python 3.10+ with pip, PyInstaller, and (optional) Cython + Visual Studio Build Tools if building Cython .pyd.

2. **Staged steps**  
   - Build Python core (optionally Cythonize then PyInstaller, or PyInstaller only).  
   - Build Electron (tsc, vite build, optional obfuscate, electron-builder).  
   - Staged API validation (auth, measurement start/stop, live polling, RESULTS_PATH) before packaging.  
   - Package installer (NSIS) or portable EXE.

3. **Client PC**  
   No Node, Python, pip, or compiler. Only the installed app (or portable EXE) and MindVision Camera SDK (existing requirement).

---

## 3. Python core build (zero runtime compiler on client)

### 3.1 Current PyInstaller build

- **Script:** `python-core/build_exe.py`  
- **Output:** `python-core/dist/magicqc_core.exe` (onefile, noconsole).  
- **Hidden imports:** worker_logger, measurement_worker, calibration_worker, integration, mvsdk, flask stack, cv2, numpy, scipy, PIL, psutil, dotenv, etc.  
- **Excludes:** tkinter, matplotlib, pandas, torch, tensorflow, etc.

Frozen behavior: `sys.frozen` True, `PROJECT_ROOT = dirname(sys.executable)`, so RESULTS_PATH and config paths are under `resources/python-core/dist/` when run from Electron with CWD = APP_ROOT.

### 3.2 Optional Cython build (build machine only)

To ship Cython-compiled binaries (e.g. integration.pyd, measurement_worker.pyd) instead of plain .py:

1. **Build machine:** Install Cython and a C compiler (e.g. Visual Studio Build Tools on Windows).  
2. **Compile:** Run a script that Cythonizes `integration.py`, `measurement_worker.py`, `calibration_worker.py`, `worker_logger.py` (and any other local modules) to .pyd, preserving the same module and function names.  
3. **PyInstaller:** Point PyInstaller at the built .pyd (e.g. `--add-data "integration.pyd;."`) so the exe uses the compiled modules; no .py or compiler needed on client.

Cython does not change function names, class signatures, or API contracts; it only compiles the implementation. The same interfaces (initialize_camera, load_annotation, transfer_keypoints_to_live, save_live_measurements, check_qc) remain.

If you do not run the Cython step, the existing PyInstaller-only build remains valid and production-ready.

---

## 4. Electron build and packaging

- **Config:** `electron-builder.json5`  
  - **files:** dist, dist-electron; excludes .py, .pyc, python-core source (so only the built exe is shipped via extraResources).  
  - **extraResources:**  
    - `python-core/dist/magicqc_core.exe` → `python-core/dist/`  
    - Root `.env`, `camera_calibration.json`, `measurement_config.json`, `registration_config.json` → `.` (under resources)  
    - `storage` → `runtime/storage` (if the `storage` directory does not exist, create an empty one so electron-builder does not fail; runtime dirs are also created on first run by main.ts)

- **Main process** spawns:  
  - Prod: `path.join(APP_ROOT, 'python-core', 'dist', 'magicqc_core.exe')` with `cwd: process.env.APP_ROOT`.  
  - No change to IPC or API layer.

- **Environment:** apiConfig loads .env from `process.env.APP_ROOT` (resources). Deployers can place a `.env` in the install directory (or use a .env.example template) so API base URL and keys are not hardcoded in a way that breaks on client systems.

---

## 5. Staged API validation (before packaging)

Run validation after the Python exe and Electron app are built but before creating the final installer. Script: `scripts/validate-api.mjs` (or equivalent).

**Checks:**

1. **Authentication:** Call GraphQL verifyPin (or ping) with configured API key; ensure network and auth are distinguishable (e.g. 4xx vs 5xx vs timeout).  
2. **Measurement pipeline:** Start Python process (or mock), POST `/api/measurement/start` with minimal config, then GET `/api/measurement/status` and `/api/results/live`; confirm no path breakage (e.g. live_measurements.json under RESULTS_PATH).  
3. **save_live_measurements path:** Assert that the file written by the CV engine is the same one served by `/api/results/live` (RESULTS_PATH alignment).  
4. **QC status:** Ensure live payload includes only real measurements (no 0.00 fallback for missing pairs) and that spec_id/spec_code alignment is correct.

Validation is intended for the build environment (or a staging install); it does not modify UI, API schema, or measurement logic.

---

## 6. Optional Cython build (build machine only)

To produce Cython-compiled binaries (e.g. `.pyd`) so no `.py` or compiler is needed on the client:

1. **Prerequisites:** Python 3.10+, Cython, and a C compiler (e.g. Visual Studio Build Tools on Windows).
2. **Compile:** From `python-core/`, run:
   ```bash
   pip install cython
   cython -3 integration.py measurement_worker.py calibration_worker.py worker_logger.py --embed
   # Then compile generated .c with your Python distutils/setuptools or a small setup.py
   ```
   Or use a dedicated script (e.g. `python-core/cython_build.py`) that builds each module to `.pyd` and places them in a `build/` directory; point PyInstaller at that directory so the exe uses `.pyd` instead of `.py`.
3. **Preserve interfaces:** Do not rename or change function/class names; Cython compiles the same API (e.g. `initialize_camera`, `load_annotation`, `transfer_keypoints_to_live`, `save_live_measurements`, `check_qc`).
4. **PyInstaller:** In `build_exe.py`, add the built `.pyd` files via `--add-data` or by having them on `sys.path` so they are collected into the onefile exe.

If you skip this step, the current PyInstaller-only build (plain `.py` bundled inside the exe) remains valid and requires no compiler on the client.

---

## 7. Production API handling (resilience)

- **Existing:** api-client already uses 30s timeout, retries (2 retries, 2s/5s delays), and distinguishes GraphQL errors from network errors.  
- **Enhancements (optional):**  
  - Increase timeout via env (e.g. `MAGICQC_API_TIMEOUT=45000`) and use exponential backoff (e.g. 3s, 6s, 12s) in `api-client.ts` if desired.  
  - Classify failures: network (ECONNREFUSED, ETIMEDOUT) vs auth (4xx from server) vs server error (5xx)—already partially done in `api-client.ts` (GraphQL errors not retried).  
  - Background health-check (ping) with auto-reconnect: main process already has connectivity/heartbeat logic; ensure it retries and clears “Authentication service unavailable” when the server becomes reachable again.

All URLs and keys remain from environment (apiConfig); no hardcoding that would break on client systems.

---

## 8. Installer and final deliverables

- **Target:** NSIS installer (or portable EXE) for Windows x64.  
- **Requirements:**  
  - App launches without external dependency installation.  
  - GraphQL/API authentication works (operator PIN from server).  
  - Measurement engine runs in headless mode; front and back side measurements save and sync to the database.  
  - Unit labels (cm/inch) reflect database values only.  
  - QC status updates in real time based only on measured (non-empty) values.

- **No changes:** UI flow, API schema, database logic, measurement pipeline behavior—only packaging, path resolution, and optional Cython compilation and API resilience.

---

## 9. Build commands summary

- **Python exe (build machine):**  
  `cd python-core && python build_exe.py`  
  → Produces `python-core/dist/magicqc_core.exe`.

- **Staged validation:**  
  `node scripts/validate-api.mjs`  
  (after Python exe exists and, if desired, after Electron build).

- **Electron + installer:**  
  `npm run build` (tsc, vite build, electron-builder)  
  or `npm run build:prod` (adds obfuscation and `--win`).

- **Full production pipeline:**  
  `npm run build:production` (or `build:production:prod` for obfuscated Win build).  
  This runs: Python exe build → Electron build → staged API validation (start Python exe, validate, stop).  
  To skip validation: `node scripts/build-production.mjs --no-validate`.

---

## 10. File paths quick reference (production)

- **APP_ROOT:** `process.resourcesPath` (e.g. `C:\Program Files\MagicQC\resources` or portable app resources folder).  
- **Python exe:** `APP_ROOT/python-core/dist/magicqc_core.exe`.  
- **Python PROJECT_ROOT:** `APP_ROOT/python-core/dist`.  
- **RESULTS_PATH (Flask/worker):** `APP_ROOT/python-core/dist/storage/measurement_results`.  
- **live_measurements.json:** `RESULTS_PATH/live_measurements.json`.  
- **Runtime dirs (Electron):** `APP_ROOT/runtime/logs`, `APP_ROOT/runtime/storage`, etc.  
- **.env:** `APP_ROOT/.env`.

This keeps the measurement-to-UI pipeline (write to RESULTS_PATH, poll via Flask) intact and ensures no relative path like `python-core/measurement_results` is used for live results.
