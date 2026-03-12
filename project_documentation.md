# MagicQC Operator Panel - Project & Architecture Documentation

## 1. Project Overview

**MagicQC Operator Panel** is an enterprise-grade Quality Control (QC) desktop application for garment measurement using high-resolution computer vision.
* **Current Version:** `1.5.1`
* **Purpose:** Provides a dual-screen operator experience where the main screen (Operator Panel) manages work orders, annotations, and measurement specifications, while a secondary screen displays the live high-resolution camera feed from a MindVision camera for real-time keypoint extraction and garment measurement.

## 2. Technology Stack & Architecture

### **Frontend & Application Shell (Electron + React)**
* **Core:** Node.js, Electron, Vite.
* **UI Framework:** React 18, TailwindCSS.
* **Responsibilities:** 
  * Renders the main Operator Panel window.
  * Manages application lifecycle ([main.ts](file:///d:/work/react/operatorPannel-main/electron/main.ts)).
  * Injects environment variables (like DPI-aware bounds `SECONDARY_SCREEN_WIDTH`/`HEIGHT` for the measurement display).
  * Runs API validation ([validate-api.mjs](file:///d:/work/react/operatorPannel-main/scripts/validate-api.mjs)) checking both internal health and MagicQC Cloud connectivity.
  * Spawns and supervises the Python Vision Core.

### **Vision Core (Python 3 + OpenCV)**
* **Core:** Python 3, Flask, OpenCV ([cv2](file:///d:/work/react/operatorPannel-main/python-core/calibration_worker.py#282-309)), MindVision SDK (`mvsdk`), Cython (for compiled `.pyd` extensions).
* **Packaging:** PyInstaller. (Transitions from `--onefile` to `--onedir` to prevent 10-30s extraction delay on startup).
* **Responsibilities:**
  * Runs a local API server on `localhost:5000` ([core_main.py](file:///d:/work/react/operatorPannel-main/python-core/core_main.py)).
  * Interfaces with the physical MindVision camera via low-level C-types.
  * Executes heavy CV workloads: edge/keypoint detection, coordinate mapping (pixels to cm), calibration tracking.
  * Manages the secondary fullscreen measurement/calibration window via OpenCV's `cv2.imshow` and `cv2.waitKey` event loops.
  * Writes structured output arrays to `live_measurements.json` for the frontend to poll asynchronously.

### **Communication Layer**
1. **REST API:** The React frontend triggers commands (e.g., "start measurement", "stop measurement", "calibrate") by calling the Flask endpoints spawned by [main.ts](file:///d:/work/react/operatorPannel-main/electron/main.ts).
2. **File Inter-Process Communication (IPC):** To handle high-frequency live measurement updates without saturating HTTP connections, the Python CV loop persistently writes to `live_measurements.json`. The React frontend ([ArticlesList.tsx](file:///d:/work/react/operatorPannel-main/src/components/ArticlesList.tsx)) polls this file every `500ms`.

---

## 3. Comprehensive Context of This Chat Session

The primary goal of this session was to stabilize the production release of the software on a specific client's Enterprise PC environment, resolving frustrating UX edge-cases and hardware integration bugs. 

**Below are the exact issues diagnosed and resolved:**

### A. Camera Connection Persistence & Stability
* **Issue:** Hitting "Stop", "Next", or using `Alt+F4` aggressively caused the USB camera to hard-reset, creating a Windows "Device disconnected/reconnected" chime and temporarily dropping the CV feed on subsequent starts.
* **Fix:** Intercepted SIGTERM/SIGINT signals in [measurement_worker.py](file:///d:/work/react/operatorPannel-main/python-core/measurement_worker.py) and introduced `_stopped_by_signal`. When stopped gracefully by the Node server, we nullify the camera handle and allow the OS to clean it up upon process exit, rather than forcing a heavy `CameraUnInit()`. This reduced stabilization delay from `2.0s` to `0.5s`, allowing operators to rapidly toggle between Front-side and Back-side measurements.

### B. Startup Performance & PC Frreze
* **Issue:** Launching the software or initiating the camera appeared to freeze the entire PC for 10-30 seconds.
* **Fix:** The issue was the PyInstaller `--onefile` configuration in [build_exe.py](file:///d:/work/react/operatorPannel-main/docs/build_exe.py). `--onefile` extracts an entire mini-OS and Python dist to a temp folder on *every launch*. We migrated the build pipeline to `--onedir`, resulting in an instant launch, and updated [main.ts](file:///d:/work/react/operatorPannel-main/electron/main.ts), [validate-api.mjs](file:///d:/work/react/operatorPannel-main/scripts/validate-api.mjs), and [electron-builder.json5](file:///d:/work/react/operatorPannel-main/electron-builder.json5) to route to `dist/magicqc_core/magicqc_core.exe`.

### C. CPU Resource Starvation
* **Issue:** The measurement screen would peg one or more CPU cores at 100%, contributing to system lag.
* **Fix:** Inside [integration.py](file:///d:/work/react/operatorPannel-main/python-core/integration.py), the `cv2.waitKey(1)` tight loop was causing unnecessary CPU burn. We changed it to `cv2.waitKey(8)`, which acts as a gentle ~120fps cap, yielding execution cycles to the OS (and the React frontend) with zero visual impact to the operator.

### D. DPI Awareness & Fullscreen Measurement Bugs
* **Issue:** The secondary measurement screen was not fully filling the monitor on the client's PC.
* **Fix:** The client's PC used Windows Display Scaling (e.g., 125% or 150%). Electron reported `bounds.width` in logical CSS pixels, but `cv2.resizeWindow` required physical pixels. Altered [main.ts](file:///d:/work/react/operatorPannel-main/electron/main.ts) to multiply the width/height bindings by the `Display.scaleFactor`, ensuring edge-to-edge coverage across all DPIs.

### E. Environment Agnostic Build Configuration
* **Issue:** Running PyInstaller remotely failed because [magicqc_core.spec](file:///d:/work/react/operatorPannel-main/docs/magicqc_core.spec) and [measurement_config.json](file:///d:/work/react/operatorPannel-main/measurement_config.json) contained hardcoded developer pathings (`D:\RJM\OPv2\...`).
* **Fix:** Cleared hardcoded JSON paths and altered the PyInstaller Spec's `pathex` to use relative directory markers (`.`). The frontend [main.ts](file:///d:/work/react/operatorPannel-main/electron/main.ts) now securely calculates `RESOURCE_ROOT` and injects an agnostic `MAGICQC_STORAGE_ROOT` environmental variable.

### F. Loading Screen Initialization
* **Issue:** Passing into measurement mode sometimes manifested a blank grey screen instead of the "Initializing Camera..." text loader.
* **Fix:** The Windows OS queue wasn't painted fast enough. Replaced `cv2.waitKey(1)` with three cycles of `cv2.waitKey(50)` in the initialization sequence to force the OS to paint the pre-loader frame.

### G. Live Measurement UI Synchronization Bug
* **Issue:** During live polling, if the CV engine could not detect a specific keypoint pair (e.g., Pair 2), the data for the *next* detected pair (Pair 3) was placed into Pair 2's UI container.
* **Fix:** Diagnosed a mismatch in [ArticlesList.tsx](file:///d:/work/react/operatorPannel-main/src/components/ArticlesList.tsx) for Back-side data processing. The code was dynamically collecting non-null values and assigning them sequentially to empty UI boxes. We refactored this block to utilize strict `spec_id`/`spec_code` mapping logic, perfectly mirroring the Front-side implementation. Undetected points now correctly remain empty, and subsequent successful points map strictly to their intended UI positions.

### H. Terminology Shift
* **Issue:** Changed "shirt" to "garment" in UI tooltips to account for varying apparel types (completed early in session).
