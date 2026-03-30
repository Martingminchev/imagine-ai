/**
 * @module fileSync
 *
 * Synchronizes project files into the memory system as role:'file' memories.
 *
 * File memories are scoped per-project — each project conversation stores its
 * own set of file memories using its userId and conversationId. This means file
 * memories participate directly in the resonance pipeline alongside chat
 * memories, while being protected from decay and reconsolidation by explicit
 * exemptions in metabolism.js and reconsolidation.js.
 *
 * Each file memory stores:
 *   - filePath:  relative path within the project root
 *   - fileHash:  SHA-256 content hash for incremental sync
 *   - text:      path + truncated content (embedded for semantic search)
 *   - composite: embedding vector for similarity matching
 *   - vibrations: word-level vectors for multi-frequency resonance
 *
 * Sync is incremental — unchanged files are skipped, deleted files are purged,
 * and new/modified files are embedded and upserted.
 *
 * Exports:
 *   syncProjectFiles(projectRoot, userId, conversationId) — full incremental sync
 *   searchFileMemories(queryComposite, userId, conversationId, limit) — cosine search
 *   getProjectTree(projectRoot, maxDepth) — formatted directory tree string
 */

const crypto = require('crypto')
const Memory = require('../models/Memory')
const { listDirectory, readFile, isBinary } = require('./fileAccess')
const { cosineSimilarity } = require('./similarity')

// ═══════════════════════════════════════════════════════════════
// §1  Constants
// ═══════════════════════════════════════════════════════════════

/** Max characters of file content to embed (keeps vectors focused) */
const EMBED_CONTENT_LIMIT = 3000

/** Max characters of file content to store in the memory text field */
const STORE_CONTENT_LIMIT = 8000

/** Minimum similarity score to include a file in search results */
const SEARCH_THRESHOLD = 0.25

/** Confidence vector for file memories (immune to decay) */
const FILE_CONFIDENCE = {
  initial: 1.0,
  current: 1.0,
  decayedAt: null,
  revisionCount: 0,
  entropyBudget: 0
}

// ═══════════════════════════════════════════════════════════════
// §2  Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Compute a fast content hash for change detection.
 * @param {string} content - File content
 * @returns {string} Hex-encoded SHA-256 hash
 */
function hashContent(content) {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex')
}

/**
 * Recursively walk the project tree and collect all readable file paths.
 * @param {string} root - Absolute path to project root
 * @param {string} [dir='.'] - Directory relative to root
 * @returns {Promise<string[]>} Array of relative file paths
 */
async function walkDirectory(root, dir = '.') {
  const entries = await listDirectory(dir, root)
  const paths = []

  for (const entry of entries) {
    const relative = dir === '.' ? entry.name : `${dir}/${entry.name}`

    if (entry.type === 'directory') {
      const children = await walkDirectory(root, relative)
      paths.push(...children)
    } else if (!isBinary(entry.name)) {
      paths.push(relative)
    }
  }

  return paths
}

/**
 * Build a multi-level directory tree string for prompt injection.
 * @param {string} root - Absolute path to project root
 * @param {string} [dir='.'] - Directory relative to root
 * @param {number} [depth=0] - Current recursion depth
 * @param {number} [maxDepth=2] - Maximum recursion depth
 * @param {string} [prefix=''] - Line prefix for indentation
 * @returns {Promise<string>} Formatted tree string
 */
async function buildTree(root, dir = '.', depth = 0, maxDepth = 2, prefix = '') {
  const entries = await listDirectory(dir, root)
  const lines = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const isLast = i === entries.length - 1
    const connector = isLast ? '└── ' : '├── '
    const childPrefix = isLast ? '    ' : '│   '
    const suffix = entry.type === 'directory' ? '/' : ''

    lines.push(`${prefix}${connector}${entry.name}${suffix}`)

    if (entry.type === 'directory' && depth < maxDepth) {
      const relative = dir === '.' ? entry.name : `${dir}/${entry.name}`
      const subtree = await buildTree(root, relative, depth + 1, maxDepth, prefix + childPrefix)
      if (subtree) lines.push(subtree)
    }
  }

  return lines.join('\n')
}

// ═══════════════════════════════════════════════════════════════
// §3  Core Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Synchronize project files into the memory system for a specific conversation.
 *
 * Performs an incremental sync:
 *   1. Walk the project tree to discover all readable files
 *   2. Load existing file memories for this conversation
 *   3. For each file on disk:
 *      - Skip if content hash matches (unchanged)
 *      - Embed and upsert if new or modified
 *   4. Delete orphaned memories (files removed from disk)
 *
 * @param {string} projectRoot - Absolute path to the project directory
 * @param {string} userId - Owner of this project conversation
 * @param {string} conversationId - Conversation to store file memories in
 * @returns {Promise<{ synced: number, skipped: number, deleted: number }>}
 */
async function syncProjectFiles(projectRoot, userId, conversationId) {
  if (!projectRoot) throw new Error('projectRoot is required for file sync')

  const { decompose } = require('./embedder')

  console.log(`  [FileSync] Scanning ${projectRoot} for ${conversationId}...`)
  const filePaths = await walkDirectory(projectRoot)
  console.log(`  [FileSync] Found ${filePaths.length} files`)

  // Load existing file memories for this conversation
  const existing = await Memory.find({
    role: 'file', userId, conversationId
  }).select('filePath fileHash _id').lean()

  const existingByPath = new Map(existing.map(m => [m.filePath, m]))

  let synced = 0
  let skipped = 0

  for (const filePath of filePaths) {
    try {
      const file = await readFile(filePath, undefined, projectRoot)
      const hash = hashContent(file.content)

      // Skip unchanged files
      const prev = existingByPath.get(filePath)
      if (prev && prev.fileHash === hash) {
        existingByPath.delete(filePath)
        skipped++
        continue
      }

      // Build the text to embed (path + truncated content for focused vectors)
      const embedText = `[${filePath}]\n${file.content.slice(0, EMBED_CONTENT_LIMIT)}`
      const storeText = `[${filePath}]\n${file.content.slice(0, STORE_CONTENT_LIMIT)}`

      const { vibrations, composite } = await decompose(embedText)

      const memoryData = {
        text: storeText,
        role: 'file',
        composite,
        vibrations,
        dissonance: 0,
        localDensity: 1,
        userId,
        conversationId,
        filePath,
        fileHash: hash,
        confidence: { ...FILE_CONFIDENCE },
        source: 'file-sync'
      }

      if (prev) {
        await Memory.updateOne({ _id: prev._id }, { $set: memoryData })
        existingByPath.delete(filePath)
      } else {
        await Memory.create(memoryData)
      }

      synced++
      console.log(`  [FileSync] ${prev ? 'Updated' : 'Added'}: ${filePath}`)
    } catch (err) {
      console.error(`  [FileSync] Failed: ${filePath} — ${err.message}`)
    }
  }

  // Delete orphaned memories (files that no longer exist on disk)
  const orphanIds = [...existingByPath.values()].map(m => m._id)
  let deleted = 0
  if (orphanIds.length > 0) {
    const result = await Memory.deleteMany({ _id: { $in: orphanIds } })
    deleted = result.deletedCount || 0
    console.log(`  [FileSync] Deleted ${deleted} orphaned file memories`)
  }

  console.log(`  [FileSync] Done — synced: ${synced}, skipped: ${skipped}, deleted: ${deleted}`)
  return { synced, skipped, deleted }
}

/**
 * Search file memories by cosine similarity to a query vector.
 *
 * Loads all file memories for a conversation and ranks them against the query.
 * Returns the top matches above the similarity threshold.
 *
 * @param {number[]} queryComposite - The query vector to match against
 * @param {string} userId - Owner of the project conversation
 * @param {string} conversationId - Conversation containing the file memories
 * @param {number} [limit=5] - Maximum number of results to return
 * @returns {Promise<Array<{ filePath: string, text: string, similarity: number }>>}
 */
async function searchFileMemories(queryComposite, userId, conversationId, limit = 5) {
  if (!queryComposite || queryComposite.length === 0) return []

  const fileMemories = await Memory.find({
    role: 'file', userId, conversationId
  }).select('filePath text composite').lean()

  if (fileMemories.length === 0) return []

  return fileMemories
    .filter(m => m.composite && m.composite.length > 0)
    .map(m => ({
      filePath: m.filePath,
      text: m.text,
      similarity: cosineSimilarity(queryComposite, m.composite)
    }))
    .filter(m => m.similarity > SEARCH_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
}

/**
 * Get a formatted project directory tree for prompt injection.
 *
 * Returns a compact tree representation (2 levels deep) suitable for
 * inclusion in the system prompt. Returns null if no project root is given.
 *
 * @param {string} projectRoot - Absolute path to the project directory
 * @param {number} [maxDepth=2] - Maximum directory depth to show
 * @returns {Promise<string|null>} Formatted tree string, or null
 */
async function getProjectTree(projectRoot, maxDepth = 2) {
  if (!projectRoot) return null

  try {
    return await buildTree(projectRoot, '.', 0, maxDepth)
  } catch (err) {
    console.error('  [FileSync] Failed to build project tree:', err.message)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  syncProjectFiles,
  searchFileMemories,
  getProjectTree
}
