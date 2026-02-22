/**
 * Runtime Security — Anti-Debug, VM Detection, Process Scanner,
 * DLL Injection Detection, Binary Integrity, and Camera SDK Check
 *
 * All checks return { safe: boolean; reason: string }.
 * Only enforced in production (isDev = false).
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface SecurityCheckResult {
    safe: boolean
    reason: string
}

// ══════════════════════════════════════════════════════════════
//  1. ANTI-DEBUG DETECTION (Node.js level)
// ══════════════════════════════════════════════════════════════

/**
 * Detect Node.js debugger attachment via:
 *  - process.execArgv (--inspect, --inspect-brk, --debug)
 *  - NODE_OPTIONS env variable
 *  - performance.now() timing gap (breakpoints cause >200ms delay)
 */
export function checkForDebugger(): SecurityCheckResult {
    // ── execArgv scan ──
    const debugFlags = ['--inspect', '--inspect-brk', '--debug', '--debug-brk']
    for (const arg of process.execArgv) {
        for (const flag of debugFlags) {
            if (arg.startsWith(flag)) {
                return { safe: false, reason: 'Debug flag detected in process arguments' }
            }
        }
    }

    // ── NODE_OPTIONS scan ──
    const nodeOpts = process.env.NODE_OPTIONS || ''
    for (const flag of debugFlags) {
        if (nodeOpts.includes(flag)) {
            return { safe: false, reason: 'Debug flag detected in NODE_OPTIONS' }
        }
    }

    // ── Timing check (debugger breakpoints cause measurable delay) ──
    const t0 = performance.now()
    // Tight loop — should complete in <1ms without debugger
    let x = 0
    for (let i = 0; i < 10000; i++) x += i
    void x
    const elapsed = performance.now() - t0
    if (elapsed > 200) {
        return { safe: false, reason: 'Timing anomaly detected — possible debugger attachment' }
    }

    return { safe: true, reason: '' }
}


// ══════════════════════════════════════════════════════════════
//  2. DEBUG TOOL PROCESS SCANNER
// ══════════════════════════════════════════════════════════════

const BANNED_PROCESSES = [
    'processhacker',
    'x64dbg',
    'x32dbg',
    'ollydbg',
    'ida64',
    'ida',
    'idag',
    'idaq',
    'windbg',
    'dnspy',
    'de4dot',
    'ilspy',
    'dotpeek',
    'fiddler',
    'wireshark',
    'cheatengine',
    'charles',
    'httpanalyzer',
    'httpdebugger',
]

/**
 * Scan running processes for known debugging/reverse-engineering tools.
 * Uses `tasklist` on Windows (no admin needed).
 */
export function checkForDebugTools(): SecurityCheckResult {
    try {
        const raw = execSync('tasklist /FO CSV /NH', {
            windowsHide: true,
            timeout: 10000,
        }).toString().toLowerCase()

        for (const tool of BANNED_PROCESSES) {
            if (raw.includes(tool)) {
                return {
                    safe: false,
                    reason: `Debugging tool detected: ${tool}`,
                }
            }
        }
    } catch {
        // If tasklist fails, allow — some environments restrict it
    }

    return { safe: true, reason: '' }
}


// ══════════════════════════════════════════════════════════════
//  3. VM / CRACK LAB DETECTION
// ══════════════════════════════════════════════════════════════

const VM_SIGNATURES = [
    'virtualbox',
    'vmware',
    'qemu',
    'hyper-v',
    'virtual machine',
    'kvm',
    'xen',
    'parallels',
    'bochs',
    'innotek',        // VirtualBox manufacturer
    'oracle vm',
]

/**
 * Detect virtual machines by querying hardware model and BIOS info.
 * Uses `wmic` on Windows.
 */
export function checkForVM(): SecurityCheckResult {
    try {
        // Query system model
        const modelRaw = execSync('wmic computersystem get model', {
            windowsHide: true,
            timeout: 5000,
        }).toString().toLowerCase()

        // Query manufacturer
        const mfrRaw = execSync('wmic computersystem get manufacturer', {
            windowsHide: true,
            timeout: 5000,
        }).toString().toLowerCase()

        // Query BIOS serial
        const biosRaw = execSync('wmic bios get serialnumber', {
            windowsHide: true,
            timeout: 5000,
        }).toString().toLowerCase()

        const combined = `${modelRaw} ${mfrRaw} ${biosRaw}`

        for (const sig of VM_SIGNATURES) {
            if (combined.includes(sig)) {
                return { safe: false, reason: `Virtual machine detected (${sig})` }
            }
        }
    } catch {
        // If wmic fails, allow — some stripped Windows installs don't have it
    }

    return { safe: true, reason: '' }
}


// ══════════════════════════════════════════════════════════════
//  4. CAMERA SDK ENVIRONMENT CHECK
// ══════════════════════════════════════════════════════════════

const MAGICCAMERA_SDK_PATHS = [
    'C:\\Program Files (x86)\\MindVision',
    'C:\\Program Files\\MindVision',
]

/**
 * Verify MagicCamera SDK is installed.
 * Returns safe=true if at least one known path exists.
 */
export function checkCameraSDK(): SecurityCheckResult {
    for (const p of MAGICCAMERA_SDK_PATHS) {
        if (fs.existsSync(p)) {
            return { safe: true, reason: '' }
        }
    }
    return {
        safe: false,
        reason: 'MagicCamera SDK not found. Please install the MagicCamera SDK.',
    }
}


// ══════════════════════════════════════════════════════════════
//  5. BINARY INTEGRITY CHECK (SHA-256)
// ══════════════════════════════════════════════════════════════

/**
 * Compute SHA-256 hash of a file.
 */
function hashFile(filePath: string): string {
    const data = fs.readFileSync(filePath)
    return createHash('sha256').update(data).digest('hex')
}

/**
 * Verify magicqc_core.exe integrity against a stored hash.
 *
 * Behaviour:
 *  - First run (no stored hash)  → write hash + version → PASS
 *  - Upgrade detected (version changed) → overwrite hash + version → PASS
 *    This prevents a new installer build from being permanently blocked because
 *    the previous version's hash file already exists in userData/secure/.
 *  - Same version, hash matches → PASS
 *  - Same version, hash differs → BLOCK (binary was tampered post-install)
 *
 * @param exePath       Absolute path to magicqc_core.exe
 * @param hashStorePath Directory to persist core_integrity.sha256 and .version
 * @param appVersion    Current app version string (e.g. "1.0.0")
 */
export function checkBinaryIntegrity(exePath: string, hashStorePath: string, appVersion = ''): SecurityCheckResult {
    if (!fs.existsSync(exePath)) {
        return { safe: false, reason: `Core binary not found: ${exePath}` }
    }

    const currentHash = hashFile(exePath)
    const hashFilePath = path.join(hashStorePath, 'core_integrity.sha256')
    const versionFilePath = path.join(hashStorePath, 'core_integrity.version')

    if (!fs.existsSync(hashStorePath)) fs.mkdirSync(hashStorePath, { recursive: true })

    // ── Upgrade detection ─────────────────────────────────────────────────────
    // If the stored app version differs from the running version, this is a fresh
    // install or upgrade.  Re-register the new binary hash and let it through.
    // Also re-register if the version file is missing (hash was written by older
    // code that didn't track versions — treat as implicit upgrade).
    if (appVersion) {
        const storedVersion = fs.existsSync(versionFilePath)
            ? fs.readFileSync(versionFilePath, 'utf8').trim()
            : ''   // version file absent → old registration, treat as upgrade
        if (storedVersion !== appVersion) {
            // New version installed — re-register hash for the new EXE.
            fs.writeFileSync(hashFilePath, currentHash, 'utf8')
            fs.writeFileSync(versionFilePath, appVersion, 'utf8')
            return { safe: true, reason: '' }
        }
    }

    if (!fs.existsSync(hashFilePath)) {
        // First run — store the hash and current version.
        fs.writeFileSync(hashFilePath, currentHash, 'utf8')
        if (appVersion) fs.writeFileSync(versionFilePath, appVersion, 'utf8')
        return { safe: true, reason: '' }
    }

    // ── Tamper check ──────────────────────────────────────────────────────────
    const storedHash = fs.readFileSync(hashFilePath, 'utf8').trim()
    if (currentHash !== storedHash) {
        return {
            safe: false,
            reason: `Core binary integrity check failed (hash mismatch). Expected: ${storedHash.substring(0, 16)}... Got: ${currentHash.substring(0, 16)}...`,
        }
    }

    return { safe: true, reason: '' }
}


// ══════════════════════════════════════════════════════════════
//  6. DLL INJECTION DETECTION
// ══════════════════════════════════════════════════════════════

const SUSPICIOUS_DLLS = [
    'frida',
    'hook',
    'inject',
    'detour',
    'minhook',
    'easyhook',
    'deviare',
    'apimonitor',
    'spy++',
]

/**
 * Check loaded modules in the current process for known injection DLLs.
 * Uses `process.moduleLoadList` (internal V8 list) and tasklist /M.
 */
export function checkForDllInjection(): SecurityCheckResult {
    try {
        // Check loaded DLLs of our own process via tasklist
        const pid = process.pid
        const raw = execSync(`tasklist /FI "PID eq ${pid}" /M /FO CSV /NH`, {
            windowsHide: true,
            timeout: 10000,
        }).toString().toLowerCase()

        for (const dll of SUSPICIOUS_DLLS) {
            if (raw.includes(dll)) {
                return {
                    safe: false,
                    reason: `Suspicious DLL detected in process: ${dll}`,
                }
            }
        }
    } catch {
        // If tasklist fails, allow
    }

    return { safe: true, reason: '' }
}
