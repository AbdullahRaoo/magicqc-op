/**
 * Post-build obfuscation script
 *
 * Runs javascript-obfuscator on the compiled Electron main process files
 * (main.js, preload.mjs) to protect IP in production builds.
 *
 * Usage: node scripts/obfuscate.js
 * Called automatically by: npm run build:prod
 */
const JavaScriptObfuscator = require('javascript-obfuscator')
const fs = require('fs')
const path = require('path')

const DIST_DIR = path.join(__dirname, '..', 'dist-electron')

// Files to obfuscate (after Vite compiles TypeScript → JavaScript)
const TARGET_FILES = [
    'main.js',
    'preload.mjs',
]

// Obfuscation settings — balanced between protection and performance
const OBFUSCATOR_OPTIONS = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.5,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.2,
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,           // Keep Electron API names intact
    selfDefending: false,           // Can break strict-mode modules
    stringArray: true,
    stringArrayEncoding: ['rc4'],
    stringArrayThreshold: 0.75,
    splitStrings: true,
    splitStringsChunkLength: 8,
    transformObjectKeys: false,     // MUST be false — renaming keys breaks Electron IPC, Node APIs, etc.
    unicodeEscapeSequence: false,   // Keeps file size reasonable
}

function obfuscateFile(filename) {
    const filePath = path.join(DIST_DIR, filename)

    if (!fs.existsSync(filePath)) {
        console.warn(`⚠️  Skipping ${filename} — file not found at ${filePath}`)
        return
    }

    const original = fs.readFileSync(filePath, 'utf8')
    const originalSize = Buffer.byteLength(original)

    console.log(`🔒 Obfuscating ${filename} (${(originalSize / 1024).toFixed(1)} KB)...`)

    const result = JavaScriptObfuscator.obfuscate(original, OBFUSCATOR_OPTIONS)
    const obfuscated = result.getObfuscatedCode()
    const newSize = Buffer.byteLength(obfuscated)

    fs.writeFileSync(filePath, obfuscated, 'utf8')

    console.log(`   ✅ Done: ${(originalSize / 1024).toFixed(1)} KB → ${(newSize / 1024).toFixed(1)} KB`)
}

// ── Main ─────────────────────────────────────────────────────
console.log('\n' + '='.repeat(50))
console.log('  MagicQC — Production Code Obfuscation')
console.log('='.repeat(50) + '\n')

if (!fs.existsSync(DIST_DIR)) {
    console.error(`❌ dist-electron/ not found. Run "vite build" first.`)
    process.exit(1)
}

for (const file of TARGET_FILES) {
    obfuscateFile(file)
}

console.log('\n✅ Obfuscation complete.\n')
