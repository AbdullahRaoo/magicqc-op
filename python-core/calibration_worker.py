"""
Calibration Worker Script for Operator Panel
Handles camera calibration in a separate process (no visible console)
"""
# ── MUST BE FIRST: redirect ALL stdout/stderr to log file ──
import sys
import os
from worker_logger import setup_file_logging
_logger = setup_file_logging('calibration')
# ── From this point on, every print() goes to logs/calibration.log ──

import json
import cv2
import math
import time
from datetime import datetime

# Import camera SDK
from mvsdk import *

# Frozen-safe PROJECT_ROOT (same logic as core_main.py)
if getattr(sys, 'frozen', False):
    _PROJECT_ROOT = os.path.dirname(sys.executable)
else:
    _PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Configuration — absolute path to calibration file
CALIBRATION_FILE = os.path.join(_PROJECT_ROOT, 'camera_calibration.json')


class CameraCalibrator:
    """Standalone camera calibrator for operator panel"""

    def __init__(self):
        self.DevInfo = None
        self.camera_obj = None

        # Calibration data
        self.pixels_per_cm = 0
        self.reference_length_cm = 0
        self.is_calibrated = False

        # Reference image
        self.reference_image = None
        self.reference_gray = None

        # Zoom and pan controls
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0

    class Camera:
        """Inner camera wrapper class"""
        def __init__(self, DevInfo):
            super().__init__()
            self.DevInfo = DevInfo
            self.hCamera = 0
            self.cap = None
            self.pFrameBuffer = 0

        def open(self):
            try:
                self.hCamera = CameraInit(self.DevInfo, -1, -1)
                cap = CameraGetCapability(self.hCamera)

                # Force MONO8 output for consistent grayscale
                CameraSetIspOutFormat(self.hCamera, CAMERA_MEDIA_TYPE_MONO8)

                # Get resolution
                width = cap.sResolutionRange.iWidthMax
                height = cap.sResolutionRange.iHeightMax
                self.pFrameBuffer = CameraAlignMalloc(width * height * 3, 16)

                # Set exposure
                CameraSetAeState(self.hCamera, 0)  # Disable auto-exposure
                CameraSetExposureTime(self.hCamera, 20000)  # 20ms exposure

                CameraPlay(self.hCamera)
                print(f"[OK] Camera opened: {width}x{height}")
                return True
            except CameraException as e:
                print(f"[ERR] Camera open failed: {e}")
                return False

        def close(self):
            if self.hCamera > 0:
                CameraUnInit(self.hCamera)
                CameraAlignFree(self.pFrameBuffer)

        def grab(self):
            try:
                pRawData, FrameHead = CameraGetImageBuffer(self.hCamera, 1000)
                CameraImageProcess(self.hCamera, pRawData, self.pFrameBuffer, FrameHead)
                CameraReleaseImageBuffer(self.hCamera, pRawData)

                # Return image as numpy array
                import numpy as np
                frame = (c_ubyte * (FrameHead.uBytes)).from_address(self.pFrameBuffer)
                frame = np.frombuffer(frame, dtype=np.uint8)

                shape = (FrameHead.iHeight, FrameHead.iWidth)
                if FrameHead.uiMediaType == CAMERA_MEDIA_TYPE_MONO8:
                    frame = frame.reshape(shape)
                else:
                    frame = frame.reshape((shape[0], shape[1], 3))
                    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                return frame
            except CameraException:
                return None

    def initialize_camera(self):
        """Initialize the MindVision camera"""
        try:
            CameraSdkInit(1)
            camera_list = CameraEnumerateDevice()
            if len(camera_list) == 0:
                print("[ERR] No camera found!")
                return False

            print(f"[OK] Found {len(camera_list)} camera(s)")
            self.DevInfo = camera_list[0]
            self.camera_obj = self.Camera(self.DevInfo)

            if not self.camera_obj.open():
                return False

            print("[OK] Camera initialized successfully")
            return True
        except CameraException as e:
            print(f"[ERR] Camera initialization failed: {e}")
            return False

    def capture_reference_frame(self):
        """Capture a reference frame from camera"""
        if self.camera_obj is None:
            print("[ERR] Camera object is None!")
            return False

        frame = self.camera_obj.grab()
        if frame is not None:
            try:
                # Convert grayscale to BGR for display
                if len(frame.shape) == 2:
                    self.reference_image = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
                    self.reference_gray = frame.copy()
                else:
                    self.reference_image = frame
                    self.reference_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

                print(f"[OK] Reference frame captured: {self.reference_image.shape[1]}x{self.reference_image.shape[0]}")
                return True
            except Exception as e:
                print(f"[ERR] Failed to process frame: {e}")
                return False
        else:
            print("[WARN] Camera grab() returned None")
            return False

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

        x1 = max(0, center_x - zoom_w // 2)
        y1 = max(0, center_y - zoom_h // 2)
        x2 = min(w, x1 + zoom_w)
        y2 = min(h, y1 + zoom_h)

        roi = image[y1:y2, x1:x2]
        if roi.size > 0:
            return cv2.resize(roi, (w, h), interpolation=cv2.INTER_LINEAR)
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

        orig_x = (zoom_x / self.zoom_factor) + x1
        orig_y = (zoom_y / self.zoom_factor) + y1

        return orig_x, orig_y

    def save_calibration(self):
        """Save calibration data to JSON file"""
        calibration_data = {
            'pixels_per_cm': self.pixels_per_cm,
            'reference_length_cm': self.reference_length_cm,
            'is_calibrated': self.is_calibrated,
            'calibration_date': datetime.now().isoformat()
        }

        try:
            with open(CALIBRATION_FILE, 'w') as f:
                json.dump(calibration_data, f, indent=4)
            print(f"[OK] Calibration saved to {CALIBRATION_FILE}")
            return True
        except Exception as e:
            print(f"[ERR] Failed to save calibration: {e}")
            return False

    def load_calibration(self):
        """Load existing calibration data"""
        if os.path.exists(CALIBRATION_FILE):
            try:
                with open(CALIBRATION_FILE, 'r') as f:
                    data = json.load(f)

                self.pixels_per_cm = data.get('pixels_per_cm', 0)
                self.reference_length_cm = data.get('reference_length_cm', 0)
                self.is_calibrated = data.get('is_calibrated', False)

                if self.is_calibrated:
                    print(f"[OK] Loaded existing calibration: {self.pixels_per_cm:.2f} px/cm")
                    return True
            except Exception as e:
                print(f"[WARN] Could not load calibration: {e}")
        return False

    def show_calibration_instructions(self, image, window_name):
        """Display calibration instructions on image"""
        instructions = [
            "=== CALIBRATION CONTROLS ===",
            "",
            "Left Click - Place calibration point",
            "Right Click - Remove nearest point",
            "",
            "Z - Zoom in",
            "X - Zoom out",
            "R - Reset zoom",
            "Arrow Keys - Pan (when zoomed)",
            "",
            "C - Clear all points",
            "S - Save calibration (after 2 points)",
            "Q - Quit without saving",
            "",
            "Place a ruler or known-size object",
            "and click on two ends to mark distance"
        ]

        temp_img = image.copy()

        # Draw semi-transparent background
        overlay = temp_img.copy()
        cv2.rectangle(overlay, (5, 5), (350, 30 + len(instructions) * 22), (0, 0, 0), -1)
        temp_img = cv2.addWeighted(overlay, 0.7, temp_img, 0.3, 0)

        for i, instruction in enumerate(instructions):
            cv2.putText(temp_img, instruction, (10, 25 + i * 22),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)

        cv2.imshow(window_name, temp_img)
        cv2.waitKey(3000)  # Show for 3 seconds

    def run_calibration(self):
        """Main calibration workflow"""
        print("\n" + "=" * 60)
        print("CAMERA CALIBRATION - Operator Panel")
        print("=" * 60)

        # Initialize camera
        if not self.initialize_camera():
            print("[ERR] Failed to initialize camera!")
            return False

        # Show loading message
        print("[OK] Camera ready. Preparing calibration window...")
        input("Press Enter when ready to capture calibration frame...")

        # Capture calibration frame
        max_attempts = 5
        calibration_captured = False
        for attempt in range(max_attempts):
            print(f"Capture attempt {attempt + 1}/{max_attempts}...")
            if self.capture_reference_frame():
                calibration_captured = True
                break
            time.sleep(0.5)

        if not calibration_captured:
            print("[ERR] Failed to capture calibration frame!")
            return False

        # Reset zoom
        self.zoom_factor = 1.0
        self.zoom_center = None
        self.pan_x = 0
        self.pan_y = 0

        # Calibration UI
        cal_points = []
        image_copy = self.reference_image.copy()

        def redraw():
            nonlocal image_copy
            image_copy[:] = self.reference_image.copy()
            if self.zoom_factor > 1.0:
                image_copy[:] = self.apply_zoom(image_copy)

            # Draw calibration points
            for i, point in enumerate(cal_points):
                disp_x, disp_y = self.original_to_zoomed_coords(point[0], point[1], image_copy.shape)
                cv2.circle(image_copy, (disp_x, disp_y), 10, (0, 255, 0), -1)
                cv2.circle(image_copy, (disp_x, disp_y), 14, (0, 0, 255), 2)
                cv2.putText(image_copy, str(i + 1), (disp_x + 15, disp_y - 15),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 0, 0), 2)

            # Draw line between points
            if len(cal_points) == 2:
                disp_p1 = self.original_to_zoomed_coords(cal_points[0][0], cal_points[0][1], image_copy.shape)
                disp_p2 = self.original_to_zoomed_coords(cal_points[1][0], cal_points[1][1], image_copy.shape)
                cv2.line(image_copy, disp_p1, disp_p2, (255, 0, 255), 3)

                # Calculate pixel distance
                pixel_dist = math.sqrt((cal_points[1][0] - cal_points[0][0]) ** 2 +
                                      (cal_points[1][1] - cal_points[0][1]) ** 2)

                # Draw status bar
                h = image_copy.shape[0]
                cv2.rectangle(image_copy, (0, h - 80), (500, h), (0, 0, 0), -1)
                cv2.putText(image_copy, f"Distance: {pixel_dist:.1f} pixels",
                           (10, h - 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
                cv2.putText(image_copy, "Press 'S' to save, 'C' to clear",
                           (10, h - 20), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            else:
                # Show instruction
                h = image_copy.shape[0]
                cv2.rectangle(image_copy, (0, h - 50), (400, h), (0, 0, 0), -1)
                cv2.putText(image_copy, f"Click {2 - len(cal_points)} more point(s) | H=Help",
                           (10, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)

        def mouse_callback(event, x, y, flags, param):
            nonlocal cal_points

            orig_x, orig_y = self.zoomed_to_original_coords(x, y, image_copy.shape)

            if event == cv2.EVENT_LBUTTONDOWN and len(cal_points) < 2:
                cal_points.append([orig_x, orig_y])
                print(f"[*] Point {len(cal_points)} placed at ({int(orig_x)}, {int(orig_y)})")
                if len(cal_points) == 2:
                    print("[OK] Two points marked! Press 'S' to save calibration.")
                redraw()

            elif event == cv2.EVENT_RBUTTONDOWN and len(cal_points) > 0:
                # Remove nearest point
                min_dist = float('inf')
                nearest_idx = -1
                for i, pt in enumerate(cal_points):
                    dist = math.sqrt((pt[0] - orig_x) ** 2 + (pt[1] - orig_y) ** 2)
                    if dist < min_dist:
                        min_dist = dist
                        nearest_idx = i

                if min_dist < 100:  # Within reasonable distance
                    cal_points.pop(nearest_idx)
                    print(f"[*] Removed point {nearest_idx + 1}")
                    redraw()

        # Create window
        window_name = "Camera Calibration - Mark Two Points"
        cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)
        cv2.resizeWindow(window_name, 1200, 800)
        cv2.setMouseCallback(window_name, mouse_callback)

        print("\n[*] Calibration window opened.")
        print("[*] Click on two points marking a known distance.")
        print("[*] Press 'H' for help, 'S' to save, 'Q' to quit.")

        redraw()
        self.show_calibration_instructions(image_copy, window_name)

        while True:
            cv2.imshow(window_name, image_copy)
            key = cv2.waitKey(1) & 0xFF

            if key == ord('s') or key == ord('S'):
                if len(cal_points) == 2:
                    # Calculate pixel distance
                    pixel_distance = math.sqrt((cal_points[1][0] - cal_points[0][0]) ** 2 +
                                              (cal_points[1][1] - cal_points[0][1]) ** 2)

                    # Ask for real distance
                    print("\n" + "=" * 60)
                    print("Enter the real-world distance between the two points")
                    print("=" * 60)

                    try:
                        distance_input = input("Distance in centimeters: ")
                        self.reference_length_cm = float(distance_input)

                        if self.reference_length_cm <= 0:
                            raise ValueError("Distance must be positive")

                        self.pixels_per_cm = pixel_distance / self.reference_length_cm
                        self.is_calibrated = True

                        print(f"\n[OK] Calibration successful!")
                        print(f"[SCALE] Pixel distance: {pixel_distance:.2f} pixels")
                        print(f"[DIM] Real distance: {self.reference_length_cm} cm")
                        print(f"[CALC] Scale factor: {self.pixels_per_cm:.2f} pixels/cm")

                        self.save_calibration()
                        cv2.destroyWindow(window_name)

                        # Close camera
                        if self.camera_obj:
                            self.camera_obj.close()

                        return True

                    except ValueError as e:
                        print(f"[ERR] Invalid input: {e}")
                        print("[*] Please enter a valid positive number.")
                else:
                    print("[ERR] Please mark exactly 2 points first!")

            elif key == ord('c') or key == ord('C'):
                cal_points = []
                redraw()
                print("[*] Points cleared.")

            elif key == ord('z') or key == ord('Z'):
                self.zoom_factor = min(5.0, self.zoom_factor * 1.2)
                redraw()
                print(f"Zoom: {self.zoom_factor:.1f}x")

            elif key == ord('x') or key == ord('X'):
                self.zoom_factor = max(1.0, self.zoom_factor / 1.2)
                redraw()
                print(f"Zoom: {self.zoom_factor:.1f}x")

            elif key == ord('r') or key == ord('R'):
                self.zoom_factor = 1.0
                self.zoom_center = None
                self.pan_x = 0
                self.pan_y = 0
                redraw()
                print("Zoom reset")

            elif key == 81:  # Left arrow
                self.pan_x -= 50
                redraw()
            elif key == 83:  # Right arrow
                self.pan_x += 50
                redraw()
            elif key == 82:  # Up arrow
                self.pan_y -= 50
                redraw()
            elif key == 84:  # Down arrow
                self.pan_y += 50
                redraw()

            elif key == ord('h') or key == ord('H'):
                self.show_calibration_instructions(image_copy, window_name)

            elif key == ord('q') or key == ord('Q'):
                print("[*] Calibration cancelled by user.")
                break

        cv2.destroyAllWindows()
        if self.camera_obj:
            self.camera_obj.close()

        return False


def main(force_new=False, silent=False):
    """Main entry point — accepts keyword arguments for dispatch from core_main.py"""
    if not silent:
        print("\n" + "=" * 60)
        print("OPERATOR PANEL - CAMERA CALIBRATION WORKER")
        print("=" * 60)

    calibrator = CameraCalibrator()

    # Check for existing calibration (unless force-new)
    if not force_new:
        if calibrator.load_calibration():
            print("\n[?] Existing calibration found.")
            print(f"    Scale: {calibrator.pixels_per_cm:.2f} pixels/cm")
            response = input("Create new calibration? (y/n): ").strip().lower()
            if response != 'y':
                print("[OK] Using existing calibration.")
                return 0
    else:
        # Force new - just load existing data for reference but proceed with new calibration
        calibrator.load_calibration()
        if not silent:
            print("[*] Force new calibration mode - skipping prompt")

    # Run calibration
    if calibrator.run_calibration():
        print("\n[OK] Calibration completed successfully!")
        return 0
    else:
        print("\n[ERR] Calibration failed or was cancelled.")
        return 1


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description='Camera Calibration Worker')
    parser.add_argument('--force-new', action='store_true',
                       help='Skip existing calibration check and create new')
    parser.add_argument('--silent', action='store_true',
                       help='Minimal console output')
    args = parser.parse_args()

    sys.exit(main(force_new=args.force_new, silent=args.silent))
