import cv2
import numpy as np
import math
try:
    from mvsdk import *
    _MVSDK_AVAILABLE = True
except (OSError, ImportError) as _sdk_err:
    # MagicCamera SDK DLL not installed — camera features will fail gracefully
    print(f"[WARN] MagicCamera SDK not available: {_sdk_err}")
    _MVSDK_AVAILABLE = False
import platform
import json
import os
import time
from scipy import ndimage
import base64

class LiveKeypointDistanceMeasurer:
    def __init__(self):
        self.camera = None
        self.camera_obj = None
        self.DevInfo = None
        
        # Front side data
        self.reference_image = None
        self.reference_gray = None
        self.keypoints = []  # Will store [x, y, type] where type is 'corner', 'perp', or 'normal'
        self.keypoint_types = []  # List of types for each keypoint
        self.transferred_keypoints = []
        
        # Back side data
        self.back_reference_image = None
        self.back_reference_gray = None
        self.back_keypoints = []  # Will store [x, y, type]
        self.back_keypoint_types = []
        self.back_transferred_keypoints = []
        
        # Current side tracking
        self.current_side = 'front'  # 'front' or 'back'
        
        self.pixels_per_cm = 0
        self.reference_length_cm = 0
        self.is_calibrated = False
        self.is_keypoints_transferred = False
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0
        self.current_format = None
        self.last_measurements = []
        self.placement_box = []  # [x1, y1, x2, y2] for shirt placement guide
        self.back_placement_box = []  # [x1, y1, x2, y2] for back side placement guide

        # Diagnostic: call counter for periodic logging in save_live_measurements
        self._save_live_call_count = 0

        # NEW: Pause functionality
        self.paused = False
        self.pause_frame = None
        
        # UPDATED: Garment color with White option
        self.garment_color = 'other'  # 'white', 'black', or 'other'
        self.gain_set = False
        
        # Calibration and annotation file paths
        self.calibration_file = "camera_calibration.json"
        self.annotation_file = "annotation_data.json"
        self.back_annotation_file = "back_annotation_data.json"
        self.reference_image_file = "reference_image.jpg"
        self.back_reference_image_file = "back_reference_image.jpg"
        
        # MULTIPLE Feature matching parameters
        self.feature_detectors = {
            'orb': cv2.ORB_create(nfeatures=3500),
            'brisk': cv2.BRISK_create()
        }
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
        self.min_matches = 15
        self.good_match_ratio = 0.75
        
        # QC Parameters
        self.qc_tolerance_cm = 100.0
        self.target_distances = {}
        self.back_target_distances = {}
        self.qc_results = {}
        
        # Enhanced Keypoint stabilization
        self.keypoint_stabilized = False
        self.stabilization_threshold = 17.0
        self.last_valid_keypoints = []
        self.stabilization_frames = 0
        
        # NEW: Perpendicular points static tracking
        self.perpendicular_points_initialized = False
        self.perpendicular_points_static_map = {}  # Store static positions for perpendicular points
        
        # Performance optimization
        self.last_transfer_time = 0
        self.transfer_interval = 0.06
        
        # Template matching for fallback
        self.template_roi_size = 85
        self.template_matching_threshold = 0.70
        
        # Size adaptation parameters
        self.last_detected_scale = 1.0
        self.scale_smoothing_factor = 0.3
        self.adaptive_search_radius = 50
        
        # Keypoint transfer method selection
        self.transfer_method = 'homography'
        self.alpha = 1.0
        
        # ENHANCED DISPLAY PARAMETERS
        self.distance_font_scale = 2.5
        self.distance_font_thickness = 8
        self.distance_text_color = (255, 255, 0)
        self.distance_bg_color = (0, 0, 0)
        self.line_thickness = 4
        self.keypoint_size = 12
        self.keypoint_border = 3
        
        # Reduced measurement display parameters
        self.measurement_box_height = 120
        self.measurement_box_width = 400
        
        # Corner keypoint parameters
        self.corner_keypoints_count = 12  # First 12 recommended as corner points
        self.corner_template_size = 150
        self.corner_matching_threshold = 0.6
        
        # Mouse panning parameters
        self.mouse_dragging = False
        self.last_mouse_x = 0
        self.last_mouse_y = 0
        
        # Annotation mode
        self.annotation_mode = 'normal'  # 'corner', 'perp', or 'normal'

    def load_calibration(self):
        """Load calibration data from JSON file"""
        try:
            if os.path.exists(self.calibration_file):
                with open(self.calibration_file, 'r') as f:
                    calibration_data = json.load(f)
                
                self.pixels_per_cm = calibration_data.get('pixels_per_cm', 0)
                self.reference_length_cm = calibration_data.get('reference_length_cm', 0)
                self.is_calibrated = calibration_data.get('is_calibrated', False)
                
                if self.is_calibrated:
                    print("✅ Calibration loaded successfully!")
                    print(f"📏 Scale factor: {self.pixels_per_cm:.2f} pixels/cm")
                    print(f"📐 Reference length: {self.reference_length_cm} cm")
                    return True
                else:
                    print("❌ Calibration file exists but is not valid")
                    return False
            else:
                print("📁 No calibration file found")
                return False
                
        except Exception as e:
            print(f"❌ Error loading calibration: {e}")
            return False

    def save_calibration(self):
        """Save calibration data to JSON file"""
        try:
            calibration_data = {
                'pixels_per_cm': self.pixels_per_cm,
                'reference_length_cm': self.reference_length_cm,
                'is_calibrated': self.is_calibrated,
                'calibration_date': str(np.datetime64('now'))
            }
            
            with open(self.calibration_file, 'w') as f:
                json.dump(calibration_data, f, indent=4)
            
            print("💾 Calibration saved successfully!")
            return True
            
        except Exception as e:
            print(f"❌ Error saving calibration: {e}")
            return False

    def save_reference_image(self):
        """Save reference image to file"""
        try:
            if self.reference_image is not None:
                success = cv2.imwrite(self.reference_image_file, self.reference_image)
                if success:
                    print(f"💾 Reference image saved: {self.reference_image_file}")
                    return True
                else:
                    print("❌ Failed to save reference image")
                    return False
            else:
                print("❌ No reference image to save")
                return False
        except Exception as e:
            print(f"❌ Error saving reference image: {e}")
            return False

    def save_back_reference_image(self):
        """Save back reference image to file"""
        try:
            if self.back_reference_image is not None:
                success = cv2.imwrite(self.back_reference_image_file, self.back_reference_image)
                if success:
                    print(f"💾 Back reference image saved: {self.back_reference_image_file}")
                    return True
                else:
                    print("❌ Failed to save back reference image")
                    return False
        except Exception as e:
            print(f"❌ Error saving back reference image: {e}")
            return False

    def load_reference_image(self):
        """Load reference image from file"""
        try:
            if os.path.exists(self.reference_image_file):
                self.reference_image = cv2.imread(self.reference_image_file)
                if self.reference_image is not None:
                    self.reference_gray = cv2.cvtColor(self.reference_image, cv2.COLOR_BGR2GRAY)
                    print(f"✅ Reference image loaded: {self.reference_image_file}")
                    print(f"📐 Image dimensions: {self.reference_image.shape[1]}x{self.reference_image.shape[0]}")
                    return True
                else:
                    print("❌ Failed to load reference image")
                    return False
            else:
                print("📁 No reference image file found")
                return False
        except Exception as e:
            print(f"❌ Error loading reference image: {e}")
            return False

    def load_back_reference_image(self):
        """Load back reference image from file"""
        try:
            if os.path.exists(self.back_reference_image_file):
                self.back_reference_image = cv2.imread(self.back_reference_image_file)
                if self.back_reference_image is not None:
                    self.back_reference_gray = cv2.cvtColor(self.back_reference_image, cv2.COLOR_BGR2GRAY)
                    print(f"✅ Back reference image loaded: {self.back_reference_image_file}")
                    print(f"📐 Image dimensions: {self.back_reference_image.shape[1]}x{self.back_reference_image.shape[0]}")
                    return True
                else:
                    print("❌ Failed to load back reference image")
                    return False
            else:
                print("📁 No back reference image file found")
                return False
        except Exception as e:
            print(f"❌ Error loading back reference image: {e}")
            return False

    def load_annotation(self):
        """Load annotation data from JSON file and reference image"""
        try:
            if os.path.exists(self.annotation_file):
                with open(self.annotation_file, 'r') as f:
                    annotation_data = json.load(f)
                
                # Load keypoints with types
                keypoints_data = annotation_data.get('keypoints', [])
                self.keypoints = []
                self.keypoint_types = []
                
                for kp_data in keypoints_data:
                    if len(kp_data) == 3:
                        # Format: [x, y, type]
                        self.keypoints.append([kp_data[0], kp_data[1]])
                        self.keypoint_types.append(kp_data[2])
                    else:
                        # Legacy format: [x, y] - assume normal type
                        self.keypoints.append([kp_data[0], kp_data[1]])
                        self.keypoint_types.append('normal')
                
                # Legacy type inference: if ALL keypoints defaulted to 'normal'
                # (no type info in annotation), infer types by position:
                # first 12 → corner, next 6 → perp, rest → normal
                if len(self.keypoint_types) > 0 and all(t == 'normal' for t in self.keypoint_types):
                    has_any_typed = any(len(kp_data) == 3 for kp_data in keypoints_data)
                    if not has_any_typed:
                        for i in range(len(self.keypoint_types)):
                            if i < 12:
                                self.keypoint_types[i] = 'corner'
                            elif i < 18:
                                self.keypoint_types[i] = 'perp'
                            # else: stays 'normal'
                        print(f"[COMPAT] Applied legacy type inference: {sum(1 for t in self.keypoint_types if t == 'corner')} corner, {sum(1 for t in self.keypoint_types if t == 'perp')} perp, {sum(1 for t in self.keypoint_types if t == 'normal')} normal")
                
                self.target_distances = annotation_data.get('target_distances', {})
                self.placement_box = annotation_data.get('placement_box', [])
                
                # Convert string keys to integers for target_distances
                self.target_distances = {int(k): float(v) for k, v in self.target_distances.items()}
                
                if self.keypoints:
                    print("✅ Annotation data loaded successfully!")
                    corner_count = sum(1 for t in self.keypoint_types if t == 'corner')
                    perp_count = sum(1 for t in self.keypoint_types if t == 'perp')
                    normal_count = sum(1 for t in self.keypoint_types if t == 'normal')
                    print(f"📍 Loaded {len(self.keypoints)} keypoints:")
                    print(f"   - Corner: {corner_count}")
                    print(f"   - Perpendicular: {perp_count}")
                    print(f"   - Normal: {normal_count}")
                    print(f"🎯 Loaded {len(self.target_distances)} target distances")
                    if self.placement_box:
                        print(f"📦 Loaded placement guide box")
                    
                    if self.load_reference_image():
                        return True
                    else:
                        print("❌ Annotation loaded but reference image missing")
                        return False
                else:
                    print("❌ Annotation file exists but has no keypoints")
                    return False
            else:
                print("📁 No annotation file found")
                return False
                
        except Exception as e:
            print(f"❌ Error loading annotation: {e}")
            return False

    def load_back_annotation(self):
        """Load back annotation data from JSON file and reference image"""
        try:
            if os.path.exists(self.back_annotation_file):
                with open(self.back_annotation_file, 'r') as f:
                    annotation_data = json.load(f)
                
                # Load keypoints with types
                keypoints_data = annotation_data.get('keypoints', [])
                self.back_keypoints = []
                self.back_keypoint_types = []
                
                for kp_data in keypoints_data:
                    if len(kp_data) == 3:
                        # Format: [x, y, type]
                        self.back_keypoints.append([kp_data[0], kp_data[1]])
                        self.back_keypoint_types.append(kp_data[2])
                    else:
                        # Legacy format: [x, y] - assume normal type
                        self.back_keypoints.append([kp_data[0], kp_data[1]])
                        self.back_keypoint_types.append('normal')
                
                # Legacy type inference for back annotations
                if len(self.back_keypoint_types) > 0 and all(t == 'normal' for t in self.back_keypoint_types):
                    has_any_typed = any(len(kp_data) == 3 for kp_data in keypoints_data)
                    if not has_any_typed:
                        for i in range(len(self.back_keypoint_types)):
                            if i < 12:
                                self.back_keypoint_types[i] = 'corner'
                            elif i < 18:
                                self.back_keypoint_types[i] = 'perp'
                        print(f"[COMPAT] Applied legacy type inference (back): {sum(1 for t in self.back_keypoint_types if t == 'corner')} corner, {sum(1 for t in self.back_keypoint_types if t == 'perp')} perp, {sum(1 for t in self.back_keypoint_types if t == 'normal')} normal")
                
                self.back_target_distances = annotation_data.get('target_distances', {})
                self.back_placement_box = annotation_data.get('placement_box', [])
                
                # Convert string keys to integers for target_distances
                self.back_target_distances = {int(k): float(v) for k, v in self.back_target_distances.items()}
                
                if self.back_keypoints:
                    print("✅ Back annotation data loaded successfully!")
                    corner_count = sum(1 for t in self.back_keypoint_types if t == 'corner')
                    perp_count = sum(1 for t in self.back_keypoint_types if t == 'perp')
                    normal_count = sum(1 for t in self.back_keypoint_types if t == 'normal')
                    print(f"📍 Loaded {len(self.back_keypoints)} back keypoints:")
                    print(f"   - Corner: {corner_count}")
                    print(f"   - Perpendicular: {perp_count}")
                    print(f"   - Normal: {normal_count}")
                    print(f"🎯 Loaded {len(self.back_target_distances)} back target distances")
                    if self.back_placement_box and len(self.back_placement_box) == 4:
                        print(f"📦 Loaded back placement_box: {self.back_placement_box}")
                    elif self.back_keypoints and (not self.back_placement_box or len(self.back_placement_box) != 4):
                        print(f"[BACK] Back annotation has {len(self.back_keypoints)} keypoints but placement_box missing or invalid: {self.back_placement_box}")
                    
                    if self.load_back_reference_image():
                        return True
                    else:
                        print("❌ Back annotation loaded but reference image missing")
                        return False
                else:
                    print("❌ Back annotation file exists but no keypoints")
                    return False
            else:
                print("📁 No back annotation file found")
                return False
                
        except Exception as e:
            print(f"❌ Error loading back annotation: {e}")
            return False

    def save_annotation(self):
        """Save annotation data to JSON file and reference image"""
        try:
            # Prepare keypoints with types
            keypoints_data = []
            for i, point in enumerate(self.keypoints):
                point_type = self.keypoint_types[i] if i < len(self.keypoint_types) else 'normal'
                keypoints_data.append([point[0], point[1], point_type])
            
            annotation_data = {
                'keypoints': keypoints_data,
                'target_distances': self.target_distances,
                'placement_box': getattr(self, 'placement_box', []),
                'annotation_date': str(np.datetime64('now'))
            }
            
            with open(self.annotation_file, 'w') as f:
                json.dump(annotation_data, f, indent=4)
            
            print("💾 Annotation data saved successfully!")
            corner_count = sum(1 for t in self.keypoint_types if t == 'corner')
            perp_count = sum(1 for t in self.keypoint_types if t == 'perp')
            normal_count = sum(1 for t in self.keypoint_types if t == 'normal')
            print(f"📍 Saved {len(self.keypoints)} keypoints:")
            print(f"   - Corner: {corner_count}")
            print(f"   - Perpendicular: {perp_count}")
            print(f"   - Normal: {normal_count}")
            print(f"🎯 Saved {len(self.target_distances)} target distances")
            if hasattr(self, 'placement_box') and self.placement_box:
                print(f"📦 Saved placement guide box")
            
            if self.save_reference_image():
                return True
            else:
                print("❌ Annotation saved but reference image save failed")
                return False
            
        except Exception as e:
            print(f"❌ Error saving annotation: {e}")
            return False

    def save_back_annotation(self):
        """Save back annotation data to JSON file and reference image"""
        try:
            # Prepare keypoints with types
            keypoints_data = []
            for i, point in enumerate(self.back_keypoints):
                point_type = self.back_keypoint_types[i] if i < len(self.back_keypoint_types) else 'normal'
                keypoints_data.append([point[0], point[1], point_type])
            
            annotation_data = {
                'keypoints': keypoints_data,
                'target_distances': self.back_target_distances,
                'placement_box': getattr(self, 'back_placement_box', []),
                'annotation_date': str(np.datetime64('now'))
            }
            
            with open(self.back_annotation_file, 'w') as f:
                json.dump(annotation_data, f, indent=4)
            
            print("💾 Back annotation data saved successfully!")
            corner_count = sum(1 for t in self.back_keypoint_types if t == 'corner')
            perp_count = sum(1 for t in self.back_keypoint_types if t == 'perp')
            normal_count = sum(1 for t in self.back_keypoint_types if t == 'normal')
            print(f"📍 Saved {len(self.back_keypoints)} back keypoints:")
            print(f"   - Corner: {corner_count}")
            print(f"   - Perpendicular: {perp_count}")
            print(f"   - Normal: {normal_count}")
            print(f"🎯 Saved {len(self.back_target_distances)} back target distances")
            
            if self.save_back_reference_image():
                return True
            else:
                print("❌ Back annotation saved but reference image save failed")
                return False
            
        except Exception as e:
            print(f"❌ Error saving back annotation: {e}")
            return False

    def delete_calibration(self):
        """Delete existing calibration file"""
        try:
            if os.path.exists(self.calibration_file):
                os.remove(self.calibration_file)
                self.is_calibrated = False
                self.pixels_per_cm = 0
                self.reference_length_cm = 0
                print("🗑️ Calibration deleted successfully!")
                return True
            else:
                print("📁 No calibration file to delete")
                return False
        except Exception as e:
            print(f"❌ Error deleting calibration: {e}")
            return False

    def delete_annotation(self):
        """Delete existing annotation file and reference image"""
        try:
            files_deleted = 0
            if os.path.exists(self.annotation_file):
                os.remove(self.annotation_file)
                files_deleted += 1
                print("🗑️ Annotation file deleted successfully!")
            
            if os.path.exists(self.back_annotation_file):
                os.remove(self.back_annotation_file)
                files_deleted += 1
                print("🗑️ Back annotation file deleted successfully!")
            
            if os.path.exists(self.reference_image_file):
                os.remove(self.reference_image_file)
                files_deleted += 1
                print("🗑️ Reference image deleted successfully!")
            
            if os.path.exists(self.back_reference_image_file):
                os.remove(self.back_reference_image_file)
                files_deleted += 1
                print("🗑️ Back reference image deleted successfully!")
            
            self.keypoints = []
            self.keypoint_types = []
            self.back_keypoints = []
            self.back_keypoint_types = []
            self.target_distances = {}
            self.back_target_distances = {}
            self.reference_image = None
            self.reference_gray = None
            self.back_reference_image = None
            self.back_reference_gray = None
            self.placement_box = []
            
            if files_deleted == 0:
                print("📁 No annotation files to delete")
            
            return True
        except Exception as e:
            print(f"❌ Error deleting annotation: {e}")
            return False

    def initialize_camera(self, headless=False):
        """Initialize the MagicCamera
        Args:
            headless: If True, skip interactive prompts (use set_garment_color before calling)
        """
        if not _MVSDK_AVAILABLE:
            print("[ERR] MagicCamera SDK (MVCAMSDK_X64.dll) is not installed.")
            print("[ERR] Please install the MagicCamera SDK and restart the application.")
            return False

        try:
            CameraSdkInit(1)
        except NameError:
            # mvsdk import failed entirely (DLL not installed)
            print("[ERR] MagicCamera SDK (MVCAMSDK_X64.dll) is not installed.")
            print("[ERR] Please install the MagicCamera SDK and restart the application.")
            return False
        except Exception as e:
            print(f"[ERR] Camera SDK initialization failed: {e}")
            return False

        try:
            camera_list = CameraEnumerateDevice()
            if len(camera_list) == 0:
                print("No camera found!")
                return False
                
            print(f"Found {len(camera_list)} camera(s)")
            self.DevInfo = camera_list[0]
            self.camera_obj = self.Camera(self.DevInfo)
            
            if not self.camera_obj.open():
                return False
                
            print("Camera initialized successfully")
            
            if headless:
                # In headless mode, garment_color should already be set via set_garment_color()
                print("[HEADLESS] Skipping interactive garment color prompt")
                if self.gain_set:
                    self.set_camera_gain_for_capture()
            else:
                # UPDATED: Ask for garment color with White option BEFORE any image capture
                self.ask_garment_color()
            
            return True
            
        except CameraException as e:
            print(f"Camera initialization failed: {e}")
            return False

    def set_garment_color(self, color):
        """Set garment color programmatically (for API-driven mode)
        Args:
            color: 'white', 'black', or 'other'
        """
        valid_colors = ['white', 'black', 'other']
        if color not in valid_colors:
            print(f"[WARN] Invalid garment color '{color}', defaulting to 'other'")
            color = 'other'
        self.garment_color = color
        self.gain_set = True
        print(f"[API] Garment color set to: {self.garment_color}")
        # Apply gain if camera is already initialized
        if self.camera_obj and self.camera_obj.hCamera > 0:
            self.set_camera_gain_for_capture()
            self.set_live_gain()

    def ask_garment_color(self):
        """UPDATED: Ask user for garment color with White option and set appropriate gain"""
        print("\n" + "="*60)
        print("GARMENT COLOR SELECTION")
        print("="*60)
        print("Please select the garment color for optimal image quality:")
        print("W - White/Light colored garment (Gain: 20, Auto Exposure: ON)")
        print("B - Black/Dark colored garment (Gain: 150, Auto Exposure: OFF)")
        print("Z - Other colors (Gain: 64, Auto Exposure: ON)")
        print("\nThis gain setting will be applied to ALL captured images (calibration, annotation, live measurement).")
        
        while True:
            choice = input("\nEnter your choice (W/B/Z): ").strip().upper()
            if choice == 'W':
                self.garment_color = 'white'
                print("✅ White garment selected - will use gain 20 with Auto Exposure ON for all captures")
                self.gain_set = True
                break
            elif choice == 'B':
                self.garment_color = 'black'
                print("✅ Black garment selected - will use gain 150 with Auto Exposure OFF for all captures")
                self.gain_set = True
                break
            elif choice == 'Z':
                self.garment_color = 'other'
                print("✅ Other colors selected - will use gain 64 with Auto Exposure ON for all captures")
                self.gain_set = True
                break
            else:
                print("❌ Invalid choice! Please press W for White, B for Black, or Z for Other colors.")
        
        # Apply the gain settings immediately
        self.set_camera_gain_for_capture()

    def set_camera_gain_for_capture(self):
        """UPDATED: Set camera gain and auto exposure based on garment color for all captures (with White option)"""
        if self.camera_obj and self.camera_obj.hCamera > 0:
            if self.garment_color == 'white':
                CameraSetAnalogGain(self.camera_obj.hCamera, 20)
                CameraSetAeState(self.camera_obj.hCamera, 1)  # Auto Exposure ON for white garments
                print("🎛️ Camera configured: Gain 20, Auto Exposure ON (WHITE garment mode)")
            elif self.garment_color == 'black':
                CameraSetAnalogGain(self.camera_obj.hCamera, 150)
                CameraSetAeState(self.camera_obj.hCamera, 0)  # Auto Exposure OFF for black garments
                print("🎛️ Camera configured: Gain 150, Auto Exposure OFF (BLACK garment mode)")
            else:  # other
                CameraSetAnalogGain(self.camera_obj.hCamera, 64)
                CameraSetAeState(self.camera_obj.hCamera, 1)  # Auto Exposure ON for other colors
                print("🎛️ Camera configured: Gain 64, Auto Exposure ON (OTHER colors mode)")

    class Camera(object):
        def __init__(self, DevInfo):
            super().__init__()
            self.DevInfo = DevInfo
            self.hCamera = 0
            self.cap = None
            self.pFrameBuffer = 0
            
        def open(self):
            if self.hCamera > 0:
                return True
                
            hCamera = 0
            try:
                hCamera = CameraInit(self.DevInfo, -1, -1)
            except CameraException as e:
                print("CameraInit Failed({}): {}".format(e.error_code, e.message))
                return False
            
            cap = CameraGetCapability(hCamera)
            monoCamera = (cap.sIspCapacity.bMonoSensor != 0)
            
            # Force mono output for faster processing
            CameraSetIspOutFormat(hCamera, CAMERA_MEDIA_TYPE_MONO8)
            
            FrameBufferSize = cap.sResolutionRange.iWidthMax * cap.sResolutionRange.iHeightMax * 1
            pFrameBuffer = CameraAlignMalloc(FrameBufferSize, 16)
            
            CameraSetTriggerMode(hCamera, 0)
            CameraSetAeState(hCamera, 1)  # Default Auto Exposure ON (will be changed by garment color)
            CameraSetAnalogGain(hCamera, 64)  # Default gain (will be changed by garment color)
            CameraPlay(hCamera)
            
            self.hCamera = hCamera
            self.pFrameBuffer = pFrameBuffer
            self.cap = cap
            
            print(f"Camera opened successfully: {self.DevInfo.GetFriendlyName()}")
            print("📷 Camera mode: MONOCHROME (for faster processing)")
            return True
        
        def close(self):
            if self.hCamera > 0:
                CameraUnInit(self.hCamera)
                self.hCamera = 0
            if self.pFrameBuffer != 0:
                CameraAlignFree(self.pFrameBuffer)
                self.pFrameBuffer = 0
        
        def grab(self):
            hCamera = self.hCamera
            pFrameBuffer = self.pFrameBuffer
            
            try:
                pRawData, FrameHead = CameraGetImageBuffer(hCamera, 200)
                CameraImageProcess(hCamera, pRawData, pFrameBuffer, FrameHead)
                CameraReleaseImageBuffer(hCamera, pRawData)
                
                if platform.system() == "Windows":
                    CameraFlipFrameBuffer(pFrameBuffer, FrameHead, 1)
                
                frame_data = (c_ubyte * FrameHead.uBytes).from_address(pFrameBuffer)
                frame = np.frombuffer(frame_data, dtype=np.uint8)
                frame = frame.reshape((FrameHead.iHeight, FrameHead.iWidth, 1))
                
                return frame
                
            except CameraException as e:
                if e.error_code != CAMERA_STATUS_TIME_OUT:
                    print("CameraGetImageBuffer failed({}): {}".format(e.error_code, e.message))
                return None

    def set_live_gain(self):
        """UPDATED: Set camera gain and auto exposure based on garment color for live measurement (with White option)"""
        if self.camera_obj and self.camera_obj.hCamera > 0:
            if self.garment_color == 'white':
                CameraSetAnalogGain(self.camera_obj.hCamera, 20)
                CameraSetAeState(self.camera_obj.hCamera, 1)  # Auto Exposure ON for white garments
                print("🎛️ Gain set to 20, Auto Exposure ON for WHITE garment (live measurement)")
            elif self.garment_color == 'black':
                CameraSetAnalogGain(self.camera_obj.hCamera, 150)
                CameraSetAeState(self.camera_obj.hCamera, 0)  # Auto Exposure OFF for black garments
                print("🎛️ Gain set to 150, Auto Exposure OFF for BLACK garment (live measurement)")
            else:  # other
                CameraSetAnalogGain(self.camera_obj.hCamera, 64)
                CameraSetAeState(self.camera_obj.hCamera, 1)  # Auto Exposure ON for other colors
                print("🎛️ Gain set to 64, Auto Exposure ON for OTHER colors (live measurement)")

    def capture_reference_frame(self):
        """Capture a reference frame from camera"""
        frame = self.camera_obj.grab()
        if frame is not None:
            self.reference_image = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
            self.reference_gray = frame.copy()
            print(f"Reference frame captured: {self.reference_image.shape[1]}x{self.reference_image.shape[0]}")
            return True
        return False

    def capture_back_reference_frame(self):
        """Capture a back reference frame from camera"""
        frame = self.camera_obj.grab()
        if frame is not None:
            self.back_reference_image = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
            self.back_reference_gray = frame.copy()
            print(f"Back reference frame captured: {self.back_reference_image.shape[1]}x{self.back_reference_image.shape[0]}")
            return True
        return False

    def capture_live_frame(self):
        """Capture a live frame from camera - returns grayscale for processing"""
        frame = self.camera_obj.grab()
        if frame is not None:
            return frame
        return None

    def extract_features_fast(self, image):
        """Extract features using fast methods optimized for grayscale"""
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image
            
        h, w = gray.shape[:2]
        max_dim = 800
        if max(h, w) > max_dim:
            scale = max_dim / max(h, w)
            new_w, new_h = int(w * scale), int(h * scale)
            image_resized = cv2.resize(gray, (new_w, new_h))
        else:
            image_resized = gray
            
        all_keypoints = []
        all_descriptors = []
        
        # ORB features - primary for speed
        try:
            kp_orb, desc_orb = self.feature_detectors['orb'].detectAndCompute(image_resized, None)
            if kp_orb is not None and desc_orb is not None:
                all_keypoints.extend(kp_orb)
                all_descriptors.append(desc_orb)
        except Exception as e:
            print(f"ORB feature extraction failed: {e}")
        
        # BRISK features - secondary
        try:
            kp_brisk, desc_brisk = self.feature_detectors['brisk'].detectAndCompute(image_resized, None)
            if kp_brisk is not None and desc_brisk is not None:
                all_keypoints.extend(kp_brisk)
                all_descriptors.append(desc_brisk)
        except Exception as e:
            print(f"BRISK feature extraction failed: {e}")
        
        # Scale keypoints back to original coordinates
        if max(h, w) > max_dim:
            scale_factor = w / new_w
            for kp in all_keypoints:
                kp.pt = (kp.pt[0] * scale_factor, kp.pt[1] * scale_factor)
                kp.size = kp.size * scale_factor
        
        # Combine descriptors
        if all_descriptors:
            if len(all_descriptors) == 1:
                combined_descriptors = all_descriptors[0]
            else:
                combined_descriptors = np.vstack(all_descriptors)
        else:
            combined_descriptors = None
            
        return all_keypoints, combined_descriptors

    def match_features_fast(self, desc1, desc2):
        """Fast feature matching for binary descriptors"""
        if desc1 is None or desc2 is None or len(desc1) == 0 or len(desc2) == 0:
            return []
        
        try:
            matches = self.matcher.knnMatch(desc1, desc2, k=2)
            
            good_matches = []
            for match_pair in matches:
                if len(match_pair) == 2:
                    m, n = match_pair
                    if m.distance < self.good_match_ratio * n.distance:
                        good_matches.append(m)
            
            return good_matches
            
        except Exception as e:
            print(f"Feature matching error: {e}")
            return []

    def transfer_with_homography(self, ref_kp, ref_desc, curr_kp, curr_desc, matches):
        """Homography-based keypoint transfer using perspective transformation"""
        if len(matches) < self.min_matches:
            return None, []
            
        try:
            src_pts = np.float32([ref_kp[m.queryIdx].pt for m in matches]).reshape(-1, 1, 2)
            dst_pts = np.float32([curr_kp[m.trainIdx].pt for m in matches]).reshape(-1, 1, 2)
            
            H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
            
            if H is None:
                return None, []
            
            det = np.linalg.det(H)
            if 0.1 < abs(det) < 10.0:
                current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
                
                transformed_points = []
                for point in current_keypoints:
                    src_point = np.array([[point[0], point[1]]], dtype=np.float32)
                    src_point = src_point.reshape(-1, 1, 2)
                    dst_point = cv2.perspectiveTransform(src_point, H)
                    
                    if len(dst_point) > 0:
                        x, y = dst_point[0][0]
                        transformed_points.append([x, y])
                    else:
                        transformed_points.append([-1, -1])
                
                return H, transformed_points
            
            return None, []
            
        except Exception as e:
            print(f"Homography transfer error: {e}")
            return None, []

    def transfer_with_mls(self, ref_kp, ref_desc, curr_kp, curr_desc, matches):
        """Moving Least Squares (MLS) based keypoint transfer for non-rigid deformation"""
        if len(matches) < 4:
            return None, []
            
        try:
            src_pts = np.float32([ref_kp[m.queryIdx].pt for m in matches])
            dst_pts = np.float32([curr_kp[m.trainIdx].pt for m in matches])
            
            current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
            transformed_points = []
            
            for ref_point in current_keypoints:
                total_weight = 0
                weighted_x = 0
                weighted_y = 0
                
                for i, match in enumerate(matches):
                    src_match_pt = src_pts[i]
                    dst_match_pt = dst_pts[i]
                    
                    distance = np.linalg.norm(np.array(ref_point) - src_match_pt)
                    
                    if distance < 1e-6:
                        weight = 1e6
                    else:
                        weight = 1.0 / (distance ** (2 * self.alpha))
                    
                    total_weight += weight
                    weighted_x += weight * dst_match_pt[0]
                    weighted_y += weight * dst_match_pt[1]
                
                if total_weight > 0:
                    x = weighted_x / total_weight
                    y = weighted_y / total_weight
                    transformed_points.append([x, y])
                else:
                    transformed_points.append([-1, -1])
            
            return None, transformed_points
            
        except Exception as e:
            print(f"MLS transfer error: {e}")
            return None, []

    def estimate_scale_change(self, kp1, kp2, matches):
        """Estimate scale change between reference and current frame"""
        if len(matches) < 4:
            return 1.0
            
        src_pts = np.float32([kp1[m.queryIdx].pt for m in matches])
        dst_pts = np.float32([kp2[m.trainIdx].pt for m in matches])
        
        ref_distances = []
        curr_distances = []
        
        for i in range(len(matches)):
            for j in range(i+1, len(matches)):
                ref_dist = np.linalg.norm(src_pts[i] - src_pts[j])
                curr_dist = np.linalg.norm(dst_pts[i] - dst_pts[j])
                if ref_dist > 10:
                    ref_distances.append(ref_dist)
                    curr_distances.append(curr_dist)
        
        if len(ref_distances) == 0:
            return 1.0
            
        scales = [curr_d / ref_d for curr_d, ref_d in zip(curr_distances, ref_distances) if ref_d > 0]
        
        if len(scales) == 0:
            return 1.0
            
        median_scale = np.median(scales)
        
        smoothed_scale = (self.last_detected_scale * (1 - self.scale_smoothing_factor) + 
                         median_scale * self.scale_smoothing_factor)
        self.last_detected_scale = smoothed_scale
        
        return smoothed_scale

    def template_match_keypoints(self, current_gray, scale_factor=1.0):
        """Template matching fallback for keypoint transfer using grayscale"""
        current_reference_gray = self.reference_gray if self.current_side == 'front' else self.back_reference_gray
        current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
        
        if current_reference_gray is None or len(current_keypoints) == 0:
            return []
            
        h, w = current_gray.shape[:2]
        ref_h, ref_w = current_reference_gray.shape[:2]
        
        transferred_points = []
        
        for i, keypoint in enumerate(current_keypoints):
            x, y = int(keypoint[0]), int(keypoint[1])
            
            template_size = int(self.template_roi_size * scale_factor)
            half_size = template_size // 2
            
            x1 = max(0, x - half_size)
            y1 = max(0, y - half_size)
            x2 = min(ref_w, x + half_size)
            y2 = min(ref_h, y + half_size)
            
            if x2 - x1 < 10 or y2 - y1 < 10:
                transferred_points.append([-1, -1])
                continue
                
            template = current_reference_gray[y1:y2, x1:x2]
            
            search_multiplier = 2.0 * scale_factor
            search_half_size = int(template_size * search_multiplier)
            
            estimated_x = int(x * scale_factor)
            estimated_y = int(y * scale_factor)
            
            sx1 = max(0, estimated_x - search_half_size)
            sy1 = max(0, estimated_y - search_half_size)
            sx2 = min(w, estimated_x + search_half_size)
            sy2 = min(h, estimated_y + search_half_size)
            
            if sx2 - sx1 < template.shape[1] or sy2 - sy1 < template.shape[0]:
                transferred_points.append([-1, -1])
                continue
                
            search_region = current_gray[sy1:sy2, sx1:sx2]
            
            try:
                result = cv2.matchTemplate(search_region, template, cv2.TM_CCOEFF_NORMED)
                min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
                
                if max_val > self.template_matching_threshold:
                    match_x = sx1 + max_loc[0] + template.shape[1] // 2
                    match_y = sy1 + max_loc[1] + template.shape[0] // 2
                    transferred_points.append([match_x, match_y])
                else:
                    transferred_points.append([-1, -1])
                    
            except Exception as e:
                transferred_points.append([-1, -1])
        
        return transferred_points

    def template_match_corners(self, current_gray, scale_factor=1.0, corner_indices=None):
        """Enhanced template matching specifically for corner keypoints"""
        current_reference_gray = self.reference_gray if self.current_side == 'front' else self.back_reference_gray
        current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
        current_keypoint_types = self.keypoint_types if self.current_side == 'front' else self.back_keypoint_types
        
        if current_reference_gray is None or len(current_keypoints) == 0:
            return []
            
        h, w = current_gray.shape[:2]
        ref_h, ref_w = current_reference_gray.shape[:2]
        
        corner_points = []
        
        # Process only corner keypoints
        indices_to_process = corner_indices if corner_indices is not None else range(len(current_keypoints))
        
        for i in indices_to_process:
            if i >= len(current_keypoints):
                corner_points.append([-1, -1])
                continue
                
            # Only process if it's a corner point
            if current_keypoint_types[i] != 'corner':
                corner_points.append([-1, -1])
                continue
                
            keypoint = current_keypoints[i]
            x, y = int(keypoint[0]), int(keypoint[1])
            
            template_size = int(self.corner_template_size * scale_factor)
            half_size = template_size // 2
            
            x1 = max(0, x - half_size)
            y1 = max(0, y - half_size)
            x2 = min(ref_w, x + half_size)
            y2 = min(ref_h, y + half_size)
            
            if x2 - x1 < 20 or y2 - y1 < 20:
                corner_points.append([-1, -1])
                continue
                
            template = current_reference_gray[y1:y2, x1:x2]
            
            search_multiplier = 2.5 * scale_factor
            search_half_size = int(template_size * search_multiplier)
            
            estimated_x = int(x * scale_factor)
            estimated_y = int(y * scale_factor)
            
            sx1 = max(0, estimated_x - search_half_size)
            sy1 = max(0, estimated_y - search_half_size)
            sx2 = min(w, estimated_x + search_half_size)
            sy2 = min(h, estimated_y + search_half_size)
            
            if sx2 - sx1 < template.shape[1] or sy2 - sy1 < template.shape[0]:
                corner_points.append([-1, -1])
                continue
                
            search_region = current_gray[sy1:sy2, sx1:sx2]
            
            try:
                methods = [cv2.TM_CCOEFF_NORMED, cv2.TM_CCORR_NORMED]
                best_match_val = -1
                best_match_loc = (0, 0)
                
                for method in methods:
                    result = cv2.matchTemplate(search_region, template, method)
                    min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
                    
                    if method == cv2.TM_CCOEFF_NORMED or method == cv2.TM_CCORR_NORMED:
                        if max_val > best_match_val:
                            best_match_val = max_val
                            best_match_loc = max_loc
                    else:
                        if min_val > best_match_val:
                            best_match_val = min_val
                            best_match_loc = min_loc
                
                if best_match_val > self.corner_matching_threshold:
                    match_x = sx1 + best_match_loc[0] + template.shape[1] // 2
                    match_y = sy1 + best_match_loc[1] + template.shape[0] // 2
                    corner_points.append([match_x, match_y])
                else:
                    corner_points.append([-1, -1])
                    
            except Exception as e:
                corner_points.append([-1, -1])
        
        return corner_points

    def detect_corners_robust(self, current_gray, scale_factor=1.0, corner_indices=None):
        """ENHANCED: Robust corner detection using multiple methods including Shi-Tomasi"""
        current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
        current_keypoint_types = self.keypoint_types if self.current_side == 'front' else self.back_keypoint_types
        
        if len(current_keypoints) == 0:
            return []
            
        h, w = current_gray.shape[:2]
        
        indices_to_process = corner_indices if corner_indices is not None else range(len(current_keypoints))
        
        # Method 1: Enhanced template matching for corners
        template_points = self.template_match_corners(current_gray, scale_factor, indices_to_process)
        
        # Method 2: Shi-Tomasi corner detection
        shitomasi_points = []
        
        for idx, i in enumerate(indices_to_process):
            if i >= len(current_keypoints):
                shitomasi_points.append([-1, -1])
                continue
                
            # Only process if it's a corner point
            if current_keypoint_types[i] != 'corner':
                shitomasi_points.append([-1, -1])
                continue
                
            keypoint = current_keypoints[i]
            x, y = int(keypoint[0] * scale_factor), int(keypoint[1] * scale_factor)
            
            search_size = int(150 * scale_factor)
            half_size = search_size // 2
            
            x1 = max(0, x - half_size)
            y1 = max(0, y - half_size)
            x2 = min(w, x + half_size)
            y2 = min(h, y + half_size)
            
            if x2 - x1 < 50 or y2 - y1 < 50:
                shitomasi_points.append([-1, -1])
                continue
                
            search_region = current_gray[y1:y2, x1:x2]
            
            try:
                corners = cv2.goodFeaturesToTrack(search_region, maxCorners=1, 
                                                qualityLevel=0.01, minDistance=10)
                
                if corners is not None and len(corners) > 0:
                    corner_x = x1 + corners[0][0][0]
                    corner_y = y1 + corners[0][0][1]
                    shitomasi_points.append([corner_x, corner_y])
                else:
                    shitomasi_points.append([-1, -1])
                    
            except Exception as e:
                shitomasi_points.append([-1, -1])
        
        # Method 3: Harris corner detection (fallback)
        harris_points = []
        
        for idx, i in enumerate(indices_to_process):
            if i >= len(current_keypoints):
                harris_points.append([-1, -1])
                continue
                
            # Only process if it's a corner point
            if current_keypoint_types[i] != 'corner':
                harris_points.append([-1, -1])
                continue
                
            keypoint = current_keypoints[i]
            x, y = int(keypoint[0] * scale_factor), int(keypoint[1] * scale_factor)
            
            search_size = int(150 * scale_factor)
            half_size = search_size // 2
            
            x1 = max(0, x - half_size)
            y1 = max(0, y - half_size)
            x2 = min(w, x + half_size)
            y2 = min(h, y + half_size)
            
            if x2 - x1 < 50 or y2 - y1 < 50:
                harris_points.append([-1, -1])
                continue
                
            search_region = current_gray[y1:y2, x1:x2]
            
            try:
                harris_response = cv2.cornerHarris(search_region, 2, 3, 0.04)
                
                min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(harris_response)
                
                if max_val > 0.01:
                    corner_x = x1 + max_loc[0]
                    corner_y = y1 + max_loc[1]
                    harris_points.append([corner_x, corner_y])
                else:
                    harris_points.append([-1, -1])
                    
            except Exception as e:
                harris_points.append([-1, -1])
        
        # Fuse results with priority: Template > Shi-Tomasi > Harris
        fused_corners = []
        for i in range(len(template_points)):
            if template_points[i][0] != -1:
                fused_corners.append(template_points[i])
            elif i < len(shitomasi_points) and shitomasi_points[i][0] != -1:
                fused_corners.append(shitomasi_points[i])
            elif i < len(harris_points) and harris_points[i][0] != -1:
                fused_corners.append(harris_points[i])
            else:
                fused_corners.append([-1, -1])
        
        return fused_corners

    def transfer_keypoints_robust(self, current_gray):
        """Robust keypoint transfer using multiple methods with grayscale processing"""
        current_reference_gray = self.reference_gray if self.current_side == 'front' else self.back_reference_gray
        current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
        current_keypoint_types = self.keypoint_types if self.current_side == 'front' else self.back_keypoint_types
        
        if current_reference_gray is None or len(current_keypoints) == 0:
            return []
            
        try:
            # METHOD 1: Feature-based matching with homography/MLS
            ref_kp, ref_desc = self.extract_features_fast(current_reference_gray)
            curr_kp, curr_desc = self.extract_features_fast(current_gray)
            
            feature_points = []
            scale_factor = 1.0
            
            if ref_desc is not None and curr_desc is not None and len(ref_desc) > 0 and len(curr_desc) > 0:
                matches = self.match_features_fast(ref_desc, curr_desc)
                
                if len(matches) >= self.min_matches:
                    scale_factor = self.estimate_scale_change(ref_kp, curr_kp, matches)
                    
                    if len(matches) >= 20 and self.transfer_method in ['homography', 'auto']:
                        H, homography_points = self.transfer_with_homography(ref_kp, ref_desc, curr_kp, curr_desc, matches)
                        if homography_points:
                            feature_points = homography_points
                            print("🔧 Using Homography transfer")
                        else:
                            _, mls_points = self.transfer_with_mls(ref_kp, ref_desc, curr_kp, curr_desc, matches)
                            feature_points = mls_points
                            print("🔧 Using MLS transfer (homography fallback)")
                    else:
                        _, mls_points = self.transfer_with_mls(ref_kp, ref_desc, curr_kp, curr_desc, matches)
                        feature_points = mls_points
                        print("🔧 Using MLS transfer")
                else:
                    feature_points = [[-1, -1]] * len(current_keypoints)
            else:
                feature_points = [[-1, -1]] * len(current_keypoints)
            
            # METHOD 2: Template matching with adaptive scale
            template_points = self.template_match_keypoints(current_gray, scale_factor)
            
            # METHOD 3: Enhanced corner detection for corner keypoints
            corner_indices = [i for i, t in enumerate(current_keypoint_types) if t == 'corner']
            corner_points = self.detect_corners_robust(current_gray, scale_factor, corner_indices)
            
            # METHOD 4: Perpendicular points handling (if they should be static)
            perp_indices = [i for i, t in enumerate(current_keypoint_types) if t == 'perp']
            
            # METHOD 5: Fusion of all methods based on point type
            fused_points = []
            valid_feature_count = 0
            valid_template_count = 0
            valid_corner_count = 0
            corner_idx_counter = 0
            
            for i in range(len(current_keypoints)):
                point_type = current_keypoint_types[i] if i < len(current_keypoint_types) else 'normal'
                
                feat_pt = feature_points[i] if i < len(feature_points) else [-1, -1]
                temp_pt = template_points[i] if i < len(template_points) else [-1, -1]
                
                if point_type == 'corner' and corner_idx_counter < len(corner_points):
                    corner_pt = corner_points[corner_idx_counter]
                    corner_idx_counter += 1
                    
                    if feat_pt[0] != -1:
                        valid_feature_count += 1
                    if temp_pt[0] != -1:
                        valid_template_count += 1
                    if corner_pt[0] != -1:
                        valid_corner_count += 1
                    
                    # For corner points, prioritize corner detection methods
                    if corner_pt[0] != -1:
                        fused_points.append(corner_pt)
                    elif feat_pt[0] != -1:
                        fused_points.append(feat_pt)
                    elif temp_pt[0] != -1:
                        fused_points.append(temp_pt)
                    else:
                        fused_points.append([-1, -1])
                        
                elif point_type == 'perp':
                    # For perpendicular points, use static positions if initialized
                    if self.perpendicular_points_initialized and i in self.perpendicular_points_static_map:
                        fused_points.append(self.perpendicular_points_static_map[i])
                    else:
                        # Otherwise use feature-based or template matching
                        if feat_pt[0] != -1:
                            fused_points.append(feat_pt)
                        elif temp_pt[0] != -1:
                            fused_points.append(temp_pt)
                        else:
                            fused_points.append([-1, -1])
                            
                else:  # normal points
                    if feat_pt[0] != -1:
                        valid_feature_count += 1
                    if temp_pt[0] != -1:
                        valid_template_count += 1
                    
                    if feat_pt[0] != -1 and temp_pt[0] != -1:
                        distance = math.sqrt((feat_pt[0]-temp_pt[0])**2 + (feat_pt[1]-temp_pt[1])**2)
                        if distance < 25:
                            feature_weight = 0.7 if len(matches) >= self.min_matches else 0.4
                            template_weight = 1.0 - feature_weight
                            
                            x = (feat_pt[0] * feature_weight + temp_pt[0] * template_weight)
                            y = (feat_pt[1] * feature_weight + temp_pt[1] * template_weight)
                            fused_points.append([x, y])
                        else:
                            if len(matches) >= self.min_matches:
                                fused_points.append(feat_pt)
                            else:
                                fused_points.append(temp_pt)
                    elif feat_pt[0] != -1:
                        fused_points.append(feat_pt)
                    elif temp_pt[0] != -1:
                        fused_points.append(temp_pt)
                    else:
                        fused_points.append([-1, -1])
            
            if len(matches) >= self.min_matches:
                print(f"📊 Transfer: {len(matches)} matches, {valid_feature_count}/{len(current_keypoints)} feature points, {valid_template_count}/{len(current_keypoints)} template points, {valid_corner_count}/{len(corner_indices)} corner points")
            
            # Apply stabilization to fused points
            stabilized_points = self.stabilize_keypoints(fused_points)
            
            # Initialize perpendicular points static map after first successful transfer
            if not self.perpendicular_points_initialized and len(stabilized_points) >= 18:
                perp_found = [i for i, t in enumerate(current_keypoint_types) if t == 'perp']
                if perp_found:
                    static_map = {}
                    valid_perp = True
                    
                    for idx in perp_found:
                        if idx < len(stabilized_points) and stabilized_points[idx][0] != -1:
                            static_map[idx] = stabilized_points[idx].copy()
                        else:
                            valid_perp = False
                            break
                    
                    if valid_perp:
                        self.perpendicular_points_static_map = static_map
                        self.perpendicular_points_initialized = True
                        print(f"📏 Perpendicular points now STATIC: {perp_found}")
            
            return stabilized_points
            
        except Exception as e:
            print(f"Error in robust keypoint transfer: {e}")
            return self.template_match_keypoints(current_gray, 1.0)

    def stabilize_keypoints(self, new_keypoints):
        """Enhanced stabilization that allows for real movement but reduces jitter"""
        if not self.last_valid_keypoints or len(self.last_valid_keypoints) != len(new_keypoints):
            self.last_valid_keypoints = new_keypoints
            return new_keypoints
        
        # Check if perpendicular points should be static
        if self.perpendicular_points_initialized:
            # Ensure perpendicular points stay static
            for idx, static_pt in self.perpendicular_points_static_map.items():
                if idx < len(new_keypoints):
                    new_keypoints[idx] = static_pt
        
        stabilized_points = []
        valid_count = 0
        
        for i, (new_point, last_point) in enumerate(zip(new_keypoints, self.last_valid_keypoints)):
            if new_point[0] == -1 or new_point[1] == -1:
                stabilized_points.append(last_point)
            else:
                # Check if this is a perpendicular point (already handled above)
                if self.perpendicular_points_initialized and i in self.perpendicular_points_static_map:
                    stabilized_points.append(new_point)
                    valid_count += 1
                    continue
                
                distance = math.sqrt((new_point[0] - last_point[0])**2 + (new_point[1] - last_point[1])**2)
                
                if distance < self.stabilization_threshold:
                    stabilized_points.append(new_point)
                    valid_count += 1
                else:
                    coordinated_movement = self.check_coordinated_movement(new_keypoints, i)
                    if coordinated_movement:
                        stabilized_points.append(new_point)
                        valid_count += 1
                    else:
                        stabilized_points.append(last_point)
        
        self.last_valid_keypoints = stabilized_points
        
        if valid_count == len(new_keypoints):
            self.stabilization_frames += 1
            if self.stabilization_frames >= 2:
                self.keypoint_stabilized = True
        else:
            self.stabilization_frames = 0
            self.keypoint_stabilized = False
        
        return stabilized_points

    def check_coordinated_movement(self, new_points, changed_index):
        """Check if movement is coordinated across multiple points (likely real movement)"""
        if len(self.last_valid_keypoints) < 3:
            return True
            
        movement_directions = []
        movement_magnitudes = []
        
        for i, (new_pt, last_pt) in enumerate(zip(new_points, self.last_valid_keypoints)):
            if new_pt[0] != -1 and last_pt[0] != -1 and i != changed_index:
                dx = new_pt[0] - last_pt[0]
                dy = new_pt[1] - last_pt[1]
                magnitude = math.sqrt(dx**2 + dy**2)
                
                if magnitude > 5:
                    movement_directions.append((dx, dy))
                    movement_magnitudes.append(magnitude)
        
        if len(movement_directions) < 2:
            return True
            
        avg_dx = np.mean([d[0] for d in movement_directions])
        avg_dy = np.mean([d[1] for d in movement_directions])
        
        consistency = 0
        for dx, dy in movement_directions:
            dot_product = (dx * avg_dx + dy * avg_dy)
            mag1 = math.sqrt(dx**2 + dy**2)
            mag2 = math.sqrt(avg_dx**2 + avg_dy**2)
            if mag1 > 0 and mag2 > 0:
                cosine_sim = dot_product / (mag1 * mag2)
                consistency += cosine_sim
        
        consistency /= len(movement_directions)
        
        return consistency > 0.7

    def apply_zoom(self, image):
        """Apply zoom and pan to image"""
        if self.zoom_factor <= 1.0:
            return image
            
        h, w = image.shape[:2]
        
        zoom_w = int(w / self.zoom_factor)
        zoom_h = int(h / self.zoom_factor)
        
        if self.zoom_center is None:
            self.zoom_center = (w // 2, h // 2)
            
        center_x, center_y = self.zoom_center
        
        center_x += self.pan_x
        center_y += self.pan_y
        
        center_x = max(zoom_w // 2, min(center_x, w - zoom_w // 2))
        center_y = max(zoom_h // 2, min(center_y, h - zoom_h // 2))
        
        x1 = center_x - zoom_w // 2
        y1 = center_y - zoom_h // 2
        x2 = x1 + zoom_w
        y2 = y1 + zoom_h
        
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)
        
        roi = image[y1:y2, x1:x2]
        if roi.size > 0:
            zoomed = cv2.resize(roi, (w, h), interpolation=cv2.INTER_LINEAR)
            return zoomed
        
        return image

    def original_to_zoomed_coords(self, orig_x, orig_y, img_shape):
        """Convert original coordinates to zoomed display coordinates"""
        if self.zoom_factor <= 1.0:
            return int(orig_x), int(orig_y)
            
        h, w = img_shape[:2]
        zoom_w = w / self.zoom_factor
        zoom_h = h / self.zoom_factor
        
        if self.zoom_center is None:
            self.zoom_center = (w // 2, h // 2)
            
        center_x, center_y = self.zoom_center
        center_x += self.pan_x
        center_y += self.pan_y
        
        x1 = max(0, center_x - zoom_w // 2)
        y1 = max(0, center_y - zoom_h // 2)
        
        zoom_x = (orig_x - x1) * self.zoom_factor
        zoom_y = (orig_y - y1) * self.zoom_factor
        
        return int(zoom_x), int(zoom_y)

    def zoomed_to_original_coords(self, zoom_x, zoom_y, img_shape):
        """Convert zoomed display coordinates to original coordinates"""
        if self.zoom_factor <= 1.0:
            return zoom_x, zoom_y
            
        h, w = img_shape[:2]
        zoom_w = w / self.zoom_factor
        zoom_h = h / self.zoom_factor
        
        if self.zoom_center is None:
            self.zoom_center = (w // 2, h // 2)
            
        center_x, center_y = self.zoom_center
        center_x += self.pan_x
        center_y += self.pan_y
        
        x1 = max(0, center_x - zoom_w // 2)
        y1 = max(0, center_y - zoom_h // 2)
        
        orig_x = x1 + zoom_x / self.zoom_factor
        orig_y = y1 + zoom_y / self.zoom_factor
        
        return int(orig_x), int(orig_y)

    def check_qc(self, pair_num, measured_distance):
        """Check if measurement passes QC tolerance.
        In headless mode, if target distance is not set, auto-pass (no interactive prompts).
        Returns True if PASS, False if FAIL. Results stored in self.qc_results.
        """
        current_target_distances = self.target_distances if self.current_side == 'front' else self.back_target_distances
        
        if pair_num not in current_target_distances:
            # No target distance available — auto-pass (no blocking input in headless mode)
            print(f"[QC] No target distance for Pair {pair_num}, auto-passing")
            self.qc_results[pair_num] = "PASS"
            return True
        
        target_distance = current_target_distances[pair_num]
        tolerance = self.qc_tolerance_cm
        
        if abs(measured_distance - target_distance) <= tolerance:
            self.qc_results[pair_num] = "PASS"
            return True
        else:
            self.qc_results[pair_num] = "FAIL"
            return False

    def draw_large_qc_indicator(self, image, pair_num, passed):
        """Draw aesthetically pleasing QC indicator on screen"""
        h, w = image.shape[:2]
        
        x = w // 2
        y = 100
        
        if passed:
            # PASS - Green gradient with checkmark symbol
            box_color = (0, 200, 0)
            text_color = (255, 255, 255)
            status_text = "PASS"
            glow_color = (0, 255, 0)
        else:
            # FAIL - Red gradient with X symbol
            box_color = (0, 0, 200)
            text_color = (255, 255, 255)
            status_text = "FAIL"
            glow_color = (0, 0, 255)
        
        # Draw glow effect
        for i in range(5, 0, -1):
            alpha = 0.3 / i
            overlay = image.copy()
            cv2.rectangle(overlay, 
                         (x - 200 - i*2, y - 60 - i*2), 
                         (x + 200 + i*2, y + 60 + i*2), 
                         glow_color, -1)
            cv2.addWeighted(overlay, alpha, image, 1 - alpha, 0, image)
        
        # Draw main box with gradient effect
        overlay = image.copy()
        cv2.rectangle(overlay, (x - 200, y - 60), (x + 200, y + 60), box_color, -1)
        cv2.addWeighted(overlay, 0.8, image, 0.2, 0, image)
        
        # Draw shiny border
        cv2.rectangle(image, (x - 200, y - 60), (x + 200, y + 60), (255, 255, 255), 3)
        cv2.rectangle(image, (x - 197, y - 57), (x + 197, y + 57), (200, 200, 200), 1)
        
        # Add status text with shadow
        text_scale = 2.5
        thickness = 5
        text_size = cv2.getTextSize(status_text, cv2.FONT_HERSHEY_DUPLEX, text_scale, thickness)[0]
        text_x = x - text_size[0] // 2
        text_y = y + text_size[1] // 2
        
        # Text shadow
        cv2.putText(image, status_text, (text_x + 3, text_y + 3), 
                   cv2.FONT_HERSHEY_DUPLEX, text_scale, (0, 0, 0), thickness)
        cv2.putText(image, status_text, (text_x, text_y), 
                   cv2.FONT_HERSHEY_DUPLEX, text_scale, text_color, thickness)
        
        # Add pair number below
        pair_text = f"PAIR {pair_num}"
        pair_scale = 1.2
        pair_size = cv2.getTextSize(pair_text, cv2.FONT_HERSHEY_DUPLEX, pair_scale, 3)[0]
        pair_x = x - pair_size[0] // 2
        pair_y = y + 80
        
        cv2.putText(image, pair_text, (pair_x + 2, pair_y + 2), 
                   cv2.FONT_HERSHEY_DUPLEX, pair_scale, (0, 0, 0), 3)
        cv2.putText(image, pair_text, (pair_x, pair_y), 
                   cv2.FONT_HERSHEY_DUPLEX, pair_scale, (255, 255, 255), 2)

    def draw_enhanced_measurement_display(self, display_frame, disp_p1, disp_p2, real_distance, pair_num, qc_passed, scale_factor):
        """Draw professional distance measurements"""
        line_color = (0, 255, 0) if qc_passed else (0, 0, 255)
        cv2.line(display_frame, disp_p1, disp_p2, line_color, self.line_thickness)
        
        mid_x = (disp_p1[0] + disp_p2[0]) // 2
        mid_y = (disp_p1[1] + disp_p2[1]) // 2
        
        distance_text = f"{real_distance:.2f} cm"
        
        text_size = cv2.getTextSize(distance_text, cv2.FONT_HERSHEY_SIMPLEX, 
                                  self.distance_font_scale, self.distance_font_thickness)[0]
        
        padding = 25
        box_width = text_size[0] + padding * 2
        box_height = text_size[1] + padding
        
        if mid_y > display_frame.shape[0] // 2:
            box_y1 = mid_y - box_height - 30
            box_y2 = mid_y - 30
        else:
            box_y1 = mid_y + 30
            box_y2 = mid_y + box_height + 30
            
        box_x1 = mid_x - box_width // 2
        box_x2 = mid_x + box_width // 2
        
        box_x1 = max(10, box_x1)
        box_x2 = min(display_frame.shape[1] - 10, box_x2)
        box_y1 = max(10, box_y1)
        box_y2 = min(display_frame.shape[0] - 10, box_y2)
        
        overlay = display_frame.copy()
        
        cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), 
                     self.distance_bg_color, -1)
        
        cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), 
                     line_color, 4)
        
        cv2.addWeighted(overlay, 0.85, display_frame, 0.15, 0, display_frame)
        
        text_x = box_x1 + (box_width - text_size[0]) // 2
        text_y = box_y1 + (box_height + text_size[1]) // 2
        
        cv2.putText(display_frame, distance_text, 
                   (text_x, text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale, 
                   (0, 0, 0), self.distance_font_thickness + 3)
        
        cv2.putText(display_frame, distance_text, 
                   (text_x, text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale, 
                   self.distance_text_color, self.distance_font_thickness)

    def draw_uncalibrated_measurement(self, display_frame, disp_p1, disp_p2, pixel_distance, pair_num, scale_factor):
        """Draw professional measurement display for uncalibrated mode"""
        cv2.line(display_frame, disp_p1, disp_p2, (255, 0, 255), self.line_thickness)
        
        mid_x = (disp_p1[0] + disp_p2[0]) // 2
        mid_y = (disp_p1[1] + disp_p2[1]) // 2
        
        distance_text = f"{pixel_distance:.1f} px"
        calibrate_text = "CALIBRATE"
        
        main_text_size = cv2.getTextSize(distance_text, cv2.FONT_HERSHEY_SIMPLEX, 
                                       self.distance_font_scale, self.distance_font_thickness)[0]
        calibrate_text_size = cv2.getTextSize(calibrate_text, cv2.FONT_HERSHEY_SIMPLEX, 
                                            self.distance_font_scale * 0.6, self.distance_font_thickness-2)[0]
        
        padding = 25
        box_width = main_text_size[0] + padding * 2
        box_height = main_text_size[1] + calibrate_text_size[1] + padding + 10
        
        if mid_y > display_frame.shape[0] // 2:
            box_y1 = mid_y - box_height - 30
            box_y2 = mid_y - 30
        else:
            box_y1 = mid_y + 30
            box_y2 = mid_y + box_height + 30
            
        box_x1 = mid_x - box_width // 2
        box_x2 = mid_x + box_width // 2
        
        box_x1 = max(10, box_x1)
        box_x2 = min(display_frame.shape[1] - 10, box_x2)
        box_y1 = max(10, box_y1)
        box_y2 = min(display_frame.shape[0] - 10, box_y2)
        
        overlay = display_frame.copy()
        cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), 
                     (0, 0, 0), -1)
        cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), 
                     (255, 0, 255), 4)
        cv2.addWeighted(overlay, 0.85, display_frame, 0.15, 0, display_frame)
        
        main_text_x = box_x1 + (box_width - main_text_size[0]) // 2
        main_text_y = box_y1 + padding + main_text_size[1]
        
        cv2.putText(display_frame, distance_text, 
                   (main_text_x, main_text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale, 
                   (0, 0, 0), self.distance_font_thickness + 3)
        cv2.putText(display_frame, distance_text, 
                   (main_text_x, main_text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale, 
                   (255, 255, 0), self.distance_font_thickness)
        
        calibrate_text_x = box_x1 + (box_width - calibrate_text_size[0]) // 2
        calibrate_text_y = main_text_y + calibrate_text_size[1] + 10
        
        cv2.putText(display_frame, calibrate_text, 
                   (calibrate_text_x, calibrate_text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale * 0.6, 
                   (0, 0, 0), 4)
        cv2.putText(display_frame, calibrate_text, 
                   (calibrate_text_x, calibrate_text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale * 0.6, 
                   (200, 200, 255), 2)

    def draw_placement_guide(self, display_frame):
        """Draw the placement guide box on live feed. Uses front or back placement_box based on current_side."""
        if self.current_side == 'back':
            box = getattr(self, 'back_placement_box', [])
        else:
            box = getattr(self, 'placement_box', [])
        if not box or len(box) != 4:
            return
        
        x1, y1, x2, y2 = box
        disp_p1 = self.original_to_zoomed_coords(x1, y1, display_frame.shape)
        disp_p2 = self.original_to_zoomed_coords(x2, y2, display_frame.shape)
        
        cv2.rectangle(display_frame, disp_p1, disp_p2, (0, 255, 0), 3)
        
        guide_text = "PLACE SHIRT HERE"
        text_size = cv2.getTextSize(guide_text, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)[0]
        text_x = (disp_p1[0] + disp_p2[0] - text_size[0]) // 2
        text_y = disp_p1[1] - 10
        
        if text_y < 30:
            text_y = disp_p2[1] + text_size[1] + 10
        
        cv2.putText(display_frame, guide_text, (text_x, text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 4)
        cv2.putText(display_frame, guide_text, (text_x, text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)

    def show_startup_menu(self):
        """Show startup menu for calibration and annotation options"""
        print("\n" + "="*60)
        print("STARTUP MENU")
        print("="*60)
        
        calibration_exists = os.path.exists(self.calibration_file)
        annotation_exists = os.path.exists(self.annotation_file)
        back_annotation_exists = os.path.exists(self.back_annotation_file)
        reference_image_exists = os.path.exists(self.reference_image_file)
        back_reference_image_exists = os.path.exists(self.back_reference_image_file)
        
        print("📊 Current Status:")
        if calibration_exists:
            print("✅ Calibration: Available")
        else:
            print("❌ Calibration: Not available")
            
        if annotation_exists and reference_image_exists:
            print("✅ Front Annotation: Available (with reference image)")
        elif annotation_exists:
            print("⚠️  Front Annotation: Available but reference image missing")
        else:
            print("❌ Front Annotation: Not available")
            
        if back_annotation_exists and back_reference_image_exists:
            print("✅ Back Annotation: Available (with reference image)")
        elif back_annotation_exists:
            print("⚠️  Back Annotation: Available but reference image missing")
        else:
            print("❌ Back Annotation: Not available")
        
        print("\nOptions:")
        print("1. Use previous calibration & annotation")
        print("2. Create new calibration")
        print("3. Create new annotation (Front)") 
        print("4. Create new annotation (Back)")
        print("5. Create new calibration AND annotation (Front)")
        print("6. Create new calibration AND annotation (Back)")
        print("7. Check current status")
        print("8. Delete all data and start fresh")
        print("9. Exit")
        
        while True:
            choice = input("\nEnter your choice (1-9): ").strip()
            
            if choice == '1':
                cal_loaded = self.load_calibration()
                front_loaded = self.load_annotation()
                back_loaded = self.load_back_annotation()
                
                if cal_loaded and (front_loaded or back_loaded):
                    print("✅ Successfully loaded previous data!")
                    if front_loaded:
                        print(f"📐 Front image: {self.reference_image.shape[1]}x{self.reference_image.shape[0]}")
                        print(f"📍 Front keypoints: {len(self.keypoints)}")
                    if back_loaded:
                        print(f"📐 Back image: {self.back_reference_image.shape[1]}x{self.back_reference_image.shape[0]}")
                        print(f"📍 Back keypoints: {len(self.back_keypoints)}")
                    if self.placement_box:
                        print(f"📦 Placement guide box: Available")
                    return True
                else:
                    if not cal_loaded:
                        print("❌ Failed to load calibration. Please create new calibration.")
                    if not front_loaded and not back_loaded:
                        print("❌ Failed to load annotation. Please create new annotation.")
                    continue
                    
            elif choice == '2':
                if self.calibrate_with_object():
                    self.save_calibration()
                    front_loaded = self.load_annotation()
                    back_loaded = self.load_back_annotation()
                    if not front_loaded and not back_loaded:
                        print("📝 No annotation found. Please create annotation next.")
                    return True
                return False
                
            elif choice == '3':
                if self.load_calibration():
                    if self.annotate_measurement_points('front'):
                        add_box = input("Do you want to add a placement guide box for shirt positioning? (y/n): ").strip().lower()
                        if add_box == 'y' or add_box == 'yes':
                            if self.annotate_placement_guide_box():
                                print("✅ Placement guide box added!")
                        self.save_annotation()
                        return True
                else:
                    print("❌ Calibration required before annotation!")
                    continue
                return False
                
            elif choice == '4':
                if self.load_calibration():
                    if self.annotate_measurement_points('back'):
                        self.save_back_annotation()
                        return True
                else:
                    print("❌ Calibration required before annotation!")
                    continue
                return False
                
            elif choice == '5':
                if self.calibrate_with_object():
                    self.save_calibration()
                    if self.annotate_measurement_points('front'):
                        add_box = input("Do you want to add a placement guide box for shirt positioning? (y/n): ").strip().lower()
                        if add_box == 'y' or add_box == 'yes':
                            if self.annotate_placement_guide_box():
                                print("✅ Placement guide box added!")
                        self.save_annotation()
                        return True
                return False
                
            elif choice == '6':
                if self.calibrate_with_object():
                    self.save_calibration()
                    if self.annotate_measurement_points('back'):
                        self.save_back_annotation()
                        return True
                return False
                
            elif choice == '7':
                cal_status = "Available" if os.path.exists(self.calibration_file) else "Not available"
                front_ann_status = "Available" if os.path.exists(self.annotation_file) else "Not available"
                back_ann_status = "Available" if os.path.exists(self.back_annotation_file) else "Not available"
                front_img_status = "Available" if os.path.exists(self.reference_image_file) else "Not available"
                back_img_status = "Available" if os.path.exists(self.back_reference_image_file) else "Not available"
                print(f"\n📊 Current Status:")
                print(f"📏 Calibration: {cal_status}")
                print(f"📍 Front Annotation: {front_ann_status}")
                print(f"📍 Back Annotation: {back_ann_status}")
                print(f"🖼️  Front Reference Image: {front_img_status}")
                print(f"🖼️  Back Reference Image: {back_img_status}")
                continue
                
            elif choice == '8':
                self.delete_calibration()
                self.delete_annotation()
                print("🗑️ All data deleted. Starting fresh...")
                if self.calibrate_with_object():
                    side = input("Create annotation for (f)ront or (b)ack? ").strip().lower()
                    if side == 'f' or side == 'front':
                        if self.annotate_measurement_points('front'):
                            add_box = input("Do you want to add a placement guide box for shirt positioning? (y/n): ").strip().lower()
                            if add_box == 'y' or add_box == 'yes':
                                if self.annotate_placement_guide_box():
                                    print("✅ Placement guide box added!")
                            self.save_annotation()
                            return True
                    elif side == 'b' or side == 'back':
                        if self.annotate_measurement_points('back'):
                            self.save_back_annotation()
                            return True
                return False
                
            elif choice == '9':
                print("👋 Exiting...")
                return False
                
            else:
                print("❌ Invalid choice! Please enter 1-9")

    def calibrate_with_object(self):
        """Step 1: Calibrate using a known size object"""
        print("\n" + "="*60)
        print("STEP 1: CALIBRATION")
        print("="*60)
        print("Please place an object of known size in the camera view.")
        input("Press Enter when ready to capture calibration frame...")
        
        max_attempts = 5
        calibration_captured = False
        for attempt in range(max_attempts):
            print(f"Calibration capture attempt {attempt + 1}/{max_attempts}...")
            if self.capture_reference_frame():
                calibration_captured = True
                break
            print(f"Attempt {attempt + 1} failed, retrying...")
        
        if not calibration_captured:
            print("Failed to capture calibration frame!")
            return False
        
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0
        
        cal_points = []
        image_copy = self.reference_image.copy()
        
        def redraw_calibration_points():
            nonlocal image_copy, cal_points
            image_copy[:] = self.reference_image.copy()
            if self.zoom_factor > 1.0:
                image_copy[:] = self.apply_zoom(image_copy)
            
            for i, point in enumerate(cal_points):
                disp_x, disp_y = self.original_to_zoomed_coords(point[0], point[1], image_copy.shape)
                cv2.circle(image_copy, (disp_x, disp_y), 8, (0, 255, 0), -1)
                cv2.circle(image_copy, (disp_x, disp_y), 12, (0, 0, 255), 2)
                cv2.putText(image_copy, str(i+1), 
                           (disp_x + 15, disp_y - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
                
            if len(cal_points) == 2:
                disp_p1 = self.original_to_zoomed_coords(cal_points[0][0], cal_points[0][1], image_copy.shape)
                disp_p2 = self.original_to_zoomed_coords(cal_points[1][0], cal_points[1][1], image_copy.shape)
                cv2.line(image_copy, disp_p1, disp_p2, (255, 0, 255), 2)
            
            cv2.imshow("Calibration - Mark two points for known distance", image_copy)
        
        def calibration_mouse_callback(event, x, y, flags, param):
            nonlocal image_copy, cal_points
            
            orig_x, orig_y = self.zoomed_to_original_coords(x, y, image_copy.shape)
            
            if event == cv2.EVENT_LBUTTONDOWN and len(cal_points) < 2:
                cal_points.append([orig_x, orig_y])
                redraw_calibration_points()
        
        window_name = "Calibration - Mark two points for known distance"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(window_name, calibration_mouse_callback)
        
        redraw_calibration_points()
        self.show_calibration_instructions(image_copy, window_name)
        
        print("Calibration window opened. Mark two points for known distance.")
        
        while True:
            cv2.imshow(window_name, image_copy)
            key = cv2.waitKey(1) & 0xFF
            
            if key == ord('s') or key == ord('S'):
                if len(cal_points) == 2:
                    pixel_distance = math.sqrt((cal_points[1][0]-cal_points[0][0])**2 + 
                                             (cal_points[1][1]-cal_points[0][1])**2)
                    
                    try:
                        self.reference_length_cm = float(input(f"Enter the real-world distance between the two points in cm: "))
                        self.pixels_per_cm = pixel_distance / self.reference_length_cm
                        self.is_calibrated = True
                        
                        print(f"✅ Calibration successful!")
                        print(f"📏 Pixel distance: {pixel_distance:.2f} pixels")
                        print(f"📐 Real distance: {self.reference_length_cm} cm")
                        print(f"⚖️ Scale factor: {self.pixels_per_cm:.2f} pixels/cm")
                        break
                    except ValueError:
                        print("❌ Invalid input! Please enter a valid number.")
                        cal_points = []
                        redraw_calibration_points()
                else:
                    print("❌ Please mark exactly 2 points for calibration!")
                    
            elif key == ord('c') or key == ord('C'):
                cal_points = []
                redraw_calibration_points()
                print("Points cleared.")
                
            elif key == ord('z') or key == ord('Z'):
                self.zoom_factor *= 1.2
                redraw_calibration_points()
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('x') or key == ord('X'):
                self.zoom_factor = max(1.0, self.zoom_factor / 1.2)
                redraw_calibration_points()
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('r') or key == ord('R'):
                self.zoom_factor = 1.0
                self.zoom_center = None
                self.pan_x = 0
                self.pan_y = 0
                redraw_calibration_points()
                print("Zoom reset")
                
            elif key == 81:
                self.pan_x -= 30
                redraw_calibration_points()
                print(f"Pan left: {self.pan_x}")
            elif key == 83:
                self.pan_x += 30
                redraw_calibration_points()
                print(f"Pan right: {self.pan_x}")
            elif key == 82:
                self.pan_y -= 30
                redraw_calibration_points()
                print(f"Pan up: {self.pan_y}")
            elif key == 84:
                self.pan_y += 30
                redraw_calibration_points()
                print(f"Pan down: {self.pan_y}")
                    
            elif key == ord('d') or key == ord('D'):
                if self.delete_calibration():
                    print("🗑️ Calibration deleted. You can now create a new one.")
                    
            elif key == ord('h') or key == ord('H'):
                self.show_calibration_instructions(image_copy, window_name)
                    
            elif key == ord('q') or key == ord('Q'):
                cv2.destroyAllWindows()
                return False
        
        cv2.destroyAllWindows()
        return True

    def show_calibration_instructions(self, image, window_name):
        """Display calibration instructions on image"""
        instructions = [
            "CALIBRATION CONTROLS:",
            "Left Click - Place point",
            "Z - Zoom in",
            "X - Zoom out",
            "R - Reset zoom",
            "Arrow Keys - Pan (Left/Right/Up/Down)",
            "C - Clear points",
            "S - Save and Continue",
            "D - Delete existing calibration",
            "H - Show this help",
            "Q - Quit without saving"
        ]
        
        temp_img = image.copy()
        for i, instruction in enumerate(instructions):
            cv2.putText(temp_img, instruction, (10, 30 + i*25), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
            cv2.putText(temp_img, instruction, (10, 30 + i*25), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        cv2.imshow(window_name, temp_img)
        cv2.waitKey(3000)

    def annotate_measurement_points(self, side='front'):
        """Step 2: Annotate points for measurement for front or back with type selection"""
        print("\n" + "="*60)
        print(f"STEP 2: {side.upper()} ANNOTATION")
        print("="*60)
        
        self.current_side = side
        self.annotation_mode = 'normal'  # Start with normal mode
        
        if side == 'front':
            if self.reference_image is None:
                print("❌ No reference image available. Capturing one now...")
                if not self.capture_reference_frame():
                    print("❌ Failed to capture reference frame!")
                    return False
            current_image = self.reference_image
            keypoints_list = self.keypoints
            keypoint_types_list = self.keypoint_types
        else:
            if self.back_reference_image is None:
                print("❌ No back reference image available. Capturing one now...")
                if not self.capture_back_reference_frame():
                    print("❌ Failed to capture back reference frame!")
                    return False
            current_image = self.back_reference_image
            keypoints_list = self.back_keypoints
            keypoint_types_list = self.back_keypoint_types
        
        print(f"Now mark the points you want to measure in the {side} live feed.")
        print("Points will be measured in pairs: 1-2, 3-4, 5-6, etc.")
        print("\n📌 ANNOTATION MODES (press key before clicking):")
        print("   C - CORNER point (press C key, then click) - Enhanced feature extraction")
        print("   P - PERPENDICULAR point (press P key, then click) - 90° alignment, static tracking")
        print("   N - NORMAL point (press N key, then click) - Basic feature extraction")
        print("   I - Clear last point (press I key)")
        print("\nCurrent mode shown in window title. Points are color-coded:")
        print("   🟡 Yellow - CORNER points")
        print("   🟣 Purple - PERPENDICULAR points") 
        print("   🟢 Green - NORMAL points")
        
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0
        
        image_copy = current_image.copy()
        temp_keypoints = []  # Temporary list for [x, y]
        temp_keypoint_types = []  # Temporary list for types
        
        def redraw_annotation(img, points, point_types):
            """Redraw all annotation points on image"""
            img[:] = current_image.copy()
            if self.zoom_factor > 1.0:
                img[:] = self.apply_zoom(img)
            
            for i, point in enumerate(points):
                disp_x, disp_y = self.original_to_zoomed_coords(point[0], point[1], img.shape)
                point_type = point_types[i] if i < len(point_types) else 'normal'
                
                if point_type == 'corner':
                    color = (0, 255, 255)  # Yellow
                    type_letter = "C"
                elif point_type == 'perp':
                    color = (255, 0, 255)  # Purple
                    type_letter = "P"
                else:  # normal
                    color = (0, 255, 0)    # Green
                    type_letter = "N"
                
                cv2.circle(img, (disp_x, disp_y), 8, color, -1)
                cv2.circle(img, (disp_x, disp_y), 12, (0, 0, 255), 2)
                cv2.putText(img, f"{i+1}({type_letter})", 
                           (disp_x + 15, disp_y - 15), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
                
                # Draw lines between odd-even pairs
                if i % 2 == 0 and i+1 < len(points):
                    disp_p2 = self.original_to_zoomed_coords(points[i+1][0], points[i+1][1], img.shape)
                    cv2.line(img, (disp_x, disp_y), disp_p2, (255, 255, 255), 1)
        
        def annotation_mouse_callback(event, x, y, flags, param):
            nonlocal image_copy, temp_keypoints, temp_keypoint_types
            
            orig_x, orig_y = self.zoomed_to_original_coords(x, y, image_copy.shape)
            
            if event == cv2.EVENT_LBUTTONDOWN:
                # Add point with current annotation mode
                temp_keypoints.append([orig_x, orig_y])
                temp_keypoint_types.append(self.annotation_mode)
                redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                print(f"✅ Point {len(temp_keypoints)} placed as {self.annotation_mode.upper()} at ({orig_x}, {orig_y})")
                
            elif event == cv2.EVENT_RBUTTONDOWN:
                if temp_keypoints:
                    # Find nearest point to remove
                    min_dist = float('inf')
                    nearest_idx = -1
                    for i, point in enumerate(temp_keypoints):
                        dist = math.sqrt((point[0] - orig_x)**2 + (point[1] - orig_y)**2)
                        if dist < min_dist:
                            min_dist = dist
                            nearest_idx = i
                    
                    if min_dist < 50:
                        removed_point = temp_keypoints.pop(nearest_idx)
                        removed_type = temp_keypoint_types.pop(nearest_idx)
                        redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                        print(f"❌ Removed point {nearest_idx+1} ({removed_type.upper()})")
        
        window_name = f"{side.upper()} Annotation - Mode: {self.annotation_mode.upper()} (Press H for help)"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(window_name, annotation_mouse_callback)
        
        redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
        self.show_annotation_instructions(image_copy, window_name, side)
        
        print(f"\n{side.capitalize()} annotation window opened. Select mode and mark points.")
        
        while True:
            cv2.imshow(window_name, image_copy)
            key = cv2.waitKey(1) & 0xFF
            
            # Mode selection keys
            if key == ord('c') or key == ord('C'):
                self.annotation_mode = 'corner'
                cv2.setWindowTitle(window_name, f"{side.upper()} Annotation - Mode: CORNER (Press H for help)")
                print("🔧 Switched to CORNER mode - Points will have enhanced feature extraction")
                
            elif key == ord('p') or key == ord('P'):
                self.annotation_mode = 'perp'
                cv2.setWindowTitle(window_name, f"{side.upper()} Annotation - Mode: PERPENDICULAR (Press H for help)")
                print("📏 Switched to PERPENDICULAR mode - Points will be 90° aligned and static during tracking")
                
            elif key == ord('n') or key == ord('N'):
                self.annotation_mode = 'normal'
                cv2.setWindowTitle(window_name, f"{side.upper()} Annotation - Mode: NORMAL (Press H for help)")
                print("📍 Switched to NORMAL mode - Basic feature extraction")
                
            elif key == ord('i') or key == ord('I'):
                # Clear last point
                if temp_keypoints:
                    removed_point = temp_keypoints.pop()
                    removed_type = temp_keypoint_types.pop()
                    redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                    print(f"🗑️ Cleared last point ({removed_type.upper()}) - Total points: {len(temp_keypoints)}")
                else:
                    print("📭 No points to clear")
                
            elif key == ord('s') or key == ord('S'):
                if len(temp_keypoints) >= 2:
                    if side == 'front':
                        self.keypoints = temp_keypoints
                        self.keypoint_types = temp_keypoint_types
                    else:
                        self.back_keypoints = temp_keypoints
                        self.back_keypoint_types = temp_keypoint_types
                    
                    corner_count = sum(1 for t in temp_keypoint_types if t == 'corner')
                    perp_count = sum(1 for t in temp_keypoint_types if t == 'perp')
                    normal_count = sum(1 for t in temp_keypoint_types if t == 'normal')
                    
                    print(f"✅ {side.capitalize()} annotation completed with {len(temp_keypoints)} keypoints")
                    print(f"   - Corner: {corner_count}")
                    print(f"   - Perpendicular: {perp_count}")
                    print(f"   - Normal: {normal_count}")
                    break
                else:
                    print("❌ Need at least 2 keypoints for measurement!")
                    
            elif key == ord('z') or key == ord('Z'):
                self.zoom_factor *= 1.2
                redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('x') or key == ord('X'):
                self.zoom_factor = max(1.0, self.zoom_factor / 1.2)
                redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('r') or key == ord('R'):
                self.zoom_factor = 1.0
                self.zoom_center = None
                self.pan_x = 0
                self.pan_y = 0
                redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                print("Zoom reset")
                
            elif key == 81:
                self.pan_x -= 30
                redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                print(f"Pan left: {self.pan_x}")
            elif key == 83:
                self.pan_x += 30
                redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                print(f"Pan right: {self.pan_x}")
            elif key == 82:
                self.pan_y -= 30
                redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                print(f"Pan up: {self.pan_y}")
            elif key == 84:
                self.pan_y += 30
                redraw_annotation(image_copy, temp_keypoints, temp_keypoint_types)
                print(f"Pan down: {self.pan_y}")
                    
            elif key == ord('h') or key == ord('H'):
                self.show_annotation_instructions(image_copy, window_name, side)
                    
            elif key == ord('q') or key == ord('Q'):
                print(f"{side.capitalize()} annotation cancelled")
                cv2.destroyAllWindows()
                return False
        
        cv2.destroyAllWindows()
        return True

    def show_annotation_instructions(self, image, window_name, side='front'):
        """Display annotation instructions on image"""
        instructions = [
            f"{side.upper()} ANNOTATION CONTROLS:",
            "Select mode FIRST, then click:",
            "C - Switch to CORNER mode (Yellow)",
            "P - Switch to PERPENDICULAR mode (Purple)",
            "N - Switch to NORMAL mode (Green)",
            "I - Clear last point",
            "",
            "Left Click - Place point (in current mode)",
            "Right Click - Remove nearest point", 
            "Z - Zoom in",
            "X - Zoom out",
            "R - Reset zoom",
            "Arrow Keys - Pan",
            "S - Save and Continue",
            "H - Show this help",
            "Q - Quit without saving",
            "",
            "POINT TYPES:",
            "CORNER (C) - Enhanced feature extraction",
            "PERPENDICULAR (P) - 90° alignment, static tracking",
            "NORMAL (N) - Basic feature extraction"
        ]
        
        temp_img = image.copy()
        for i, instruction in enumerate(instructions):
            cv2.putText(temp_img, instruction, (10, 30 + i*25), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
            cv2.putText(temp_img, instruction, (10, 30 + i*25), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        cv2.imshow(window_name, temp_img)
        cv2.waitKey(5000)

    def annotate_placement_guide_box(self):
        """Step 2.5: Annotate placement guide box for accurate shirt positioning"""
        print("\n" + "="*60)
        print("STEP 2.5: PLACEMENT GUIDE BOX ANNOTATION")
        print("="*60)
        print("Draw a rectangle around the area where the shirt should be placed.")
        print("This will help you position the shirt accurately for measurements.")
        
        if self.reference_image is None:
            print("❌ No reference image available!")
            return False
        
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0
        
        image_copy = self.reference_image.copy()
        self.placement_box = []
        drawing = False
        temp_box = []
        
        def redraw_box_annotation(img, start_point, current_point, final=False):
            img[:] = self.reference_image.copy()
            if self.zoom_factor > 1.0:
                img[:] = self.apply_zoom(img)
            
            disp_start = self.original_to_zoomed_coords(start_point[0], start_point[1], img.shape)
            disp_current = self.original_to_zoomed_coords(current_point[0], current_point[1], img.shape)
            
            if final:
                cv2.rectangle(img, (disp_start[0], disp_start[1]), 
                             (disp_current[0], disp_current[1]), 
                             (0, 255, 255), 4)
                
                overlay = img.copy()
                cv2.rectangle(overlay, (disp_start[0], disp_start[1]), 
                             (disp_current[0], disp_current[1]), 
                             (0, 255, 255), -1)
                cv2.addWeighted(overlay, 0.2, img, 0.8, 0, img)
                
                text = "SHIRT PLACEMENT GUIDE"
                text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.0, 3)[0]
                text_x = (disp_start[0] + disp_current[0] - text_size[0]) // 2
                text_y = (disp_start[1] + disp_current[1] + text_size[1]) // 2
                
                cv2.putText(img, text, (text_x, text_y), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 5)
                cv2.putText(img, text, (text_x, text_y), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
            else:
                cv2.rectangle(img, (disp_start[0], disp_start[1]), 
                             (disp_current[0], disp_current[1]), 
                             (255, 0, 0), 2)
        
        def box_mouse_callback(event, x, y, flags, param):
            nonlocal image_copy, drawing, temp_box
            
            orig_x, orig_y = self.zoomed_to_original_coords(x, y, image_copy.shape)
            
            if event == cv2.EVENT_LBUTTONDOWN:
                drawing = True
                temp_box = [[orig_x, orig_y]]
                print(f"Box started at ({orig_x}, {orig_y})")
                
            elif event == cv2.EVENT_MOUSEMOVE:
                if drawing and len(temp_box) == 1:
                    temp_current = [orig_x, orig_y]
                    redraw_box_annotation(image_copy, temp_box[0], temp_current)
                    
            elif event == cv2.EVENT_LBUTTONUP:
                if drawing and len(temp_box) == 1:
                    drawing = False
                    self.placement_box = [temp_box[0][0], temp_box[0][1], orig_x, orig_y]
                    print(f"Box completed: ({self.placement_box[0]}, {self.placement_box[1]}) to ({self.placement_box[2]}, {self.placement_box[3]})")
                    redraw_box_annotation(image_copy, temp_box[0], [orig_x, orig_y], final=True)
        
        window_name = "Placement Guide - Draw box for shirt positioning (Press H for help)"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(window_name, box_mouse_callback)
        
        image_copy[:] = self.reference_image.copy()
        if self.zoom_factor > 1.0:
            image_copy[:] = self.apply_zoom(image_copy)
        self.show_box_instructions(image_copy, window_name)
        
        print("Placement guide window opened. Draw a rectangle for shirt positioning.")
        
        while True:
            cv2.imshow(window_name, image_copy)
            key = cv2.waitKey(1) & 0xFF
            
            if key == ord('s') or key == ord('S'):
                if len(self.placement_box) == 4:
                    x1, y1, x2, y2 = self.placement_box
                    self.placement_box = [
                        min(x1, x2), min(y1, y2),
                        max(x1, x2), max(y1, y2)
                    ]
                    print(f"✅ Placement guide box saved!")
                    print(f"📦 Box coordinates: ({self.placement_box[0]}, {self.placement_box[1]}) to ({self.placement_box[2]}, {self.placement_box[3]})")
                    break
                else:
                    print("❌ Please draw a box first!")
                    
            elif key == ord('c') or key == ord('C'):
                self.placement_box = []
                temp_box = []
                drawing = False
                image_copy[:] = self.reference_image.copy()
                if self.zoom_factor > 1.0:
                    image_copy[:] = self.apply_zoom(image_copy)
                print("Box cleared")
                
            elif key == ord('z') or key == ord('Z'):
                self.zoom_factor *= 1.2
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('x') or key == ord('X'):
                self.zoom_factor = max(1.0, self.zoom_factor / 1.2)
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('r') or key == ord('R'):
                self.zoom_factor = 1.0
                self.zoom_center = None
                self.pan_x = 0
                self.pan_y = 0
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print("Zoom reset")
                
            elif key == 81:
                self.pan_x -= 30
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Pan left: {self.pan_x}")
            elif key == 83:
                self.pan_x += 30
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Pan right: {self.pan_x}")
            elif key == 82:
                self.pan_y -= 30
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Pan up: {self.pan_y}")
            elif key == 84:
                self.pan_y += 30
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Pan down: {self.pan_y}")
                    
            elif key == ord('h') or key == ord('H'):
                self.show_box_instructions(image_copy, window_name)
                    
            elif key == ord('q') or key == ord('Q'):
                print("Placement guide annotation cancelled")
                self.placement_box = []
                cv2.destroyAllWindows()
                return False
        
        cv2.destroyAllWindows()
        return True

    def show_box_instructions(self, image, window_name):
        """Display box annotation instructions on image"""
        instructions = [
            "PLACEMENT GUIDE CONTROLS:",
            "Click & Drag - Draw placement box",
            "Z - Zoom in",
            "X - Zoom out", 
            "R - Reset zoom",
            "Arrow Keys - Pan (Left/Right/Up/Down)",
            "C - Clear box",
            "S - Save and Continue",
            "H - Show this help",
            "Q - Quit without saving",
            "",
            "Draw a box around where the shirt",
            "should be placed for accurate measurements"
        ]
        
        temp_img = image.copy()
        for i, instruction in enumerate(instructions):
            cv2.putText(temp_img, instruction, (10, 30 + i*25), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
            cv2.putText(temp_img, instruction, (10, 30 + i*25), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        cv2.imshow(window_name, temp_img)
        cv2.waitKey(3000)

    def display_measurements_on_terminal(self, measurements):
        """Display measurements in terminal with detailed QC info"""
        print("\n" + "="*50)
        print(f"LIVE {self.current_side.upper()} MEASUREMENTS")
        print("="*50)
        for i, measurement in enumerate(measurements):
            pair_num, distance_cm, distance_px, qc_result = measurement[:4]
            if self.is_calibrated:
                current_target_distances = self.target_distances if self.current_side == 'front' else self.back_target_distances
                target = current_target_distances.get(pair_num, "Not set")
                status = "✅ PASS" if qc_result else "❌ FAIL"
                print(f"Pair {pair_num}: {distance_cm:.2f} cm (Target: {target} cm) - {status}")
            else:
                print(f"Pair {pair_num}: {distance_px:.1f} pixels")
        print("="*50)

    def save_live_measurements(self, measurements, annotation_name=None):
        """Save current live measurements to JSON file for Operator Panel UI access.
        Uses RESULTS_PATH when set by worker so API and worker read/write the same file.
        Merges self.last_measurements before fallback so valid values are never overwritten by 0.0.
        CRITICAL: results_path must be absolute (set by measurement_worker from config) to avoid CWD issues."""
        try:
            # Use config results_path (RESULTS_PATH) when set by measurement_worker for API alignment
            # CRITICAL: Ensure absolute path - worker sets this from config which uses os.path.abspath(RESULTS_PATH)
            results_dir = getattr(self, 'results_path', 'measurement_results')
            # Ensure absolute path (defensive: if somehow relative, resolve relative to PROJECT_ROOT)
            if not os.path.isabs(results_dir):
                import sys
                if getattr(sys, 'frozen', False):
                    exe_path = os.path.abspath(sys.executable)
                    exe_dir = os.path.dirname(exe_path)
                    # Handle nested dist/ layout (consistent with core_main.py)
                    if os.path.basename(exe_dir) == 'dist':
                        parent = os.path.dirname(exe_dir)
                        if os.path.basename(parent) == 'python-core':
                            project_root = os.path.dirname(parent)
                        else:
                            project_root = parent
                    elif os.path.basename(exe_dir) == 'python-core':
                        project_root = os.path.dirname(exe_dir)
                    else:
                        project_root = exe_dir
                else:
                    # Dev mode fallback
                    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
                
                # Default to storage/measurement_results (production standard)
                if results_dir == 'measurement_results':
                    results_dir = os.path.join('storage', results_dir)
                
                results_dir = os.path.abspath(os.path.join(project_root, results_dir))
            
            os.makedirs(results_dir, exist_ok=True)
            
            # File path resolution
            results_file = os.path.join(results_dir, 'live_measurements.json')
            temp_file = results_file + '.tmp'
            
            # Get measurement_specs passed from UI via worker config
            specs = getattr(self, 'measurement_specs', []) or []
            
            measurement_data = {
                'timestamp': time.strftime('%Y-%m-%dT%H:%M:%S'),
                'annotation_name': annotation_name or getattr(self, 'current_annotation_name', 'unknown'),
                'side': self.current_side,
                'is_calibrated': self.is_calibrated,
                'pixels_per_cm': self.pixels_per_cm,
                'tolerance_cm': self.qc_tolerance_cm,
                'garment_color': self.garment_color,
                'measurements': [],
                'results_path': results_file # For verification
            }
            
            # Build measured_by_pair from current frame only
            measured_by_pair = {}
            for measurement in measurements:
                pair_num, real_distance, pixel_distance, qc_passed = measurement[:4]
                is_fallback = measurement[4] if len(measurement) >= 5 else False
                measured_by_pair[pair_num] = {
                    'real_distance': real_distance,
                    'pixel_distance': pixel_distance,
                    'qc_passed': qc_passed,
                    'is_fallback': is_fallback,
                    'from_current_frame': True
                }
            
            # Merge self.last_measurements BEFORE fallback: preserve valid values so we never overwrite with 0.0
            last = getattr(self, 'last_measurements', []) or []
            for m in last:
                if len(m) < 4:
                    continue
                pn, real_dist, px_dist, qc = m[:4]
                if real_dist is not None and real_dist > 0 and pn not in measured_by_pair:
                    measured_by_pair[pn] = {
                        'real_distance': real_dist,
                        'pixel_distance': px_dist,
                        'qc_passed': qc,
                        'is_fallback': True,
                        'from_current_frame': False
                    }
            
            # Determine total pairs: max of specs count and highest measured pair_num
            max_pairs = max(
                len(specs),
                max(measured_by_pair.keys()) if measured_by_pair else 0
            )
            
            # Produce spec-aligned output: only use 0.0 when pair has NEVER been measured
            for pair_num in range(1, max_pairs + 1):
                spec_index = pair_num - 1
                spec = specs[spec_index] if spec_index < len(specs) else None
                
                if pair_num in measured_by_pair:
                    m = measured_by_pair[pair_num]
                    real_distance = m['real_distance']
                    pixel_distance = m['pixel_distance']
                    qc_passed = m['qc_passed']
                    is_fallback = m['is_fallback']
                else:
                    # Pair never measured — emit null (per user request) so UI shows empty
                    real_distance = None
                    pixel_distance = 0.0
                    qc_passed = False
                    is_fallback = True
                
                # Only populated actual_cm for real measurements; null for fallback/missing
                actual_cm_out = round(real_distance, 2) if real_distance is not None else None
                
                entry = {
                    'id': pair_num,
                    'name': spec.get('name', f'Measurement {pair_num}') if spec else f'Measurement {pair_num}',
                    'spec_id': spec.get('db_id') if spec else None,
                    'spec_code': spec.get('code') if spec else None,
                    'actual_cm': actual_cm_out,
                    'pixel_distance': round(pixel_distance, 2),
                    'expected_value': spec.get('expected_value') if spec else None,
                    # Strictly use spec tolerances, default to 1.0 (production alignment)
                    'tolerance_plus': spec.get('tol_plus', 1.0) if spec else 1.0,
                    'tolerance_minus': spec.get('tol_minus', 1.0) if spec else 1.0,
                    'qc_passed': qc_passed,
                    'is_fallback': is_fallback
                }
                measurement_data['measurements'].append(entry)

            # Atomic write to avoid partial reads by API
            try:
                with open(temp_file, 'w') as f:
                    json.dump(measurement_data, f, indent=2)
                os.replace(temp_file, results_file)
            except (IOError, OSError) as e:
                print(f"[ERR] Failed to save live measurements (atomic): {e}")
                # Fallback to direct write if replace fails
                with open(results_file, 'w') as f:
                    json.dump(measurement_data, f, indent=2)

            # Ensure the file is at the final absolute path (log for debugging)
            if not getattr(self, '_save_path_logged', False):
                print(f"[PATH] Authoritative results path: {os.path.abspath(results_file)}")
                self._save_path_logged = True
            
            # Diagnostic: every 30 calls log path, pair mapping, source, side; explicitly call out LEG Opening and Inseam
            self._save_live_call_count = getattr(self, '_save_live_call_count', 0) + 1
            if self._save_live_call_count % 30 == 1:
                print(f"[LIVE] Write path: {live_file_abs} | side={self.current_side}")
                for e in measurement_data['measurements']:
                    m = measured_by_pair.get(e['id'])
                    src = 'current' if (m and m.get('from_current_frame')) else ('last' if m else 'never')
                    print(f"  pair_num={e['id']} actual_cm={e.get('actual_cm')} spec_code={e.get('spec_code')} source={src}")
                # Explicitly log LEG Opening and Inseam so we can confirm they are picked from live measurement
                for e in measurement_data['measurements']:
                    if e.get('spec_code') in ('JD_k-30', 'JD_A-32'):
                        print(f"  [POM] {e.get('spec_code')} ({e.get('name', '')}) actual_cm={e.get('actual_cm')}")
            
            return True
        except Exception as e:
            print(f"[ERR] Error saving live measurements: {e}")
            return False

    def live_mouse_callback(self, event, x, y, flags, param):
        """Mouse callback for live measurement window"""
        if event == cv2.EVENT_MOUSEWHEEL:
            if flags > 0:
                self.zoom_factor *= 1.1
                print(f"Zoom: {self.zoom_factor:.1f}x")
            else:
                self.zoom_factor = max(1.0, self.zoom_factor / 1.1)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            self.zoom_center = (x, y)
            
        elif event == cv2.EVENT_MBUTTONDOWN:
            self.mouse_dragging = True
            self.last_mouse_x = x
            self.last_mouse_y = y
            print("Panning started - drag with middle mouse button")
            
        elif event == cv2.EVENT_MOUSEMOVE:
            if self.mouse_dragging:
                dx = x - self.last_mouse_x
                dy = y - self.last_mouse_y
                
                pan_scale = 1.0 / self.zoom_factor
                self.pan_x += int(dx * pan_scale)
                self.pan_y += int(dy * pan_scale)
                
                self.last_mouse_x = x
                self.last_mouse_y = y
                
        elif event == cv2.EVENT_MBUTTONUP:
            self.mouse_dragging = False
            print("Panning stopped")

    def switch_to_back_side(self):
        """Switch to back side measurement"""
        if not hasattr(self, 'back_keypoints') or not self.back_keypoints or self.back_reference_image is None:
            print("❌ No back annotation found! Please create back annotation first.")
            return False
        
        self.current_side = 'back'
        self.transferred_keypoints = []
        self.is_keypoints_transferred = False
        back_box = getattr(self, 'back_placement_box', [])
        if back_box and len(back_box) == 4:
            print(f"[BACK] Using back placement_box for boundary: {back_box}")
        elif self.back_keypoints:
            print(f"[BACK] Back annotation has {len(self.back_keypoints)} keypoints but no valid placement_box: {back_box}")
        self.keypoint_stabilized = False
        self.last_valid_keypoints = []
        self.stabilization_frames = 0
        self.perpendicular_points_initialized = False
        self.perpendicular_points_static_map = {}
        print("🔄 Switched to BACK side measurement")
        return True

    def switch_to_front_side(self):
        """Switch to front side measurement"""
        if not hasattr(self, 'keypoints') or not self.keypoints or self.reference_image is None:
            print("❌ No front annotation found! Please create front annotation first.")
            return False
        
        self.current_side = 'front'
        self.transferred_keypoints = []
        self.is_keypoints_transferred = False
        self.keypoint_stabilized = False
        self.last_valid_keypoints = []
        self.stabilization_frames = 0
        self.perpendicular_points_initialized = False
        self.perpendicular_points_static_map = {}
        print("🔄 Switched to FRONT side measurement")
        return True

    def transfer_keypoints_to_live(self, headless=False):
        """Step 3: Live measurement with robust keypoint tracking and point-type specific handling
        Args:
            headless: If True, skip interactive prompts, use fullscreen, and save live measurements
        """
        print("\n" + "="*60)
        print("STEP 3: LIVE MEASUREMENT - ROBUST KEYPOINT TRACKING")
        print("="*60)
        print("Keypoints will now adapt based on their type:")
        print("  CORNER points: Enhanced detection (template + Shi-Tomasi + Harris)")
        print("  PERPENDICULAR points: Static after first successful match")
        print("  NORMAL points: Basic feature matching")
        print("PAUSE FUNCTION + MOUSE PAN/ZOOM!")
        print("B KEY: Switch between FRONT and BACK sides!")
        
        # UPDATED: Set camera gain and auto exposure based on garment color for live measurement (with White option)
        self.set_live_gain()
        
        if not headless:
            input("Press Enter to start live measurement...")
        else:
            print("[HEADLESS] Starting live measurement automatically...")
        
        window_name = "Live Measurement - Robust Tracking"
        if headless:
            cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
            cv2.setWindowProperty(window_name, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
        else:
            cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
            cv2.resizeWindow(window_name, 1200, 800)
        
        cv2.setMouseCallback(window_name, self.live_mouse_callback)
        
        terminal_update_counter = 0
        self.keypoint_stabilized = False
        self.last_valid_keypoints = []
        self.stabilization_frames = 0
        self.last_detected_scale = 1.0
        self.perpendicular_points_initialized = False
        self.perpendicular_points_static_map = {}
        
        # Option to toggle perpendicular points static behavior
        perpendicular_static_mode = True  # Default to static mode
        
        # External stop flag for headless mode (set by measurement_worker)
        self.should_stop = getattr(self, 'should_stop', False)
        
        while True:
            if not self.paused:
                frame_gray = self.capture_live_frame()
                if frame_gray is None:
                    continue
                
                display_frame = cv2.cvtColor(frame_gray, cv2.COLOR_GRAY2BGR)
                display_frame = self.apply_zoom(display_frame)
                
                self.pause_frame = display_frame.copy()
            else:
                display_frame = self.pause_frame.copy()
            
            # Draw placement guide for current side (front or back) when box is available
            if self.current_side == 'front' and hasattr(self, 'placement_box') and self.placement_box and len(self.placement_box) == 4:
                self.draw_placement_guide(display_frame)
            elif self.current_side == 'back' and getattr(self, 'back_placement_box', []) and len(getattr(self, 'back_placement_box', [])) == 4:
                self.draw_placement_guide(display_frame)
            
            if not self.paused:
                current_time = time.time()
                if current_time - self.last_transfer_time >= self.transfer_interval:
                    if self.current_side == 'front':
                        self.transferred_keypoints = self.transfer_keypoints_robust(frame_gray)
                    else:
                        self.transferred_keypoints = self.transfer_keypoints_robust(frame_gray)
                    self.last_transfer_time = current_time
                    if len(self.transferred_keypoints) > 0:
                        self.is_keypoints_transferred = True
            
            current_measurements = []
            
            if self.is_keypoints_transferred and self.transferred_keypoints:
                valid_points_count = 0
                current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
                current_keypoint_types = self.keypoint_types if self.current_side == 'front' else self.back_keypoint_types
                
                # Draw keypoints with type-specific colors
                for i, point in enumerate(self.transferred_keypoints):
                    if point[0] == -1 or point[1] == -1:
                        continue
                        
                    valid_points_count += 1
                    disp_x, disp_y = self.original_to_zoomed_coords(point[0], point[1], display_frame.shape)
                    
                    point_type = current_keypoint_types[i] if i < len(current_keypoint_types) else 'normal'
                    
                    if point_type == 'corner':
                        if self.keypoint_stabilized:
                            color = (0, 255, 255)  # Yellow
                        else:
                            color = (0, 200, 255)  # Orange-yellow
                        type_letter = "C"
                    elif point_type == 'perp':
                        if self.perpendicular_points_initialized and perpendicular_static_mode:
                            color = (255, 0, 255)  # Bright Purple for static perpendicular points
                        else:
                            color = (255, 0, 200)  # Magenta for adaptive perpendicular points
                        type_letter = "P"
                    else:  # normal
                        if self.keypoint_stabilized:
                            color = (0, 255, 0)  # Green
                        else:
                            color = (0, 255, 255)  # Yellow-green
                        type_letter = "N"
                    
                    cv2.circle(display_frame, (disp_x, disp_y), self.keypoint_size, color, -1)
                    cv2.circle(display_frame, (disp_x, disp_y), self.keypoint_size + 3, (0, 0, 255), self.keypoint_border)
                    
                    cv2.putText(display_frame, f"{i+1}({type_letter})", 
                               (disp_x + 20, disp_y - 20), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 0, 0), 3)
                
                # Draw distances between pairs
                for i in range(0, len(self.transferred_keypoints)-1, 2):
                    if i+1 < len(self.transferred_keypoints):
                        p1 = self.transferred_keypoints[i]
                        p2 = self.transferred_keypoints[i+1]
                        
                        if p1[0] == -1 or p1[1] == -1 or p2[0] == -1 or p2[1] == -1:
                            continue
                        
                        disp_p1 = self.original_to_zoomed_coords(p1[0], p1[1], display_frame.shape)
                        disp_p2 = self.original_to_zoomed_coords(p2[0], p2[1], display_frame.shape)
                        
                        pixel_distance = math.sqrt((p2[0]-p1[0])**2 + (p2[1]-p1[1])**2)
                        
                        if self.is_calibrated:
                            real_distance = pixel_distance / self.pixels_per_cm
                            pair_num = i//2 + 1
                            
                            qc_passed = self.check_qc(pair_num, real_distance)
                            self.draw_large_qc_indicator(display_frame, pair_num, qc_passed)
                            
                            self.draw_enhanced_measurement_display(
                                display_frame, disp_p1, disp_p2, real_distance, 
                                pair_num, qc_passed, self.last_detected_scale
                            )
                            
                            current_measurements.append((pair_num, real_distance, pixel_distance, qc_passed))
                        else:
                            self.draw_uncalibrated_measurement(
                                display_frame, disp_p1, disp_p2, pixel_distance,
                                i//2 + 1, self.last_detected_scale
                            )
                            current_measurements.append((i//2+1, 0, pixel_distance, False))
            
            # Persist current measurements for QC-triggered saves and next-frame reference
            if current_measurements:
                self.last_measurements = current_measurements
            if not self.paused:
                terminal_update_counter += 1
                if terminal_update_counter >= 20 and current_measurements:
                    self.display_measurements_on_terminal(current_measurements)
                    terminal_update_counter = 0
                # In headless mode: save every frame so QC results and status update live in Operator Panel
                # Pass current frame data when available; otherwise last_measurements (merge inside save preserves valid values)
                if headless:
                    payload = current_measurements if current_measurements else getattr(self, 'last_measurements', [])
                    self.save_live_measurements(payload)
            
            if self.paused:
                h, w = display_frame.shape[:2]
                cv2.putText(display_frame, "PAUSED", (int(w/2 - 150), int(h/2)), 
                           cv2.FONT_HERSHEY_SIMPLEX, 3, (0, 0, 255), 8)
                cv2.putText(display_frame, "Press P to resume", (int(w/2 - 180), int(h/2) + 60), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 3)
            
            # Add subtle status indicators at the bottom of the screen
            h, w = display_frame.shape[:2]
            bottom_y = h - 30
            
            # Draw semi-transparent background for status
            overlay = display_frame.copy()
            cv2.rectangle(overlay, (0, h - 60), (w, h), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.3, display_frame, 0.7, 0, display_frame)
            
            # Add simple status text at the bottom
            cv2.putText(display_frame, f"Side: {self.current_side.upper()}", 
                       (20, bottom_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
            cv2.putText(display_frame, f"Zoom: {self.zoom_factor:.1f}x", 
                       (200, bottom_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
            cv2.putText(display_frame, f"Points: {valid_points_count}/{len(current_keypoints) if current_keypoints else 0}", 
                       (380, bottom_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 2)
            cv2.putText(display_frame, "Controls: P=Pause, B=Side, Z/X=Zoom", 
                       (620, bottom_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (150, 150, 150), 2)
            
            cv2.imshow(window_name, display_frame)
            
            # Check external stop flag (for headless mode)
            if headless and getattr(self, 'should_stop', False):
                print("[HEADLESS] Stop signal received, exiting measurement loop")
                break
            
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == ord('Q'):
                break
            elif key == ord('p') or key == ord('P'):
                self.paused = not self.paused
                if self.paused:
                    print("⏸️ Measurement PAUSED - Press P to resume")
                else:
                    print("▶️ Measurement RESUMED")
            elif key == ord('y') or key == ord('Y'):
                # Toggle perpendicular points static/adaptive mode
                if self.perpendicular_points_initialized:
                    perpendicular_static_mode = not perpendicular_static_mode
                    if perpendicular_static_mode:
                        print("📏 Perpendicular points now STATIC")
                        # Re-apply static positions
                        for idx, static_pt in self.perpendicular_points_static_map.items():
                            if idx < len(self.transferred_keypoints):
                                self.transferred_keypoints[idx] = static_pt.copy()
                    else:
                        print("📏 Perpendicular points now ADAPTIVE (will move with garment)")
            elif key == ord('b') or key == ord('B'):
                if self.current_side == 'front':
                    if self.switch_to_back_side():
                        print("🔄 Switched to BACK side")
                        self.perpendicular_points_initialized = False
                    else:
                        print("❌ Failed to switch to back side - no back annotation found")
                else:
                    if self.switch_to_front_side():
                        print("🔄 Switched to FRONT side")
                        self.perpendicular_points_initialized = False
                    else:
                        print("❌ Failed to switch to front side - no front annotation found")
            elif key == ord('z') or key == ord('Z'):
                self.zoom_factor *= 1.2
                print(f"Zoom: {self.zoom_factor:.1f}x")
            elif key == ord('x') or key == ord('X'):
                self.zoom_factor = max(1.0, self.zoom_factor / 1.2)
                print(f"Zoom: {self.zoom_factor:.1f}x")
            elif key == ord('r') or key == ord('R'):
                self.zoom_factor = 1.0
                self.zoom_center = None
                self.pan_x = 0
                self.pan_y = 0
                print("Zoom reset")
            elif key == 81:
                self.pan_x -= 20
                print(f"Pan left: {self.pan_x}")
            elif key == 83:
                self.pan_x += 20
                print(f"Pan right: {self.pan_x}")
            elif key == 82:
                self.pan_y -= 20
                print(f"Pan up: {self.pan_y}")
            elif key == 84:
                self.pan_y += 20
                print(f"Pan down: {self.pan_y}")
        
        cv2.destroyAllWindows()
        return True

    def run(self):
        """Main execution function"""
        print("=" * 60)
        print("🎯 ROBUST LIVE KEYPOINT DISTANCE MEASUREMENT")
        print("=" * 60)
        print("Now with point-type specific tracking!")
        print("NEW FEATURES:")
        print("  • CORNER points: Enhanced detection (template + Shi-Tomasi + Harris)")
        print("  • PERPENDICULAR points: 90° alignment during annotation, static tracking")
        print("  • NORMAL points: Basic feature extraction")
        print("  • Camera gain adjustment based on garment color:")
        print("    - White: Gain 20, Auto Exposure ON (for ALL captures)")
        print("    - Black: Gain 150, Auto Exposure OFF (for ALL captures)")
        print("    - Other: Gain 64, Auto Exposure ON (for ALL captures)")
        print("=" * 60)
        
        if not self.initialize_camera():
            return
        
        try:
            if not self.show_startup_menu():
                return
            
            self.transfer_keypoints_to_live()
            
        finally:
            if self.camera_obj:
                self.camera_obj.close()
            print("Measurement session ended")

# Run the application
if __name__ == "__main__":
    app = LiveKeypointDistanceMeasurer()
    app.run()