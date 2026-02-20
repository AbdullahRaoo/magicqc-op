/**
 * Config Vault — Encrypted runtime configuration management
 *
 * Encrypts .env and JSON config files using AES-256-GCM and stores
 * the encrypted versions. At runtime, configs are decrypted into
 * memory only — never written to disk in plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getAesKey } from './keystore'

// ── Encryption helpers ──────────────────────────────────────

function encryptData(plaintext: Buffer): Buffer {
    const key = getAesKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    // Format: [iv:12][tag:16][ciphertext]
    return Buffer.concat([iv, tag, encrypted])
}

function decryptData(packed: Buffer): Buffer {
    const key = getAesKey()
    const iv = packed.subarray(0, 12)
    const tag = packed.subarray(12, 28)
    const ciphertext = packed.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

// ── Public API ──────────────────────────────────────────────

/**
 * Read a config file, encrypting it on first access.
 * Returns the decrypted content as a UTF-8 string (in-memory only).
 *
 * Workflow:
 * 1. If .enc version exists → decrypt and return
 * 2. If plaintext exists → encrypt, store .enc, delete plaintext, return original
 * 3. If neither exists → return null
 */
export function readSecureConfig(configPath: string): string | null {
    const encPath = configPath + '.enc'

    // Case 1: Encrypted version already exists
    if (fs.existsSync(encPath)) {
        try {
            const packed = fs.readFileSync(encPath)
            return decryptData(packed).toString('utf8')
        } catch {
            // Decryption failed — file may be corrupted
            return null
        }
    }

    // Case 2: Plaintext exists — encrypt and migrate
    if (fs.existsSync(configPath)) {
        const plaintext = fs.readFileSync(configPath)
        const encrypted = encryptData(plaintext)

        // Write encrypted version
        fs.writeFileSync(encPath, encrypted)

        // Remove plaintext (security: no unencrypted configs on disk)
        fs.unlinkSync(configPath)

        return plaintext.toString('utf8')
    }

    // Case 3: Neither exists
    return null
}

/**
 * Load all known config files securely.
 * Returns a map of config name → decrypted content string.
 */
export function loadSecureConfigs(appRoot: string): Map<string, string> {
    const configs = new Map<string, string>()

    const configFiles = [
        '.env',
        'camera_calibration.json',
        'measurement_config.json',
        'registration_config.json',
    ]

    for (const filename of configFiles) {
        const configPath = path.join(appRoot, filename)
        const content = readSecureConfig(configPath)
        if (content !== null) {
            configs.set(filename, content)
        }
    }

    return configs
}

/**
 * Parse a .env file content string into process.env entries.
 * Only sets variables that are not already defined.
 */
export function applyEnvConfig(envContent: string): void {
    const lines = envContent.split('\n')
    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.substring(0, eqIdx).trim()
        const value = trimmed.substring(eqIdx + 1).trim()
            .replace(/^["']|["']$/g, '')  // Strip surrounding quotes
        if (!process.env[key]) {
            process.env[key] = value
        }
    }
}
