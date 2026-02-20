/**
 * License Manager — hardware-bound license file management
 *
 * Creates an encrypted license file on first launch that binds to the
 * current machine's hardware fingerprint. On every subsequent launch the
 * stored fingerprint is decrypted and compared against live hardware.
 *
 * Security:
 *   - AES-256-GCM authenticated encryption (ciphertext + auth tag)
 *   - HMAC-SHA256 integrity envelope around the entire payload
 *   - Embedded key (sufficient for industrial anti-copy; lives inside ASAR)
 *
 * Anti-tamper:
 *   - Deleted license.dat → INVALID (app blocks, not auto re-created)
 *   - Modified license.dat → INVALID (AES auth tag or HMAC fails)
 *   - Copied to another machine → INVALID (fingerprint mismatch)
 */
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getAesKey, getHmacKey } from './keystore'

// ── Keys are reconstructed at runtime from split fragments ───
// See keystore.ts for the split-key storage implementation.
const AES_KEY = getAesKey()    // 32 bytes (AES-256)
const HMAC_KEY = getHmacKey()  // 32 bytes (HMAC-SHA256)

// ── License file structure ───────────────────────────────────
//
//  Bytes 0–11   : IV  (12 bytes for GCM)
//  Bytes 12–27  : Auth tag (16 bytes from GCM)
//  Bytes 28–N   : Ciphertext (encrypted JSON payload)
//  Bytes N–N+32 : HMAC-SHA256 of bytes 0–N (integrity envelope)

export type LicenseStatus =
    | { valid: true; fingerprint: string }
    | { valid: false; reason: string; fingerprint?: string }

// ── Internal helpers ─────────────────────────────────────────

function encrypt(plaintext: string): Buffer {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', AES_KEY, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const authTag = cipher.getAuthTag() // 16 bytes

    // Pack: IV (12) + AuthTag (16) + Ciphertext (variable)
    const packed = Buffer.concat([iv, authTag, encrypted])

    // Append HMAC over the packed bytes for tamper detection
    const hmac = createHmac('sha256', HMAC_KEY).update(packed).digest()
    return Buffer.concat([packed, hmac])
}

function decrypt(data: Buffer): string {
    // Minimum size: IV(12) + AuthTag(16) + at least 1 byte cipher + HMAC(32) = 61
    if (data.length < 61) {
        throw new Error('License file too small — corrupted or tampered')
    }

    // Split HMAC from the rest
    const hmacStored = data.subarray(data.length - 32)
    const packed = data.subarray(0, data.length - 32)

    // Verify HMAC integrity first
    const hmacComputed = createHmac('sha256', HMAC_KEY).update(packed).digest()
    if (!hmacStored.equals(hmacComputed)) {
        throw new Error('License integrity check failed — file tampered')
    }

    // Unpack: IV (12) + AuthTag (16) + Ciphertext
    const iv = packed.subarray(0, 12)
    const authTag = packed.subarray(12, 28)
    const ciphertext = packed.subarray(28)

    const decipher = createDecipheriv('aes-256-gcm', AES_KEY, iv)
    decipher.setAuthTag(authTag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString('utf8')
}

// ── Public API ───────────────────────────────────────────────

/**
 * Get the absolute path to the license file.
 * In production: APP_ROOT/secure/license.dat
 * In dev: project_root/secure/license.dat
 */
export function getLicensePath(): string {
    return path.join(process.env.STORAGE_ROOT!, 'secure', 'license.dat')
}

/**
 * Check whether a license file already exists.
 */
export function licenseExists(): boolean {
    return fs.existsSync(getLicensePath())
}

/**
 * Create a new license file for the given hardware fingerprint.
 * This should ONLY be called on first install (when no license.dat exists).
 */
export function createLicense(fingerprint: string): void {
    const licensePath = getLicensePath()
    const secureDir = path.dirname(licensePath)

    // Ensure directory exists
    if (!fs.existsSync(secureDir)) {
        fs.mkdirSync(secureDir, { recursive: true })
    }

    const payload = JSON.stringify({
        fp: fingerprint,
        ts: new Date().toISOString(),
        v: 1,  // schema version
    })

    const encrypted = encrypt(payload)
    fs.writeFileSync(licensePath, encrypted)
}

/**
 * Validate the license file against the current hardware fingerprint.
 *
 * Returns `{ valid: true }` if:
 *   1. license.dat exists
 *   2. HMAC integrity passes
 *   3. AES-GCM decryption succeeds
 *   4. Stored fingerprint matches current hardware
 *
 * Returns `{ valid: false, reason }` otherwise.
 */
export function validateLicense(currentFingerprint: string): LicenseStatus {
    const licensePath = getLicensePath()

    // ── Check 1: file must exist ──
    if (!fs.existsSync(licensePath)) {
        return { valid: false, reason: 'License file not found. Application not activated on this device.', fingerprint: currentFingerprint }
    }

    // ── Check 2+3: decrypt (verifies HMAC + AES auth tag) ──
    let payload: { fp: string; ts: string; v: number }
    try {
        const data = fs.readFileSync(licensePath)
        const json = decrypt(data)
        payload = JSON.parse(json)
    } catch (err: any) {
        return { valid: false, reason: `License verification failed: ${err.message}`, fingerprint: currentFingerprint }
    }

    // ── Check 4: fingerprint match ──
    if (payload.fp !== currentFingerprint) {
        return { valid: false, reason: 'Hardware mismatch. This license belongs to a different device.', fingerprint: currentFingerprint }
    }

    return { valid: true, fingerprint: currentFingerprint }
}
