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

// --------- Expose Database API to the Renderer process ---------
contextBridge.exposeInMainWorld('database', {
  /**
   * Execute a SELECT query and return array of results
   */
  query: async <T = any>(sql: string, params?: any[]): Promise<{ success: boolean; data?: T[]; error?: string }> => {
    return ipcRenderer.invoke('db:query', sql, params)
  },

  /**
   * Execute a SELECT query and return single result
   */
  queryOne: async <T = any>(sql: string, params?: any[]): Promise<{ success: boolean; data?: T | null; error?: string }> => {
    return ipcRenderer.invoke('db:queryOne', sql, params)
  },

  /**
   * Execute INSERT, UPDATE, or DELETE query
   */
  execute: async (sql: string, params?: any[]): Promise<{ success: boolean; data?: { affectedRows: number; insertId?: number }; error?: string }> => {
    return ipcRenderer.invoke('db:execute', sql, params)
  },

  /**
   * Securely verify operator PIN against hashes
   */
  verifyPin: async (pin: string): Promise<{ success: boolean; data?: any; error?: string }> => {
    return ipcRenderer.invoke('db:verifyPin', pin)
  },

  /**
   * Test database connection
   */
  testConnection: async (): Promise<{ success: boolean; message?: string; error?: string }> => {
    return ipcRenderer.invoke('db:testConnection')
  },
})

// --------- Expose Measurement API to the Renderer process ---------
contextBridge.exposeInMainWorld('measurement', {
  start: (config: { annotation_name: string; side?: string }) => ipcRenderer.invoke('measurement:start', config),
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

