import { app } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import dotenv from 'dotenv'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 1. Resolve RESOURCE_ROOT (where the app is installed)
export const RESOURCE_ROOT = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..')

// 2. Resolve STORAGE_ROOT (where we write data - logs, results, secure configs)
function resolveStorageRoot(): string {
    if (!app.isPackaged) return RESOURCE_ROOT

    try {
        // Check if the installation directory is writable (rarely true for C:\Program Files)
        const testFile = path.join(RESOURCE_ROOT, '.write_test')
        fs.writeFileSync(testFile, '')
        fs.unlinkSync(testFile)
        return RESOURCE_ROOT
    } catch (e) {
        // Read-only environment detected (e.g. C:\Program Files\)
        // Fallback to standard AppData location which is ALWAYS writable and persistent.
        return app.getPath('userData')
    }
}

export const STORAGE_ROOT = resolveStorageRoot()

// 3. Set global environment variables immediately to unify path resolution across modules
process.env.APP_ROOT = RESOURCE_ROOT    // Binary root (immutable)
process.env.STORAGE_ROOT = STORAGE_ROOT // Writable root (mutable)

// 4. Load .env into process.env before any other imports occur
// We prioritize the .env in STORAGE_ROOT (migrated) over the one in RESOURCE_ROOT (packaged template)
const envPath = fs.existsSync(path.join(STORAGE_ROOT, '.env'))
    ? path.join(STORAGE_ROOT, '.env')
    : path.join(RESOURCE_ROOT, '.env')

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
}

console.log('[Bootstrap] Paths & Env initialized:')
console.log(`  RESOURCE_ROOT: ${RESOURCE_ROOT}`)
console.log(`  STORAGE_ROOT:  ${STORAGE_ROOT}`)
console.log(`  ENV_PATH:      ${envPath}`)
