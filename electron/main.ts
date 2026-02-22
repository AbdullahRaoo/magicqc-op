import './env-setup' // MUST BE FIRST - initializes paths and loads .env
import { app, BrowserWindow, ipcMain, session } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import { spawn, execSync, ChildProcess } from 'node:child_process'
import { PYTHON_API_URL, MAGICQC_API_BASE, MAGICQC_API_KEY } from './apiConfig'
import { apiClient } from './api-client'
import { getFingerprint } from './hwid'
import { validateLicense, createLicense, licenseExists } from './license'
import {
  checkForDebugger, checkForVM, checkCameraSDK,
  checkForDebugTools, checkForDllInjection, checkBinaryIntegrity,
} from './security'
import { loadSecureConfigs, applyEnvConfig } from './config-vault'

// ESM has no __dirname — derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Get finalized roots from environment (set by env-setup.ts)
const RESOURCE_ROOT = process.env.APP_ROOT!
const STORAGE_ROOT = process.env.STORAGE_ROOT!

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

// dist/ and dist-electron/ are INSIDE the asar archive in production.
const ASAR_ROOT = app.getAppPath()           // resources/app.asar in prod, project root in dev
export const MAIN_DIST = path.join(ASAR_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(ASAR_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(ASAR_ROOT, 'public') : RENDERER_DIST

// Global dev/prod flag — used throughout for conditional behavior
const isDev = !app.isPackaged

// ── Suppress error popups in production ──────────────────────
// Prevent Electron from showing native OS error dialogs to end users.
// Errors are logged to STORAGE_ROOT/logs/ instead.
if (!isDev) {
  // Suppress the default Electron crash/error dialog
  import('electron').then(({ dialog }) => {
    dialog.showErrorBox = (title: string, content: string) => {
      console.error(`[ErrorBox suppressed] ${title}: ${content}`)
    }
  })

  // Catch unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    console.error('[UnhandledRejection]', reason)
  })

  // Catch uncaught exceptions — log and continue
  process.on('uncaughtException', (err) => {
    console.error('[UncaughtException]', err)
  })
}

let win: BrowserWindow | null
let pythonProcess: ChildProcess | null = null
let pythonLogStream: fs.WriteStream | null = null
let licenseValid = false   // Tracks whether hardware license passed
const appState = { isQuitting: false } // Tracks application shutdown status
let pythonRestartCount = 0
const PYTHON_MAX_RESTARTS = 5

// ══════════════════════════════════════════════════════════════
//  SINGLE INSTANCE LOCK — prevent multiple copies running
// ══════════════════════════════════════════════════════════════
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  // Another instance is already running — quit immediately
  app.quit()
}
app.on('second-instance', () => {
  // User tried to run a second copy — focus the existing window
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

// ── Security audit log ──────────────────────────────────────
function securityLog(message: string): void {
  // STORAGE_ROOT/logs is pre-created by the startup runtimeDirs block below.
  // Never use STORAGE_ROOT/runtime/logs — that sub-path is not pre-created.
  const logDir = path.join(process.env.STORAGE_ROOT!, 'logs')
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
  const logPath = path.join(logDir, 'security.log')
  const timestamp = new Date().toISOString()
  fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`)
}

// ── Content Security Policy ─────────────────────────────────
function setupCSP(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // In production, Electron loads from file:// protocol where 'self' has an
    // opaque (null) origin in Chromium — header-based CSP breaks script/style
    // loading.  The meta-tag CSP in index.html handles production security.
    // Only inject header CSP for http(s):// requests (dev server, API calls).
    if (!isDev && details.url.startsWith('file://')) {
      return callback({ responseHeaders: details.responseHeaders })
    }

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            // Dev: permissive — Vite HMR needs inline scripts, eval, and WebSocket
            ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https://magicqc.online; img-src 'self' data: blob: https:; object-src 'none'"
            // Prod http(s) requests (e.g. API calls): strict
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self' http://localhost:* http://127.0.0.1:* https://magicqc.online; img-src 'self' data: blob:; object-src 'none'"
        ],
      },
    })
  })
}

// Start Python API server automatically
// Start Python API server automatically with auto-restart resilience
async function startPythonServer(isRestart = false): Promise<boolean> {
  if (isRestart) {
    console.log('🔄 Attempting to restart Python engine...');
    stopPythonServer();
    // Wait briefly for port release
    await new Promise(r => setTimeout(r, 1000));
  }

  return new Promise((resolve) => {
    // Production: spawn compiled exe directly (no Python interpreter needed)
    // Dev:        spawn python interpreter with script path
    const exePath = path.join(process.env.APP_ROOT!, 'python-core', 'dist', 'magicqc_core.exe')
    const scriptPath = path.join(process.env.APP_ROOT!, 'python-core', 'core_main.py')

    const spawnCmd = isDev ? 'python' : exePath
    const spawnArgs = isDev ? [scriptPath] : []

    // Log absolute path to ensure alignment
    console.log(`🐍 Starting Python API server [${isDev ? 'DEV' : 'PROD'}]: ${spawnCmd}`)
    console.log(`   Resource Root (EXE): ${RESOURCE_ROOT}`)
    console.log(`   Storage Root (CWD):  ${STORAGE_ROOT}`)

    // Ensure logs directory exists at STORAGE_ROOT/logs
    const logsDir = path.join(STORAGE_ROOT, 'logs')
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true })
    const logPath = path.join(logsDir, 'python_server.log')

    pythonLogStream = fs.createWriteStream(logPath, { flags: 'a' })
    pythonLogStream.write(`\n${'='.repeat(60)}\n[${new Date().toISOString()}] Python server ${isRestart ? 'RESTARTING' : 'STARTING'}\n${'='.repeat(60)}\n`)

    try {
      // Spawn process – fully hidden, no console window for the operator.
      // CWD is strictly set to STORAGE_ROOT for absolute path resolution.
      pythonProcess = spawn(spawnCmd, spawnArgs, {
        cwd: STORAGE_ROOT,
        env: {
          ...process.env,
          // Explicitly pass storage root to Python for Results/Polling alignment
          MAGICQC_STORAGE_ROOT: STORAGE_ROOT
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
        detached: false
      })

      // Drain stdout/stderr → log file
      pythonProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        pythonLogStream?.write(`[OUT] ${text}\n`)
        // Also log to console in dev
        if (isDev) console.log(`[PyOUT] ${text}`)
      })

      pythonProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        pythonLogStream?.write(`[ERR] ${text}\n`)
        if (isDev) console.error(`[PyERR] ${text}`)
      })

      pythonProcess.on('error', (err) => {
        const msg = `❌ Failed to start Python server: ${err}`
        console.error(msg)
        pythonLogStream?.write(`${msg}\n`)
        pythonProcess = null
        resolve(false)
      })

      pythonProcess.on('exit', (code, signal) => {
        const msg = `🐍 Python server exited (code: ${code}, signal: ${signal})`
        console.warn(msg)
        pythonLogStream?.write(`${msg}\n`)
        pythonProcess = null

        // Auto-restart logic for production resilience (capped to prevent infinite loops)
        if (!appState.isQuitting && pythonRestartCount < PYTHON_MAX_RESTARTS) {
          pythonRestartCount++
          console.log(`🔄 Python core died unexpectedly — triggering auto-restart in 2s... (attempt ${pythonRestartCount}/${PYTHON_MAX_RESTARTS})`);
          setTimeout(() => startPythonServer(true), 2000);
        } else if (pythonRestartCount >= PYTHON_MAX_RESTARTS) {
          console.warn(`⛔ Python server failed after ${PYTHON_MAX_RESTARTS} restart attempts — measurement features unavailable`)
        }
      })

      // Wait for server to be ready
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
    const pid = pythonProcess.pid
    console.log('🛑 Stopping Python API server...')
    try {
      // On Windows, kill the entire process tree synchronously so it's
      // dead before Electron exits — prevents orphaned magicqc_core.exe.
      if (process.platform === 'win32' && pid) {
        execSync(`taskkill /pid ${pid} /f /t`, { windowsHide: true, timeout: 5000 })
      } else {
        pythonProcess.kill('SIGTERM')
      }
    } catch (error) {
      // taskkill may fail if process already exited — that's fine
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

function createWindow(opts?: { fingerprint: string; reason: string } | { sdkMissing: true }) {
  win = new BrowserWindow({
    icon: path.join(ASAR_ROOT, 'public', 'favicon.ico'),
    autoHideMenuBar: true,  // Hide File/Edit/View menu bar
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false, // Required for preload script to work with contextBridge
      devTools: isDev, // Disable DevTools in production
    },
  })

  // Remove the application menu entirely in production
  if (!isDev) {
    win.setMenu(null)
  }

  // F11 toggles fullscreen (menu is removed so the default shortcut is gone)
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F11' && input.type === 'keyDown') {
      win!.setFullScreen(!win!.isFullScreen())
      _event.preventDefault()
    }
  })

  // ── Production security: full DevTools & inspection lockdown ──
  if (!isDev) {
    // Block F12, Ctrl+Shift+I/J/C, Ctrl+U (view-source)
    win.webContents.on('before-input-event', (_event, input) => {
      const isDevToolsShortcut =
        input.key === 'F12' ||
        (input.control && input.shift && ['I', 'i', 'J', 'j', 'C', 'c'].includes(input.key)) ||
        (input.control && (input.key === 'u' || input.key === 'U'))
      if (isDevToolsShortcut) {
        _event.preventDefault()
      }
    })

    // Disable right-click context menu in production
    win.webContents.on('context-menu', (e) => {
      e.preventDefault()
    })

    // Override openDevTools to no-op (prevents programmatic access)
    win.webContents.openDevTools = () => { }
  }

  // Push message to Renderer-process on load
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  // Handle renderer crashes gracefully in production
  if (!isDev) {
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error('[RenderProcessGone]', details.reason, details.exitCode)
      // Attempt to reload the page on crash (not on kill/oom)
      if (details.reason === 'crashed' || details.reason === 'abnormal-exit') {
        setTimeout(() => {
          if (win && !win.isDestroyed()) {
            win.reload()
          }
        }, 2000)
      }
    })
  }

  // ── Load the appropriate page ──
  if (opts && 'sdkMissing' in opts) {
    // Camera SDK not found — show blocking SDK missing page
    const htmlPath = path.join(ASAR_ROOT, 'public', 'sdk_missing.html')
    win.loadFile(htmlPath)
  } else if (opts && 'fingerprint' in opts) {
    // License / security failed — show unauthorized page
    const fp = encodeURIComponent(opts.fingerprint)
    const reason = encodeURIComponent(opts.reason)
    const htmlPath = path.join(ASAR_ROOT, 'public', 'unauthorized.html')
    win.loadFile(htmlPath, { query: { fp, reason } })
  } else if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.maximize()
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

// Initialize app and create window when ready
app.whenReady().then(async () => {
  try {
    // Log startup environment for diagnostics (dev only — no path leaks in production)
    if (isDev) {
      console.log(`🏭 MagicQC Operator Panel v${app.getVersion()}`)
      console.log(`   Mode: DEVELOPMENT`)
      console.log(`   APP_ROOT: ${process.env.APP_ROOT}`)
      console.log(`   ASAR_ROOT: ${ASAR_ROOT}`)
      console.log(`   Platform: ${process.platform} ${process.arch}`)
    }

    // Clear Chromium cache on startup to prevent corruption-related blank screens
    await session.defaultSession.clearCache()

    // Set up Content Security Policy
    setupCSP()

    // Ensure all runtime directories exist directly under STORAGE_ROOT
    // Anchored to the authoritative STORAGE_ROOT/storage structure.
    const runtimeDirs = [
      'logs',
      'storage',
      'storage/measurement_results',
      'temp_annotations',
      'temp_measure',
      'secure'
    ]
    for (const dir of runtimeDirs) {
      const dirPath = path.join(process.env.STORAGE_ROOT!, dir)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
        if (isDev) console.log(`📁 Created authoritative directory: ${dir}`)
      }
    }

    // Migrate default templates/configs if needed (first launch in a new STORAGE_ROOT)
    const templates = [
      '.env',
      'camera_calibration.json',
      'registration_config.json',
      'measurement_config.json'
    ]
    for (const file of templates) {
      const src = path.join(RESOURCE_ROOT, file)
      const dest = path.join(STORAGE_ROOT, file)
      if (fs.existsSync(src) && !fs.existsSync(dest)) {
        try {
          fs.copyFileSync(src, dest)
          if (isDev) console.log(`🚚 Initialized storage with template: ${file}`)
        } catch (e) {
          console.error(`❌ Migration failed for ${file}:`, e)
        }
      }
    }


    // ══════════════════════════════════════════════════════════════
    //  SECURITY GATES (production only — dev mode bypasses all)
    //  Order: anti-debug → debug tools → DLL → VM → license → SDK → exe → integrity
    // ══════════════════════════════════════════════════════════════
    if (!isDev) {
      securityLog('=== Application startup ===')

      // ── Gate 1: Anti-Debug (Node.js level) ──
      const debugCheck = checkForDebugger()
      if (!debugCheck.safe) {
        securityLog(`BLOCKED: ${debugCheck.reason}`)
        console.error(`🚫 Security: ${debugCheck.reason}`)
        app.quit()
        return
      }
      securityLog('PASS: Anti-debug check')

      // ── Gate 2: Debug Tool Process Scanner ──
      const toolCheck = checkForDebugTools()
      if (!toolCheck.safe) {
        securityLog(`BLOCKED: ${toolCheck.reason}`)
        console.error(`🚫 Security: ${toolCheck.reason}`)
        app.quit()
        return
      }
      securityLog('PASS: No debug tools detected')

      // ── Gate 3: DLL Injection Detection ──
      const dllCheck = checkForDllInjection()
      if (!dllCheck.safe) {
        securityLog(`BLOCKED: ${dllCheck.reason}`)
        console.error(`🚫 Security: ${dllCheck.reason}`)
        app.quit()
        return
      }
      securityLog('PASS: No DLL injection detected')

      // ── Gate 4: VM Detection ──
      const vmCheck = checkForVM()
      if (!vmCheck.safe) {
        securityLog(`BLOCKED: ${vmCheck.reason}`)
        console.error(`🚫 Security: ${vmCheck.reason}`)
        const fp = getFingerprint()
        createWindow({ fingerprint: fp, reason: vmCheck.reason })
        return
      }
      securityLog('PASS: VM detection check')

      // ── Gate 5: Hardware License ──
      console.log('🔒 Validating hardware license...')
      const fingerprint = getFingerprint()

      if (!licenseExists()) {
        console.log('🔑 First launch detected — creating hardware license')
        createLicense(fingerprint)
        securityLog(`LICENSE CREATED: fingerprint=${fingerprint.substring(0, 16)}...`)
        console.log('✅ License created and bound to this device')
      }

      const result = validateLicense(fingerprint)
      if (!result.valid) {
        securityLog(`BLOCKED: License validation failed — ${result.reason}`)
        console.error(`🚫 License validation FAILED: ${result.reason}`)
        createWindow({ fingerprint: result.fingerprint || fingerprint, reason: result.reason })
        return
      }
      securityLog('PASS: Hardware license validated')

      // ── Gate 6: Camera SDK (NON-BLOCKING) ──
      // SDK is only needed for live camera measurement, not for app launch.
      // Let the app start; camera features will fail gracefully at runtime.
      const sdkCheck = checkCameraSDK()
      if (!sdkCheck.safe) {
        securityLog(`WARNING: ${sdkCheck.reason}`)
        console.warn(`⚠️ ${sdkCheck.reason} — camera features will be unavailable`)
      } else {
        securityLog('PASS: MagicCamera SDK found')
      }

      // ── Gate 7: Core binary existence ──
      const exePath = path.join(process.env.APP_ROOT!, 'python-core', 'dist', 'magicqc_core.exe')
      if (!fs.existsSync(exePath)) {
        securityLog(`BLOCKED: magicqc_core.exe not found at ${exePath}`)
        console.error(`🚫 magicqc_core.exe not found at: ${exePath}`)
        createWindow({ fingerprint, reason: 'Core engine binary missing. Reinstall required.' })
        return
      }
      securityLog('PASS: Core binary exists')

      // ── Gate 8: Binary integrity (SHA-256 hash verification) ──
      const hashStorePath = path.join(process.env.STORAGE_ROOT!, 'secure')
      const integrityCheck = checkBinaryIntegrity(exePath, hashStorePath, app.getVersion())
      if (!integrityCheck.safe) {
        securityLog(`BLOCKED: ${integrityCheck.reason}`)
        console.error(`🚫 ${integrityCheck.reason}`)
        createWindow({ fingerprint, reason: 'Core binary integrity check failed. Reinstall required.' })
        return
      }
      securityLog('PASS: Binary integrity verified')

      licenseValid = true
      securityLog('ALL 8 GATES PASSED — starting application')
      console.log('✅ All security checks passed')
    } else {
      licenseValid = true  // Dev mode always passes
    }

    // ── Secure config loading (encrypt on first run, decrypt to memory) ──
    if (!isDev) {
      try {
        const configs = loadSecureConfigs(process.env.STORAGE_ROOT!)
        const envContent = configs.get('.env')
        if (envContent) {
          applyEnvConfig(envContent)
          securityLog('CONFIG: .env loaded from encrypted vault')
        }
        securityLog(`CONFIG: ${configs.size} config files loaded securely`)
      } catch (err) {
        securityLog(`CONFIG WARNING: Failed to load encrypted configs: ${err}`)
      }
    }

    // Start Python API server
    console.log('🚀 Starting application services...')

    const pythonReady = await startPythonServer()
    if (pythonReady) {
      console.log('✅ Python measurement server started successfully')
    } else {
      console.warn('⚠️ Python server may not be available - measurement features may be limited')
    }

    // Test MagicQC API connectivity (non-blocking)
    apiClient.ping().then(result => {
      if (result.success) {
        console.log('✅ MagicQC API connected successfully')
      } else {
        console.warn('⚠️ MagicQC API may not be available')
      }
    }).catch(err => {
      console.warn('⚠️ MagicQC API unreachable:', err.message)
    })

    // ── IPC handlers register ONLY after all security gates pass ──
    // Unauthorized state gets zero IPC bridges (no data access possible)
    setupApiHandlers()
    setupMeasurementHandlers()

    // Create window (normal app)
    createWindow()

    // ── Process Monitoring: broadcast reconnection status to renderer ──
    // Only declare process "reconnecting" after a sustained absence to avoid
    // flashing the banner during brief auto-restart transitions.
    let pythonDownSince: number | null = null
    const PYTHON_DOWN_GRACE_MS = 4000 // 4 seconds grace period before showing banner
    const monitorInterval = setInterval(() => {
      const isDown = !pythonProcess || pythonProcess.killed || pythonProcess.exitCode !== null
      if (isDown) {
        if (!pythonDownSince) pythonDownSince = Date.now()
        if (Date.now() - pythonDownSince >= PYTHON_DOWN_GRACE_MS) {
          for (const w of BrowserWindow.getAllWindows()) {
            w.webContents.send('python:status-changed', { status: 'reconnecting' })
          }
        }
      } else {
        if (pythonDownSince) {
          // Python came back — broadcast connected to clear banner
          pythonDownSince = null
          for (const w of BrowserWindow.getAllWindows()) {
            w.webContents.send('python:status-changed', { status: 'connected' })
          }
        }
      }
    }, 2000)
    app.on('before-quit', () => {
      appState.isQuitting = true;
      clearInterval(monitorInterval);
    })
  } catch (error) {
    console.error('Failed to start application:', error)
    app.quit()
  }
})

// Set up IPC handlers for MagicQC API operations (replaces old database handlers)
function setupApiHandlers() {
  // Ping / connection test
  ipcMain.handle('api:ping', async () => {
    try {
      const result = await apiClient.ping()
      return { success: result.success, message: 'API connection successful' }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'API unreachable' }
    }
  })

  // Operators list (GraphQL)
  ipcMain.handle('api:operators', async () => {
    try {
      const operators = await apiClient.getOperators()
      return { success: true, data: operators }
    } catch (error) {
      console.error('API operators error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // All Purchase Orders — no brand filter (GraphQL)
  ipcMain.handle('api:purchaseOrdersAll', async (_event, status?: string) => {
    try {
      const pos = await apiClient.getAllPurchaseOrders(status)
      return { success: true, data: pos }
    } catch (error) {
      console.error('API purchaseOrdersAll error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Brands
  ipcMain.handle('api:brands', async () => {
    try {
      const brands = await apiClient.getBrands()
      return { success: true, data: brands }
    } catch (error) {
      console.error('API brands error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Article Types
  ipcMain.handle('api:articleTypes', async (_event, brandId: number) => {
    try {
      const types = await apiClient.getArticleTypes(brandId)
      return { success: true, data: types }
    } catch (error) {
      console.error('API articleTypes error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Articles (filtered)
  ipcMain.handle('api:articles', async (_event, brandId: number, typeId?: number | null) => {
    try {
      const articles = await apiClient.getArticlesFiltered(brandId, typeId)
      return { success: true, data: articles }
    } catch (error) {
      console.error('API articles error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Purchase Orders
  ipcMain.handle('api:purchaseOrders', async (_event, brandId: number) => {
    try {
      const pos = await apiClient.getPurchaseOrders(brandId)
      return { success: true, data: pos }
    } catch (error) {
      console.error('API purchaseOrders error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // PO Articles
  ipcMain.handle('api:poArticles', async (_event, poId: number) => {
    try {
      const articles = await apiClient.getPOArticles(poId)
      return { success: true, data: articles }
    } catch (error) {
      console.error('API poArticles error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Measurement Specs
  ipcMain.handle('api:measurementSpecs', async (_event, articleId: number, size: string) => {
    try {
      const specs = await apiClient.getMeasurementSpecs(articleId, size)
      return { success: true, data: specs }
    } catch (error) {
      console.error('API measurementSpecs error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Available Sizes
  ipcMain.handle('api:availableSizes', async (_event, articleId: number) => {
    try {
      const sizes = await apiClient.getAvailableSizes(articleId)
      return { success: true, data: sizes }
    } catch (error) {
      console.error('API availableSizes error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Measurement Results (Load)
  ipcMain.handle('api:measurementResults', async (_event, poArticleId: number, size: string) => {
    try {
      const results = await apiClient.getMeasurementResults(poArticleId, size)
      return { success: true, data: results }
    } catch (error) {
      console.error('API measurementResults error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Measurement Results (Save)
  ipcMain.handle('api:saveMeasurementResults', async (_event, results: any[]) => {
    try {
      const result = await apiClient.saveMeasurementResults(results)
      return { success: true, data: result }
    } catch (error) {
      console.error('API saveMeasurementResults error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Measurement Results Detailed (Save with side)
  ipcMain.handle('api:saveMeasurementResultsDetailed', async (_event, data: any) => {
    try {
      const result = await apiClient.saveMeasurementResultsDetailed(data)
      return { success: true, data: result }
    } catch (error) {
      console.error('API saveMeasurementResultsDetailed error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Measurement Sessions
  ipcMain.handle('api:saveMeasurementSession', async (_event, data: any) => {
    try {
      const result = await apiClient.saveMeasurementSession(data)
      return { success: true, data: result }
    } catch (error) {
      console.error('API saveMeasurementSession error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Verify PIN (live GraphQL mutation against Laravel backend)
  ipcMain.handle('api:verifyPin', async (_event, pin: string) => {
    try {
      console.log(`[AUTH] Verifying PIN via GraphQL API...`)
      console.log(`[AUTH] API Base: ${MAGICQC_API_BASE}`)
      const result = await apiClient.verifyPin(pin)
      if (result.success && result.operator) {
        console.log(`[AUTH] ✅ PIN verified for: ${result.operator.full_name} (employee_id: ${result.operator.employee_id})`)
        return { success: true, data: result.operator }
      }
      console.log(`[AUTH] ❌ PIN verification failed: ${result.message || 'Invalid PIN'}`)
      return { success: false, error: result.message || 'Invalid PIN. Please try again.' }
    } catch (error: any) {
      // Log the FULL raw error — never mask it
      console.error('[AUTH] ❌ Raw API error:', error?.message || error)
      console.error('[AUTH] Error stack:', error?.stack)

      // Distinguish error types for the user
      const msg = error?.message || ''
      if (msg.includes('timed out') || msg.includes('ETIMEDOUT') || msg.includes('ECONNREFUSED')) {
        return { success: false, error: 'Cannot reach authentication server. Check network connection.' }
      }
      if (msg.includes('GraphQL Error')) {
        return { success: false, error: `Server rejected request: ${msg}` }
      }
      if (msg.includes('HTTP 4') || msg.includes('HTTP 5')) {
        return { success: false, error: `Server error: ${msg}` }
      }
      return { success: false, error: `Authentication failed: ${msg || 'Unknown error'}` }
    }
  })

  // Operator Fetch (annotation + image)
  ipcMain.handle('api:operatorFetch', async (_event, articleStyle: string, size: string, side?: string, color?: string) => {
    try {
      console.log(`[operatorFetch] Calling: style='${articleStyle}', size='${size}', side='${side || 'front'}', color='${color || 'none'}'`)
      const result = await apiClient.operatorFetch(articleStyle, size, side || 'front', color)
      console.log(`[operatorFetch] Response: success=${result.success}, hasAnnotation=${!!result.annotation}, message=${result.message || 'none'}`)
      if (result.annotation) {
        console.log(`[operatorFetch] Annotation ID: ${result.annotation.id}, style: ${result.annotation.article_style}, size: ${result.annotation.size}`)
      }
      return result
    } catch (error) {
      console.error('API operatorFetch error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Image fetch (base64)
  ipcMain.handle('api:fetchImageBase64', async (_event, articleStyle: string, size: string, side?: string) => {
    try {
      const result = await apiClient.fetchImageBase64(articleStyle, size, side || 'front')
      return result
    } catch (error) {
      console.error('API fetchImageBase64 error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // ── API Connectivity Status ─────────────────────────────────────────────
  ipcMain.handle('api:connectivity', () => {
    return { status: apiConnectionStatus, lastCheck: apiLastCheckTime }
  })

  // ── Start auto-reconnect heartbeat ──────────────────────────────────────
  startApiHeartbeat()
}

// ── API Connection Manager (auto-reconnect with exponential backoff) ──────
let apiConnectionStatus: 'connected' | 'reconnecting' | 'disconnected' = 'disconnected'
let apiLastCheckTime: string = ''
let apiHeartbeatTimer: NodeJS.Timeout | null = null
let apiRetryCount = 0
const API_BACKOFF_SCHEDULE = [3000, 5000, 10000, 20000, 30000] // ms
const API_HEARTBEAT_INTERVAL = 30000 // 30s when connected

async function checkApiConnectivity(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)
    const response = await fetch(`${MAGICQC_API_BASE}/graphql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': MAGICQC_API_KEY,
      },
      body: JSON.stringify({ query: '{ __typename }' }),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    return response.ok
  } catch {
    return false
  }
}

function broadcastConnectivityStatus() {
  apiLastCheckTime = new Date().toISOString()
  const payload = { status: apiConnectionStatus, lastCheck: apiLastCheckTime }
  // Send to all renderer windows (BrowserWindow is already imported at top-level)
  for (const bw of BrowserWindow.getAllWindows()) {
    bw.webContents.send('api:connectivity-changed', payload)
  }
}

async function startApiHeartbeat() {
  // Initial check
  const alive = await checkApiConnectivity()
  if (alive) {
    apiConnectionStatus = 'connected'
    apiRetryCount = 0
    console.log('[HEARTBEAT] ✅ API connected')
  } else {
    apiConnectionStatus = 'disconnected'
    console.log('[HEARTBEAT] ❌ API not reachable — will retry')
  }
  broadcastConnectivityStatus()

  // Schedule periodic checks
  const scheduleNext = () => {
    if (apiHeartbeatTimer) clearTimeout(apiHeartbeatTimer)

    const delay = apiConnectionStatus === 'connected'
      ? API_HEARTBEAT_INTERVAL
      : API_BACKOFF_SCHEDULE[Math.min(apiRetryCount, API_BACKOFF_SCHEDULE.length - 1)]

    apiHeartbeatTimer = setTimeout(async () => {
      const wasConnected = apiConnectionStatus === 'connected'
      const alive = await checkApiConnectivity()

      if (alive) {
        if (!wasConnected) {
          console.log(`[HEARTBEAT] ✅ API reconnected after ${apiRetryCount} retries`)
        }
        apiConnectionStatus = 'connected'
        apiRetryCount = 0
      } else {
        apiRetryCount++
        apiConnectionStatus = wasConnected ? 'reconnecting' : 'reconnecting'
        const nextDelay = API_BACKOFF_SCHEDULE[Math.min(apiRetryCount, API_BACKOFF_SCHEDULE.length - 1)]
        console.log(`[HEARTBEAT] ⚠️ API unreachable — retry #${apiRetryCount} in ${nextDelay / 1000}s`)
      }

      broadcastConnectivityStatus()
      scheduleNext()
    }, delay)
  }

  scheduleNext()
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
      const appRoot = process.env.APP_ROOT!
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

  // Fetch reference image from MagicQC API (bypasses CORS in renderer)
  ipcMain.handle('measurement:fetchLaravelImage', async (_event, articleStyle: string, size: string) => {
    // MAGICQC_API_BASE is the base URL for REST endpoints (not /graphql)
    const imageApiUrl = `${MAGICQC_API_BASE}/api/uploaded-annotations/fetch-image-base64?article_style=${encodeURIComponent(articleStyle)}&size=${encodeURIComponent(size)}`

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

    // STORAGE_ROOT is always writable (userData fallback in prod).
    // APP_ROOT (resourcesPath) is read-only in Program Files — never write there.
    // temp_measure is pre-created under STORAGE_ROOT by the startup runtimeDirs block.
    const tempMeasureDir = path.join(process.env.STORAGE_ROOT!, 'temp_measure')

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

// Stop Python server when app quits
app.on('before-quit', () => {
  appState.isQuitting = true
  stopPythonServer()
})

// Final safety net: force-exit after cleanup so no zombie renderer processes linger.
// On Windows, Electron renderer processes can survive app.quit() if the event loop stalls.
app.on('will-quit', (e) => {
  // Ensure Python is dead
  stopPythonServer()

  // Destroy any remaining browser windows
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.destroy() } catch { /* already destroyed */ }
  }

  // Hard exit after a short grace period to guarantee no orphans
  setTimeout(() => process.exit(0), 500)
})
