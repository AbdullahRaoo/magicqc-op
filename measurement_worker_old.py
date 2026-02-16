import sys
import os
import json
import time
from measurment2 import LiveKeypointDistanceMeasurer

def run_headless_measurement():
    # Load config created by api_server.py
    config_file = 'measurement_config.json'
    if not os.path.exists(config_file):
        print(f"[ERR] Config file {config_file} not found")
        sys.exit(1)
        
    try:
        with open(config_file, 'r') as f:
            config = json.load(f)
            
        annotation_name = config.get('annotation_name')  # Size (e.g., 'XXL')
        article_style = config.get('article_style')      # Article style (e.g., 'NKE-TS-001')
        side = config.get('side', 'front')
        results_path = config.get('results_path', 'measurement_results')
        
        # New direct file paths from api_server
        annotation_json_path = config.get('annotation_json_path')
        reference_image_path = config.get('reference_image_path')
        
        print(f"[START] Worker for article: {article_style}, size: {annotation_name} ({side})")
        print(f"[PATH] Annotation JSON: {annotation_json_path}")
        print(f"[PATH] Reference Image: {reference_image_path}")
        print(f"[PATH] Results: {results_path}")
        
        # Initialize measurer
        measurer = LiveKeypointDistanceMeasurer()
        
        if not measurer.initialize_camera():
            print("[ERR] Could not initialize camera")
            sys.exit(1)
            
        # Set paths for measurer
        measurer.current_annotation_name = annotation_name
        measurer.current_side = side
        
        # Load local calibration if exists
        measurer.load_calibration()
        
        # Use direct file paths if provided (new format)
        if annotation_json_path and os.path.exists(annotation_json_path):
            measurer.annotation_file = annotation_json_path
            print(f"[LOAD] Using annotation file: {annotation_json_path}")
        else:
            # Fallback to old folder-based structure
            annotation_path = config.get('annotation_path')
            if annotation_path:
                size_annotation_path = os.path.join(annotation_path, f"{side}_annotation.json")
                if os.path.exists(size_annotation_path):
                    measurer.annotation_file = size_annotation_path
                    print(f"[LOAD] Using folder-based annotation: {size_annotation_path}")
                else:
                    print(f"[ERR] Annotation not found: {annotation_json_path or size_annotation_path}")
                    sys.exit(1)
            else:
                print(f"[ERR] No annotation path provided in config")
                sys.exit(1)
        
        # Set reference image path
        if reference_image_path and os.path.exists(reference_image_path):
            measurer.reference_image_file = reference_image_path
            print(f"[LOAD] Using reference image: {reference_image_path}")
            print(f"[FILE] Reference image size: {os.path.getsize(reference_image_path)} bytes")
        else:
            # Fallback to old folder-based structure
            annotation_path = config.get('annotation_path')
            if annotation_path:
                size_image_path = os.path.join(annotation_path, f"{side}_reference.jpg")
                if os.path.exists(size_image_path):
                    measurer.reference_image_file = size_image_path
                    print(f"[LOAD] Using folder-based reference image: {size_image_path}")
                else:
                    print(f"[WARN] Reference image not found at: {reference_image_path}")
                    print(f"[WARN] Also not found at: {size_image_path}")
            else:
                print(f"[WARN] Reference image not found at: {reference_image_path}")
                print(f"[WARN] No fallback annotation_path in config")
        
        print(f"[DEBUG] Final annotation_file: {measurer.annotation_file}")
        print(f"[DEBUG] Final reference_image_file: {measurer.reference_image_file}")
        
        if not measurer.load_annotation():
            print("[ERR] Failed to load annotation")
            sys.exit(1)
            
        # Start matching - HEADLESS mode (no interactive prompts)
        print(f"[LIVE] Starting measurement loop (HEADLESS MODE)...")
        measurer.transfer_keypoints_to_live(headless=True)
        
    except Exception as e:
        print(f"[FATAL] Worker crash: {e}")
        import traceback
        traceback.print_exc()
        print("\n[PAUSE] Worker crashed. Press Enter to close window...")
        input()
        sys.exit(1)

if __name__ == "__main__":
    run_headless_measurement()
