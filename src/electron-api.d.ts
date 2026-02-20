// ─── MagicQC API Interface (GraphQL + REST) ─────────────────────────────────

interface MagicQCAPI {
    // Connection (REST)
    ping: () => Promise<{ success: boolean; message?: string; error?: string }>

    // Connectivity heartbeat
    getConnectivity: () => Promise<{ status: 'connected' | 'reconnecting' | 'disconnected'; lastCheck: string }>
    onConnectivityChanged: (callback: (event: any, data: { status: string; lastCheck: string }) => void) => () => void

    // Brands / Article Types / Articles cascade (GraphQL)
    getBrands: () => Promise<{ success: boolean; data?: Array<{ id: number; name: string }>; error?: string }>
    getArticleTypes: (brandId: number) => Promise<{ success: boolean; data?: Array<{ id: number; name: string }>; error?: string }>
    getArticles: (brandId: number, typeId?: number | null) => Promise<{
        success: boolean; data?: Array<{
            id: number; article_style: string; description?: string
            brand?: { id: number; name: string }
            articleType?: { id: number; name: string }
        }>; error?: string
    }>

    // Purchase Orders (GraphQL)
    getPurchaseOrders: (brandId: number) => Promise<{
        success: boolean; data?: Array<{
            id: number; po_number: string; date?: string; country?: string; status?: string
            brand?: { id: number; name: string }
            articles?: Array<{ id: number; article_color?: string; order_quantity?: number }>
        }>; error?: string
    }>
    getAllPurchaseOrders: (status?: string) => Promise<{
        success: boolean; data?: Array<{
            id: number; po_number: string; date?: string; country?: string; status?: string
            brand?: { id: number; name: string }
        }>; error?: string
    }>
    getPOArticles: (poId: number) => Promise<{
        success: boolean; data?: Array<{
            id: number; article_color?: string; order_quantity?: number
            purchaseOrder?: { po_number: string }
        }>; error?: string
    }>

    // Measurement Specs & Sizes (GraphQL)
    getMeasurementSpecs: (articleId: number, size: string) => Promise<{
        success: boolean; data?: Array<{
            id: number; measurement_id?: number; code: string; measurement: string;
            expected_value: number; tol_plus: number; tol_minus: number;
            side?: string; size?: string; article_id?: number; unit?: string
            sizes?: Array<{ size: string; value: number; unit?: string }>
        }>; error?: string
    }>
    getAvailableSizes: (articleId: number) => Promise<{ success: boolean; data?: string[]; error?: string }>

    // Measurement Results (GraphQL mutations + REST GET fallback)
    getMeasurementResults: (poArticleId: number, size: string) => Promise<{
        success: boolean; data?: Array<{
            measurement_id: number; measured_value: number | null; status: string;
            tol_plus?: number; tol_minus?: number
        }>; error?: string
    }>
    saveMeasurementResults: (results: any[]) => Promise<{ success: boolean; data?: any; error?: string }>
    saveMeasurementResultsDetailed: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>

    // Sessions (GraphQL mutation)
    saveMeasurementSession: (data: any) => Promise<{ success: boolean; data?: any; error?: string }>

    // Authentication (GraphQL mutation)
    verifyPin: (pin: string) => Promise<{ success: boolean; data?: any; error?: string }>

    // Operators (GraphQL)
    getOperators: () => Promise<{
        success: boolean; data?: Array<{
            id: number; full_name: string; employee_id: string; department: string; contact_number?: string
        }>; error?: string
    }>

    // Annotations (REST — per guide §9)
    operatorFetch: (articleStyle: string, size: string, side?: string, color?: string) => Promise<{
        success: boolean; source?: string;
        annotation?: {
            id: number; article_style: string; size: string; side: string; color?: string;
            annotation_data: any; image_width: number; image_height: number;
            reference_image_data?: string; reference_image_mime_type?: string;
        };
        reference_image?: {
            data: string; mime_type: string; data_url: string; width: number; height: number;
        } | null;
        error?: string
    }>
    fetchImageBase64: (articleStyle: string, size: string, side?: string) => Promise<{
        success: boolean; image?: { data: string; mime_type: string; width: number; height: number }; error?: string
    }>
}

interface MeasurementAPI {
    start: (config: {
        annotation_name: string;
        article_style?: string;
        side?: string;
        garment_color?: string;
        color_code?: string;
        keypoints_pixels?: string | null;
        target_distances?: string | null;
        placement_box?: string | null;
        image_width?: number | null;
        image_height?: number | null;
        annotation_data?: string;
        image_data?: string;
        image_mime_type?: string;
        measurement_specs?: string;
    }) => Promise<{ status: string; message: string; data?: any }>
    stop: () => Promise<{ status: string; message: string }>
    getStatus: () => Promise<{ status: string; running?: boolean; data?: any }>
    getLiveResults: () => Promise<{ status: string; data: any; message?: string }>
    loadTestImage: (relativePath: string) => Promise<{ status: string; data?: string; message?: string }>
    startCalibration: () => Promise<{ status: string; message: string }>
    getCalibrationStatus: () => Promise<{ status: string; data: { calibrated: boolean; pixels_per_cm?: number; reference_length_cm?: number; calibration_date?: string } }>
    cancelCalibration: () => Promise<{ status: string; message: string }>
    uploadCalibration: (calibrationData: {
        pixels_per_cm: number
        reference_length_cm: number
        is_calibrated: boolean
    }) => Promise<{ status: string; message: string; data?: any }>
    fetchLaravelImage: (articleStyle: string, size: string) => Promise<{
        status: string;
        data?: string;
        mime_type?: string;
        width?: number;
        height?: number;
        message?: string
    }>
    saveTempFiles: (data: {
        keypoints: number[][]
        target_distances: Record<string, number>
        placement_box: number[] | null
        image_width: number
        image_height: number
        image_base64: string
    }) => Promise<{ status: string; message: string; jsonPath?: string; imagePath?: string }>
    // Handle status changes (auto-restart bridge)
    onStatusChanged: (callback: (event: any, data: { status: 'connected' | 'reconnecting' | 'disconnected' }) => void) => () => void
}

interface IpcRenderer {
    on: (channel: string, listener: (event: any, ...args: any[]) => void) => void
    off: (channel: string, ...omit: any[]) => void
    send: (channel: string, ...omit: any[]) => void
    invoke: (channel: string, ...omit: any[]) => Promise<any>
}

declare global {
    interface Window {
        api: MagicQCAPI
        measurement: MeasurementAPI
        ipcRenderer: IpcRenderer
    }
}

export { }
