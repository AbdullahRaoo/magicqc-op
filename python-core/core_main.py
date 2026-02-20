"""
MagicQC Core - Unified entry point for all Python measurement services.

Usage:
  python core_main.py                                  # Start Flask API server
  python core_main.py --worker measurement             # Run measurement worker
  python core_main.py --worker calibration             # Run calibration worker
  python core_main.py --worker calibration --force-new # Force new calibration
"""
import sys
import os
import argparse

# ---------------------------------------------------------------------------
# Path constants â€” all paths are relative to the PROJECT ROOT (parent dir)
# Frozen (PyInstaller): sys.executable IS the .exe sitting in PROJECT_ROOT
# Dev:                   this file is at PROJECT_ROOT/python-core/core_main.py
# ---------------------------------------------------------------------------
def _get_project_root():
    """Resolve PROJECT_ROOT that works both in dev and PyInstaller frozen mode.
    Handles nested layout: in dev path is project/python-core/core_main.py; 
    in build path may be project/python-core/dist/magicqc_core.exe."""
    if getattr(sys, 'frozen', False):
        exe_path = os.path.abspath(sys.executable)
        exe_dir = os.path.dirname(exe_path)
        
        # Case A: EXE is inside dist/ (common in dev/build simulations)
        if os.path.basename(exe_dir) == 'dist':
            parent = os.path.dirname(exe_dir)
            # If parent is python-core, go one more up to reach true PROJECT_ROOT
            if os.path.basename(parent) == 'python-core':
                return os.path.dirname(parent)
            return parent
            
        # Case B: EXE is inside python-core/ (e.g. results of some build scripts)
        if os.path.basename(exe_dir) == 'python-core':
            return os.path.dirname(exe_dir)
            
        # Case C: Packaged production (EXE at root)
        return exe_dir
    else:
        # Dev mode: this file is at PROJECT_ROOT/python-core/core_main.py
        return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PROJECT_ROOT = _get_project_root()
# Support writable path redirection for Program Files installs
STORAGE_ROOT = os.environ.get('MAGICQC_STORAGE_ROOT', PROJECT_ROOT)

CORE_DIR = os.path.join(PROJECT_ROOT, 'python-core') if not getattr(sys, 'frozen', False) else os.path.dirname(sys.executable)

# Ensure python-core modules are importable in both dev and frozen mode
if not getattr(sys, 'frozen', False):
    _core_path = os.path.join(PROJECT_ROOT, 'python-core')
    if _core_path not in sys.path:
        sys.path.insert(0, _core_path)


def _dispatch_worker(args):
    """Dispatch to the requested worker subprocess."""
    if args.worker == 'measurement':
        # Module-level import triggers logging setup inside measurement_worker
        from measurement_worker import run_headless_measurement
        run_headless_measurement()

    elif args.worker == 'calibration':
        # Module-level import triggers logging setup inside calibration_worker
        from calibration_worker import main as calibration_main
        sys.exit(calibration_main(force_new=args.force_new, silent=args.silent))

    elif args.worker == 'registration':
        print("[ERR] Registration worker not yet implemented")
        sys.exit(1)


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
#  Flask API Server  (migrated from api_server.py â€” all routes preserved)
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

def run_api_server():
    """Start the Flask measurement API server."""

    # â”€â”€ Load .env from PROJECT ROOT â”€â”€
    try:
        from dotenv import load_dotenv
        load_dotenv(os.path.join(PROJECT_ROOT, '.env'))
    except ImportError:
        pass  # dotenv not installed â€” fall back to OS-level env vars

    # â”€â”€ File-based logging â”€â”€
    from worker_logger import setup_file_logging
    _logger = setup_file_logging('api_server')
    # All print() output now goes to logs/api_server.log

    try:
        from PIL import Image
        import io as _io
    except ImportError:
        print("[WARN] PIL not installed, run: pip install Pillow")

    import json
    import threading
    import time
    import base64
    from datetime import datetime
    from flask import Flask, request, jsonify
    from flask_cors import CORS
    import subprocess
    import signal
    import psutil

    # â”€â”€ Helper: build Windows-safe Popen kwargs â”€â”€
    def _hidden_popen_kwargs() -> dict:
        """Return extra keyword arguments for subprocess.Popen on Windows
        that guarantee NO console window is ever shown to the operator."""
        import platform
        if platform.system() != 'Windows':
            return {}

        si = subprocess.STARTUPINFO()
        si.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        si.wShowWindow = 0  # SW_HIDE

        return {
            'creationflags': (
                subprocess.CREATE_NO_WINDOW
            ),
            'startupinfo': si,
            'stdin': subprocess.DEVNULL,
            'stdout': subprocess.DEVNULL,
            'stderr': subprocess.DEVNULL,
        }

    app = Flask(__name__)
    CORS(app)  # Enable CORS for Laravel communication

    # â”€â”€ Configuration â€” all paths anchored to STORAGE_ROOT â”€â”€
    LARAVEL_STORAGE_PATH = os.environ.get('LARAVEL_STORAGE_PATH', os.path.join(STORAGE_ROOT, 'storage'))
    ANNOTATIONS_PATH = os.path.join(LARAVEL_STORAGE_PATH, 'annotations')

    # Local annotation storage (fallback)
    LOCAL_ANNOTATIONS_PATH = os.path.join(STORAGE_ROOT, 'temp_annotations')

    # Local storage for results
    # CRITICAL: Always use absolute paths so subprocess CWD doesn't affect resolution
    LOCAL_STORAGE_PATH = os.path.abspath(os.path.join(STORAGE_ROOT, 'storage'))
    RESULTS_PATH = os.path.abspath(os.path.join(LOCAL_STORAGE_PATH, 'measurement_results'))
    CONFIG_FILE = os.path.abspath(os.path.join(STORAGE_ROOT, 'measurement_config.json'))

    # Ensure directories exist
    os.makedirs(LOCAL_STORAGE_PATH, exist_ok=True)
    os.makedirs(RESULTS_PATH, exist_ok=True)
    os.makedirs(LOCAL_ANNOTATIONS_PATH, exist_ok=True)
    
    # Log absolute paths for debugging (critical for production path alignment)
    print(f"[PATH] PROJECT_ROOT: {PROJECT_ROOT}")
    print(f"[PATH] RESULTS_PATH (absolute): {RESULTS_PATH}")

    # â”€â”€ Global state â”€â”€
    measurement_process = None
    measurement_status = {
        'running': False,
        'annotation_name': None,
        'status': 'idle',
        'error': None,
        'start_time': None
    }

    def strip_base64_prefix(data):
        """Strip data URL prefix from base64 string."""
        if data and ',' in data and data.strip().startswith('data:'):
            return data.split(',', 1)[1]
        return data

    def decode_base64_image(image_data_raw):
        """Safely decode base64 image data, stripping data URL prefix if present."""
        clean_b64 = strip_base64_prefix(image_data_raw)
        return base64.b64decode(clean_b64)

    def verify_image_file(file_path):
        """Verify a written image file is a valid image readable by OpenCV."""
        try:
            import cv2
            img = cv2.imread(file_path)
            if img is not None:
                h, w = img.shape[:2]
                return True, w, h
            return False, 0, 0
        except Exception:
            return False, 0, 0

    def ensure_directories():
        """Ensure all required directories exist"""
        os.makedirs(RESULTS_PATH, exist_ok=True)
        print(f"[OK] Annotations directory (Laravel): {ANNOTATIONS_PATH}")
        print(f"[OK] Results directory: {RESULTS_PATH}")

    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    #  ROUTES
    # â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

    @app.route('/health', methods=['GET'])
    def health_check():
        """Health check endpoint"""
        return jsonify({
            'status': 'ok',
            'message': 'Python Measurement API is running',
            'timestamp': time.time()
        })

    @app.route('/api/measurement/status', methods=['GET'])
    def get_measurement_status():
        """
        Get current measurement status. Production contract: response MUST contain
        a top-level boolean 'running' field.
        """
        nonlocal measurement_process, measurement_status
        try:
            # Lifecycle sync: poll real process
            running = False
            if measurement_process is not None:
                if measurement_process.poll() is None:
                    running = True
                else:
                    # Worker exited
                    measurement_process = None
                    measurement_status['running'] = False
                    if not measurement_status.get('status') or measurement_status['status'] == 'running':
                        measurement_status['status'] = 'stopped'
            else:
                running = bool(measurement_status.get('running', False))

            # Build rigid production response schema
            response = {
                "running": running,
                "status": "success",
                "data": {
                    "running": running,
                    "annotation_name": measurement_status.get('annotation_name'),
                    "status": measurement_status.get('status', 'idle'),
                    "error": measurement_status.get('error'),
                    "start_time": measurement_status.get('start_time')
                }
            }
            return jsonify(response)
        except Exception as e:
            # Defensive fallback to prevent validation failure during exceptions
            return jsonify({
                "running": False,
                "status": "error",
                "data": {
                    "running": False,
                    "annotation_name": None,
                    "status": "error",
                    "error": str(e),
                    "start_time": None
                }
            })

    @app.route('/api/annotations/list', methods=['GET'])
    def list_annotations():
        """List all available annotations in Laravel storage"""
        try:
            annotations = []
            if os.path.exists(ANNOTATIONS_PATH):
                for item in os.listdir(ANNOTATIONS_PATH):
                    item_path = os.path.join(ANNOTATIONS_PATH, item)

                    if item.endswith('.json'):
                        base_name = item[:-5]
                        parts = base_name.rsplit('_', 1)

                        if len(parts) == 2:
                            article_style, size = parts
                        else:
                            article_style = base_name
                            size = 'unknown'

                        has_image = False
                        for ext in ['.jpg', '.jpeg', '.png', '.bmp']:
                            if os.path.exists(os.path.join(ANNOTATIONS_PATH, f"{base_name}{ext}")):
                                has_image = True
                                break

                        annotation_info = {
                            'name': base_name,
                            'article_style': article_style,
                            'size': size,
                            'format': 'file',
                            'has_annotation': True,
                            'has_image': has_image
                        }
                        annotations.append(annotation_info)

                    elif os.path.isdir(item_path):
                        annotation_info = {
                            'name': item,
                            'article_style': None,
                            'size': item,
                            'format': 'folder',
                            'has_front': os.path.exists(os.path.join(item_path, 'front_annotation.json')),
                            'has_back': os.path.exists(os.path.join(item_path, 'back_annotation.json')),
                            'has_front_image': os.path.exists(os.path.join(item_path, 'front_reference.jpg')),
                            'has_back_image': os.path.exists(os.path.join(item_path, 'back_reference.jpg'))
                        }
                        annotations.append(annotation_info)

            return jsonify({
                'status': 'success',
                'data': {
                    'annotations': annotations,
                    'count': len(annotations),
                    'path': ANNOTATIONS_PATH
                }
            })
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/annotations/export', methods=['POST'])
    def export_annotation():
        """Export annotation from Python annotations/ folder to Laravel storage"""
        try:
            data = request.json
            source_name = data.get('annotation_name')
            target_name = data.get('target_name', source_name)

            if not source_name:
                return jsonify({
                    'status': 'error',
                    'message': 'annotation_name is required'
                }), 400

            source_dir = os.path.join(PROJECT_ROOT, 'annotations', source_name)
            if not os.path.exists(source_dir):
                return jsonify({
                    'status': 'error',
                    'message': f'Annotation {source_name} not found in Python annotations'
                }), 404

            target_dir = os.path.join(ANNOTATIONS_PATH, target_name)
            os.makedirs(target_dir, exist_ok=True)

            import shutil
            copied_files = []

            files_to_copy = [
                'front_annotation.json',
                'front_reference.jpg',
                'back_annotation.json',
                'back_reference.jpg'
            ]

            for file_name in files_to_copy:
                source_file = os.path.join(source_dir, file_name)
                if os.path.exists(source_file):
                    target_file = os.path.join(target_dir, file_name)
                    shutil.copy2(source_file, target_file)
                    copied_files.append(file_name)

            return jsonify({
                'status': 'success',
                'message': f'Exported annotation to Laravel storage',
                'data': {
                    'source': source_name,
                    'target': target_name,
                    'copied_files': copied_files
                }
            })

        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/measurement/start', methods=['POST'])
    def start_measurement():
        """Start measurement with specified annotation"""
        nonlocal measurement_process, measurement_status

        try:
            data = request.json
            annotation_name = data.get('annotation_name')
            article_style = data.get('article_style')
            side = data.get('side', 'front')
            garment_color = data.get('garment_color', 'other')

            color_code = data.get('color_code', '')
            if not color_code:
                color_code_map = {'white': 'w', 'black': 'b', 'other': 'z'}
                color_code = color_code_map.get(garment_color, 'z')
            print(f"[API] Garment color: {garment_color}, color code: {color_code}")

            keypoints_pixels = data.get('keypoints_pixels')
            target_distances = data.get('target_distances')
            placement_box = data.get('placement_box')
            image_width = data.get('image_width')
            image_height = data.get('image_height')

            annotation_data = data.get('annotation_data')
            image_data = data.get('image_data')
            image_mime_type = data.get('image_mime_type')

            measurement_specs_raw = data.get('measurement_specs')
            measurement_specs = []
            if measurement_specs_raw:
                try:
                    measurement_specs = json.loads(measurement_specs_raw) if isinstance(measurement_specs_raw, str) else measurement_specs_raw
                    print(f"[API] Received {len(measurement_specs)} measurement specs from UI")
                except Exception as e:
                    print(f"[WARN] Could not parse measurement_specs: {e}")

            print(f"[API] Received request for {article_style}_{annotation_name}")
            print(f"[API] keypoints_pixels present: {keypoints_pixels is not None}")
            print(f"[API] target_distances present: {target_distances is not None}")
            if target_distances:
                print(f"[API] target_distances value: {target_distances[:200] if isinstance(target_distances, str) else target_distances}")
            print(f"[API] image dimensions: {image_width}x{image_height}")
            print(f"[API] image_data present: {image_data is not None}, length: {len(image_data) if image_data else 0}")

            if not annotation_name:
                return jsonify({
                    'status': 'error',
                    'message': 'annotation_name (size) is required'
                }), 400

            # Stop any existing measurement before starting a new one
            if measurement_status['running']:
                print(f"[API] Stopping existing measurement before starting new one...")
                if measurement_process:
                    try:
                        parent = psutil.Process(measurement_process.pid)
                        for child in parent.children(recursive=True):
                            child.kill()
                        parent.kill()
                    except Exception as e:
                        print(f"[WARN] Error stopping existing process: {e}")
                measurement_status['running'] = False
                time.sleep(0.5)

            # Clean stale live_measurements.json to prevent cached data leaking
            for stale_path in [
                os.path.join(RESULTS_PATH, 'live_measurements.json'),
                os.path.join(PROJECT_ROOT, 'measurement_results', 'live_measurements.json'),
            ]:
                if os.path.exists(stale_path):
                    try:
                        os.remove(stale_path)
                        print(f"[CLEANUP] Removed stale live data: {stale_path}")
                    except Exception as e:
                        print(f"[WARN] Could not remove stale file {stale_path}: {e}")

            annotation_json_path = None
            reference_image_path = None

            # PRIORITY 1: Use measurement-ready keypoints_pixels from database
            if keypoints_pixels and image_data:
                print(f"[DB] Using measurement-ready keypoints_pixels for {article_style}_{annotation_name}")

                temp_dir = os.path.join(STORAGE_ROOT, 'temp_annotations')  # STORAGE_ROOT is writable; PROJECT_ROOT may be read-only in Program Files
                os.makedirs(temp_dir, exist_ok=True)

                try:
                    ext_map = {
                        'image/jpeg': '.jpg',
                        'image/jpg': '.jpg',
                        'image/png': '.png',
                        'image/bmp': '.bmp',
                        'image/gif': '.gif'
                    }
                    ext = ext_map.get(image_mime_type, '.jpg')

                    safe_style = str(article_style).replace('/', '_').replace('\\', '_')
                    safe_name = str(annotation_name).replace('/', '_').replace('\\', '_')
                    color_suffix = f"-{color_code}" if color_code else ''
                    temp_image_path = os.path.join(temp_dir, f"{safe_style}_{safe_name}{color_suffix}{ext}")

                    image_bytes = decode_base64_image(image_data)

                    import cv2
                    import numpy as np

                    nparr = np.frombuffer(image_bytes, np.uint8)
                    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

                    if img is not None:
                        actual_h, actual_w = img.shape[:2]

                        NATIVE_WIDTH = 5472
                        NATIVE_HEIGHT = 2752

                        target_w = image_width if image_width and image_width > 1920 else NATIVE_WIDTH
                        target_h = image_height if image_height and image_height > 1080 else NATIVE_HEIGHT

                        if target_w == NATIVE_WIDTH and target_h == 1080:
                            print(f"[BUGFIX] Detected incomplete scaling in database ({NATIVE_WIDTH}x1080)")
                            print(f"[BUGFIX] Correcting target height from 1080 to {NATIVE_HEIGHT}")
                            target_h = NATIVE_HEIGHT

                        print(f"[DB] Reference image actual size: {actual_w}x{actual_h}")
                        print(f"[DB] Target size (native camera): {target_w}x{target_h}")

                        if actual_w < target_w or actual_h < target_h:
                            print(f"[DB] UPSCALING reference image from {actual_w}x{actual_h} to {target_w}x{target_h}")
                            img_upscaled = cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

                            upscaled_h, upscaled_w = img_upscaled.shape[:2]
                            print(f"[DB] Upscaled result: {upscaled_w}x{upscaled_h}")

                            if ext in ['.jpg', '.jpeg']:
                                _, img_encoded = cv2.imencode('.jpg', img_upscaled, [cv2.IMWRITE_JPEG_QUALITY, 95])
                            else:
                                _, img_encoded = cv2.imencode(ext, img_upscaled)

                            image_bytes = img_encoded.tobytes()
                            print(f"[DB] Upscaled image size: {len(image_bytes)} bytes")
                        else:
                            print(f"[DB] Image already at target resolution, no upscale needed")

                    with open(temp_image_path, 'wb') as f:
                        f.write(image_bytes)
                        f.flush()
                        os.fsync(f.fileno())
                    reference_image_path = os.path.abspath(temp_image_path)
                    print(f"[DB] Wrote reference image to: {reference_image_path} ({len(image_bytes)} bytes)")

                    img_ok, img_w, img_h = verify_image_file(reference_image_path)
                    if not img_ok:
                        print(f"[ERR] Written image file FAILED OpenCV verification: {reference_image_path}")
                        print(f"[ERR] File size: {os.path.getsize(reference_image_path)} bytes")
                        header = image_bytes[:16] if image_bytes else b''
                        print(f"[ERR] First 16 bytes (hex): {header.hex()}")
                        return jsonify({
                            'status': 'error',
                            'message': 'Reference image file is corrupted or unreadable by OpenCV'
                        }), 400
                    else:
                        print(f"[DB] Image verification PASSED: {img_w}x{img_h}")

                except Exception as e:
                    print(f"[ERR] Failed to decode/write image: {e}")
                    return jsonify({
                        'status': 'error',
                        'message': f'Failed to process image data: {str(e)}'
                    }), 400

                # Build measurement annotation from database data
                temp_json_path = os.path.join(temp_dir, f"{safe_style}_{safe_name}{color_suffix}.json")
                try:
                    if isinstance(keypoints_pixels, str):
                        keypoints = json.loads(keypoints_pixels)
                    else:
                        keypoints = keypoints_pixels or []

                    if isinstance(target_distances, str):
                        targets = json.loads(target_distances) if target_distances else {}
                    else:
                        targets = target_distances or {}

                    if isinstance(placement_box, str):
                        box = json.loads(placement_box) if placement_box else []
                    else:
                        box = placement_box or []

                    print(f"[DB] Loaded {len(keypoints)} keypoints (pixels)")
                    print(f"[DB] Loaded {len(targets)} target distances")
                    print(f"[DB] Placement box: {box}")

                    measurement_annotation = {
                        'keypoints': keypoints,
                        'target_distances': targets,
                        'placement_box': box,
                        'annotation_date': datetime.now().isoformat(),
                        'source': 'database',
                        'article_style': article_style,
                        'size': annotation_name
                    }

                    with open(temp_json_path, 'w') as f:
                        json.dump(measurement_annotation, f, indent=4)
                    annotation_json_path = temp_json_path
                    print(f"[DB] Wrote annotation JSON to: {temp_json_path}")

                except Exception as e:
                    print(f"[ERR] Failed to process annotation data: {e}")
                    import traceback
                    traceback.print_exc()
                    return jsonify({
                        'status': 'error',
                        'message': f'Failed to process annotation data: {str(e)}'
                    }), 400

            # PRIORITY 2: Fallback - use percentage annotations and convert
            elif annotation_data and image_data:
                print(f"[DB] Using percentage annotations (fallback) for {article_style}_{annotation_name}")

                temp_dir = os.path.join(STORAGE_ROOT, 'temp_annotations')  # STORAGE_ROOT is writable; PROJECT_ROOT may be read-only in Program Files
                os.makedirs(temp_dir, exist_ok=True)

                try:
                    ext_map = {
                        'image/jpeg': '.jpg',
                        'image/jpg': '.jpg',
                        'image/png': '.png',
                        'image/bmp': '.bmp',
                        'image/gif': '.gif'
                    }
                    ext = ext_map.get(image_mime_type, '.jpg')
                    safe_p2_style = str(article_style).replace('/', '_').replace('\\', '_')
                    safe_p2_name = str(annotation_name).replace('/', '_').replace('\\', '_')
                    color_suffix_p2 = f"-{color_code}" if color_code else ''
                    temp_image_path = os.path.join(temp_dir, f"{safe_p2_style}_{safe_p2_name}{color_suffix_p2}{ext}")

                    image_bytes = decode_base64_image(image_data)
                    with open(temp_image_path, 'wb') as f:
                        f.write(image_bytes)
                        f.flush()
                        os.fsync(f.fileno())
                    reference_image_path = os.path.abspath(temp_image_path)

                    from PIL import Image as PILImage
                    import io as _io
                    pil_img = PILImage.open(_io.BytesIO(image_bytes))
                    pil_img_width, pil_img_height = pil_img.size
                    print(f"[DB] Reference image dimensions: {pil_img_width}x{pil_img_height}")

                    if isinstance(annotation_data, str):
                        db_annotations = json.loads(annotation_data)
                    else:
                        db_annotations = annotation_data

                    keypoints = []
                    for point in db_annotations:
                        x_percent = float(point.get('x', 0))
                        y_percent = float(point.get('y', 0))
                        x_pixel = int((x_percent / 100.0) * pil_img_width)
                        y_pixel = int((y_percent / 100.0) * pil_img_height)
                        keypoints.append([x_pixel, y_pixel])
                        print(f"[DB] Point '{point.get('label', 'unknown')}': ({x_percent}%, {y_percent}%) -> ({x_pixel}, {y_pixel}) px")

                    temp_json_path = os.path.join(temp_dir, f"{safe_p2_style}_{safe_p2_name}{color_suffix_p2}.json")
                    measurement_annotation = {
                        'keypoints': keypoints,
                        'target_distances': {},
                        'placement_box': [],
                        'annotation_date': datetime.now().isoformat(),
                        'source': 'database_converted',
                        'article_style': article_style,
                        'size': annotation_name
                    }

                    with open(temp_json_path, 'w') as f:
                        json.dump(measurement_annotation, f, indent=4)
                    annotation_json_path = temp_json_path
                    print(f"[DB] Wrote converted annotation JSON to: {temp_json_path}")

                except Exception as e:
                    print(f"[ERR] Failed to convert annotation data: {e}")
                    import traceback
                    traceback.print_exc()
                    return jsonify({
                        'status': 'error',
                        'message': f'Failed to process annotation data: {str(e)}'
                    }), 400

            # PRIORITY 2.5: Use keypoints from database (with or without local image)
            elif keypoints_pixels and not image_data:
                print(f"[DB+FILE] Using keypoints from database for {article_style}_{annotation_name} ({side})")

                temp_dir = os.path.join(STORAGE_ROOT, 'temp_annotations')  # STORAGE_ROOT is writable; PROJECT_ROOT may be read-only in Program Files
                os.makedirs(temp_dir, exist_ok=True)

                safe_style = str(article_style).replace('/', '_').replace('\\', '_')
                safe_name = str(annotation_name).replace('/', '_').replace('\\', '_')

                search_dirs = [ANNOTATIONS_PATH, LOCAL_ANNOTATIONS_PATH]
                found_image_path = None

                for search_dir in search_dirs:
                    if not os.path.exists(search_dir):
                        continue
                    for ext in ['.jpg', '.jpeg', '.png', '.bmp']:
                        potential_image = os.path.join(search_dir, f"{safe_style}_{safe_name}_{side}{ext}")
                        if os.path.exists(potential_image):
                            found_image_path = potential_image
                            break
                    if found_image_path:
                        break

                if not found_image_path:
                    for search_dir in search_dirs:
                        if not os.path.exists(search_dir):
                            continue
                        for ext in ['.jpg', '.jpeg', '.png', '.bmp']:
                            potential_image = os.path.join(search_dir, f"{safe_style}_{safe_name}{ext}")
                            if os.path.exists(potential_image):
                                found_image_path = potential_image
                                break
                        if found_image_path:
                            break

                if found_image_path:
                    reference_image_path = found_image_path
                    print(f"[DB+FILE] Found local reference image: {found_image_path}")
                else:
                    print(f"[DB+FILE] No local reference image found, proceeding with keypoints only (camera will provide live view)")

                try:
                    if isinstance(keypoints_pixels, str):
                        keypoints = json.loads(keypoints_pixels)
                    else:
                        keypoints = keypoints_pixels or []

                    if isinstance(target_distances, str):
                        targets = json.loads(target_distances) if target_distances else {}
                    else:
                        targets = target_distances or {}

                    if isinstance(placement_box, str):
                        box = json.loads(placement_box) if placement_box else []
                    else:
                        box = placement_box or []

                    print(f"[DB+FILE] Loaded {len(keypoints)} keypoints from database")

                    color_suffix_p25 = f"-{color_code}" if color_code else ''
                    temp_json_path = os.path.join(temp_dir, f"{safe_style}_{safe_name}_{side}{color_suffix_p25}.json")
                    measurement_annotation = {
                        'keypoints': keypoints,
                        'target_distances': targets,
                        'placement_box': box,
                        'annotation_date': datetime.now().isoformat(),
                        'source': 'database_keypoints' if not found_image_path else 'database_with_local_image',
                        'article_style': article_style,
                        'size': annotation_name,
                        'side': side
                    }

                    with open(temp_json_path, 'w') as f:
                        json.dump(measurement_annotation, f, indent=4)
                    annotation_json_path = temp_json_path
                    print(f"[DB+FILE] Wrote annotation JSON to: {temp_json_path}")

                except Exception as e:
                    print(f"[ERR] Failed to process database keypoints: {e}")
                    import traceback
                    traceback.print_exc()

            # PRIORITY 3: File-based annotation lookup (fallback)
            if not annotation_json_path:
                if article_style:
                    safe_style = str(article_style).replace('/', '_').replace('\\', '_')
                    safe_name = str(annotation_name).replace('/', '_').replace('\\', '_')

                    base_name_with_side = f"{safe_style}_{safe_name}_{side}"
                    base_name_generic = f"{safe_style}_{safe_name}"

                    search_dirs = [ANNOTATIONS_PATH, LOCAL_ANNOTATIONS_PATH]

                    for search_dir in search_dirs:
                        if not os.path.exists(search_dir):
                            continue

                        json_file = os.path.join(search_dir, f"{base_name_with_side}.json")

                        if os.path.exists(json_file):
                            annotation_json_path = json_file

                            for ext in ['.jpg', '.jpeg', '.png', '.bmp']:
                                potential_image = os.path.join(search_dir, f"{base_name_with_side}{ext}")
                                if os.path.exists(potential_image):
                                    reference_image_path = potential_image
                                    break

                            print(f"[ANNOTATION] Found side-specific annotation ({side}): {json_file}")
                            if reference_image_path:
                                print(f"[ANNOTATION] Found side-specific reference image: {reference_image_path}")
                            break

                    if not annotation_json_path:
                        for search_dir in search_dirs:
                            if not os.path.exists(search_dir):
                                continue

                            json_file = os.path.join(search_dir, f"{base_name_generic}.json")

                            if os.path.exists(json_file):
                                annotation_json_path = json_file

                                for ext in ['.jpg', '.jpeg', '.png', '.bmp']:
                                    potential_image = os.path.join(search_dir, f"{base_name_generic}{ext}")
                                    if os.path.exists(potential_image):
                                        reference_image_path = potential_image
                                        break

                                print(f"[ANNOTATION] Found generic annotation (for {side}): {json_file}")
                                if reference_image_path:
                                    print(f"[ANNOTATION] Found generic reference image: {reference_image_path}")
                                break

            # Fallback: Try size-only naming (backward compatible)
            if not annotation_json_path:
                base_name = annotation_name

                for search_dir in [ANNOTATIONS_PATH, LOCAL_ANNOTATIONS_PATH]:
                    if not os.path.exists(search_dir):
                        continue

                    json_file = os.path.join(search_dir, f"{base_name}.json")

                    if os.path.exists(json_file):
                        annotation_json_path = json_file
                        for ext in ['.jpg', '.jpeg', '.png', '.bmp']:
                            potential_image = os.path.join(search_dir, f"{base_name}{ext}")
                            if os.path.exists(potential_image):
                                reference_image_path = potential_image
                                break
                        print(f"[ANNOTATION] Using size-only annotation: {json_file}")
                        break

            # Also check folder-based structure as additional fallback
            if not annotation_json_path:
                if article_style:
                    folder_path = os.path.join(ANNOTATIONS_PATH, article_style, annotation_name)
                    folder_json = os.path.join(folder_path, f'{side}_annotation.json')
                    folder_image = os.path.join(folder_path, f'{side}_reference.jpg')

                    if os.path.exists(folder_json):
                        annotation_json_path = folder_json
                        if os.path.exists(folder_image):
                            reference_image_path = folder_image
                        print(f"[ANNOTATION] Using folder-based annotation ({side}): {folder_json}")

                if not annotation_json_path:
                    folder_path = os.path.join(ANNOTATIONS_PATH, annotation_name)
                    folder_json = os.path.join(folder_path, f'{side}_annotation.json')
                    folder_image = os.path.join(folder_path, f'{side}_reference.jpg')

                    if os.path.exists(folder_json):
                        annotation_json_path = folder_json
                        if os.path.exists(folder_image):
                            reference_image_path = folder_image
                        print(f"[ANNOTATION] Using size folder annotation ({side}): {folder_json}")

            # Special case for staged API validation (node scripts/validate-api.mjs)
            if not annotation_json_path and annotation_name == '__validation__':
                print("[VALIDATION] Creating dummy annotation for API check")
                temp_dir = os.path.join(STORAGE_ROOT, 'temp_annotations')  # STORAGE_ROOT is writable; PROJECT_ROOT may be read-only in Program Files
                os.makedirs(temp_dir, exist_ok=True)
                annotation_json_path = os.path.join(temp_dir, '__validation__.json')
                with open(annotation_json_path, 'w') as f:
                    json.dump({
                        'keypoints': [[100, 100], [200, 200]],
                        'target_distances': {'1': 10.0},
                        'annotation_date': datetime.now().isoformat()
                    }, f)

            if not annotation_json_path:
                return jsonify({
                    'status': 'error',
                    'message': f'Annotation not found. No database data provided and no file found for: {article_style}_{annotation_name}'
                }), 404

            # Create config file for measurement script
            config = {
                'annotation_name': annotation_name,
                'article_style': article_style,
                'annotation_json_path': os.path.abspath(annotation_json_path) if annotation_json_path else None,
                'reference_image_path': os.path.abspath(reference_image_path) if reference_image_path else None,
                'side': side,
                'garment_color': garment_color,
                'laravel_storage': LARAVEL_STORAGE_PATH,
                'results_path': RESULTS_PATH,  # Already absolute from initialization
                'measurement_specs': measurement_specs
            }

            print(f"[CONFIG] Annotation JSON: {annotation_json_path}")
            print(f"[CONFIG] Reference Image: {reference_image_path}")

            with open(CONFIG_FILE, 'w') as f:
                json.dump(config, f, indent=4)

            # Update status
            measurement_status.update({
                'running': True,
                'annotation_name': annotation_name,
                'status': 'starting',
                'error': None,
                'start_time': time.time()
            })

            # Start measurement in background thread
            def run_measurement():
                nonlocal measurement_process, measurement_status
                try:
                    # Spawn worker via core_main.py --worker measurement
                    # Frozen: sys.executable IS core_main.exe â†’ pass args directly
                    # Dev:    sys.executable is python.exe â†’ need script path
                    if getattr(sys, 'frozen', False):
                        worker_cmd = [sys.executable, '--worker', 'measurement']
                    else:
                        worker_cmd = [sys.executable, os.path.abspath(__file__), '--worker', 'measurement']
                    measurement_process = subprocess.Popen(
                        worker_cmd,
                        **_hidden_popen_kwargs(),
                        env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                        cwd=STORAGE_ROOT  # writable; PROJECT_ROOT may be read-only in prod
                    )
                    print(f"[MEASUREMENT] Started worker with PID: {measurement_process.pid}")

                    measurement_status['status'] = 'running'

                    measurement_process.wait()

                    if measurement_process.returncode == 0:
                        measurement_status['status'] = 'completed'
                    else:
                        measurement_status['status'] = 'failed'
                        measurement_status['error'] = f'Measurement script exited with code {measurement_process.returncode}'

                except Exception as e:
                    measurement_status['status'] = 'failed'
                    measurement_status['error'] = str(e)
                finally:
                    measurement_status['running'] = False
                    measurement_process = None

            thread = threading.Thread(target=run_measurement)
            thread.daemon = True
            thread.start()

            return jsonify({
                'status': 'success',
                'message': 'Measurement started',
                'data': {
                    'annotation_name': annotation_name,
                    'side': side
                }
            })

        except Exception as e:
            measurement_status['running'] = False
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/measurement/stop', methods=['POST'])
    def stop_measurement():
        """Stop running measurement"""
        nonlocal measurement_process, measurement_status

        try:
            if not measurement_status['running']:
                return jsonify({
                    'status': 'error',
                    'message': 'No measurement is running'
                }), 400

            if measurement_process:
                try:
                    parent = psutil.Process(measurement_process.pid)
                    for child in parent.children(recursive=True):
                        child.kill()
                    parent.kill()
                except:
                    pass

            measurement_status.update({
                'running': False,
                'annotation_name': None,
                'status': 'stopped',
                'error': None,
                'start_time': None
            })

            return jsonify({
                'status': 'success',
                'message': 'Measurement stopped'
            })

        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/results/live', methods=['GET'])
    def get_live_measurements():
        """Get current live measurements. Strictly uses absolute RESULTS_PATH."""
        try:
            live_file = os.path.join(RESULTS_PATH, 'live_measurements.json')

            if not os.path.exists(live_file):
                # Defensive fallback: return a valid empty schema instead of 404
                return jsonify({
                    'status': 'waiting',
                    'message': 'Measurement file not yet generated',
                    'data': {
                        'timestamp': datetime.now().isoformat(),
                        'measurements': [],
                        'is_live': False
                    }
                })

            file_age = time.time() - os.path.getmtime(live_file)
            
            with open(live_file, 'r') as f:
                data = json.load(f)
            
            # Enrich with real-time metadata
            data['file_age_seconds'] = round(file_age, 1)
            data['is_live'] = file_age < 30
            
            return jsonify({
                'status': 'success',
                'data': data
            })

        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e),
                'measurements': []
            }), 500

    @app.route('/api/results/latest', methods=['GET'])
    def get_latest_results():
        """Get latest measurement results"""
        try:
            result_files = []
            if os.path.exists(RESULTS_PATH):
                for file in os.listdir(RESULTS_PATH):
                    if file.endswith('.json'):
                        file_path = os.path.join(RESULTS_PATH, file)
                        result_files.append((file_path, os.path.getmtime(file_path)))

            if not result_files:
                return jsonify({
                    'status': 'success',
                    'data': None,
                    'message': 'No results found'
                })

            latest_file = max(result_files, key=lambda x: x[1])[0]

            with open(latest_file, 'r') as f:
                results = json.load(f)

            return jsonify({
                'status': 'success',
                'data': results
            })

        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/calibration/status', methods=['GET'])
    def get_calibration_status():
        """Check if calibration exists"""
        # STORAGE_ROOT is always writable (userData on Program Files installs).
        # Electron migrates the template from PROJECT_ROOT to STORAGE_ROOT on first launch.
        calibration_file = os.path.join(STORAGE_ROOT, 'camera_calibration.json')
        if not os.path.exists(calibration_file):
            # Fallback to PROJECT_ROOT template (resources/ in prod, project root in dev)
            calibration_file = os.path.join(PROJECT_ROOT, 'camera_calibration.json')
        exists = os.path.exists(calibration_file)

        if exists:
            with open(calibration_file, 'r') as f:
                calibration_data = json.load(f)
            return jsonify({
                'status': 'success',
                'data': {
                    'calibrated': calibration_data.get('is_calibrated', False),
                    'pixels_per_cm': calibration_data.get('pixels_per_cm', 0),
                    'reference_length_cm': calibration_data.get('reference_length_cm', 0),
                    'calibration_date': calibration_data.get('calibration_date', None)
                }
            })
        else:
            return jsonify({
                'status': 'success',
                'data': {
                    'calibrated': False
                }
            })

    @app.route('/api/calibration/upload', methods=['POST'])
    def upload_calibration():
        """Upload a calibration JSON file"""
        try:
            data = request.get_json()

            if not data:
                return jsonify({'status': 'error', 'message': 'No data provided'})

            pixels_per_cm = data.get('pixels_per_cm')
            reference_length_cm = data.get('reference_length_cm', 0)
            is_calibrated = data.get('is_calibrated', False)

            if not pixels_per_cm or float(pixels_per_cm) <= 0:
                return jsonify({'status': 'error', 'message': 'Invalid pixels_per_cm value. Must be a positive number.'})

            calibration_data = {
                'pixels_per_cm': float(pixels_per_cm),
                'reference_length_cm': float(reference_length_cm) if reference_length_cm else 0,
                'is_calibrated': bool(is_calibrated),
                'calibration_date': datetime.now().isoformat()
            }

            # Write to STORAGE_ROOT — always writable, even under Program Files.
            calibration_file = os.path.join(STORAGE_ROOT, 'camera_calibration.json')
            with open(calibration_file, 'w') as f:
                json.dump(calibration_data, f, indent=4)

            print(f"[CALIBRATION] Uploaded calibration to {calibration_file}: {calibration_data}")

            return jsonify({
                'status': 'success',
                'message': 'Calibration uploaded successfully',
                'data': calibration_data
            })
        except ValueError as e:
            return jsonify({'status': 'error', 'message': f'Invalid number format: {str(e)}'})
        except Exception as e:
            print(f"[CALIBRATION] Upload error: {e}")
            return jsonify({'status': 'error', 'message': str(e)})

    # â”€â”€ Calibration process state â”€â”€
    calibration_process = None
    calibration_status = {
        'running': False,
        'status': 'idle',
        'error': None
    }

    @app.route('/api/calibration/start', methods=['POST'])
    def start_calibration():
        """Start camera calibration process"""
        nonlocal calibration_process, calibration_status

        if calibration_status['running']:
            return jsonify({
                'status': 'error',
                'message': 'Calibration is already in progress'
            }), 409

        calibration_status = {
            'running': True,
            'status': 'starting',
            'error': None
        }

        def run_calibration():
            nonlocal calibration_process, calibration_status
            try:
                calibration_status['status'] = 'running'

                if getattr(sys, 'frozen', False):
                    cal_cmd = [sys.executable, '--worker', 'calibration', '--force-new']
                else:
                    cal_cmd = [sys.executable, os.path.abspath(__file__), '--worker', 'calibration', '--force-new']
                calibration_process = subprocess.Popen(
                    cal_cmd,
                    **_hidden_popen_kwargs(),
                    env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                    cwd=STORAGE_ROOT  # writable; PROJECT_ROOT may be read-only in prod
                )

                calibration_process.wait()

                if calibration_process.returncode == 0:
                    calibration_status['status'] = 'completed'
                else:
                    calibration_status['status'] = 'failed'
                    calibration_status['error'] = f'Calibration exited with code {calibration_process.returncode}'
            except Exception as e:
                calibration_status['status'] = 'failed'
                calibration_status['error'] = str(e)
            finally:
                calibration_status['running'] = False
                calibration_process = None

        thread = threading.Thread(target=run_calibration)
        thread.daemon = True
        thread.start()

        return jsonify({
            'status': 'success',
            'message': 'Camera calibration started'
        })

    @app.route('/api/calibration/cancel', methods=['POST'])
    def cancel_calibration():
        """Cancel ongoing calibration"""
        nonlocal calibration_process, calibration_status

        if calibration_process:
            try:
                calibration_process.terminate()
            except:
                pass

        calibration_status = {
            'running': False,
            'status': 'cancelled',
            'error': None
        }

        return jsonify({
            'status': 'success',
            'message': 'Calibration cancelled'
        })

    @app.route('/api/annotation/<size>/measurements', methods=['GET'])
    def get_annotation_measurements(size):
        """Get measurement data from annotation file for a specific size"""
        annotation_dir = os.path.join(ANNOTATIONS_PATH, size)

        if not os.path.exists(annotation_dir):
            return jsonify({
                'status': 'error',
                'message': f'No annotation found for size {size}'
            }), 404

        front_annotation = os.path.join(annotation_dir, 'front_annotation.json')

        if not os.path.exists(front_annotation):
            return jsonify({
                'status': 'error',
                'message': f'No front annotation found for size {size}'
            }), 404

        try:
            with open(front_annotation, 'r') as f:
                annotation_data_file = json.load(f)

            reference_distances = annotation_data_file.get('reference_distances', [])
            keypoint_names = annotation_data_file.get('keypoint_names', [])

            measurements = []
            for i, distance in enumerate(reference_distances):
                if keypoint_names and i < len(keypoint_names):
                    name = keypoint_names[i]
                else:
                    name = f'Measurement {i + 1}'

                measurements.append({
                    'id': i + 1,
                    'name': name,
                    'actual_cm': round(distance, 2),
                    'tolerance_plus': 1.0,
                    'tolerance_minus': 1.0
                })

            return jsonify({
                'status': 'success',
                'data': {
                    'size': size,
                    'measurements': measurements,
                    'total_measurements': len(measurements)
                }
            })
        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': f'Error reading annotation: {str(e)}'
            }), 500

    # â”€â”€ Registration process state â”€â”€
    registration_process = None
    registration_status = {
        'running': False,
        'size': None,
        'status': 'idle',
        'error': None,
        'step': None
    }

    @app.route('/api/register/start', methods=['POST'])
    def start_registration():
        """Start shirt registration process"""
        nonlocal registration_process, registration_status

        try:
            data = request.json
            size = data.get('size')

            valid_sizes = ['S', 'M', 'L', 'XL', 'XXL']
            if not size or size not in valid_sizes:
                return jsonify({
                    'status': 'error',
                    'message': f'Invalid size. Must be one of: {", ".join(valid_sizes)}'
                }), 400

            if registration_status['running']:
                return jsonify({
                    'status': 'error',
                    'message': 'Registration is already in progress'
                }), 400

            annotation_dir = os.path.join(ANNOTATIONS_PATH, size)
            if os.path.exists(annotation_dir):
                overwrite = data.get('overwrite', False)
                if not overwrite:
                    return jsonify({
                        'status': 'error',
                        'message': f'Annotation for size {size} already exists. Set overwrite=true to replace.'
                    }), 400

            # Write to STORAGE_ROOT — always writable, even under Program Files.
            reg_config_file = os.path.join(STORAGE_ROOT, 'registration_config.json')
            config = {
                'size': size,
                'annotation_path': annotation_dir,
                'laravel_storage': LARAVEL_STORAGE_PATH,
                'annotations_path': ANNOTATIONS_PATH
            }

            with open(reg_config_file, 'w') as f:
                json.dump(config, f, indent=4)

            registration_status = {
                'running': True,
                'size': size,
                'status': 'starting',
                'error': None,
                'step': 'initializing'
            }

            def run_registration():
                nonlocal registration_process, registration_status
                try:
                    registration_status['step'] = 'running'

                    if getattr(sys, 'frozen', False):
                        reg_cmd = [sys.executable, '--worker', 'registration']
                    else:
                        reg_cmd = [sys.executable, os.path.abspath(__file__), '--worker', 'registration']
                    registration_process = subprocess.Popen(
                        reg_cmd,
                        **_hidden_popen_kwargs(),
                        env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
                        cwd=STORAGE_ROOT  # writable; PROJECT_ROOT may be read-only in prod
                    )

                    registration_process.wait()

                    if registration_process.returncode == 0:
                        registration_status['status'] = 'completed'
                        registration_status['step'] = 'completed'
                    else:
                        registration_status['status'] = 'failed'
                        registration_status['error'] = f'Registration script exited with code {registration_process.returncode}'
                        registration_status['step'] = 'failed'

                except Exception as e:
                    registration_status['status'] = 'failed'
                    registration_status['error'] = str(e)
                    registration_status['step'] = 'failed'
                finally:
                    registration_status['running'] = False
                    registration_process = None

            thread = threading.Thread(target=run_registration)
            thread.daemon = True
            thread.start()

            return jsonify({
                'status': 'success',
                'message': f'Shirt registration started for size {size}',
                'data': {
                    'size': size,
                    'instructions': 'The Python registration window will open. Follow the on-screen instructions to capture and annotate the shirt.'
                }
            })

        except Exception as e:
            registration_status['running'] = False
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    @app.route('/api/register/status', methods=['GET'])
    def get_registration_status():
        """Get current registration status"""
        return jsonify({
            'status': 'success',
            'data': registration_status
        })

    @app.route('/api/register/cancel', methods=['POST'])
    def cancel_registration():
        """Cancel ongoing registration"""
        nonlocal registration_process, registration_status

        try:
            if not registration_status['running']:
                return jsonify({
                    'status': 'error',
                    'message': 'No registration is running'
                }), 400

            if registration_process:
                try:
                    parent = psutil.Process(registration_process.pid)
                    for child in parent.children(recursive=True):
                        child.kill()
                    parent.kill()
                except:
                    pass

            registration_status = {
                'running': False,
                'size': None,
                'status': 'cancelled',
                'error': None,
                'step': 'cancelled'
            }

            return jsonify({
                'status': 'success',
                'message': 'Registration cancelled'
            })

        except Exception as e:
            return jsonify({
                'status': 'error',
                'message': str(e)
            }), 500

    # â”€â”€ Start server â”€â”€
    API_PORT = int(os.environ.get('PYTHON_API_PORT', '5000'))

    print("=" * 60)
    print("[START] CAMERA MEASUREMENT API SERVER")
    print("=" * 60)
    print(f"[DIR] Local Storage: {LOCAL_STORAGE_PATH}")
    print(f"[DIR] Laravel Storage: {LARAVEL_STORAGE_PATH}")
    print(f"[PTS] Annotations: {ANNOTATIONS_PATH}")
    print(f"[STAT] Results: {RESULTS_PATH}")
    print("=" * 60)

    ensure_directories()

    print(f"\n[OK] Server starting on http://127.0.0.1:{API_PORT}")
    print("[API] Laravel can now communicate with the measurement system\n")

    app.run(host='127.0.0.1', port=API_PORT, debug=False, use_reloader=False)


# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
#  Entry point
# â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

def main():
    parser = argparse.ArgumentParser(description='MagicQC Core - Unified Python Entry Point')
    parser.add_argument('--worker', choices=['measurement', 'calibration', 'registration'],
                        help='Run as a worker subprocess instead of the API server')
    parser.add_argument('--force-new', action='store_true',
                        help='Force new calibration (calibration worker only)')
    parser.add_argument('--silent', action='store_true',
                        help='Minimal output (calibration worker only)')
    args = parser.parse_args()

    if args.worker:
        _dispatch_worker(args)
    else:
        run_api_server()


if __name__ == '__main__':
    main()
