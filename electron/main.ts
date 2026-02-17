import { app, BrowserWindow, ipcMain, session } from 'electron'
import bcrypt from 'bcryptjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, ChildProcess } from 'node:child_process'
import { initializeDatabase, closeDatabase, query, queryOne, execute } from './database'
import { PYTHON_API_URL, LARAVEL_API_URL } from './apiConfig'

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null
let pythonProcess: ChildProcess | null = null
let pythonLogStream: fs.WriteStream | null = null

// Start Python API server automatically
async function startPythonServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const pythonScript = path.join(process.env.APP_ROOT!, 'api_server.py')
    console.log('🐍 Starting Python API server:', pythonScript)

    // Ensure logs directory exists and open a write-stream for Python output
    const logsDir = path.join(process.env.APP_ROOT!, 'logs')
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true })
    const logPath = path.join(logsDir, 'python_server.log')
    pythonLogStream = fs.createWriteStream(logPath, { flags: 'a' })
    pythonLogStream.write(`\n${'='.repeat(60)}\n[${new Date().toISOString()}] Python server starting\n${'='.repeat(60)}\n`)

    try {
      // Spawn Python process – fully hidden, no console window for the operator.
      // stdout/stderr are piped so we can write them to the log file.
      pythonProcess = spawn('python', [pythonScript], {
        cwd: process.env.APP_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true, // Sets STARTF_USESHOWWINDOW + SW_HIDE on Windows
        shell: false,
        detached: false
      })

      // Drain stdout/stderr → log file (never shown to the operator)
      pythonProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        pythonLogStream?.write(`[OUT] ${text}\n`)
      })

      pythonProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        pythonLogStream?.write(`[ERR] ${text}\n`)
      })

      pythonProcess.on('error', (err) => {
        const msg = `❌ Failed to start Python server: ${err}`
        console.error(msg)
        pythonLogStream?.write(`${msg}\n`)
        pythonProcess = null
        resolve(false)
      })

      pythonProcess.on('exit', (code) => {
        const msg = `🐍 Python server exited with code ${code}`
        console.log(msg)
        pythonLogStream?.write(`${msg}\n`)
        pythonProcess = null
      })

      // Wait for server to be ready (check health endpoint)
      waitForPythonServer().then(resolve)
    } catch (error) {
      console.error('❌ Error starting Python server:', error)
      resolve(false)
    }
  })
}

// Wait for Python server to be ready
async function waitForPythonServer(maxRetries = 30, delay = 500): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${PYTHON_API_URL}/health`)
      if (response.ok) {
        console.log('✅ Python API server is ready')
        return true
      }
    } catch {
      // Server not ready yet, wait and retry
    }
    await new Promise(r => setTimeout(r, delay))
  }
  console.error('❌ Python server did not start in time')
  return false
}

// Stop Python server
function stopPythonServer() {
  if (pythonProcess) {
    console.log('🛑 Stopping Python API server...')
    try {
      // On Windows, we need to kill the process tree
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', pythonProcess.pid!.toString(), '/f', '/t'], { windowsHide: true })
      } else {
        pythonProcess.kill('SIGTERM')
      }
    } catch (error) {
      console.error('Error stopping Python server:', error)
    }
    pythonProcess = null
  }
  // Close the log file stream
  if (pythonLogStream) {
    pythonLogStream.write(`[${new Date().toISOString()}] Python server stopped\n`)
    pythonLogStream.end()
    pythonLogStream = null
  }
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for preload script to work with contextBridge
      // Content Security Policy is set via meta tag in index.html
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// Set up Content Security Policy
function setupCSP() {
  // CSP for development (allows Vite HMR)
  // In production builds, this will be more restrictive
  const isDev = !!VITE_DEV_SERVER_URL

  // Build CSP allowing the Python API and Laravel API origins dynamically
  const pythonOrigin = PYTHON_API_URL   // e.g. http://localhost:5000
  const laravelOrigin = LARAVEL_API_URL // e.g. http://127.0.0.1:8000

  const csp = isDev
    ? `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:* ws://localhost:* wss://localhost:*; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; connect-src 'self' ${pythonOrigin} ${laravelOrigin} http://localhost:* ws://localhost:* wss://localhost:*; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none';`
    : `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: https: blob:; connect-src 'self' ${pythonOrigin} ${laravelOrigin}; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none';`

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp]
      }
    })
  })
}

// Initialize database and create window when app is ready
app.whenReady().then(async () => {
  try {
    // Clear Chromium cache on startup to prevent corruption-related blank screens
    await session.defaultSession.clearCache()

    // Set up Content Security Policy
    setupCSP()

    // Start Python API server automatically
    console.log('🚀 Starting application services...')
    const pythonReady = await startPythonServer()
    if (pythonReady) {
      console.log('✅ Python measurement server started successfully')
    } else {
      console.warn('⚠️ Python server may not be available - measurement features may be limited')
    }

    // Initialize database connection
    await initializeDatabase()

    // Set up IPC handlers for database operations
    setupDatabaseHandlers()

    // Set up IPC handlers for measurement operations
    setupMeasurementHandlers()

    // Create window
    createWindow()
  } catch (error) {
    console.error('Failed to start application:', error)
    app.quit()
  }
})

// Set up IPC handlers for database operations
function setupDatabaseHandlers() {
  // Query handler - returns array of results
  ipcMain.handle('db:query', async (_event, sql: string, params?: any[]) => {
    try {
      const results = await query(sql, params)
      return { success: true, data: results }
    } catch (error) {
      console.error('Database query error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // QueryOne handler - returns single result
  ipcMain.handle('db:queryOne', async (_event, sql: string, params?: any[]) => {
    try {
      const result = await queryOne(sql, params)
      return { success: true, data: result }
    } catch (error) {
      console.error('Database queryOne error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Execute handler - for INSERT, UPDATE, DELETE
  ipcMain.handle('db:execute', async (_event, sql: string, params?: any[]) => {
    try {
      const result = await execute(sql, params)
      return { success: true, data: result }
    } catch (error) {
      console.error('Database execute error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  })

  // Verify PIN handler
  ipcMain.handle('db:verifyPin', async (_event, pin: string) => {
    try {
      console.log(`[AUTH] Attempting login for PIN: ${pin}`);
      const operators = await query('SELECT id, full_name, employee_id, department, login_pin FROM operators')

      console.log(`[AUTH] Found ${operators.length} operators in database`);

      for (const op of operators) {
        if (op.login_pin) {
          // Check for literal match (e.g. if stored as plain '0001')
          if (op.login_pin === pin) {
            console.log(`[AUTH] Plaintext match found for: ${op.full_name}`);
            const { login_pin, ...opSafeData } = op
            return { success: true, data: opSafeData }
          }

          // Check for Bcrypt match
          try {
            const isMatch = await bcrypt.compare(pin, op.login_pin)
            console.log(`[AUTH] Bcrypt Match Result for ${op.full_name}: ${isMatch}`);
            if (isMatch) {
              const { login_pin, ...opSafeData } = op
              return { success: true, data: opSafeData }
            }
          } catch (e: any) {
            console.log(`[AUTH] Bcrypt Error: ${e.message}`);
          }
        }
      }

      console.log(`[AUTH] No match found for PIN: ${pin}`);
      return { success: false, error: 'Invalid PIN. Please try again.' }
    } catch (error) {
      console.error('[AUTH] System error:', error)
      return { success: false, error: 'Authentication service unavailable' }
    }
  })
}

// Set up IPC handlers for measurement operations
function setupMeasurementHandlers() {
  // PYTHON_API_URL is imported from apiConfig.ts (reads from .env)

  // Helper function to make API calls with retry
  async function fetchWithRetry(url: string, options?: RequestInit, maxRetries = 3): Promise<Response> {
    let lastError: Error | null = null
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options)
        return response
      } catch (error) {
        lastError = error as Error
        // Wait before retry
        await new Promise(r => setTimeout(r, 500))
      }
    }
    throw lastError
  }

  // Start measurement
  ipcMain.handle('measurement:start', async (_event, config: {
    annotation_name: string;
    article_style?: string;
    side?: string;
    garment_color?: string;
    color_code?: string;
    // New measurement-ready data from database
    keypoints_pixels?: string | null;
    target_distances?: string | null;
    placement_box?: string | null;
    image_width?: number | null;
    image_height?: number | null;
    // Fallback data
    annotation_data?: string;
    image_data?: string;
    image_mime_type?: string;
  }) => {
    try {
      const response = await fetchWithRetry(`${PYTHON_API_URL}/api/measurement/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      })
      const result = await response.json()
      return result
    } catch (error) {
      console.error('Failed to start measurement:', error)
      // Try to restart Python server if it crashed
      console.log('🔄 Attempting to restart Python server...')
      const restarted = await startPythonServer()
      if (restarted) {
        // Retry the request
        try {
          const response = await fetch(`${PYTHON_API_URL}/api/measurement/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
          })
          return await response.json()
        } catch {
          return { status: 'error', message: 'Measurement system unavailable. Please restart the application.' }
        }
      }
      return { status: 'error', message: 'Measurement system is starting. Please try again in a moment.' }
    }
  })

  // Stop measurement
  ipcMain.handle('measurement:stop', async () => {
    try {
      const response = await fetch(`${PYTHON_API_URL}/api/measurement/stop`, {
        method: 'POST'
      })
      return await response.json()
    } catch (error) {
      return { status: 'error', message: 'Could not stop measurement process' }
    }
  })

  // Get current status
  ipcMain.handle('measurement:getStatus', async () => {
    try {
      const response = await fetch(`${PYTHON_API_URL}/api/measurement/status`)
      return await response.json()
    } catch (error) {
      return { status: 'error', message: 'API offline' }
    }
  })

  // Get live results
  ipcMain.handle('measurement:getLiveResults', async () => {
    try {
      const response = await fetch(`${PYTHON_API_URL}/api/results/live`)
      return await response.json()
    } catch (error) {
      return { status: 'error', message: 'Could not fetch live results' }
    }
  })

  // Load test image from local file
  ipcMain.handle('measurement:loadTestImage', async (_event, relativePath: string) => {
    try {
      const path = await import('path')
      const fs = await import('fs')

      // Resolve path relative to app root
      const appRoot = process.cwd()
      const imagePath = path.join(appRoot, relativePath)

      console.log('[MAIN] Loading test image from:', imagePath)

      if (!fs.existsSync(imagePath)) {
        console.log('[MAIN] Test image not found:', imagePath)
        return { status: 'error', message: 'Test image not found: ' + imagePath }
      }

      // Read file and convert to base64
      const imageBuffer = fs.readFileSync(imagePath)
      const base64Image = imageBuffer.toString('base64')

      console.log('[MAIN] Loaded test image, base64 length:', base64Image.length)

      return { status: 'success', data: base64Image }
    } catch (error) {
      console.error('[MAIN] Error loading test image:', error)
      return { status: 'error', message: 'Error loading test image: ' + String(error) }
    }
  })

  // Start camera calibration
  ipcMain.handle('measurement:startCalibration', async () => {
    try {
      console.log('[MAIN] Starting camera calibration...')
      const response = await fetch(`${PYTHON_API_URL}/api/calibration/start`, {
        method: 'POST'
      })
      return await response.json()
    } catch (error) {
      console.error('[MAIN] Failed to start calibration:', error)
      return { status: 'error', message: 'Could not start calibration. Please ensure Python server is running.' }
    }
  })

  // Get calibration status
  ipcMain.handle('measurement:getCalibrationStatus', async () => {
    try {
      const response = await fetch(`${PYTHON_API_URL}/api/calibration/status`)
      return await response.json()
    } catch (error) {
      return { status: 'error', message: 'Could not fetch calibration status' }
    }
  })

  // Cancel calibration
  ipcMain.handle('measurement:cancelCalibration', async () => {
    try {
      const response = await fetch(`${PYTHON_API_URL}/api/calibration/cancel`, {
        method: 'POST'
      })
      return await response.json()
    } catch (error) {
      return { status: 'error', message: 'Could not cancel calibration' }
    }
  })

  // Upload calibration JSON data
  ipcMain.handle('measurement:uploadCalibration', async (_event, calibrationData: {
    pixels_per_cm: number
    reference_length_cm: number
    is_calibrated: boolean
  }) => {
    try {
      console.log('[MAIN] Uploading calibration:', calibrationData)
      const response = await fetch(`${PYTHON_API_URL}/api/calibration/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calibrationData)
      })
      return await response.json()
    } catch (error) {
      console.error('[MAIN] Failed to upload calibration:', error)
      return { status: 'error', message: 'Could not upload calibration. Please ensure Python server is running.' }
    }
  })

  // Fetch reference image from Laravel API (bypasses CORS in renderer)
  ipcMain.handle('measurement:fetchLaravelImage', async (_event, articleStyle: string, size: string) => {
    // LARAVEL_API_URL is imported from apiConfig.ts (reads from .env)
    const imageApiUrl = `${LARAVEL_API_URL}/api/uploaded-annotations/fetch-image-base64?article_style=${encodeURIComponent(articleStyle)}&size=${encodeURIComponent(size)}`

    console.log('[MAIN] Fetching Laravel image:', imageApiUrl)

    try {
      const response = await fetch(imageApiUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      })

      if (!response.ok) {
        return {
          status: 'error',
          message: `API returned ${response.status}: ${response.statusText}`
        }
      }

      const data = await response.json()

      if (data.success && data.image && data.image.data) {
        console.log('[MAIN] Successfully fetched image from Laravel')
        return {
          status: 'success',
          data: data.image.data,
          mime_type: data.image.mime_type || 'image/jpeg',
          width: data.image.width,
          height: data.image.height
        }
      } else {
        return {
          status: 'error',
          message: 'Invalid image response from API'
        }
      }
    } catch (error) {
      console.error('[MAIN] Failed to fetch Laravel image:', error)
      return {
        status: 'error',
        message: `Could not connect to Laravel server: ${error}`
      }
    }
  })

  // Save annotation and image to temp_measure folder before measurement
  ipcMain.handle('measurement:saveTempFiles', async (_event, data: {
    keypoints: number[][]
    target_distances: Record<string, number>
    placement_box: number[] | null
    image_width: number
    image_height: number
    image_base64: string
  }) => {
    const path = await import('path')
    const fs = await import('fs')

    const tempMeasureDir = path.join(process.cwd(), 'temp_measure')

    console.log('[MAIN] Saving files to temp_measure folder:', tempMeasureDir)

    try {
      // Ensure temp_measure folder exists
      if (!fs.existsSync(tempMeasureDir)) {
        fs.mkdirSync(tempMeasureDir, { recursive: true })
      }

      // Save annotation_data.json
      const annotationData = {
        keypoints: data.keypoints,
        target_distances: data.target_distances,
        placement_box: data.placement_box,
        image_width: data.image_width,
        image_height: data.image_height
      }

      const jsonPath = path.join(tempMeasureDir, 'annotation_data.json')
      fs.writeFileSync(jsonPath, JSON.stringify(annotationData, null, 2))
      console.log('[MAIN] Saved annotation_data.json')

      // Save reference_image.jpg
      // Remove data:image/...;base64, prefix if present
      let base64Data = data.image_base64
      if (base64Data.includes(',')) {
        base64Data = base64Data.split(',')[1]
      }

      const imagePath = path.join(tempMeasureDir, 'reference_image.jpg')
      fs.writeFileSync(imagePath, Buffer.from(base64Data, 'base64'))
      console.log('[MAIN] Saved reference_image.jpg')

      return {
        status: 'success',
        message: 'Saved temp_measure files',
        jsonPath,
        imagePath
      }
    } catch (error) {
      console.error('[MAIN] Failed to save temp_measure files:', error)
      return {
        status: 'error',
        message: `Failed to save files: ${error}`
      }
    }
  })
}

// Close database connection and stop Python server when app quits
app.on('before-quit', async () => {
  stopPythonServer()
  await closeDatabase()
})
