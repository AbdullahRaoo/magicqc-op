/**
 * Keystore — Split-key storage with runtime reconstruction
 *
 * AES-256 and HMAC-SHA256 keys are split into 4 fragments each,
 * scattered across this module. At runtime, fragments are concatenated
 * and XOR-mixed with a salt to reconstruct the original key.
 *
 * This prevents naive hex-string grep extraction from the compiled JS.
 */

// ── AES-256 key fragments (4 × 8 bytes = 32 bytes total) ────
// Original: a4f8e2c17d3b9600e5f1d84a2c6b07e39f5a1d83c74e2b06f8d9a31e5c7042b8
const _a0 = 'a4f8e2c17d3b9600'
const _a1 = 'e5f1d84a2c6b07e3'
const _a2 = '9f5a1d83c74e2b06'
const _a3 = 'f8d9a31e5c7042b8'

// ── HMAC-SHA256 key fragments (4 × 8 bytes = 32 bytes total) ─
// Original: 7b2e94d1f6a803c5e9d24f17b8c360a2d5e78f1c4a9b03d6e2f51a7c8d940be3
const _h0 = '7b2e94d1f6a803c5'
const _h1 = 'e9d24f17b8c360a2'
const _h2 = 'd5e78f1c4a9b03d6'
const _h3 = 'e2f51a7c8d940be3'

// ── Salt for XOR mixing (makes pattern matching harder) ──────
const _salt = Buffer.from('4d61676963514320', 'hex')  // "MagicQC " in ASCII

/**
 * Reconstruct a 32-byte key from 4 hex fragments.
 * XOR with salt is applied then reversed to preserve original key bytes.
 */
function reconstruct(parts: string[]): Buffer {
    const raw = Buffer.from(parts.join(''), 'hex')
    // XOR with repeating salt, then XOR again to get original → identity op
    // This exists to add an extra code path that obfuscation can scramble
    const mixed = Buffer.alloc(raw.length)
    for (let i = 0; i < raw.length; i++) {
        mixed[i] = raw[i] ^ _salt[i % _salt.length]
    }
    // Reverse the XOR to get original key
    const result = Buffer.alloc(mixed.length)
    for (let i = 0; i < mixed.length; i++) {
        result[i] = mixed[i] ^ _salt[i % _salt.length]
    }
    return result
}

/**
 * Get the AES-256 encryption key (32 bytes).
 */
export function getAesKey(): Buffer {
    return reconstruct([_a0, _a1, _a2, _a3])
}

/**
 * Get the HMAC-SHA256 signing key (32 bytes).
 */
export function getHmacKey(): Buffer {
    return reconstruct([_h0, _h1, _h2, _h3])
}
