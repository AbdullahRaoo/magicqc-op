"""
Measurement Worker - Bridge between api_server.py and the new CV engine (integration.py)
Spawned as a subprocess by api_server.py when measurement is requested.
Reads config from measurement_config.json, initializes the CV engine, and runs live measurement.
Writes live results to measurement_results/live_measurements.json for UI polling.
"""
# ── MUST BE FIRST: redirect ALL stdout/stderr to log file before any prints ──
import sys, os
os.environ['PYTHONIOENCODING'] = 'utf-8'

from worker_logger import setup_file_logging
_logger = setup_file_logging('measurement')
# ── From this point on, every print() goes to logs/measurement.log ──

import json
import time

# Import the new CV engine from integration.py
from integration import LiveKeypointDistanceMeasurer


def run_headless_measurement():
    """Run measurement in headless mode (no interactive prompts) driven by API config."""
    config_file = 'measurement_config.json'
    if not os.path.exists(config_file):
        print(f"[ERR] Config file {config_file} not found")
        sys.exit(1)

    try:
        with open(config_file, 'r') as f:
            config = json.load(f)

        annotation_name = config.get('annotation_name')       # Size (e.g., 'XXL')
        article_style = config.get('article_style')            # Article style (e.g., 'NKE-TS-001')
        side = config.get('side', 'front')
        results_path = config.get('results_path', 'measurement_results')
        garment_color = config.get('garment_color', 'other')   # 'white', 'black', or 'other'

        # New direct file paths from api_server - normalize to absolute paths
        annotation_json_path = config.get('annotation_json_path')
        reference_image_path = config.get('reference_image_path')
        if annotation_json_path:
            annotation_json_path = os.path.abspath(annotation_json_path)
        if reference_image_path:
            reference_image_path = os.path.abspath(reference_image_path)
        results_path = os.path.abspath(results_path)

        print(f"[START] Worker for article: {article_style}, size: {annotation_name} ({side})")
        print(f"[PATH] Annotation JSON: {annotation_json_path}")
        print(f"[PATH] Reference Image: {reference_image_path}")
        print(f"[PATH] Results: {results_path}")
        print(f"[MODE] Garment Color: {garment_color}")

        # Read measurement specs from UI (for labeling live measurements)
        measurement_specs = config.get('measurement_specs', [])
        if measurement_specs:
            print(f"[SPECS] Received {len(measurement_specs)} measurement specs from UI:")
            for s in measurement_specs:
                print(f"  Pair {s.get('index', '?') + 1} -> {s.get('code', '?')}: {s.get('name', '?')} (expected: {s.get('expected_value', '?')} cm, db_id: {s.get('db_id', '?')})")
        else:
            print(f"[SPECS] No measurement specs from UI (will use generic names)")

        # Pre-flight checks: verify files exist and are non-zero
        if reference_image_path and os.path.exists(reference_image_path):
            img_size = os.path.getsize(reference_image_path)
            with open(reference_image_path, 'rb') as f:
                header = f.read(16)
            print(f"[CHECK] Reference image: {img_size} bytes, header(hex): {header.hex()}")
            if header[:2] == b'\xff\xd8':
                print(f"[CHECK] Valid JPEG header detected")
            elif header[:4] == b'\x89PNG':
                print(f"[CHECK] Valid PNG header detected")
            else:
                print(f"[WARN] Unexpected image header - file may be corrupted")

        # Initialize the new CV engine
        measurer = LiveKeypointDistanceMeasurer()

        # Set garment color BEFORE camera initialization (API-driven, no terminal input)
        measurer.set_garment_color(garment_color)

        # Pass measurement spec names from UI so the CV engine can label each pair
        measurer.measurement_specs = measurement_specs

        # Store metadata for result output
        measurer.current_annotation_name = annotation_name
        measurer.current_side = side

        # Initialize camera in headless mode (skips interactive prompts)
        if not measurer.initialize_camera(headless=True):
            print("[ERR] Could not initialize camera")
            sys.exit(1)

        # Load calibration if exists
        measurer.load_calibration()

        # Set annotation file path
        if annotation_json_path and os.path.exists(annotation_json_path):
            measurer.annotation_file = annotation_json_path
            print(f"[LOAD] Using annotation file: {annotation_json_path}")
        else:
            print(f"[ERR] Annotation file not found: {annotation_json_path}")
            sys.exit(1)

        # Set reference image path
        if reference_image_path and os.path.exists(reference_image_path):
            measurer.reference_image_file = reference_image_path
            print(f"[LOAD] Using reference image: {reference_image_path}")
            print(f"[FILE] Reference image size: {os.path.getsize(reference_image_path)} bytes")
        else:
            print(f"[WARN] Reference image not found at: {reference_image_path}")

        # Load annotation data
        if not measurer.load_annotation():
            print("[ERR] Failed to load front annotation")
            sys.exit(1)

        # Load reference image
        measurer.load_reference_image()

        # If back annotation exists, load it too (for side switching)
        back_annotation_path = annotation_json_path.replace('_front', '_back') if annotation_json_path else None
        if back_annotation_path and os.path.exists(back_annotation_path):
            measurer.back_annotation_file = back_annotation_path
            measurer.load_back_annotation()
            back_ref_path = reference_image_path.replace('_front', '_back') if reference_image_path else None
            if back_ref_path and os.path.exists(back_ref_path):
                measurer.back_reference_image_file = back_ref_path
                measurer.load_back_reference_image()

        # Set current side
        if side == 'back':
            measurer.switch_to_back_side()

        # Start live measurement in HEADLESS mode (fullscreen camera, no terminal prompts)
        print(f"[LIVE] Starting measurement loop (HEADLESS MODE, FULLSCREEN)...")
        measurer.transfer_keypoints_to_live(headless=True)

    except Exception as e:
        print(f"[FATAL] Worker crash: {e}")
        import traceback
        traceback.print_exc()
        # No input() pause – there is no visible console in production
        sys.exit(1)


if __name__ == "__main__":
    run_headless_measurement()
