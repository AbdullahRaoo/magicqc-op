/**
 * Hardware Fingerprint Generator
 * 
 * Generates a deterministic, unique fingerprint for the current machine by
 * combining CPU ID, primary MAC address, motherboard UUID, and disk serial.
 * 
 * All lookups are offline — no network calls required.
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import os from 'node:os'

// ── Individual component collectors ──────────────────────────

/** Windows: `wmic cpu get ProcessorId` → e.g. "BFEBFBFF000906EA" */
function getCpuId(): string {
    try {
        const raw = execSync('wmic cpu get ProcessorId', {
            windowsHide: true,
            timeout: 5000,
        }).toString()
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
        // Second line is the actual value (first is the header "ProcessorId")
        return lines[1] ?? 'UNKNOWN_CPU'
    } catch {
        return 'UNKNOWN_CPU'
    }
}

/** First non-internal MAC address from `os.networkInterfaces()` */
function getPrimaryMac(): string {
    const ifaces = os.networkInterfaces()
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]!) {
            // Skip internal (loopback) and IPv6 link-local
            if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                return iface.mac.toUpperCase()
            }
        }
    }
    return 'UNKNOWN_MAC'
}

/** Windows: `wmic csproduct get UUID` → e.g. "4C4C4544-0042-4D10-..." */
function getMotherboardUuid(): string {
    try {
        const raw = execSync('wmic csproduct get UUID', {
            windowsHide: true,
            timeout: 5000,
        }).toString()
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
        const uuid = lines[1] ?? ''
        // Some machines return all-F's UUID — treat as unavailable
        if (uuid && !uuid.match(/^[F\-]+$/i)) {
            return uuid
        }
        return 'UNKNOWN_MB'
    } catch {
        return 'UNKNOWN_MB'
    }
}

/** Windows: `wmic diskdrive get serialnumber` → primary disk serial */
function getDiskSerial(): string {
    try {
        const raw = execSync('wmic diskdrive get serialnumber', {
            windowsHide: true,
            timeout: 5000,
        }).toString()
        const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
        // First data line after header
        const serial = lines[1] ?? ''
        if (serial && serial !== 'SerialNumber') {
            return serial
        }
        return 'UNKNOWN_DISK'
    } catch {
        return 'UNKNOWN_DISK'
    }
}

// ── Public API ───────────────────────────────────────────────

export interface HardwareComponents {
    cpuId: string
    mac: string
    motherboardUuid: string
    diskSerial: string
}

/**
 * Collect raw hardware component strings.
 * Useful for diagnostics and support display.
 */
export function getHardwareComponents(): HardwareComponents {
    return {
        cpuId: getCpuId(),
        mac: getPrimaryMac(),
        motherboardUuid: getMotherboardUuid(),
        diskSerial: getDiskSerial(),
    }
}

/**
 * Generate a deterministic 64-char hex fingerprint (SHA-256) from
 * CPU ID + MAC address + motherboard UUID + disk serial.
 * 
 * Even if one component returns UNKNOWN, the fingerprint is still
 * unique because the other components contribute entropy.
 */
export function getFingerprint(): string {
    const { cpuId, mac, motherboardUuid, diskSerial } = getHardwareComponents()
    const combined = `MAGICQC|${cpuId}|${mac}|${motherboardUuid}|${diskSerial}`
    return createHash('sha256').update(combined).digest('hex')
}
