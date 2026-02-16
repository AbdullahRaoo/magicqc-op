import { Operator, DatabaseQueryResult, DatabaseOneResult, DatabaseExecuteResult } from './types/database'

interface DatabaseAPI {
    query: <T = any>(sql: string, params?: any[]) => Promise<{ success: boolean; data?: T[]; error?: string }>
    queryOne: <T = any>(sql: string, params?: any[]) => Promise<{ success: boolean; data?: T | null; error?: string }>
    execute: (sql: string, params?: any[]) => Promise<{ success: boolean; data?: { affectedRows: number; insertId?: number }; error?: string }>
    verifyPin: (pin: string) => Promise<{ success: boolean; data?: any; error?: string }>
    testConnection: () => Promise<{ success: boolean; message?: string; error?: string }>
}

interface MeasurementAPI {
    start: (config: {
        annotation_name: string;
        article_style?: string;
        side?: string;
        garment_color?: string;  // 'white', 'black', or 'other'
        color_code?: string;     // Color suffix code: 'w' (white), 'b' (black), 'z' (other)
        // New measurement-ready data from database
        keypoints_pixels?: string | null;   // JSON string [[x, y], ...] (pixel coordinates)
        target_distances?: string | null;   // JSON string {"1": 3.81, ...} (distances in cm)
        placement_box?: string | null;      // JSON string [x1, y1, x2, y2]
        image_width?: number | null;
        image_height?: number | null;
        // Fallback: percentage-based annotations for conversion
        annotation_data?: string;  // JSON string of annotation points [{x, y, label}]
        image_data?: string;       // Base64 encoded reference image from database
        image_mime_type?: string;  // MIME type of the image
        measurement_specs?: string; // JSON string of spec info [{index, db_id, code, name, expected_value}]
    }) => Promise<{ status: string; message: string; data?: any }>
    stop: () => Promise<{ status: string; message: string }>
    getStatus: () => Promise<{ status: string; data: any }>
    getLiveResults: () => Promise<{ status: string; data: any; message?: string }>
    loadTestImage: (relativePath: string) => Promise<{ status: string; data?: string; message?: string }>
    // Calibration methods
    startCalibration: () => Promise<{ status: string; message: string }>
    getCalibrationStatus: () => Promise<{ status: string; data: { calibrated: boolean; pixels_per_cm?: number; reference_length_cm?: number; calibration_date?: string } }>
    cancelCalibration: () => Promise<{ status: string; message: string }>
    uploadCalibration: (calibrationData: {
        pixels_per_cm: number
        reference_length_cm: number
        is_calibrated: boolean
    }) => Promise<{ status: string; message: string; data?: any }>
    // Fetch image from Laravel API via main process (bypasses CORS)
    fetchLaravelImage: (articleStyle: string, size: string) => Promise<{
        status: string;
        data?: string;
        mime_type?: string;
        width?: number;
        height?: number;
        message?: string
    }>
    // Save annotation and image files to temp_measure folder
    saveTempFiles: (data: {
        keypoints: number[][]
        target_distances: Record<string, number>
        placement_box: number[] | null
        image_width: number
        image_height: number
        image_base64: string
    }) => Promise<{ status: string; message: string; jsonPath?: string; imagePath?: string }>
}

interface IpcRenderer {
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
    off: (channel: string, ...omit: any[]) => void
    send: (channel: string, ...omit: any[]) => void
    invoke: (channel: string, ...omit: any[]) => Promise<any>
}

declare global {
    interface Window {
        database: DatabaseAPI
        measurement: MeasurementAPI
        ipcRenderer: IpcRenderer
    }
}
