# -*- coding: utf-8 -*-
import sys
import os

# Fix Windows console encoding for Unicode characters
os.environ['PYTHONIOENCODING'] = 'utf-8'

import cv2
import numpy as np
import math
from mvsdk import *
import platform
import json
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
        self.keypoints = []
        self.transferred_keypoints = []
        
        # Back side data
        self.back_reference_image = None
        self.back_reference_gray = None
        self.back_keypoints = []
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
        
        # Resolution handling for webcam vs native camera images
        self.NATIVE_WIDTH = 5488
        self.NATIVE_HEIGHT = 3672
        self.WEBCAM_WIDTH = 1920
        self.WEBCAM_HEIGHT = 1080
        self.reference_is_webcam_resolution = False  # True if ref image is webcam res
        self.reference_scale_factor = 1.0  # Scale factor from ref to native
        # Matching resolution images (for feature matching)
        self.reference_gray_matching = None  # Reference at matching resolution
        self.keypoints_matching = []  # Keypoints scaled for matching resolution
        
        # NEW: Pause functionality
        self.paused = False
        self.pause_frame = None
        
        # Calibration and annotation file paths
        self.calibration_file = "camera_calibration.json"
        self.annotation_file = "annotation_data.json"
        self.back_annotation_file = "back_annotation_data.json"  # NEW: Back side annotation
        self.reference_image_file = "reference_image.jpg"
        self.back_reference_image_file = "back_reference_image.jpg"  # NEW: Back side reference image
        
        # MULTIPLE Feature matching parameters
        self.feature_detectors = {
            'orb': cv2.ORB_create(nfeatures=3500),  # Primary detector for speed
            'brisk': cv2.BRISK_create()  # Secondary detector
        }
        self.matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)  # For binary descriptors
        self.min_matches = 15  # Reduced for faster processing
        self.good_match_ratio = 0.75
        
        # QC Parameters
        self.qc_tolerance_cm = 100.0
        self.target_distances = {}
        self.back_target_distances = {}  # NEW: Back side target distances
        self.qc_results = {}
        
        # Enhanced Keypoint stabilization
        self.keypoint_stabilized = False
        self.stabilization_threshold = 17.0
        self.last_valid_keypoints = []
        self.stabilization_frames = 0
        
        # Performance optimization
        self.last_transfer_time = 0
        self.transfer_interval = 0.06  # Faster transfer for responsiveness
        
        # Template matching for fallback
        self.template_roi_size = 85
        self.template_matching_threshold = 0.70
        
        # Size adaptation parameters
        self.last_detected_scale = 1.0
        self.scale_smoothing_factor = 0.3
        self.adaptive_search_radius = 50
        
        # Keypoint transfer method selection
        self.transfer_method = 'homography'  # 'homography', 'mls', or 'auto'
        self.alpha = 1.0  # MLS parameter
        
        # ENHANCED DISPLAY PARAMETERS FOR BETTER VISIBILITY
        self.distance_font_scale = 2.5  # Increased from 2.2
        self.distance_font_thickness = 8  # Adjusted for better clarity
        self.distance_text_color = (255, 255, 0)  # Yellow
        self.distance_bg_color = (0, 0, 0)  # Black
        self.line_thickness = 4
        self.keypoint_size = 12
        self.keypoint_border = 3
        
        # Reduced measurement display parameters
        self.measurement_box_height = 120
        self.measurement_box_width = 400
        
        # NEW: Enhanced Corner keypoint parameters
        self.corner_keypoints_count = 12  # Increased from 6 to 12 for better corner coverage
        self.corner_template_size = 150  # Increased from 120
        self.corner_matching_threshold = 0.6  # Lowered from 0.65
        
        # NEW: Mouse panning parameters
        self.mouse_dragging = False
        self.last_mouse_x = 0
        self.last_mouse_y = 0

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
                    print("[OK] Calibration loaded successfully!")
                    print(f"[SCALE] Scale factor: {self.pixels_per_cm:.2f} pixels/cm")
                    print(f"[DIM] Reference length: {self.reference_length_cm} cm")
                    return True
                else:
                    print("[ERR] Calibration file exists but is not valid")
                    return False
            else:
                print("[DIR] No calibration file found")
                return False
                
        except Exception as e:
            print(f"[ERR] Error loading calibration: {e}")
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
            
            print("[SAVE] Calibration saved successfully!")
            return True
            
        except Exception as e:
            print(f"[ERR] Error saving calibration: {e}")
            return False

    def save_live_measurements(self, measurements, annotation_name=None):
        """Save current live measurements to JSON file for Laravel UI access"""
        try:
            # Determine output path
            if hasattr(self, 'annotations_dir') and self.annotations_dir:
                results_dir = os.path.join(os.path.dirname(self.annotations_dir), 'measurement_results')
            else:
                results_dir = 'measurement_results'
            
            os.makedirs(results_dir, exist_ok=True)
            
            # Build measurement data
            measurement_data = {
                'timestamp': str(np.datetime64('now')),
                'annotation_name': annotation_name or getattr(self, 'current_annotation_name', 'unknown'),
                'side': self.current_side if hasattr(self, 'current_side') else 'front',
                'is_calibrated': self.is_calibrated,
                'pixels_per_cm': self.pixels_per_cm,
                'tolerance_cm': 1.0,  # Default tolerance of 1cm
                'measurements': []
            }
            
            # Get keypoint names if available
            keypoint_names = getattr(self, 'keypoint_names', [])
            
            for measurement in measurements:
                # Support both old (4-tuple) and new (5-tuple with fallback flag) formats
                if len(measurement) >= 5:
                    pair_num, real_distance, pixel_distance, qc_passed, is_fallback = measurement[:5]
                else:
                    pair_num, real_distance, pixel_distance, qc_passed = measurement[:4]
                    is_fallback = False
                    
                name = keypoint_names[pair_num - 1] if pair_num <= len(keypoint_names) else f'Measurement {pair_num}'
                measurement_data['measurements'].append({
                    'id': pair_num,
                    'name': name,
                    'actual_cm': round(real_distance, 2),
                    'pixel_distance': round(pixel_distance, 2),
                    'tolerance_plus': 1.0,
                    'tolerance_minus': 1.0,
                    'min_valid': round(real_distance - 1.0, 2),
                    'max_valid': round(real_distance + 1.0, 2),
                    'qc_passed': qc_passed,
                    'is_fallback': is_fallback  # True if tracking failed and used annotation position
                })
            
            # Save to live_measurements.json (always overwritten with latest)
            live_file = os.path.join(results_dir, 'live_measurements.json')
            with open(live_file, 'w') as f:
                json.dump(measurement_data, f, indent=4)
            
            return True
        except Exception as e:
            print(f"[ERR] Error saving live measurements: {e}")
            return False

    def save_reference_image(self):
        """Save reference image to file"""
        try:
            if self.reference_image is not None:
                # Save reference image as JPEG
                success = cv2.imwrite(self.reference_image_file, self.reference_image)
                if success:
                    print(f"[SAVE] Reference image saved: {self.reference_image_file}")
                    return True
                else:
                    print("[ERR] Failed to save reference image")
                    return False
            else:
                print("[ERR] No reference image to save")
                return False
        except Exception as e:
            print(f"[ERR] Error saving reference image: {e}")
            return False

    def save_back_reference_image(self):
        """Save back reference image to file"""
        try:
            if self.back_reference_image is not None:
                # Save back reference image as JPEG
                success = cv2.imwrite(self.back_reference_image_file, self.back_reference_image)
                if success:
                    print(f"[SAVE] Back reference image saved: {self.back_reference_image_file}")
                    return True
                else:
                    print("[ERR] Failed to save back reference image")
                    return False
            else:
                print("[ERR] No back reference image to save")
                return False
        except Exception as e:
            print(f"[ERR] Error saving back reference image: {e}")
            return False

    def load_reference_image(self):
        """Load reference image from file with resolution detection"""
        try:
            print(f"[DEBUG] Attempting to load reference image from: {self.reference_image_file}")
            print(f"[DEBUG] File exists: {os.path.exists(self.reference_image_file)}")
            
            if os.path.exists(self.reference_image_file):
                # Log file details
                file_size = os.path.getsize(self.reference_image_file)
                print(f"[DEBUG] Reference image file size: {file_size} bytes")
                
                self.reference_image = cv2.imread(self.reference_image_file)
                if self.reference_image is not None:
                    img_height, img_width = self.reference_image.shape[:2]
                    
                    # Detect if reference is webcam resolution (upscaled to native)
                    # Check for signs of upscaling: native dimensions but low detail
                    # Also check if it's already at webcam resolution
                    if img_width == self.WEBCAM_WIDTH and img_height == self.WEBCAM_HEIGHT:
                        self.reference_is_webcam_resolution = True
                        self.reference_scale_factor = self.NATIVE_WIDTH / self.WEBCAM_WIDTH
                        print(f"[RES] Reference is at WEBCAM resolution ({img_width}x{img_height})")
                        print(f"[RES] Scale factor to native: {self.reference_scale_factor:.3f}")
                    elif img_width == self.NATIVE_WIDTH and img_height == self.NATIVE_HEIGHT:
                        # Native resolution - check if it might be upscaled
                        # For now, assume it might be upscaled if we have webcam keypoints
                        self.reference_is_webcam_resolution = False
                        self.reference_scale_factor = 1.0
                        print(f"[RES] Reference is at NATIVE resolution ({img_width}x{img_height})")
                    else:
                        self.reference_is_webcam_resolution = False
                        self.reference_scale_factor = 1.0
                        print(f"[RES] Reference is at UNKNOWN resolution ({img_width}x{img_height})")
                    
                    # Create grayscale version for processing
                    self.reference_gray = cv2.cvtColor(self.reference_image, cv2.COLOR_BGR2GRAY)
                    print(f"[OK] Reference image loaded: {self.reference_image_file}")
                    print(f"[DIM] BGR Image dimensions: {self.reference_image.shape}")
                    print(f"[DIM] Grayscale dimensions: {self.reference_gray.shape}")
                    
                    # Create matching-resolution version for feature matching
                    # Always work at webcam resolution for matching to avoid upscaled blur
                    self._prepare_matching_images()
                    
                    return True
                else:
                    print("[ERR] Failed to load reference image")
                    return False
            else:
                print(f"[DIR] No reference image file found at: {self.reference_image_file}")
                return False
        except Exception as e:
            print(f"[ERR] Error loading reference image: {e}")
            return False
    
    def _prepare_matching_images(self):
        """Prepare images and keypoints at matching resolution (webcam res)"""
        if self.reference_gray is None:
            return
        
        img_height, img_width = self.reference_gray.shape[:2]
        
        # If reference is larger than webcam resolution, resize for matching
        if img_width > self.WEBCAM_WIDTH:
            self.reference_gray_matching = cv2.resize(
                self.reference_gray, 
                (self.WEBCAM_WIDTH, self.WEBCAM_HEIGHT),
                interpolation=cv2.INTER_AREA  # Best for downscaling
            )
            scale_factor = self.WEBCAM_WIDTH / img_width
            print(f"[MATCH] Created matching reference at {self.WEBCAM_WIDTH}x{self.WEBCAM_HEIGHT}")
            print(f"[MATCH] Scale factor for keypoints: {scale_factor:.3f}")
            
            # Scale keypoints to matching resolution
            self.keypoints_matching = []
            for kp in self.keypoints:
                scaled_x = int(kp[0] * scale_factor)
                scaled_y = int(kp[1] * scale_factor)
                self.keypoints_matching.append([scaled_x, scaled_y])
            print(f"[MATCH] Scaled {len(self.keypoints_matching)} keypoints to matching resolution")
        else:
            # Reference is already at or below matching resolution
            self.reference_gray_matching = self.reference_gray.copy()
            self.keypoints_matching = [kp.copy() if isinstance(kp, list) else list(kp) for kp in self.keypoints]
            print(f"[MATCH] Using reference as-is for matching (already at {img_width}x{img_height})")

    def load_back_reference_image(self):
        """Load back reference image from file"""
        try:
            if os.path.exists(self.back_reference_image_file):
                self.back_reference_image = cv2.imread(self.back_reference_image_file)
                if self.back_reference_image is not None:
                    # Create grayscale version for faster processing
                    self.back_reference_gray = cv2.cvtColor(self.back_reference_image, cv2.COLOR_BGR2GRAY)
                    print(f"[OK] Back reference image loaded: {self.back_reference_image_file}")
                    print(f"[DIM] Image dimensions: {self.back_reference_image.shape[1]}x{self.back_reference_image.shape[0]}")
                    return True
                else:
                    print("[ERR] Failed to load back reference image")
                    return False
            else:
                print("[DIR] No back reference image file found")
                return False
        except Exception as e:
            print(f"[ERR] Error loading back reference image: {e}")
            return False

    def load_annotation(self):
        """Load annotation data from JSON file and reference image"""
        try:
            if os.path.exists(self.annotation_file):
                with open(self.annotation_file, 'r') as f:
                    annotation_data = json.load(f)
                
                self.keypoints = annotation_data.get('keypoints', [])
                self.target_distances = annotation_data.get('target_distances', {})
                self.placement_box = annotation_data.get('placement_box', [])  # Load placement box
                
                # Convert string keys to integers for target_distances
                self.target_distances = {int(k): float(v) for k, v in self.target_distances.items()}
                
                if self.keypoints:
                    print("[OK] Annotation data loaded successfully!")
                    print(f"[PTS] Loaded {len(self.keypoints)} keypoints")
                    print(f"[TGT] Loaded {len(self.target_distances)} target distances")
                    if self.placement_box:
                        print(f"[BOX] Loaded placement guide box")
                    
                    # Now load the reference image
                    if self.load_reference_image():
                        return True
                    else:
                        print("[ERR] Annotation loaded but reference image missing")
                        return False
                else:
                    print("[ERR] Annotation file exists but has no keypoints")
                    return False
            else:
                print("[DIR] No annotation file found")
                return False
                
        except Exception as e:
            print(f"[ERR] Error loading annotation: {e}")
            return False

    def load_back_annotation(self):
        """Load back annotation data from JSON file and reference image"""
        try:
            if os.path.exists(self.back_annotation_file):
                with open(self.back_annotation_file, 'r') as f:
                    annotation_data = json.load(f)
                
                self.back_keypoints = annotation_data.get('keypoints', [])
                self.back_target_distances = annotation_data.get('target_distances', {})
                
                # Convert string keys to integers for target_distances
                self.back_target_distances = {int(k): float(v) for k, v in self.back_target_distances.items()}
                
                if self.back_keypoints:
                    print("[OK] Back annotation data loaded successfully!")
                    print(f"[PTS] Loaded {len(self.back_keypoints)} back keypoints")
                    print(f"[TGT] Loaded {len(self.back_target_distances)} back target distances")
                    
                    # Now load the back reference image
                    if self.load_back_reference_image():
                        return True
                    else:
                        print("[ERR] Back annotation loaded but reference image missing")
                        return False
                else:
                    print("[ERR] Back annotation file exists but has no keypoints")
                    return False
            else:
                print("[DIR] No back annotation file found")
                return False
                
        except Exception as e:
            print(f"[ERR] Error loading back annotation: {e}")
            return False

    def save_annotation(self):
        """Save annotation data to JSON file and reference image"""
        try:
            annotation_data = {
                'keypoints': self.keypoints,
                'target_distances': self.target_distances,
                'placement_box': getattr(self, 'placement_box', []),  # Add placement box
                'annotation_date': str(np.datetime64('now'))
            }
            
            with open(self.annotation_file, 'w') as f:
                json.dump(annotation_data, f, indent=4)
            
            print("[SAVE] Annotation data saved successfully!")
            print(f"[PTS] Saved {len(self.keypoints)} keypoints")
            print(f"[TGT] Saved {len(self.target_distances)} target distances")
            if hasattr(self, 'placement_box') and self.placement_box:
                print(f"[BOX] Saved placement guide box")
            
            # Also save the reference image
            if self.save_reference_image():
                return True
            else:
                print("[ERR] Annotation saved but reference image save failed")
                return False
            
        except Exception as e:
            print(f"[ERR] Error saving annotation: {e}")
            return False

    def save_back_annotation(self):
        """Save back annotation data to JSON file and reference image"""
        try:
            annotation_data = {
                'keypoints': self.back_keypoints,
                'target_distances': self.back_target_distances,
                'annotation_date': str(np.datetime64('now'))
            }
            
            with open(self.back_annotation_file, 'w') as f:
                json.dump(annotation_data, f, indent=4)
            
            print("[SAVE] Back annotation data saved successfully!")
            print(f"[PTS] Saved {len(self.back_keypoints)} back keypoints")
            print(f"[TGT] Saved {len(self.back_target_distances)} back target distances")
            
            # Also save the back reference image
            if self.save_back_reference_image():
                return True
            else:
                print("[ERR] Back annotation saved but reference image save failed")
                return False
            
        except Exception as e:
            print(f"[ERR] Error saving back annotation: {e}")
            return False

    def delete_calibration(self):
        """Delete existing calibration file"""
        try:
            if os.path.exists(self.calibration_file):
                os.remove(self.calibration_file)
                self.is_calibrated = False
                self.pixels_per_cm = 0
                self.reference_length_cm = 0
                print("[DEL] Calibration deleted successfully!")
                return True
            else:
                print("[DIR] No calibration file to delete")
                return False
        except Exception as e:
            print(f"[ERR] Error deleting calibration: {e}")
            return False

    def delete_annotation(self):
        """Delete existing annotation file and reference image"""
        try:
            files_deleted = 0
            if os.path.exists(self.annotation_file):
                os.remove(self.annotation_file)
                files_deleted += 1
                print("[DEL] Annotation file deleted successfully!")
            
            if os.path.exists(self.back_annotation_file):
                os.remove(self.back_annotation_file)
                files_deleted += 1
                print("[DEL] Back annotation file deleted successfully!")
            
            if os.path.exists(self.reference_image_file):
                os.remove(self.reference_image_file)
                files_deleted += 1
                print("[DEL] Reference image deleted successfully!")
            
            if os.path.exists(self.back_reference_image_file):
                os.remove(self.back_reference_image_file)
                files_deleted += 1
                print("[DEL] Back reference image deleted successfully!")
            
            self.keypoints = []
            self.back_keypoints = []
            self.target_distances = {}
            self.back_target_distances = {}
            self.reference_image = None
            self.reference_gray = None
            self.back_reference_image = None
            self.back_reference_gray = None
            self.placement_box = []
            
            if files_deleted == 0:
                print("[DIR] No annotation files to delete")
            
            return True
        except Exception as e:
            print(f"[ERR] Error deleting annotation: {e}")
            return False

    def initialize_camera(self):
        """Initialize the MindVision camera"""
        try:
            CameraSdkInit(1)
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
            return True
            
        except CameraException as e:
            print(f"Camera initialization failed: {e}")
            return False

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
            
            FrameBufferSize = cap.sResolutionRange.iWidthMax * cap.sResolutionRange.iHeightMax * 1  # Mono = 1 channel
            pFrameBuffer = CameraAlignMalloc(FrameBufferSize, 16)
            
            CameraSetTriggerMode(hCamera, 0)
            CameraSetAeState(hCamera, 1)
            CameraSetAnalogGain(hCamera, 64)
            CameraPlay(hCamera)
            
            self.hCamera = hCamera
            self.pFrameBuffer = pFrameBuffer
            self.cap = cap
            
            print(f"Camera opened successfully: {self.DevInfo.GetFriendlyName()}")
            print("[CAM] Camera mode: MONOCHROME (for faster processing)")
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
                frame = frame.reshape((FrameHead.iHeight, FrameHead.iWidth, 1))  # Mono channel
                
                return frame
                
            except CameraException as e:
                if e.error_code != CAMERA_STATUS_TIME_OUT:
                    print("CameraGetImageBuffer failed({}): {}".format(e.error_code, e.message))
                return None

    def capture_reference_frame(self):
        """Capture a reference frame from camera"""
        if self.camera_obj is None:
            print("[ERR] Camera object is None!")
            return False
        
        frame = self.camera_obj.grab()
        if frame is not None:
            try:
                # Squeeze mono (h,w,1) to grayscale (h,w)
                if len(frame.shape) == 3 and frame.shape[2] == 1:
                    frame_2d = frame[:, :, 0]
                else:
                    frame_2d = frame
                
                # Convert grayscale to BGR for display and annotation
                self.reference_image = cv2.cvtColor(frame_2d, cv2.COLOR_GRAY2BGR)
                # Keep proper 2D grayscale for processing
                self.reference_gray = frame_2d.copy()
                print(f"[OK] Reference frame captured: {self.reference_image.shape[1]}x{self.reference_image.shape[0]}")
                print(f"[OK] Reference gray shape: {self.reference_gray.shape}")
                return True
            except Exception as e:
                print(f"[ERR] Failed to process frame: {e}")
                return False
        else:
            print("[WARN] Camera grab() returned None")
            return False

    def capture_back_reference_frame(self):
        """Capture a back reference frame from camera"""
        frame = self.camera_obj.grab()
        if frame is not None:
            # Squeeze mono (h,w,1) to grayscale (h,w)
            if len(frame.shape) == 3 and frame.shape[2] == 1:
                frame_2d = frame[:, :, 0]
            else:
                frame_2d = frame
            
            # Convert grayscale to BGR for display and annotation
            self.back_reference_image = cv2.cvtColor(frame_2d, cv2.COLOR_GRAY2BGR)
            # Keep proper 2D grayscale for processing
            self.back_reference_gray = frame_2d.copy()
            print(f"Back reference frame captured: {self.back_reference_image.shape[1]}x{self.back_reference_image.shape[0]}")
            print(f"[OK] Back reference gray shape: {self.back_reference_gray.shape}")
            return True
        return False

    def capture_live_frame(self):
        """Capture a live frame from camera - returns proper 2D grayscale for processing"""
        frame = self.camera_obj.grab()
        if frame is not None:
            # Squeeze mono (h,w,1) to grayscale (h,w)
            if len(frame.shape) == 3 and frame.shape[2] == 1:
                return frame[:, :, 0]
            return frame
        return None

    def extract_features_fast(self, image):
        """Extract features using fast methods optimized for grayscale"""
        # Handle different input formats
        if image is None:
            return [], None
        
        # Ensure 2D grayscale
        if len(image.shape) == 3:
            if image.shape[2] == 1:
                # Mono channel (h,w,1) - squeeze to (h,w)
                gray = image[:, :, 0]
            elif image.shape[2] == 3:
                # BGR - convert to grayscale
                gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
            else:
                gray = image
        else:
            # Already 2D grayscale
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
            # For binary descriptors like ORB, BRISK
            matches = self.matcher.knnMatch(desc1, desc2, k=2)
            
            # Apply ratio test
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
            
            # Find homography with RANSAC
            H, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
            
            if H is None:
                return None, []
            
            # Check if homography is reasonable
            det = np.linalg.det(H)
            if 0.1 < abs(det) < 10.0:  # Reasonable scale change
                # Transform all reference keypoints
                transformed_points = []
                current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
                
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
        if len(matches) < 4:  # Need at least 4 points for MLS
            return None, []
            
        try:
            # Extract matched points
            src_pts = np.float32([ref_kp[m.queryIdx].pt for m in matches])
            dst_pts = np.float32([curr_kp[m.trainIdx].pt for m in matches])
            
            current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
            transformed_points = []
            
            for ref_point in current_keypoints:
                # For each reference keypoint, compute MLS transformation
                total_weight = 0
                weighted_x = 0
                weighted_y = 0
                
                for i, match in enumerate(matches):
                    src_match_pt = src_pts[i]
                    dst_match_pt = dst_pts[i]
                    
                    # Calculate distance between reference keypoint and this matched point
                    distance = np.linalg.norm(np.array(ref_point) - src_match_pt)
                    
                    if distance < 1e-6:  # Avoid division by zero
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
        
        # Calculate distances between all pairs in both sets
        ref_distances = []
        curr_distances = []
        
        for i in range(len(matches)):
            for j in range(i+1, len(matches)):
                ref_dist = np.linalg.norm(src_pts[i] - src_pts[j])
                curr_dist = np.linalg.norm(dst_pts[i] - dst_pts[j])
                if ref_dist > 10:  # Only consider significant distances
                    ref_distances.append(ref_dist)
                    curr_distances.append(curr_dist)
        
        if len(ref_distances) == 0:
            return 1.0
            
        # Calculate median scale change
        scales = [curr_d / ref_d for curr_d, ref_d in zip(curr_distances, ref_distances) if ref_d > 0]
        
        if len(scales) == 0:
            return 1.0
            
        median_scale = np.median(scales)
        
        # Smooth scale changes
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
            # Create template around keypoint in reference image
            x, y = int(keypoint[0]), int(keypoint[1])
            
            # Adjust template size based on scale
            template_size = int(self.template_roi_size * scale_factor)
            half_size = template_size // 2
            
            # Extract template from reference (with bounds checking)
            x1 = max(0, x - half_size)
            y1 = max(0, y - half_size)
            x2 = min(ref_w, x + half_size)
            y2 = min(ref_h, y + half_size)
            
            if x2 - x1 < 10 or y2 - y1 < 10:
                transferred_points.append([-1, -1])
                continue
                
            template = current_reference_gray[y1:y2, x1:x2]
            
            # Search region in current frame (expanded based on scale)
            search_multiplier = 2.0 * scale_factor
            search_half_size = int(template_size * search_multiplier)
            
            # Estimate position based on scale
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
                # Perform template matching
                result = cv2.matchTemplate(search_region, template, cv2.TM_CCOEFF_NORMED)
                min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(result)
                
                if max_val > self.template_matching_threshold:
                    # Found good match
                    match_x = sx1 + max_loc[0] + template.shape[1] // 2
                    match_y = sy1 + max_loc[1] + template.shape[0] // 2
                    transferred_points.append([match_x, match_y])
                else:
                    transferred_points.append([-1, -1])
                    
            except Exception as e:
                transferred_points.append([-1, -1])
        
        return transferred_points

    def template_match_corners(self, current_gray, scale_factor=1.0):
        """Enhanced template matching specifically for corner keypoints"""
        current_reference_gray = self.reference_gray if self.current_side == 'front' else self.back_reference_gray
        current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
        
        if current_reference_gray is None or len(current_keypoints) == 0:
            return []
            
        h, w = current_gray.shape[:2]
        ref_h, ref_w = current_reference_gray.shape[:2]
        
        corner_points = []
        
        # Process only corner keypoints (first 12)
        for i in range(min(self.corner_keypoints_count, len(current_keypoints))):
            keypoint = current_keypoints[i]
            x, y = int(keypoint[0]), int(keypoint[1])
            
            # Use larger template for corners
            template_size = int(self.corner_template_size * scale_factor)
            half_size = template_size // 2
            
            # Extract template from reference
            x1 = max(0, x - half_size)
            y1 = max(0, y - half_size)
            x2 = min(ref_w, x + half_size)
            y2 = min(ref_h, y + half_size)
            
            if x2 - x1 < 20 or y2 - y1 < 20:
                corner_points.append([-1, -1])
                continue
                
            template = current_reference_gray[y1:y2, x1:x2]
            
            # Larger search region for corners
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
                # Try multiple template matching methods for corners
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
                    match_y = sx1 + best_match_loc[1] + template.shape[0] // 2
                    corner_points.append([match_x, match_y])
                else:
                    corner_points.append([-1, -1])
                    
            except Exception as e:
                corner_points.append([-1, -1])
        
        return corner_points

    def detect_corners_robust(self, current_gray, scale_factor=1.0):
        """ENHANCED: Robust corner detection using multiple methods including Shi-Tomasi"""
        current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
        
        if len(current_keypoints) < min(self.corner_keypoints_count, len(current_keypoints)):
            return []
            
        h, w = current_gray.shape[:2]
        
        # Method 1: Enhanced template matching for corners
        template_points = self.template_match_corners(current_gray, scale_factor)
        
        # Method 2: Shi-Tomasi corner detection (NEW)
        shitomasi_points = []
        
        for i in range(min(self.corner_keypoints_count, len(current_keypoints))):
            keypoint = current_keypoints[i]
            x, y = int(keypoint[0] * scale_factor), int(keypoint[1] * scale_factor)
            
            # Define search region around expected corner position
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
                # Shi-Tomasi corner detection
                corners = cv2.goodFeaturesToTrack(search_region, maxCorners=1, 
                                                qualityLevel=0.01, minDistance=10)
                
                if corners is not None and len(corners) > 0:
                    # Get the strongest corner
                    corner_x = x1 + corners[0][0][0]
                    corner_y = y1 + corners[0][0][1]
                    shitomasi_points.append([corner_x, corner_y])
                else:
                    shitomasi_points.append([-1, -1])
                    
            except Exception as e:
                shitomasi_points.append([-1, -1])
        
        # Method 3: Harris corner detection (fallback)
        harris_points = []
        
        for i in range(min(self.corner_keypoints_count, len(current_keypoints))):
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
                # Harris corner detection
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
        """Robust keypoint transfer using multiple methods with grayscale processing
        
        RESOLUTION-AWARE: Performs matching at webcam resolution to avoid issues with
        upscaled reference images that have blurry features.
        """
        current_reference_gray = self.reference_gray if self.current_side == 'front' else self.back_reference_gray
        current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
        
        if current_reference_gray is None or len(current_keypoints) == 0:
            print(f"[DEBUG] transfer_keypoints_robust: ref_gray={current_reference_gray is not None}, keypoints={len(current_keypoints)}")
            return []
        
        # Get matching-resolution reference image and keypoints
        ref_gray_for_matching = self.reference_gray_matching if self.reference_gray_matching is not None else current_reference_gray
        keypoints_for_matching = self.keypoints_matching if self.keypoints_matching else current_keypoints
        
        # Check if we need to resize live frame to match reference resolution
        live_height, live_width = current_gray.shape[:2]
        ref_height, ref_width = ref_gray_for_matching.shape[:2]
        
        # Scale factors for converting between resolutions
        scale_up_x = live_width / ref_width  # To scale matched points back to live resolution
        scale_up_y = live_height / ref_height
        need_scale_up = abs(scale_up_x - 1.0) > 0.01 or abs(scale_up_y - 1.0) > 0.01
        
        # Resize live frame to matching resolution if needed
        if need_scale_up:
            current_gray_matching = cv2.resize(
                current_gray, 
                (ref_width, ref_height),
                interpolation=cv2.INTER_AREA  # Best for downscaling
            )
        else:
            current_gray_matching = current_gray
        
        # DEBUG: Print image shapes once
        if not hasattr(self, '_shape_debug_printed') or not self._shape_debug_printed:
            print(f"[DEBUG] Reference gray shape (original): {current_reference_gray.shape}")
            print(f"[DEBUG] Reference gray shape (matching): {ref_gray_for_matching.shape}")
            print(f"[DEBUG] Current (live) gray shape (original): {current_gray.shape}")
            print(f"[DEBUG] Current (live) gray shape (matching): {current_gray_matching.shape}")
            print(f"[DEBUG] Scale up factors: x={scale_up_x:.3f}, y={scale_up_y:.3f}")
            print(f"[DEBUG] Number of keypoints (original): {len(current_keypoints)}")
            print(f"[DEBUG] Number of keypoints (matching): {len(keypoints_for_matching)}")
            print(f"[DEBUG] First keypoint (original): {current_keypoints[0] if current_keypoints else 'N/A'}")
            print(f"[DEBUG] First keypoint (matching): {keypoints_for_matching[0] if keypoints_for_matching else 'N/A'}")
            self._shape_debug_printed = True
            
        try:
            # METHOD 1: Feature-based matching with homography/MLS
            # Use matching-resolution images for feature extraction
            ref_kp, ref_desc = self.extract_features_fast(ref_gray_for_matching)
            curr_kp, curr_desc = self.extract_features_fast(current_gray_matching)
            
            feature_points = []
            scale_factor = 1.0
            
            if ref_desc is not None and curr_desc is not None and len(ref_desc) > 0 and len(curr_desc) > 0:
                matches = self.match_features_fast(ref_desc, curr_desc)
                
                if len(matches) >= self.min_matches:
                    # Estimate scale change
                    scale_factor = self.estimate_scale_change(ref_kp, curr_kp, matches)
                    
                    # Choose transfer method based on match quality and count
                    if len(matches) >= 20 and self.transfer_method in ['homography', 'auto']:
                        # Use homography for good matches (rigid transformation)
                        H, homography_points = self.transfer_with_homography(ref_kp, ref_desc, curr_kp, curr_desc, matches)
                        if homography_points:
                            feature_points = homography_points
                            print("[FIX] Using Homography transfer")
                        else:
                            # Fallback to MLS
                            _, mls_points = self.transfer_with_mls(ref_kp, ref_desc, curr_kp, curr_desc, matches)
                            feature_points = mls_points
                            print("[FIX] Using MLS transfer (homography fallback)")
                    else:
                        # Use MLS for fewer matches or non-rigid deformation
                        _, mls_points = self.transfer_with_mls(ref_kp, ref_desc, curr_kp, curr_desc, matches)
                        feature_points = mls_points
                        print("[FIX] Using MLS transfer")
                else:
                    feature_points = [[-1, -1]] * len(current_keypoints)
            else:
                feature_points = [[-1, -1]] * len(current_keypoints)
            
            # METHOD 2: Template matching with adaptive scale
            template_points = self.template_match_keypoints(current_gray, scale_factor)
            
            # NEW: METHOD 3: Enhanced corner detection for first 12 keypoints
            corner_points = self.detect_corners_robust(current_gray, scale_factor)
            
            # METHOD 4: Fusion of all methods
            fused_points = []
            valid_feature_count = 0
            valid_template_count = 0
            valid_corner_count = 0
            
            for i in range(len(current_keypoints)):
                feat_pt = feature_points[i]
                temp_pt = template_points[i]
                
                # For corner keypoints, use specialized corner detection
                if i < self.corner_keypoints_count and i < len(corner_points):
                    corner_pt = corner_points[i]
                    
                    # Count valid points for method selection
                    if feat_pt[0] != -1:
                        valid_feature_count += 1
                    if temp_pt[0] != -1:
                        valid_template_count += 1
                    if corner_pt[0] != -1:
                        valid_corner_count += 1
                    
                    # Priority: Corner detection > Feature matching > Template matching
                    if corner_pt[0] != -1:
                        fused_points.append(corner_pt)
                    elif feat_pt[0] != -1:
                        fused_points.append(feat_pt)
                    elif temp_pt[0] != -1:
                        fused_points.append(temp_pt)
                    else:
                        fused_points.append([-1, -1])
                else:
                    # Regular keypoints: use original fusion logic
                    if feat_pt[0] != -1:
                        valid_feature_count += 1
                    if temp_pt[0] != -1:
                        valid_template_count += 1
                    
                    # If both methods agree (within threshold), use weighted average
                    if feat_pt[0] != -1 and temp_pt[0] != -1:
                        distance = math.sqrt((feat_pt[0]-temp_pt[0])**2 + (feat_pt[1]-temp_pt[1])**2)
                        if distance < 25:  # Points are close enough
                            # Weight based on method reliability
                            feature_weight = 0.7 if len(matches) >= self.min_matches else 0.4
                            template_weight = 1.0 - feature_weight
                            
                            x = (feat_pt[0] * feature_weight + temp_pt[0] * template_weight)
                            y = (feat_pt[1] * feature_weight + temp_pt[1] * template_weight)
                            fused_points.append([x, y])
                        else:
                            # Prefer feature matching if they disagree but feature is good
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
            
            # Print transfer method statistics
            if len(matches) >= self.min_matches:
                print(f"[STAT] Transfer: {len(matches)} matches, {valid_feature_count}/{len(current_keypoints)} feature points, {valid_template_count}/{len(current_keypoints)} template points, {valid_corner_count}/{min(self.corner_keypoints_count, len(current_keypoints))} corner points")
            else:
                # DEBUG: Print when no tracking is working
                print(f"[WARN] Keypoint transfer failed: matches={len(matches) if 'matches' in locals() else 0}, min_required={self.min_matches}")
                print(f"[WARN] Feature descriptors - ref: {len(ref_desc) if ref_desc is not None else 0}, curr: {len(curr_desc) if curr_desc is not None else 0}")
            
            # Apply stabilization to fused points
            stabilized_points = self.stabilize_keypoints(fused_points)
            
            # Scale up points to live resolution if matching was done at lower resolution
            if need_scale_up:
                scaled_points = []
                for pt in stabilized_points:
                    if pt[0] != -1 and pt[1] != -1:
                        scaled_x = pt[0] * scale_up_x
                        scaled_y = pt[1] * scale_up_y
                        scaled_points.append([scaled_x, scaled_y])
                    else:
                        scaled_points.append([-1, -1])
                return scaled_points
            
            return stabilized_points
            
        except Exception as e:
            print(f"Error in robust keypoint transfer: {e}")
            # Fallback to simple template matching
            return self.template_match_keypoints(current_gray, 1.0)

    def stabilize_keypoints(self, new_keypoints):
        """Enhanced stabilization that allows for real movement but reduces jitter"""
        if not self.last_valid_keypoints or len(self.last_valid_keypoints) != len(new_keypoints):
            self.last_valid_keypoints = new_keypoints
            return new_keypoints
        
        stabilized_points = []
        valid_count = 0
        
        for i, (new_point, last_point) in enumerate(zip(new_keypoints, self.last_valid_keypoints)):
            if new_point[0] == -1 or new_point[1] == -1:
                # Use last valid point if current is invalid
                stabilized_points.append(last_point)
            else:
                # Calculate distance from last valid point
                distance = math.sqrt((new_point[0] - last_point[0])**2 + (new_point[1] - last_point[1])**2)
                
                if distance < self.stabilization_threshold:
                    # Point is stable, use current position
                    stabilized_points.append(new_point)
                    valid_count += 1
                else:
                    # Check if this is part of a coordinated movement (likely real)
                    coordinated_movement = self.check_coordinated_movement(new_keypoints, i)
                    if coordinated_movement:
                        # Accept the movement as real
                        stabilized_points.append(new_point)
                        valid_count += 1
                    else:
                        # Likely jitter, use last position
                        stabilized_points.append(last_point)
        
        self.last_valid_keypoints = stabilized_points
        
        # Update stabilization status
        if valid_count == len(new_keypoints):
            self.stabilization_frames += 1
            if self.stabilization_frames >= 2:  # Faster stabilization
                self.keypoint_stabilized = True
        else:
            self.stabilization_frames = 0
            self.keypoint_stabilized = False
        
        return stabilized_points

    def check_coordinated_movement(self, new_points, changed_index):
        """Check if movement is coordinated across multiple points (likely real movement)"""
        if len(self.last_valid_keypoints) < 3:
            return True  # Not enough points to check, assume real movement
            
        movement_directions = []
        movement_magnitudes = []
        
        for i, (new_pt, last_pt) in enumerate(zip(new_points, self.last_valid_keypoints)):
            if new_pt[0] != -1 and last_pt[0] != -1 and i != changed_index:
                dx = new_pt[0] - last_pt[0]
                dy = new_pt[1] - last_pt[1]
                magnitude = math.sqrt(dx**2 + dy**2)
                
                if magnitude > 5:  # Significant movement
                    movement_directions.append((dx, dy))
                    movement_magnitudes.append(magnitude)
        
        if len(movement_directions) < 2:
            return True  # Not enough data, assume real movement
            
        # Check consistency of movement directions
        avg_dx = np.mean([d[0] for d in movement_directions])
        avg_dy = np.mean([d[1] for d in movement_directions])
        avg_magnitude = np.mean(movement_magnitudes)
        
        # Calculate how consistent the movements are
        consistency = 0
        for dx, dy in movement_directions:
            dot_product = (dx * avg_dx + dy * avg_dy)
            mag1 = math.sqrt(dx**2 + dy**2)
            mag2 = math.sqrt(avg_dx**2 + avg_dy**2)
            if mag1 > 0 and mag2 > 0:
                cosine_sim = dot_product / (mag1 * mag2)
                consistency += cosine_sim
        
        consistency /= len(movement_directions)
        
        # If movements are consistent, it's likely real object movement
        return consistency > 0.7

    def apply_zoom(self, image):
        """Apply zoom and pan to image"""
        if self.zoom_factor <= 1.0:
            return image
            
        h, w = image.shape[:2]
        
        # Calculate zoomed dimensions
        zoom_w = int(w / self.zoom_factor)
        zoom_h = int(h / self.zoom_factor)
        
        # Calculate region of interest
        if self.zoom_center is None:
            self.zoom_center = (w // 2, h // 2)
            
        center_x, center_y = self.zoom_center
        
        # Apply pan
        center_x += self.pan_x
        center_y += self.pan_y
        
        # Ensure center stays within bounds
        center_x = max(zoom_w // 2, min(center_x, w - zoom_w // 2))
        center_y = max(zoom_h // 2, min(center_y, h - zoom_h // 2))
        
        # Calculate ROI
        x1 = center_x - zoom_w // 2
        y1 = center_y - zoom_h // 2
        x2 = x1 + zoom_w
        y2 = y1 + zoom_h
        
        # Ensure ROI is within image bounds
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)
        
        # Extract and resize ROI
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
        
        # Calculate ROI bounds
        x1 = max(0, center_x - zoom_w // 2)
        y1 = max(0, center_y - zoom_h // 2)
        
        # Convert to zoomed coordinates
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
        
        # Calculate ROI bounds
        x1 = max(0, center_x - zoom_w // 2)
        y1 = max(0, center_y - zoom_h // 2)
        
        # Convert to original coordinates
        orig_x = x1 + zoom_x / self.zoom_factor
        orig_y = y1 + zoom_y / self.zoom_factor
        
        return int(orig_x), int(orig_y)

    def check_qc(self, pair_num, measured_distance):
        """Check if measurement passes QC tolerance"""
        current_target_distances = self.target_distances if self.current_side == 'front' else self.back_target_distances
        
        if pair_num not in current_target_distances:
            # No target set - use measured distance as target (auto-pass first measurement)
            # Don't ask user - just use the measured value
            current_target_distances[pair_num] = measured_distance
            # Save annotation silently with new target distance
            if self.current_side == 'front':
                self.save_annotation()
            else:
                self.save_back_annotation()
            return True  # Auto-pass first measurement
        
        target_distance = current_target_distances[pair_num]
        tolerance = self.qc_tolerance_cm
        
        if abs(measured_distance - target_distance) <= tolerance:
            self.qc_results[pair_num] = "PASS"
            return True
        else:
            self.qc_results[pair_num] = "FAIL"
            return False

    def draw_large_qc_indicator(self, image, pair_num, passed):
        """Draw LARGE box-shaped QC indicator on screen"""
        h, w = image.shape[:2]
        
        # Position for QC indicator (top center)
        x = w // 2
        y = 120
        
        # Large box dimensions
        box_width = 350
        box_height = 140
        corner_radius = 20
        
        # Calculate box coordinates
        x1 = x - box_width // 2
        y1 = y - box_height // 2
        x2 = x + box_width // 2
        y2 = y + box_height // 2
        
        if passed:
            # Green PASS box
            box_color = (0, 255, 0)
            text_color = (0, 0, 0)
            status_text = "PASS"
        else:
            # Red FAIL box
            box_color = (0, 0, 255)
            text_color = (255, 255, 255)
            status_text = "FAIL"
        
        # Draw rounded rectangle
        cv2.rectangle(image, (x1, y1), (x2, y2), box_color, -1)
        cv2.rectangle(image, (x1, y1), (x2, y2), (255, 255, 255), 4)
        
        # Draw large text
        text_scale = 5.2
        thickness = 5
        
        # Main status text
        text_size = cv2.getTextSize(status_text, cv2.FONT_HERSHEY_SIMPLEX, text_scale, thickness)[0]
        text_x = x - text_size[0] // 2
        text_y = y + text_size[1] // 2
        cv2.putText(image, status_text, (text_x, text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, text_scale, text_color, thickness)
        
        # Pair number text
        pair_text = f"Pair {pair_num}"
        pair_scale = 1.4
        pair_size = cv2.getTextSize(pair_text, cv2.FONT_HERSHEY_SIMPLEX, pair_scale, 3)[0]
        pair_x = x - pair_size[0] // 2
        pair_y = y1 - 15
        cv2.putText(image, pair_text, (pair_x, pair_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, pair_scale, (255, 255, 255), 4)

    def draw_enhanced_measurement_display(self, display_frame, disp_p1, disp_p2, real_distance, pair_num, qc_passed, scale_factor):
        """Draw professional distance measurements - SIMPLIFIED VERSION"""
        # Draw measurement line
        line_color = (0, 255, 0) if qc_passed else (0, 0, 255)  # Green for PASS, Red for FAIL
        cv2.line(display_frame, disp_p1, disp_p2, line_color, self.line_thickness)
        
        # Calculate midpoint for text placement
        mid_x = (disp_p1[0] + disp_p2[0]) // 2
        mid_y = (disp_p1[1] + disp_p2[1]) // 2
        
        # Create clean, professional text
        distance_text = f"{real_distance:.2f} cm"
        
        # Calculate text dimensions for proper background
        text_size = cv2.getTextSize(distance_text, cv2.FONT_HERSHEY_SIMPLEX, 
                                  self.distance_font_scale, self.distance_font_thickness)[0]
        
        # Add padding
        padding = 25
        box_width = text_size[0] + padding * 2
        box_height = text_size[1] + padding
        
        # Position box above or below midpoint to avoid overlapping the line
        if mid_y > display_frame.shape[0] // 2:
            # Position above midpoint
            box_y1 = mid_y - box_height - 30
            box_y2 = mid_y - 30
        else:
            # Position below midpoint  
            box_y1 = mid_y + 30
            box_y2 = mid_y + box_height + 30
            
        box_x1 = mid_x - box_width // 2
        box_x2 = mid_x + box_width // 2
        
        # Ensure box stays within frame bounds
        box_x1 = max(10, box_x1)
        box_x2 = min(display_frame.shape[1] - 10, box_x2)
        box_y1 = max(10, box_y1)
        box_y2 = min(display_frame.shape[0] - 10, box_y2)
        
        # Draw professional background with rounded corners effect
        overlay = display_frame.copy()
        
        # Draw main background rectangle
        cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), 
                     self.distance_bg_color, -1)
        
        # Add border with measurement line color
        cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), 
                     line_color, 4)
        
        # Apply semi-transparent overlay
        cv2.addWeighted(overlay, 0.85, display_frame, 0.15, 0, display_frame)
        
        # Draw clean, professional text with outline for better readability
        text_x = box_x1 + (box_width - text_size[0]) // 2
        text_y = box_y1 + (box_height + text_size[1]) // 2
        
        # Draw black outline first for better visibility
        cv2.putText(display_frame, distance_text, 
                   (text_x, text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale, 
                   (0, 0, 0), self.distance_font_thickness + 3)
        
        # Draw main text
        cv2.putText(display_frame, distance_text, 
                   (text_x, text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale, 
                   self.distance_text_color, self.distance_font_thickness)

    def draw_uncalibrated_measurement(self, display_frame, disp_p1, disp_p2, pixel_distance, pair_num, scale_factor):
        """Draw professional measurement display for uncalibrated mode"""
        # Draw measurement line
        cv2.line(display_frame, disp_p1, disp_p2, (255, 0, 255), self.line_thickness)
        
        # Calculate midpoint
        mid_x = (disp_p1[0] + disp_p2[0]) // 2
        mid_y = (disp_p1[1] + disp_p2[1]) // 2
        
        # Create clean text
        distance_text = f"{pixel_distance:.1f} px"
        calibrate_text = "CALIBRATE"
        
        # Calculate dimensions for main text
        main_text_size = cv2.getTextSize(distance_text, cv2.FONT_HERSHEY_SIMPLEX, 
                                       self.distance_font_scale, self.distance_font_thickness)[0]
        calibrate_text_size = cv2.getTextSize(calibrate_text, cv2.FONT_HERSHEY_SIMPLEX, 
                                            self.distance_font_scale * 0.6, self.distance_font_thickness-2)[0]
        
        # Use main text dimensions for box
        padding = 25
        box_width = main_text_size[0] + padding * 2
        box_height = main_text_size[1] + calibrate_text_size[1] + padding + 10
        
        # Position box
        if mid_y > display_frame.shape[0] // 2:
            box_y1 = mid_y - box_height - 30
            box_y2 = mid_y - 30
        else:
            box_y1 = mid_y + 30
            box_y2 = mid_y + box_height + 30
            
        box_x1 = mid_x - box_width // 2
        box_x2 = mid_x + box_width // 2
        
        # Ensure box stays within frame
        box_x1 = max(10, box_x1)
        box_x2 = min(display_frame.shape[1] - 10, box_x2)
        box_y1 = max(10, box_y1)
        box_y2 = min(display_frame.shape[0] - 10, box_y2)
        
        # Draw professional background
        overlay = display_frame.copy()
        cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), 
                     (0, 0, 0), -1)
        cv2.rectangle(overlay, (box_x1, box_y1), (box_x2, box_y2), 
                     (255, 0, 255), 4)
        cv2.addWeighted(overlay, 0.85, display_frame, 0.15, 0, display_frame)
        
        # Draw text with outline for better readability
        main_text_x = box_x1 + (box_width - main_text_size[0]) // 2
        main_text_y = box_y1 + padding + main_text_size[1]
        
        # Main distance text
        cv2.putText(display_frame, distance_text, 
                   (main_text_x, main_text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale, 
                   (0, 0, 0), self.distance_font_thickness + 3)
        cv2.putText(display_frame, distance_text, 
                   (main_text_x, main_text_y), 
                   cv2.FONT_HERSHEY_SIMPLEX, self.distance_font_scale, 
                   (255, 255, 0), self.distance_font_thickness)
        
        # Calibration text below
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
        """Draw the placement guide box on live feed"""
        if not hasattr(self, 'placement_box') or not self.placement_box or len(self.placement_box) != 4:
            return
        
        # Convert original coordinates to zoomed coordinates for display
        x1, y1, x2, y2 = self.placement_box
        disp_p1 = self.original_to_zoomed_coords(x1, y1, display_frame.shape)
        disp_p2 = self.original_to_zoomed_coords(x2, y2, display_frame.shape)
        
        # Draw simple border only (no fill, no transparency)
        cv2.rectangle(display_frame, disp_p1, disp_p2, (0, 255, 0), 3)  # Green border, thickness 3
        
        # Add guide text
        guide_text = "PLACE SHIRT HERE"
        text_size = cv2.getTextSize(guide_text, cv2.FONT_HERSHEY_SIMPLEX, 0.8, 2)[0]
        text_x = (disp_p1[0] + disp_p2[0] - text_size[0]) // 2
        text_y = disp_p1[1] - 10
        
        # Ensure text doesn't go off screen
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
        
        # Check for existing calibration and annotation
        calibration_exists = os.path.exists(self.calibration_file)
        annotation_exists = os.path.exists(self.annotation_file)
        back_annotation_exists = os.path.exists(self.back_annotation_file)
        reference_image_exists = os.path.exists(self.reference_image_file)
        back_reference_image_exists = os.path.exists(self.back_reference_image_file)
        
        print("[STAT] Current Status:")
        if calibration_exists:
            print("[OK] Calibration: Available")
        else:
            print("[ERR] Calibration: Not available")
            
        if annotation_exists and reference_image_exists:
            print("[OK] Front Annotation: Available (with reference image)")
        elif annotation_exists:
            print("[WARN]  Front Annotation: Available but reference image missing")
        else:
            print("[ERR] Front Annotation: Not available")
            
        if back_annotation_exists and back_reference_image_exists:
            print("[OK] Back Annotation: Available (with reference image)")
        elif back_annotation_exists:
            print("[WARN]  Back Annotation: Available but reference image missing")
        else:
            print("[ERR] Back Annotation: Not available")
        
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
                # Load existing calibration and annotation
                cal_loaded = self.load_calibration()
                front_loaded = self.load_annotation()
                back_loaded = self.load_back_annotation()
                
                if cal_loaded and (front_loaded or back_loaded):
                    print("[OK] Successfully loaded previous data!")
                    if front_loaded:
                        print(f"[DIM] Front image: {self.reference_image.shape[1]}x{self.reference_image.shape[0]}")
                        print(f"[PTS] Front keypoints: {len(self.keypoints)}")
                    if back_loaded:
                        print(f"[DIM] Back image: {self.back_reference_image.shape[1]}x{self.back_reference_image.shape[0]}")
                        print(f"[PTS] Back keypoints: {len(self.back_keypoints)}")
                    if self.placement_box:
                        print(f"[BOX] Placement guide box: Available")
                    return True
                else:
                    if not cal_loaded:
                        print("[ERR] Failed to load calibration. Please create new calibration.")
                    if not front_loaded and not back_loaded:
                        print("[ERR] Failed to load annotation. Please create new annotation.")
                    continue
                    
            elif choice == '2':
                # Create new calibration only
                if self.calibrate_with_object():
                    # Save calibration
                    self.save_calibration()
                    # Try to load existing annotation
                    front_loaded = self.load_annotation()
                    back_loaded = self.load_back_annotation()
                    if not front_loaded and not back_loaded:
                        print("[?] No annotation found. Please create annotation next.")
                    return True
                return False
                
            elif choice == '3':
                # Create new front annotation only
                if self.load_calibration():
                    if self.annotate_measurement_points('front'):
                        # Ask if user wants to add placement guide box
                        add_box = input("Do you want to add a placement guide box for shirt positioning? (y/n): ").strip().lower()
                        if add_box == 'y' or add_box == 'yes':
                            if self.annotate_placement_guide_box():
                                print("[OK] Placement guide box added!")
                        # Save annotation with reference image
                        self.save_annotation()
                        return True
                else:
                    print("[ERR] Calibration required before annotation!")
                    continue
                return False
                
            elif choice == '4':
                # Create new back annotation only
                if self.load_calibration():
                    if self.annotate_measurement_points('back'):
                        # Save back annotation with reference image
                        self.save_back_annotation()
                        return True
                else:
                    print("[ERR] Calibration required before annotation!")
                    continue
                return False
                
            elif choice == '5':
                # Create both calibration and front annotation
                if self.calibrate_with_object():
                    # Save calibration
                    self.save_calibration()
                    if self.annotate_measurement_points('front'):
                        # Ask if user wants to add placement guide box
                        add_box = input("Do you want to add a placement guide box for shirt positioning? (y/n): ").strip().lower()
                        if add_box == 'y' or add_box == 'yes':
                            if self.annotate_placement_guide_box():
                                print("[OK] Placement guide box added!")
                        # Save annotation with reference image
                        self.save_annotation()
                        return True
                return False
                
            elif choice == '6':
                # Create both calibration and back annotation
                if self.calibrate_with_object():
                    # Save calibration
                    self.save_calibration()
                    if self.annotate_measurement_points('back'):
                        # Save back annotation with reference image
                        self.save_back_annotation()
                        return True
                return False
                
            elif choice == '7':
                # Check status
                cal_status = "Available" if os.path.exists(self.calibration_file) else "Not available"
                front_ann_status = "Available" if os.path.exists(self.annotation_file) else "Not available"
                back_ann_status = "Available" if os.path.exists(self.back_annotation_file) else "Not available"
                front_img_status = "Available" if os.path.exists(self.reference_image_file) else "Not available"
                back_img_status = "Available" if os.path.exists(self.back_reference_image_file) else "Not available"
                print(f"\n[STAT] Current Status:")
                print(f"[SCALE] Calibration: {cal_status}")
                print(f"[PTS] Front Annotation: {front_ann_status}")
                print(f"[PTS] Back Annotation: {back_ann_status}")
                print(f"[?]  Front Reference Image: {front_img_status}")
                print(f"[?]  Back Reference Image: {back_img_status}")
                continue
                
            elif choice == '8':
                # Delete all and start fresh
                self.delete_calibration()
                self.delete_annotation()
                print("[DEL] All data deleted. Starting fresh...")
                if self.calibrate_with_object():
                    # Ask which annotation to create
                    side = input("Create annotation for (f)ront or (b)ack? ").strip().lower()
                    if side == 'f' or side == 'front':
                        if self.annotate_measurement_points('front'):
                            add_box = input("Do you want to add a placement guide box for shirt positioning? (y/n): ").strip().lower()
                            if add_box == 'y' or add_box == 'yes':
                                if self.annotate_placement_guide_box():
                                    print("[OK] Placement guide box added!")
                            self.save_annotation()
                            return True
                    elif side == 'b' or side == 'back':
                        if self.annotate_measurement_points('back'):
                            self.save_back_annotation()
                            return True
                return False
                
            elif choice == '9':
                print("[?] Exiting...")
                return False
                
            else:
                print("[ERR] Invalid choice! Please enter 1-9")

    def calibrate_with_object(self, force_new=False):
        """Step 1: Calibrate using a known size object
        
        Args:
            force_new: If True, always do new calibration. If False, use saved calibration if exists.
        """
        # Store force_new flag for later use when asking for reference length
        self._force_new_calibration = force_new
        
        # Check if valid calibration already exists
        if not force_new and os.path.exists(self.calibration_file):
            try:
                with open(self.calibration_file, 'r') as f:
                    cal_data = json.load(f)
                    if cal_data.get('pixels_per_cm', 0) > 0 and cal_data.get('reference_length_cm', 0) > 0:
                        # Valid calibration exists - use it without asking
                        self.pixels_per_cm = cal_data['pixels_per_cm']
                        self.reference_length_cm = cal_data['reference_length_cm']
                        self.is_calibrated = True
                        print("\n" + "="*60)
                        print("[OK] Using saved calibration")
                        print("="*60)
                        print(f"[SCALE] Pixels per cm: {self.pixels_per_cm:.2f}")
                        print(f"[DIM] Reference length: {self.reference_length_cm} cm")
                        return True
            except Exception as e:
                print(f"[WARN] Could not load calibration: {e}")
        
        print("\n" + "="*60)
        print("STEP 1: CALIBRATION")
        print("="*60)
        
        # Initialize camera if not already done
        if self.camera_obj is None:
            print("Initializing camera...")
            if not self.initialize_camera():
                print("[ERR] Failed to initialize camera!")
                return False
        
        print("Please place an object of known size in the camera view.")
        input("Press Enter when ready to capture calibration frame...")
        
        # Capture calibration frame
        max_attempts = 5
        calibration_captured = False
        for attempt in range(max_attempts):
            print(f"Calibration capture attempt {attempt + 1}/{max_attempts}...")
            if self.capture_reference_frame():
                calibration_captured = True
                print(f"[OK] Frame captured successfully on attempt {attempt + 1}!")
                break
            print(f"[WARN] Attempt {attempt + 1} failed, retrying...")
            import time
            time.sleep(0.5)  # Brief pause between attempts
        
        if not calibration_captured:
            print("[ERR] Failed to capture calibration frame after all attempts!")
            print("[*] Please check:")
            print("    - Camera is properly connected")
            print("    - Camera is not in use by another program")
            print("    - Sufficient lighting is present")
            return False
        
        # Verify reference image is valid
        if self.reference_image is None:
            print("[ERR] Reference image is None after capture!")
            return False
        
        print(f"[OK] Reference image size: {self.reference_image.shape[1]}x{self.reference_image.shape[0]}")
        
        # Reset zoom for calibration
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0
        
        # Show calibration frame and get two points for known distance
        cal_points = []
        image_copy = self.reference_image.copy()
        
        def redraw_calibration_points():
            """Redraw calibration points on image"""
            nonlocal image_copy, cal_points
            image_copy[:] = self.reference_image.copy()
            if self.zoom_factor > 1.0:
                image_copy[:] = self.apply_zoom(image_copy)
            
            for i, point in enumerate(cal_points):
                # Convert original coordinates to zoomed coordinates for display
                disp_x, disp_y = self.original_to_zoomed_coords(point[0], point[1], image_copy.shape)
                cv2.circle(image_copy, (disp_x, disp_y), 8, (0, 255, 0), -1)
                cv2.circle(image_copy, (disp_x, disp_y), 12, (0, 0, 255), 2)
                cv2.putText(image_copy, str(i+1), 
                           (disp_x + 15, disp_y - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
                
            # Draw line if two points
            if len(cal_points) == 2:
                disp_p1 = self.original_to_zoomed_coords(cal_points[0][0], cal_points[0][1], image_copy.shape)
                disp_p2 = self.original_to_zoomed_coords(cal_points[1][0], cal_points[1][1], image_copy.shape)
                cv2.line(image_copy, disp_p1, disp_p2, (255, 0, 255), 2)
                
                # Calculate and display pixel distance
                pixel_dist = math.sqrt((cal_points[1][0]-cal_points[0][0])**2 + 
                                      (cal_points[1][1]-cal_points[0][1])**2)
                cv2.putText(image_copy, f"Distance: {pixel_dist:.1f} pixels", 
                           (10, image_copy.shape[0] - 40), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                cv2.putText(image_copy, "Press 'S' to save calibration", 
                           (10, image_copy.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            else:
                # Show instruction to click
                cv2.putText(image_copy, f"Click {2-len(cal_points)} more point(s)", 
                           (10, image_copy.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)
            
            cv2.imshow("Calibration - Mark two points for known distance", image_copy)
        
        def calibration_mouse_callback(event, x, y, flags, param):
            nonlocal image_copy, cal_points
            
            # Convert coordinates from zoomed to original
            orig_x, orig_y = self.zoomed_to_original_coords(x, y, image_copy.shape)
            
            if event == cv2.EVENT_LBUTTONDOWN and len(cal_points) < 2:
                cal_points.append([orig_x, orig_y])
                print(f"[*] Point {len(cal_points)} marked at ({orig_x}, {orig_y})")
                if len(cal_points) == 2:
                    print("[OK] Two points marked! Press 'S' to save calibration.")
                redraw_calibration_points()
        
        # Create calibration window
        window_name = "Calibration - Mark two points for known distance"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(window_name, calibration_mouse_callback)
        
        print(f"[OK] Calibration window created: '{window_name}'")
        print("[*] Click on two points on the reference object to mark the known distance.")
        print("[*] Press 'H' to show help, 'S' to save when done, 'Q' to quit.")
        
        # Display initial instructions
        redraw_calibration_points()
        self.show_calibration_instructions(image_copy, window_name)
        
        print("Calibration window opened. Mark two points for known distance.")
        
        while True:
            cv2.imshow(window_name, image_copy)
            key = cv2.waitKey(1) & 0xFF
            
            if key == ord('s') or key == ord('S'):  # Save calibration
                if len(cal_points) == 2:
                    # Calculate pixel distance
                    pixel_distance = math.sqrt((cal_points[1][0]-cal_points[0][0])**2 + 
                                             (cal_points[1][1]-cal_points[0][1])**2)
                    
                    # Check if reference length is already saved from previous calibration
                    saved_reference_length = 0
                    # Only use saved reference length if NOT forcing new calibration
                    if not getattr(self, '_force_new_calibration', False):
                        if os.path.exists(self.calibration_file):
                            try:
                                with open(self.calibration_file, 'r') as f:
                                    old_cal = json.load(f)
                                    saved_reference_length = old_cal.get('reference_length_cm', 0)
                            except:
                                pass
                    
                    # If we have a saved reference length, use it automatically (don't ask)
                    if saved_reference_length > 0:
                        self.reference_length_cm = saved_reference_length
                        print(f"[OK] Using saved reference length: {self.reference_length_cm} cm")
                    else:
                        # No saved reference length, ask user only once
                        print("\n" + "="*60)
                        print("[INPUT REQUIRED] Please check the console/terminal")
                        print("="*60)
                        try:
                            distance_input = input(f"Enter the real-world distance between the two points in cm: ")
                            self.reference_length_cm = float(distance_input)
                        except ValueError:
                            print("[ERR] Invalid input! Please enter a valid number.")
                            cal_points = []  # Reset points
                            redraw_calibration_points()
                            continue
                    
                    try:
                        self.pixels_per_cm = pixel_distance / self.reference_length_cm
                        self.is_calibrated = True
                        
                        print(f"[OK] Calibration successful!")
                        print(f"[SCALE] Pixel distance: {pixel_distance:.2f} pixels")
                        print(f"[DIM] Real distance: {self.reference_length_cm} cm")
                        print(f"[?] Scale factor: {self.pixels_per_cm:.2f} pixels/cm")
                        
                        # Save calibration
                        self.save_calibration()
                        cv2.destroyWindow(window_name)
                        return True
                        
                    except (ValueError, ZeroDivisionError) as e:
                        print(f"[ERR] Error in calibration calculation: {e}")
                        cal_points = []  # Reset points
                        redraw_calibration_points()
                else:
                    print("[ERR] Please mark exactly 2 points for calibration!")
                    
            elif key == ord('c') or key == ord('C'):  # Clear points
                cal_points = []
                redraw_calibration_points()
                print("Points cleared.")
                
            # Zoom and pan controls for calibration
            elif key == ord('z') or key == ord('Z'):  # Zoom in
                self.zoom_factor *= 1.2
                redraw_calibration_points()
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('x') or key == ord('X'):  # Zoom out
                self.zoom_factor = max(1.0, self.zoom_factor / 1.2)
                redraw_calibration_points()
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('r') or key == ord('R'):  # Reset zoom
                self.zoom_factor = 1.0
                self.zoom_center = None
                self.pan_x = 0
                self.pan_y = 0
                redraw_calibration_points()
                print("Zoom reset")
                
            # PAN CONTROLS
            elif key == 81:  # Left arrow - Pan left
                self.pan_x -= 30
                redraw_calibration_points()
                print(f"Pan left: {self.pan_x}")
            elif key == 83:  # Right arrow - Pan right
                self.pan_x += 30
                redraw_calibration_points()
                print(f"Pan right: {self.pan_x}")
            elif key == 82:  # Up arrow - Pan up
                self.pan_y -= 30
                redraw_calibration_points()
                print(f"Pan up: {self.pan_y}")
            elif key == 84:  # Down arrow - Pan down
                self.pan_y += 30
                redraw_calibration_points()
                print(f"Pan down: {self.pan_y}")
                    
            elif key == ord('d') or key == ord('D'):  # Delete calibration
                if self.delete_calibration():
                    print("[DEL] Calibration deleted. You can now create a new one.")
                    
            elif key == ord('h') or key == ord('H'):  # Help
                self.show_calibration_instructions(image_copy, window_name)
                    
            elif key == ord('q') or key == ord('Q'):  # Quit
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
        cv2.waitKey(3000)  # Show instructions for 3 seconds

    def annotate_measurement_points(self, side='front'):
        """Step 2: Annotate points for measurement for front or back"""
        print("\n" + "="*60)
        print(f"STEP 2: {side.upper()} ANNOTATION")
        print("="*60)
        
        # Set current side
        self.current_side = side
        
        # Make sure we have a reference image
        if side == 'front':
            if self.reference_image is None:
                print("[ERR] No reference image available. Capturing one now...")
                if not self.capture_reference_frame():
                    print("[ERR] Failed to capture reference frame!")
                    return False
            current_image = self.reference_image
        else:  # back
            if self.back_reference_image is None:
                print("[ERR] No back reference image available. Capturing one now...")
                if not self.capture_back_reference_frame():
                    print("[ERR] Failed to capture back reference frame!")
                    return False
            current_image = self.back_reference_image
        
        print(f"Now mark the points you want to measure in the {side} live feed.")
        print("Points will be measured in pairs: 1-2, 3-4, 5-6, etc.")
        print(f"NOTE: First {self.corner_keypoints_count} points will be treated as CORNER points for robust tracking!")
        
        # Reset zoom for annotation
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0
        
        image_copy = current_image.copy()
        temp_keypoints = []
        
        def redraw_annotation(img, points):
            """Redraw all annotation points on image"""
            img[:] = current_image.copy()
            if self.zoom_factor > 1.0:
                img[:] = self.apply_zoom(img)
            
            for i, point in enumerate(points):
                # Convert original coordinates to zoomed coordinates for display
                disp_x, disp_y = self.original_to_zoomed_coords(point[0], point[1], img.shape)
                
                # Use different colors for corner vs regular points
                if i < self.corner_keypoints_count:  # Corner points
                    color = (0, 255, 255)  # Yellow for corners
                    point_type = "C"
                else:  # Regular points
                    color = (0, 255, 0)    # Green for regular
                    point_type = "R"
                
                cv2.circle(img, (disp_x, disp_y), 8, color, -1)
                cv2.circle(img, (disp_x, disp_y), 12, (0, 0, 255), 2)
                cv2.putText(img, f"{i+1}({point_type})", 
                           (disp_x + 15, disp_y - 15), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 0, 0), 2)
        
        def annotation_mouse_callback(event, x, y, flags, param):
            nonlocal image_copy, temp_keypoints
            
            # Convert coordinates from zoomed to original
            orig_x, orig_y = self.zoomed_to_original_coords(x, y, image_copy.shape)
            
            if event == cv2.EVENT_LBUTTONDOWN:
                # Add point in original coordinates
                temp_keypoints.append([orig_x, orig_y])
                
                # Redraw all points
                redraw_annotation(image_copy, temp_keypoints)
                point_type = "CORNER" if len(temp_keypoints) <= self.corner_keypoints_count else "REGULAR"
                print(f"{point_type} Point {len(temp_keypoints)} placed at ({orig_x}, {orig_y})")
                
            elif event == cv2.EVENT_RBUTTONDOWN:
                # Right click to remove nearest point
                if temp_keypoints:
                    # Find nearest point
                    min_dist = float('inf')
                    nearest_idx = -1
                    for i, point in enumerate(temp_keypoints):
                        dist = math.sqrt((point[0] - orig_x)**2 + (point[1] - orig_y)**2)
                        if dist < min_dist:
                            min_dist = dist
                            nearest_idx = i
                    
                    if min_dist < 50:  # Within reasonable distance
                        removed_point = temp_keypoints.pop(nearest_idx)
                        redraw_annotation(image_copy, temp_keypoints)
                        point_type = "CORNER" if nearest_idx < self.corner_keypoints_count else "REGULAR"
                        print(f"{point_type} Point {nearest_idx + 1} removed")
        
        # Create window
        window_name = f"{side.upper()} Annotation - Mark points to measure (Press H for help)"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(window_name, annotation_mouse_callback)
        
        # Display initial instructions
        redraw_annotation(image_copy, temp_keypoints)
        self.show_annotation_instructions(image_copy, window_name, side)
        
        print(f"{side.capitalize()} annotation window opened. Mark points for measurement.")
        
        while True:
            cv2.imshow(window_name, image_copy)
            key = cv2.waitKey(1) & 0xFF
            
            if key == ord('s') or key == ord('S'):  # Save
                if len(temp_keypoints) >= 2:
                    if side == 'front':
                        self.keypoints = temp_keypoints
                    else:
                        self.back_keypoints = temp_keypoints
                    corner_count = min(self.corner_keypoints_count, len(temp_keypoints))
                    regular_count = max(0, len(temp_keypoints) - self.corner_keypoints_count)
                    print(f"[OK] {side.capitalize()} annotation completed with {len(temp_keypoints)} keypoints")
                    print(f"[DIM] Corner points: {corner_count}, Regular points: {regular_count}")
                    break
                else:
                    print("Need at least 2 keypoints for measurement!")
                    
            elif key == ord('c') or key == ord('C'):  # Clear last point
                if temp_keypoints:
                    temp_keypoints.pop()
                    redraw_annotation(image_copy, temp_keypoints)
                    print(f"Last point cleared. Total points: {len(temp_keypoints)}")
                    
            elif key == ord('z') or key == ord('Z'):  # Zoom in
                self.zoom_factor *= 1.2
                redraw_annotation(image_copy, temp_keypoints)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('x') or key == ord('X'):  # Zoom out
                self.zoom_factor = max(1.0, self.zoom_factor / 1.2)
                redraw_annotation(image_copy, temp_keypoints)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('r') or key == ord('R'):  # Reset zoom
                self.zoom_factor = 1.0
                self.zoom_center = None
                self.pan_x = 0
                self.pan_y = 0
                redraw_annotation(image_copy, temp_keypoints)
                print("Zoom reset")
                
            # PAN CONTROLS
            elif key == 81:  # Left arrow - Pan left
                self.pan_x -= 30
                redraw_annotation(image_copy, temp_keypoints)
                print(f"Pan left: {self.pan_x}")
            elif key == 83:  # Right arrow - Pan right
                self.pan_x += 30
                redraw_annotation(image_copy, temp_keypoints)
                print(f"Pan right: {self.pan_x}")
            elif key == 82:  # Up arrow - Pan up
                self.pan_y -= 30
                redraw_annotation(image_copy, temp_keypoints)
                print(f"Pan up: {self.pan_y}")
            elif key == 84:  # Down arrow - Pan down
                self.pan_y += 30
                redraw_annotation(image_copy, temp_keypoints)
                print(f"Pan down: {self.pan_y}")
                    
            elif key == ord('h') or key == ord('H'):  # Help
                self.show_annotation_instructions(image_copy, window_name, side)
                    
            elif key == ord('q') or key == ord('Q'):  # Quit
                print(f"{side.capitalize()} annotation cancelled")
                cv2.destroyAllWindows()
                return False
        
        cv2.destroyAllWindows()
        return True

    def annotate_placement_guide_box(self):
        """Step 2.5: Annotate placement guide box for accurate shirt positioning"""
        print("\n" + "="*60)
        print("STEP 2.5: PLACEMENT GUIDE BOX ANNOTATION")
        print("="*60)
        print("Draw a rectangle around the area where the shirt should be placed.")
        print("This will help you position the shirt accurately for measurements.")
        
        if self.reference_image is None:
            print("[ERR] No reference image available!")
            return False
        
        # Reset zoom for box annotation
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0
        
        image_copy = self.reference_image.copy()
        self.placement_box = []  # [x1, y1, x2, y2] in original coordinates
        drawing = False
        temp_box = []
        
        def redraw_box_annotation(img, start_point, current_point, final=False):
            """Redraw the placement box on image"""
            img[:] = self.reference_image.copy()
            if self.zoom_factor > 1.0:
                img[:] = self.apply_zoom(img)
            
            # Convert original coordinates to zoomed for display
            disp_start = self.original_to_zoomed_coords(start_point[0], start_point[1], img.shape)
            disp_current = self.original_to_zoomed_coords(current_point[0], current_point[1], img.shape)
            
            if final:
                # Draw final box
                cv2.rectangle(img, (disp_start[0], disp_start[1]), 
                             (disp_current[0], disp_current[1]), 
                             (0, 255, 255), 4)  # Thick yellow border
                
                # Fill with semi-transparent color
                overlay = img.copy()
                cv2.rectangle(overlay, (disp_start[0], disp_start[1]), 
                             (disp_current[0], disp_current[1]), 
                             (0, 255, 255), -1)
                cv2.addWeighted(overlay, 0.2, img, 0.8, 0, img)
                
                # Add guide text
                text = "SHIRT PLACEMENT GUIDE"
                text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 1.0, 3)[0]
                text_x = (disp_start[0] + disp_current[0] - text_size[0]) // 2
                text_y = (disp_start[1] + disp_current[1] + text_size[1]) // 2
                
                cv2.putText(img, text, (text_x, text_y), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 5)
                cv2.putText(img, text, (text_x, text_y), 
                           cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
            else:
                # Draw temporary box while dragging
                cv2.rectangle(img, (disp_start[0], disp_start[1]), 
                             (disp_current[0], disp_current[1]), 
                             (255, 0, 0), 2)  # Blue border while drawing
        
        def box_mouse_callback(event, x, y, flags, param):
            nonlocal image_copy, drawing, temp_box
            
            # Convert coordinates from zoomed to original
            orig_x, orig_y = self.zoomed_to_original_coords(x, y, image_copy.shape)
            
            if event == cv2.EVENT_LBUTTONDOWN:
                drawing = True
                temp_box = [[orig_x, orig_y]]
                print(f"Box started at ({orig_x}, {orig_y})")
                
            elif event == cv2.EVENT_MOUSEMOVE:
                if drawing and len(temp_box) == 1:
                    # Update temporary box while dragging
                    temp_current = [orig_x, orig_y]
                    redraw_box_annotation(image_copy, temp_box[0], temp_current)
                    
            elif event == cv2.EVENT_LBUTTONUP:
                if drawing and len(temp_box) == 1:
                    drawing = False
                    self.placement_box = [temp_box[0][0], temp_box[0][1], orig_x, orig_y]
                    print(f"Box completed: ({self.placement_box[0]}, {self.placement_box[1]}) to ({self.placement_box[2]}, {self.placement_box[3]})")
                    redraw_box_annotation(image_copy, temp_box[0], [orig_x, orig_y], final=True)
        
        # Create window
        window_name = "Placement Guide - Draw box for shirt positioning (Press H for help)"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.setMouseCallback(window_name, box_mouse_callback)
        
        # Display initial instructions
        image_copy[:] = self.reference_image.copy()
        if self.zoom_factor > 1.0:
            image_copy[:] = self.apply_zoom(image_copy)
        self.show_box_instructions(image_copy, window_name)
        
        print("Placement guide window opened. Draw a rectangle for shirt positioning.")
        
        while True:
            cv2.imshow(window_name, image_copy)
            key = cv2.waitKey(1) & 0xFF
            
            if key == ord('s') or key == ord('S'):  # Save box
                if len(self.placement_box) == 4:
                    # Ensure box coordinates are properly ordered (top-left to bottom-right)
                    x1, y1, x2, y2 = self.placement_box
                    self.placement_box = [
                        min(x1, x2), min(y1, y2),  # top-left
                        max(x1, x2), max(y1, y2)   # bottom-right
                    ]
                    print(f"[OK] Placement guide box saved!")
                    print(f"[BOX] Box coordinates: ({self.placement_box[0]}, {self.placement_box[1]}) to ({self.placement_box[2]}, {self.placement_box[3]})")
                    break
                else:
                    print("[ERR] Please draw a box first!")
                    
            elif key == ord('c') or key == ord('C'):  # Clear box
                self.placement_box = []
                temp_box = []
                drawing = False
                image_copy[:] = self.reference_image.copy()
                if self.zoom_factor > 1.0:
                    image_copy[:] = self.apply_zoom(image_copy)
                print("Box cleared")
                
            elif key == ord('z') or key == ord('Z'):  # Zoom in
                self.zoom_factor *= 1.2
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('x') or key == ord('X'):  # Zoom out
                self.zoom_factor = max(1.0, self.zoom_factor / 1.2)
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            elif key == ord('r') or key == ord('R'):  # Reset zoom
                self.zoom_factor = 1.0
                self.zoom_center = None
                self.pan_x = 0
                self.pan_y = 0
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print("Zoom reset")
                
            # PAN CONTROLS
            elif key == 81:  # Left arrow - Pan left
                self.pan_x -= 30
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Pan left: {self.pan_x}")
            elif key == 83:  # Right arrow - Pan right
                self.pan_x += 30
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Pan right: {self.pan_x}")
            elif key == 82:  # Up arrow - Pan up
                self.pan_y -= 30
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Pan up: {self.pan_y}")
            elif key == 84:  # Down arrow - Pan down
                self.pan_y += 30
                redraw_box_annotation(image_copy, temp_box[0] if temp_box else [0,0], 
                                     temp_box[0] if temp_box else [0,0], 
                                     final=len(self.placement_box)==4)
                print(f"Pan down: {self.pan_y}")
                    
            elif key == ord('h') or key == ord('H'):  # Help
                self.show_box_instructions(image_copy, window_name)
                    
            elif key == ord('q') or key == ord('Q'):  # Quit without saving
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
        cv2.waitKey(3000)  # Show instructions for 3 seconds

    def show_annotation_instructions(self, image, window_name, side='front'):
        """Display annotation instructions on image"""
        instructions = [
            f"{side.upper()} ANNOTATION CONTROLS:",
            "Left Click - Place point",
            "Right Click - Remove nearest point", 
            "Z - Zoom in",
            "X - Zoom out",
            "R - Reset zoom",
            "Arrow Keys - Pan (Left/Right/Up/Down)",
            "C - Clear last point",
            "S - Save and Continue",
            "H - Show this help",
            "Q - Quit without saving",
            "",
            f"NOTE: First {self.corner_keypoints_count} points will be treated as",
            "CORNER points for robust tracking!"
        ]
        
        temp_img = image.copy()
        for i, instruction in enumerate(instructions):
            cv2.putText(temp_img, instruction, (10, 30 + i*25), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 3)
            cv2.putText(temp_img, instruction, (10, 30 + i*25), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
        
        cv2.imshow(window_name, temp_img)
        cv2.waitKey(3000)  # Show instructions for 3 seconds

    def display_measurements_on_terminal(self, measurements):
        """Display measurements in terminal"""
        print("\n" + "="*50)
        print(f"LIVE {self.current_side.upper()} MEASUREMENTS")
        print("="*50)
        for measurement in measurements:
            # Support both old (4-tuple) and new (5-tuple with fallback flag) formats
            if len(measurement) >= 5:
                pair_num, distance_cm, distance_px, qc_result, is_fallback = measurement[:5]
            else:
                pair_num, distance_cm, distance_px, qc_result = measurement[:4]
                is_fallback = False
                
            fallback_marker = " [ESTIMATED]" if is_fallback else ""
            
            if self.is_calibrated:
                current_target_distances = self.target_distances if self.current_side == 'front' else self.back_target_distances
                target = current_target_distances.get(pair_num, "Not set")
                status = "[OK] PASS" if qc_result else "[ERR] FAIL"
                print(f"Pair {pair_num}: {distance_cm:.2f} cm (Target: {target} cm) - {status}{fallback_marker}")
            else:
                print(f"Pair {pair_num}: {distance_px:.1f} pixels{fallback_marker}")
        print("="*50)

    def live_mouse_callback(self, event, x, y, flags, param):
        """Mouse callback for live measurement window - FIXED MOUSE WHEEL"""
        if event == cv2.EVENT_MOUSEWHEEL:
            # FIXED: Proper mouse wheel detection
            if flags > 0:  # Scroll up - zoom in
                self.zoom_factor *= 1.1
                print(f"Zoom: {self.zoom_factor:.1f}x")
            else:  # Scroll down - zoom out
                self.zoom_factor = max(1.0, self.zoom_factor / 1.1)
                print(f"Zoom: {self.zoom_factor:.1f}x")
                
            # Set zoom center to mouse position
            self.zoom_center = (x, y)
            
        elif event == cv2.EVENT_MBUTTONDOWN:
            # Middle mouse button down - start panning
            self.mouse_dragging = True
            self.last_mouse_x = x
            self.last_mouse_y = y
            print("Panning started - drag with middle mouse button")
            
        elif event == cv2.EVENT_MOUSEMOVE:
            # Mouse move while panning
            if self.mouse_dragging:
                dx = x - self.last_mouse_x
                dy = y - self.last_mouse_y
                
                # Adjust pan based on zoom factor
                pan_scale = 1.0 / self.zoom_factor
                self.pan_x += int(dx * pan_scale)
                self.pan_y += int(dy * pan_scale)
                
                self.last_mouse_x = x
                self.last_mouse_y = y
                
        elif event == cv2.EVENT_MBUTTONUP:
            # Middle mouse button up - stop panning
            self.mouse_dragging = False
            print("Panning stopped")

    def switch_to_back_side(self):
        """Switch to back side measurement"""
        # FIXED: Check if back_keypoints exists and has elements, and back_reference_image is not None
        if not hasattr(self, 'back_keypoints') or not self.back_keypoints or self.back_reference_image is None:
            print("[ERR] No back annotation found! Please create back annotation first.")
            return False
        
        self.current_side = 'back'
        self.transferred_keypoints = []
        self.is_keypoints_transferred = False
        self.keypoint_stabilized = False
        self.last_valid_keypoints = []
        self.stabilization_frames = 0
        print("[SWITCH] Switched to BACK side measurement")
        return True

    def switch_to_front_side(self):
        """Switch to front side measurement"""
        # FIXED: Check if keypoints exists and has elements, and reference_image is not None
        if not hasattr(self, 'keypoints') or not self.keypoints or self.reference_image is None:
            print("[ERR] No front annotation found! Please create front annotation first.")
            return False
        
        self.current_side = 'front'
        self.transferred_keypoints = []
        self.is_keypoints_transferred = False
        self.keypoint_stabilized = False
        self.last_valid_keypoints = []
        self.stabilization_frames = 0
        print("[SWITCH] Switched to FRONT side measurement")
        return True

    def transfer_keypoints_to_live(self, headless=False):
        """Step 3: Transfer keypoints to live feed using robust method
        Args:
            headless: If True, skip interactive prompts (for API-driven measurement)
        """
        print("\n" + "="*60)
        print("STEP 3: LIVE MEASUREMENT - ROBUST KEYPOINT TRACKING")
        print("="*60)
        print("Keypoints will now adapt to different garment sizes automatically.")
        print("Moving from small to large shirts should work seamlessly!")
        print("NOW WITH HOMOGRAPHY/MLS TRANSFER + GRAYSCALE PROCESSING!")
        print(f"ENHANCED CORNER DETECTION FOR FIRST {self.corner_keypoints_count} POINTS!")
        print("PAUSE FUNCTION + MOUSE PAN/ZOOM!")
        print("B KEY: Switch between FRONT and BACK sides!")
        
        if not headless:
            input("Press Enter to start live measurement...")
        else:
            print("[HEADLESS] Starting measurement automatically...")
        
        cv2.namedWindow("Live Measurement - Robust Tracking", cv2.WINDOW_NORMAL)
        # Make window fullscreen for better visibility
        cv2.setWindowProperty("Live Measurement - Robust Tracking", cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
        print("[DISPLAY] Camera window set to FULLSCREEN mode - Press ESC or Q to exit")
        
        # Set up mouse callback for zoom and pan
        cv2.setMouseCallback("Live Measurement - Robust Tracking", self.live_mouse_callback)
        
        terminal_update_counter = 0
        self.keypoint_stabilized = False
        self.last_valid_keypoints = []
        self.stabilization_frames = 0
        self.last_detected_scale = 1.0
        
        while True:
            if not self.paused:
                frame_gray = self.capture_live_frame()
                if frame_gray is None:
                    continue
                
                # Convert grayscale to BGR for display
                display_frame = cv2.cvtColor(frame_gray, cv2.COLOR_GRAY2BGR)
                display_frame = self.apply_zoom(display_frame)
                
                # Store current frame for pause mode
                self.pause_frame = display_frame.copy()
            else:
                # Use paused frame
                display_frame = self.pause_frame.copy()
            
            # Draw placement guide box if available and on front side
            if self.current_side == 'front' and hasattr(self, 'placement_box') and self.placement_box:
                self.draw_placement_guide(display_frame)
            
            # Use robust keypoint transfer with timing control (only when not paused)
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
            
            # Draw transferred keypoints and measurements
            if self.is_keypoints_transferred and self.transferred_keypoints:
                valid_points_count = 0
                current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
                
                # Draw keypoints first
                for i, point in enumerate(self.transferred_keypoints):
                    if point[0] == -1 or point[1] == -1:
                        continue
                        
                    valid_points_count += 1
                    disp_x, disp_y = self.original_to_zoomed_coords(point[0], point[1], display_frame.shape)
                    
                    # VISIBLE KEYPOINTS with different colors for corners vs regular
                    if i < self.corner_keypoints_count:
                        # Corner points - Yellow
                        if self.keypoint_stabilized:
                            color = (0, 255, 255)  # Yellow - stable corners
                        else:
                            color = (0, 200, 255)  # Orange - tracking corners
                        point_type = "C"
                    else:
                        # Regular points - Green
                        if self.keypoint_stabilized:
                            color = (0, 255, 0)  # Green - stable
                        else:
                            color = (0, 255, 255)  # Yellow - tracking
                        point_type = "R"
                    
                    # Draw keypoints
                    cv2.circle(display_frame, (disp_x, disp_y), self.keypoint_size, color, -1)
                    cv2.circle(display_frame, (disp_x, disp_y), self.keypoint_size + 3, (0, 0, 255), self.keypoint_border)
                    
                    # Point numbers with type indicator
                    cv2.putText(display_frame, f"{i+1}({point_type})", 
                               (disp_x + 20, disp_y - 20), 
                               cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 0, 0), 3)
                
                # Draw distances between pairs with PROFESSIONAL display
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
                            
                            # Use professional measurement display (SIMPLIFIED)
                            self.draw_enhanced_measurement_display(
                                display_frame, disp_p1, disp_p2, real_distance, 
                                pair_num, qc_passed, self.last_detected_scale
                            )
                            
                            current_measurements.append((pair_num, real_distance, pixel_distance, qc_passed))
                        else:
                            # Use uncalibrated measurement display
                            self.draw_uncalibrated_measurement(
                                display_frame, disp_p1, disp_p2, pixel_distance,
                                i//2 + 1, self.last_detected_scale
                            )
                            current_measurements.append((i//2+1, 0, pixel_distance, False))
            
            # Update terminal display (only when not paused)
            if not self.paused:
                terminal_update_counter += 1
                if terminal_update_counter >= 20 and current_measurements:
                    self.display_measurements_on_terminal(current_measurements)
                    # Save live measurements for Laravel UI access
                    self.save_live_measurements(current_measurements)
                    terminal_update_counter = 0
            
            # Enhanced status information
            current_keypoints = self.keypoints if self.current_side == 'front' else self.back_keypoints
            valid_points = len([p for p in self.transferred_keypoints if p[0] != -1]) if self.transferred_keypoints else 0
            total_points = len(current_keypoints) if current_keypoints else 0
            
            # Determine tracking mode display
            if self.keypoint_stabilized:
                tracking_status = "[OK] STABLE"
            else:
                tracking_status = "[~] TRACKING"
            
            status_lines = [
                f"Side: {self.current_side.upper()}",
                f"Points: {valid_points}/{total_points} valid",
                f"Mode: {tracking_status}",
                f"Calibrated: {self.is_calibrated}",
                f"Resolution: {self.pixels_per_cm:.2f} px/cm" if self.is_calibrated else "Scale: Not calibrated",
                f"Placement Guide: {'ON' if hasattr(self, 'placement_box') and self.placement_box and self.current_side == 'front' else 'OFF'}",
                f"Zoom: {self.zoom_factor:.1f}x",
                f"Status: {'PAUSED' if self.paused else 'LIVE'}",
                "P=Pause, B=Side, Z/X=Zoom, R=Reset, Q=Quit"
            ]
            
            # Draw status panel
            status_bg_height = len(status_lines) * 32 + 20
            cv2.rectangle(display_frame, (0, 0), (550, status_bg_height), (0, 0, 0), -1)
            cv2.rectangle(display_frame, (0, 0), (550, status_bg_height), (255, 255, 255), 2)
            
            for i, line in enumerate(status_lines):
                cv2.putText(display_frame, line, (10, 28 + i*32), 
                           cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            
            # Add pause indicator
            if self.paused:
                h, w = display_frame.shape[:2]
                cv2.putText(display_frame, "PAUSED", (int(w/2 - 150), int(h/2)), 
                           cv2.FONT_HERSHEY_SIMPLEX, 3, (0, 0, 255), 8)
                cv2.putText(display_frame, "Press P to resume", (int(w/2 - 180), int(h/2) + 60), 
                             cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 3)
            cv2.imshow("Live Measurement - Robust Tracking", display_frame)
            
            key = cv2.waitKey(1) & 0xFF
            if key == ord('q') or key == ord('Q') or key == 27:  # Q or ESC to quit
                print("[EXIT] Exiting measurement...")
                break
            elif key == ord('p') or key == ord('P'):
                # Toggle pause
                self.paused = not self.paused
                if self.paused:
                    print("[PAUSE] Measurement PAUSED - Press P to resume")
                else:
                    print("[PAUSE] Measurement RESUMED")
            elif key == ord('b') or key == ord('B'):
                # Switch between front and back sides
                if self.current_side == 'front':
                    if self.switch_to_back_side():
                        print("[SWITCH] Switched to BACK side")
                    else:
                        print("[ERR] Failed to switch to back side - no back annotation found")
                else:
                    if self.switch_to_front_side():
                        print("[SWITCH] Switched to FRONT side")
                    else:
                        print("[ERR] Failed to switch to front side - no front annotation found")
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
            elif key == 81:  # Left arrow
                self.pan_x -= 20
                print(f"Pan left: {self.pan_x}")
            elif key == 83:  # Right arrow
                self.pan_x += 20
                print(f"Pan right: {self.pan_x}")
            elif key == 82:  # Up arrow
                self.pan_y -= 20
                print(f"Pan up: {self.pan_y}")
            elif key == 84:  # Down arrow
                self.pan_y += 20

                
                print(f"Pan down: {self.pan_y}")
        
        cv2.destroyAllWindows()
        return True

    def run(self):
        """Main execution function"""
        print("=" * 60)
        print("[TGT] ROBUST LIVE KEYPOINT DISTANCE MEASUREMENT")
        print("=" * 60)
        print("Now with adaptive keypoint tracking for different garment sizes!")
        print("Perfect for measuring small → medium → large shirts seamlessly")
        print("ENHANCED WITH HOMOGRAPHY/MLS TRANSFER + GRAYSCALE PROCESSING!")
        print(f"NEW: Enhanced corner detection for first {self.corner_keypoints_count} points!")
        print("Pause function + Mouse wheel pan/zoom!")
        print("NEW: Front and Back side measurement support!")
        print("=" * 60)
        
        if not self.initialize_camera():
            return
        
        try:
            # Show startup menu for calibration and annotation options
            if not self.show_startup_menu():
                return
            
            # Step 3: Live Measurements with robust tracking
            self.transfer_keypoints_to_live()
            
        finally:
            if self.camera_obj:
                self.camera_obj.close()
            print("Measurement session ended")

# Run the application
if __name__ == "__main__":
    app = LiveKeypointDistanceMeasurer()
    app.run()