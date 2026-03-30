/**
 * @module fileAccess
 *
 * Read-only, sandboxed file access for the orchestrator.
 *
 * All paths are resolved relative to PROJECT_ROOT (from .env) and cannot
 * escape it. This module provides the orchestrator with awareness of the
 * user's project structure without any write capability.
 *
 * Exports:
 *   getProjectRoot()              — configured root path, or null
 *   listDirectory(relativePath)   — directory listing with type/size
 *   readFile(relativePath, max)   — file content with truncation
 *   isIgnored(name)               — check against built-in ignore list
 */

const fs = require('fs')
const path = require('path')

// ═══════════════════════════════════════════════════════════════
// §1  Configuration
// ═══════════════════════════════════════════════════════════════

/** Maximum file size returned by readFile (100 KB) */
const MAX_FILE_BYTES = 100 * 1024

/** Directories that are always skipped */
const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', '.cache', '.parcel-cache',
  'coverage', '.turbo', '.svelte-kit'
])

/** Exact filenames that are always skipped */
const IGNORED_FILES = new Set([
  '.env', '.env.local', '.env.production', '.env.development',
  '.DS_Store', 'Thumbs.db'
])

/** File extensions treated as binary (not readable as text) */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.wasm', '.exe', '.dll', '.so', '.dylib',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.mp3', '.mp4', '.avi', '.mov', '.webm', '.ogg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.pyc', '.class', '.o', '.obj',
  '.sqlite', '.db'
])

/** File patterns matched by extension (e.g. *.lock, *.log) */
const IGNORED_EXTENSIONS = new Set([
  '.lock', '.log'
])

// ═══════════════════════════════════════════════════════════════
// §2  Core Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Get the configured project root path.
 * @returns {string|null} Absolute path to project root, or null if not set
 */
function getProjectRoot() {
  const root = process.env.PROJECT_ROOT
  if (!root || !root.trim()) return null
  return path.resolve(root.trim())
}

/**
 * Resolve a relative path within a root directory, with traversal protection.
 * Throws if the resolved path escapes the root directory.
 *
 * @param {string} relativePath - Path relative to project root
 * @param {string} [rootOverride] - Explicit root path (overrides PROJECT_ROOT env)
 * @returns {string} Absolute resolved path
 * @throws {Error} If no root is available or path escapes the sandbox
 */
function safePath(relativePath, rootOverride) {
  const root = rootOverride || getProjectRoot()
  if (!root) throw new Error('PROJECT_ROOT is not configured')

  const resolved = path.resolve(root, relativePath || '.')
  const normalizedRoot = path.resolve(root)

  if (!resolved.startsWith(normalizedRoot)) {
    throw new Error('Path escapes project root')
  }

  return resolved
}

/**
 * Check whether a file or directory name should be excluded from listings.
 *
 * @param {string} name - File or directory name (not a path)
 * @param {boolean} isDir - Whether the entry is a directory
 * @returns {boolean} true if the entry should be skipped
 */
function isIgnored(name, isDir = false) {
  if (isDir) return IGNORED_DIRS.has(name)
  if (IGNORED_FILES.has(name)) return true

  const ext = path.extname(name).toLowerCase()
  if (IGNORED_EXTENSIONS.has(ext)) return true

  return false
}

/**
 * Check whether a file has a binary extension (not suitable for text reading).
 *
 * @param {string} name - Filename
 * @returns {boolean} true if the file is likely binary
 */
function isBinary(name) {
  const ext = path.extname(name).toLowerCase()
  return BINARY_EXTENSIONS.has(ext)
}

/**
 * List the contents of a directory within a project root.
 *
 * Returns an array of entries sorted directories-first, then alphabetically.
 * Ignored entries (node_modules, .git, .env, etc.) are excluded.
 *
 * @param {string} [relativePath='.'] - Directory path relative to project root
 * @param {string} [rootOverride] - Explicit root path (overrides PROJECT_ROOT env)
 * @returns {Promise<{ name: string, type: 'file'|'directory', size: number }[]>}
 * @throws {Error} If no root is available, path escapes root, or path is not a directory
 */
async function listDirectory(relativePath = '.', rootOverride) {
  const resolved = safePath(relativePath, rootOverride)

  const stat = await fs.promises.stat(resolved)
  if (!stat.isDirectory()) {
    throw new Error('Path is not a directory')
  }

  const entries = await fs.promises.readdir(resolved, { withFileTypes: true })
  const results = []

  for (const entry of entries) {
    const entryIsDir = entry.isDirectory()
    if (isIgnored(entry.name, entryIsDir)) continue

    const entryPath = path.join(resolved, entry.name)
    let size = 0

    if (!entryIsDir) {
      try {
        const s = await fs.promises.stat(entryPath)
        size = s.size
      } catch (_) { /* unreadable file */ }
    }

    results.push({
      name: entry.name,
      type: entryIsDir ? 'directory' : 'file',
      size
    })
  }

  // Sort: directories first, then alphabetical
  results.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return results
}

/**
 * Read a file within a project root.
 *
 * Returns the file content as UTF-8 text. Files larger than maxBytes are
 * truncated and flagged. Binary files are refused.
 *
 * @param {string} relativePath - File path relative to project root
 * @param {number} [maxBytes=MAX_FILE_BYTES] - Maximum bytes to read (default 100KB)
 * @param {string} [rootOverride] - Explicit root path (overrides PROJECT_ROOT env)
 * @returns {Promise<{ path: string, content: string, size: number, truncated: boolean }>}
 * @throws {Error} If file doesn't exist, is binary, or path escapes root
 */
async function readFile(relativePath, maxBytes = MAX_FILE_BYTES, rootOverride) {
  const resolved = safePath(relativePath, rootOverride)
  const name = path.basename(resolved)

  if (isBinary(name)) {
    throw new Error(`Binary file type not supported: ${path.extname(name)}`)
  }

  const stat = await fs.promises.stat(resolved)
  if (!stat.isFile()) {
    throw new Error('Path is not a file')
  }

  const truncated = stat.size > maxBytes
  const fd = await fs.promises.open(resolved, 'r')

  try {
    const buffer = Buffer.alloc(Math.min(stat.size, maxBytes))
    await fd.read(buffer, 0, buffer.length, 0)

    return {
      path: relativePath,
      content: buffer.toString('utf-8'),
      size: stat.size,
      truncated
    }
  } finally {
    await fd.close()
  }
}

// ═══════════════════════════════════════════════════════════════
// §3  Formatting Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Format a directory listing as a tree string for prompt injection.
 *
 * @param {Array<{ name: string, type: string }>} entries - From listDirectory()
 * @returns {string} Tree-formatted string, e.g. "├── src/\n├── package.json"
 */
function formatTree(entries) {
  return entries.map((e, i) => {
    const connector = i === entries.length - 1 ? '└── ' : '├── '
    const suffix = e.type === 'directory' ? '/' : ''
    return `${connector}${e.name}${suffix}`
  }).join('\n')
}

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  getProjectRoot,
  listDirectory,
  readFile,
  isIgnored,
  isBinary,
  formatTree
}
