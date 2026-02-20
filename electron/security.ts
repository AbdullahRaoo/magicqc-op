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

const MINDVISION_SDK_PATHS = [
    'C:\\Program Files (x86)\\MindVision',
    'C:\\Program Files\\MindVision',
]

/**
 * Verify MindVision Camera SDK is installed.
 * Returns safe=true if at least one known path exists.
 */
export function checkCameraSDK(): SecurityCheckResult {
    for (const p of MINDVISION_SDK_PATHS) {
        if (fs.existsSync(p)) {
            return { safe: true, reason: '' }
        }
    }
    return {
        safe: false,
        reason: 'MindVision Camera SDK not found. Install from C:\\Program Files (x86)\\MindVision\\',
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
 * On first run, generates and stores the hash.
 * On subsequent runs, validates against stored hash.
 */
export function checkBinaryIntegrity(exePath: string, hashStorePath: string): SecurityCheckResult {
    if (!fs.existsSync(exePath)) {
        return { safe: false, reason: `Core binary not found: ${exePath}` }
    }

    const currentHash = hashFile(exePath)
    const hashFile_ = path.join(hashStorePath, 'core_integrity.sha256')

    if (!fs.existsSync(hashFile_)) {
        // First run — store the hash
        if (!fs.existsSync(hashStorePath)) fs.mkdirSync(hashStorePath, { recursive: true })
        fs.writeFileSync(hashFile_, currentHash, 'utf8')
        return { safe: true, reason: '' }
    }

    // Validate against stored hash
    const storedHash = fs.readFileSync(hashFile_, 'utf8').trim()
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
