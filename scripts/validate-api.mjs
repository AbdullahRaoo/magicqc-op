#!/usr/bin/env node
/**
 * Staged API validation for Magic QC Operator Panel.
 * Run before packaging to ensure no path breakage or env mismatch between dev and production.
 *
 * Usage:
 *   node scripts/validate-api.mjs                    # Validate using existing .env; Python must be running
 *   node scripts/validate-api.mjs --start-python     # Start magicqc_core.exe (Flask), validate, then stop
 *   node scripts/validate-api.mjs --skip-magicqc     # Skip MagicQC server checks (auth/ping)
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// Load .env from project root
const projectRoot = path.resolve(__dirname, '..')
const envPath = path.join(projectRoot, '.env')
try {
  require('dotenv').config({ path: envPath })
} catch (_) {}

const pythonHost = process.env.PYTHON_API_HOST || 'localhost'
const pythonPort = process.env.PYTHON_API_PORT || '5000'
const PYTHON_API_URL = `http://${pythonHost}:${pythonPort}`

const MAGICQC_API_URL = process.env.MAGICQC_API_URL || 'https://magicqc.online/graphql'
const MAGICQC_API_BASE = process.env.MAGICQC_API_BASE || 'https://magicqc.online'
const MAGICQC_API_KEY = process.env.MAGICQC_API_KEY || ''

const args = process.argv.slice(2)
const startPython = args.includes('--start-python')
const skipMagicQC = args.includes('--skip-magicqc')

let pythonProcess = null

function log (msg, type = 'info') {
  const prefix = type === 'err' ? '❌' : type === 'ok' ? '✅' : '🔍'
  console.log(`${prefix} ${msg}`)
}

async function fetchWithTimeout (url, options = {}, timeoutMs = 15000) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...options, signal: c.signal })
    clearTimeout(t)
    return res
  } catch (e) {
    clearTimeout(t)
    throw e
  }
}

async function waitForHealth (maxAttempts = 15, intervalMs = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetchWithTimeout(`${PYTHON_API_URL}/health`, {}, 3000)
      if (res.ok) return true
    } catch (_) {}
    await new Promise(r => setTimeout(r, intervalMs))
  }
  return false
}

async function validatePythonApis () {
  // 1. Health
  try {
    const res = await fetchWithTimeout(`${PYTHON_API_URL}/health`, {}, 5000)
    if (!res.ok) throw new Error(`Health returned ${res.status}`)
    log('Python health OK', 'ok')
  } catch (e) {
    log(`Python health failed: ${e.message}`, 'err')
    return false
  }

  // 2. Measurement status
  try {
    const res = await fetchWithTimeout(`${PYTHON_API_URL}/api/measurement/status`, {}, 5000)
    if (!res.ok) throw new Error(`Measurement status returned ${res.status}`)
    const data = await res.json()
    if (data.running === undefined) throw new Error('Missing running field')
    log('Measurement status OK', 'ok')
  } catch (e) {
    log(`Measurement status failed: ${e.message}`, 'err')
    return false
  }

  // 3. Live results (path integrity: same RESULTS_PATH as write)
  try {
    const res = await fetchWithTimeout(`${PYTHON_API_URL}/api/results/live`, {}, 5000)
    if (!res.ok) throw new Error(`Live results returned ${res.status}`)
    const data = await res.json()
    if (data.data === undefined) throw new Error('Missing data field')
    log('Live results endpoint OK (RESULTS_PATH aligned)', 'ok')
  } catch (e) {
    log(`Live results failed: ${e.message}`, 'err')
    return false
  }

  // 4. Optional: start then stop (minimal config)
  try {
    const startRes = await fetchWithTimeout(`${PYTHON_API_URL}/api/measurement/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        annotation_name: '__validation__',
        article_style: '',
        side: 'front',
        garment_color: '#ffffff',
        measurement_specs: []
      })
    }, 8000)
    if (!startRes.ok) {
      const t = await startRes.text()
      throw new Error(`Start returned ${startRes.status}: ${t.slice(0, 100)}`)
    }
    const stopRes = await fetchWithTimeout(`${PYTHON_API_URL}/api/measurement/stop`, { method: 'POST' }, 5000)
    if (!stopRes.ok) throw new Error(`Stop returned ${stopRes.status}`)
    log('Measurement start/stop OK', 'ok')
  } catch (e) {
    log(`Measurement start/stop failed: ${e.message}`, 'err')
    return false
  }

  return true
}

async function validateMagicQC () {
  if (!MAGICQC_API_KEY) {
    log('MAGICQC_API_KEY not set — skipping MagicQC auth/ping', 'info')
    return true
  }
  try {
    const res = await fetchWithTimeout(MAGICQC_API_BASE + '/api/camera/ping', {
      headers: { 'Authorization': `Bearer ${MAGICQC_API_KEY}`, 'Accept': 'application/json' }
    }, 10000)
    if (!res.ok) throw new Error(`Ping returned ${res.status}`)
    log('MagicQC ping OK', 'ok')
  } catch (e) {
    log(`MagicQC ping failed: ${e.message}`, 'err')
    return false
  }
  return true
}

function startPythonProcess () {
  const exePath = path.join(projectRoot, 'python-core', 'dist', 'magicqc_core.exe')
  const fs = require('node:fs')
  if (!fs.existsSync(exePath)) {
    log(`Python exe not found: ${exePath}`, 'err')
    return false
  }
  log(`Starting Python core: ${exePath}`, 'info')
  pythonProcess = spawn(exePath, [], {
    cwd: projectRoot,
    stdio: 'ignore',
    windowsHide: true
  })
  pythonProcess.on('error', (err) => {
    log(`Python process error: ${err.message}`, 'err')
  })
  return true
}

function stopPythonProcess () {
  if (pythonProcess) {
    pythonProcess.kill('SIGTERM')
    pythonProcess = null
    log('Python process stopped', 'info')
  }
}

async function main () {
  console.log('Staged API validation\n')
  if (startPython) {
    if (!startPythonProcess()) process.exit(1)
    const ready = await waitForHealth()
    if (!ready) {
      log('Python core did not become ready in time', 'err')
      stopPythonProcess()
      process.exit(1)
    }
    log('Python core ready', 'ok')
  }

  let ok = true
  ok = (await validatePythonApis()) && ok
  if (!skipMagicQC) ok = (await validateMagicQC()) && ok

  if (startPython) stopPythonProcess()

  if (!ok) {
    console.log('\nValidation failed.')
    process.exit(1)
  }
  console.log('\nAll validations passed.')
}

main().catch((e) => {
  console.error(e)
  if (pythonProcess) stopPythonProcess()
  process.exit(1)
})
