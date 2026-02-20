#!/usr/bin/env node
/**
 * Production build pipeline for Magic QC Operator Panel.
 * 1. Build Python core (PyInstaller onefile → magicqc_core.exe)
 * 2. Build Electron (tsc, vite, optional obfuscation, electron-builder)
 * 3. Staged API validation (start Python exe, validate endpoints, stop)
 *
 * Usage:
 *   node scripts/build-production.mjs           # build + validate (npm run build)
 *   node scripts/build-production.mjs --prod   # use build:prod (obfuscate + --win)
 *   node scripts/build-production.mjs --no-validate  # skip API validation
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

function run (cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const cwd = opts.cwd || projectRoot
    const child = spawn(cmd, args, {
      cwd,
      stdio: 'inherit',
      shell: opts.shell ?? true
    })
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))))
    child.on('error', reject)
  })
}

async function main () {
  const args = process.argv.slice(2)
  const useProd = args.includes('--prod')
  const noValidate = args.includes('--no-validate')

  console.log('Step 1: Building Python core (PyInstaller)...\n')
  await run('python', ['build_exe.py'], { cwd: path.join(projectRoot, 'python-core') })

  const exePath = path.join(projectRoot, 'python-core', 'dist', 'magicqc_core.exe')
  const { existsSync, mkdirSync } = await import('node:fs')
  if (!existsSync(exePath)) {
    throw new Error('Python exe not found after build: ' + exePath)
  }

  // Pre-create runtime directory tree at project root.
  // These are used by validate-api.mjs (run without Electron) and
  // also serve as the source for extraResources when electron-builder packs.
  const runtimeDirs = [
    'storage',
    'storage/measurement_results',
    'storage/annotations',
    'logs',
  ]
  for (const dir of runtimeDirs) {
    const dirPath = path.join(projectRoot, dir)
    if (!existsSync(dirPath)) {
      mkdirSync(dirPath, { recursive: true })
      console.log(`Created runtime dir: ${dir}`)
    }
  }
  console.log('\nStep 2: Building Electron...\n')
  if (useProd) {
    await run('npm', ['run', 'build:prod'])
  } else {
    await run('npm', ['run', 'build'])
  }

  if (noValidate) {
    console.log('\nSkipping API validation (--no-validate).')
    return
  }
  console.log('\nStep 3: Staged API validation...\n')
  await run('node', ['scripts/validate-api.mjs', '--start-python'])
  console.log('\nProduction build and validation complete.')
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
