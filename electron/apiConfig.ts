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

import dotenv from 'dotenv'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Load .env from project root
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

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
