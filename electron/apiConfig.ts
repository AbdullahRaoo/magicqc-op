/**
 * Centralized API Configuration for the Electron Main Process.
 *
 * Every API URL, base path, and network address used by the Operator Panel
 * is resolved here from environment variables loaded via dotenv in database.ts.
 * No other file in the codebase should contain hardcoded host/port/URL strings.
 *
 * Environment variables (.env):
 *   PYTHON_API_HOST  – hostname for the Python Flask measurement server  (default: localhost)
 *   PYTHON_API_PORT  – port for the Python Flask measurement server      (default: 5000)
 *   LARAVEL_API_URL  – full base URL for the Laravel backend API         (default: http://127.0.0.1:8000)
 *   LARAVEL_STORAGE_PATH – disk path to Laravel public storage           (default: D:\RJM\magicQC\public\storage)
 */

// ─── Python Flask Measurement API ─────────────────────────────────────────────
const pythonHost = process.env.PYTHON_API_HOST || 'localhost'
const pythonPort = process.env.PYTHON_API_PORT || '5000'

/** Full base URL for the Python measurement API (e.g. http://localhost:5000) */
export const PYTHON_API_URL = `http://${pythonHost}:${pythonPort}`

// ─── Laravel Backend API ──────────────────────────────────────────────────────
/** Full base URL for the Laravel backend (e.g. http://127.0.0.1:8000) */
export const LARAVEL_API_URL = process.env.LARAVEL_API_URL || 'http://127.0.0.1:8000'

// ─── Laravel Storage (disk path) ─────────────────────────────────────────────
/** Absolute path to the Laravel public/storage folder on disk */
export const LARAVEL_STORAGE_PATH = process.env.LARAVEL_STORAGE_PATH || String.raw`D:\RJM\magicQC\public\storage`
