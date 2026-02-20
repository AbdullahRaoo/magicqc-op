/**
 * Centralized API Configuration for the Electron Main Process.
 *
 * Every API URL, base path, and network address used by the Operator Panel
 * is resolved here from environment variables loaded via dotenv.
 * No other file in the codebase should contain hardcoded host/port/URL strings.
 *
 * Environment variables (.env):
 *   MAGICQC_API_URL   – GraphQL endpoint URL                              (default: https://magicqc.online/graphql)
 *   MAGICQC_API_BASE  – base URL for remaining REST endpoints             (default: https://magicqc.online)
 *   MAGICQC_API_KEY   – API key for authenticated endpoints               (required)
 *   PYTHON_API_HOST   – hostname for the Python Flask measurement API     (default: localhost)
 *   PYTHON_API_PORT   – port for the Python Flask measurement API         (default: 5000)
 */

// Note: .env is loaded by env-setup.ts which is imported in main.ts
// No need to call dotenv.config() here as it is already handled.
console.log(`[API Config] Initializing with: MAGICQC_API_URL=${process.env.MAGICQC_API_URL || 'DEFAULT'}`)

// ─── MagicQC GraphQL API ─────────────────────────────────────────────────────
/** GraphQL endpoint URL (e.g. https://magicqc.online/graphql) */
export const MAGICQC_API_URL = process.env.MAGICQC_API_URL || 'https://magicqc.online/graphql'

/** Base URL for remaining REST endpoints (ping, annotations, images) */
export const MAGICQC_API_BASE = process.env.MAGICQC_API_BASE || 'https://magicqc.online'

/** API key for authenticated endpoints */
export const MAGICQC_API_KEY = process.env.MAGICQC_API_KEY || ''

// ─── Python Flask Measurement API ─────────────────────────────────────────────
const pythonHost = process.env.PYTHON_API_HOST || 'localhost'
const pythonPort = process.env.PYTHON_API_PORT || '5000'

/** Full base URL for the Python measurement API (e.g. http://localhost:5000) */
export const PYTHON_API_URL = `http://${pythonHost}:${pythonPort}`
