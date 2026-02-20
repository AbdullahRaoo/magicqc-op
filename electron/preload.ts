import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },
})

// --------- Expose MagicQC API to the Renderer process ---------
// All data access now goes through GraphQL (single POST /graphql endpoint).
// Annotations and ping still use REST (per guide §9).
contextBridge.exposeInMainWorld('api', {
  // Connection test (REST)
  ping: () => ipcRenderer.invoke('api:ping'),

  // Brands → Article Types → Articles cascade (GraphQL)
  getBrands: () => ipcRenderer.invoke('api:brands'),
  getArticleTypes: (brandId: number) => ipcRenderer.invoke('api:articleTypes', brandId),
  getArticles: (brandId: number, typeId?: number | null) =>
    ipcRenderer.invoke('api:articles', brandId, typeId),

  // Purchase Orders (GraphQL)
  getPurchaseOrders: (brandId: number) => ipcRenderer.invoke('api:purchaseOrders', brandId),
  getAllPurchaseOrders: (status?: string) => ipcRenderer.invoke('api:purchaseOrdersAll', status),
  getPOArticles: (poId: number) => ipcRenderer.invoke('api:poArticles', poId),

  // Measurement Specs & Sizes (GraphQL)
  getMeasurementSpecs: (articleId: number, size: string) =>
    ipcRenderer.invoke('api:measurementSpecs', articleId, size),
  getAvailableSizes: (articleId: number) =>
    ipcRenderer.invoke('api:availableSizes', articleId),

  // Measurement Results CRUD (GraphQL mutations + REST fallback for GET)
  getMeasurementResults: (poArticleId: number, size: string) =>
    ipcRenderer.invoke('api:measurementResults', poArticleId, size),
  saveMeasurementResults: (results: any[]) =>
    ipcRenderer.invoke('api:saveMeasurementResults', results),
  saveMeasurementResultsDetailed: (data: any) =>
    ipcRenderer.invoke('api:saveMeasurementResultsDetailed', data),

  // Measurement Sessions (GraphQL mutation)
  saveMeasurementSession: (data: any) =>
    ipcRenderer.invoke('api:saveMeasurementSession', data),

  // Operator Authentication (GraphQL mutation)
  verifyPin: (pin: string) => ipcRenderer.invoke('api:verifyPin', pin),

  // Operators List (GraphQL)
  getOperators: () => ipcRenderer.invoke('api:operators'),

  // Annotation + Reference Image (REST — per guide §9)
  operatorFetch: (articleStyle: string, size: string, side?: string, color?: string) =>
    ipcRenderer.invoke('api:operatorFetch', articleStyle, size, side, color),

  // Image fetch base64 (REST — per guide §9)
  fetchImageBase64: (articleStyle: string, size: string, side?: string) =>
    ipcRenderer.invoke('api:fetchImageBase64', articleStyle, size, side),

  // Connectivity status (heartbeat manager)
  getConnectivity: () => ipcRenderer.invoke('api:connectivity'),
  onConnectivityChanged: (callback: (event: any, data: { status: string; lastCheck: string }) => void) => {
    ipcRenderer.on('api:connectivity-changed', callback)
    return () => ipcRenderer.removeListener('api:connectivity-changed', callback)
  },
})

// --------- Expose Measurement API to the Renderer process ---------
contextBridge.exposeInMainWorld('measurement', {
  start: (config: { annotation_name: string; side?: string; garment_color?: string }) => ipcRenderer.invoke('measurement:start', config),
  stop: () => ipcRenderer.invoke('measurement:stop'),
  getStatus: () => ipcRenderer.invoke('measurement:getStatus'),
  getLiveResults: () => ipcRenderer.invoke('measurement:getLiveResults'),
  loadTestImage: (relativePath: string) => ipcRenderer.invoke('measurement:loadTestImage', relativePath),
  // Calibration methods
  startCalibration: () => ipcRenderer.invoke('measurement:startCalibration'),
  getCalibrationStatus: () => ipcRenderer.invoke('measurement:getCalibrationStatus'),
  cancelCalibration: () => ipcRenderer.invoke('measurement:cancelCalibration'),
  uploadCalibration: (calibrationData: {
    pixels_per_cm: number
    reference_length_cm: number
    is_calibrated: boolean
  }) => ipcRenderer.invoke('measurement:uploadCalibration', calibrationData),
  // Fetch image from Laravel API (via main process to bypass CORS)
  fetchLaravelImage: (articleStyle: string, size: string) =>
    ipcRenderer.invoke('measurement:fetchLaravelImage', articleStyle, size),
  // Save annotation and image files to temp_measure folder
  saveTempFiles: (data: {
    keypoints: number[][]
    target_distances: Record<string, number>
    placement_box: number[] | null
    image_width: number
    image_height: number
    image_base64: string
  }) => ipcRenderer.invoke('measurement:saveTempFiles', data),
})
