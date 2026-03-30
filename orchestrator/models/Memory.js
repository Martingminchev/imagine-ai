/**
 * Memory — the fundamental unit of experience.
 *
 * Each memory stores both the interpreted text and its original source
 * (immutable engram), enabling reconsolidation tracking. Memories carry
 * word-level vibrations for multi-frequency resonance matching and a
 * composite vector for fast similarity search.
 *
 * The confidence vector tracks how certain the interpretation is over time,
 * decaying with age and accumulating revision history.
 */

const mongoose = require('mongoose')

const VibrationSchema = new mongoose.Schema({
  word:   { type: String, required: true },
  vector: { type: [Number], required: true }
}, { _id: false })

const ConfidenceSchema = new mongoose.Schema({
  initial:        { type: Number, default: 1.0 },
  current:        { type: Number, default: 1.0 },
  decayedAt:      { type: Date, default: null },
  revisionCount:  { type: Number, default: 0 },
  entropyBudget:  { type: Number, default: 1.0 }
}, { _id: false })

const RevisionSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  composite: { type: [Number], default: [] },
  timestamp: { type: Date, default: Date.now },
  context:   { type: String, default: '' }
}, { _id: false })

const MemorySchema = new mongoose.Schema({
  // ── Core ──────────────────────────────────────────────────────────────────
  text:           { type: String, required: true },
  role:           { type: String, enum: ['user', 'ai', 'lesson', 'initiative', 'file'], required: true },
  composite:      { type: [Number], default: [] },
  vibrations:     { type: [VibrationSchema], default: [] },
  dissonance:     { type: Number, default: 0 },
  localDensity:   { type: Number, default: 1 },
  accessCount:    { type: Number, default: 0 },
  lastAccessed:   { type: Date, default: null },
  userId:         { type: String, default: 'anonymous' },
  conversationId: { type: String, default: 'default' },
  timestamp:      { type: Date, default: Date.now },

  // Links lessons to originating tasks
  taskId:         { type: mongoose.Schema.Types.ObjectId, ref: 'Task', default: null },

  // ── Reconsolidation — immutable source vs evolving interpretation ─────────
  sourceText:      { type: String, default: null },
  sourceComposite: { type: [Number], default: [] },
  retrievalCount:  { type: Number, default: 0 },
  vectorDrift:     { type: Number, default: 0 },
  emotionalValence:{ type: Number, default: 0 },
  reconstructedAt: { type: Date, default: null },

  // ── Metabolic memory ─────────────────────────────────────────────────────
  confidence: {
    type: ConfidenceSchema,
    default: () => ({
      initial: 1.0,
      current: 1.0,
      decayedAt: null,
      revisionCount: 0,
      entropyBudget: 1.0
    })
  },
  revisions:       { type: [RevisionSchema], default: [] },
  divergenceScore: { type: Number, default: 0 },
  metabolized:     { type: Boolean, default: true },
  limbicProcessedAt: { type: Date, default: null },

  // ── Fuzzy recall ─────────────────────────────────────────────────────────
  gist:     { type: String, default: null },
  gistedAt: { type: Date, default: null },

  // ── File tracking (role: 'file' only) ────────────────────────────────────
  filePath: { type: String, default: null },
  fileHash: { type: String, default: null },

  // ── Origin tracking ──────────────────────────────────────────────────────
  source:   { type: String, default: null }
})

// ── Indexes ────────────────────────────────────────────────────────────────
// Memories are global per user — conversationId is a source tag, not a filter.
// File memories (role: 'file') are the exception: they're project-scoped.
MemorySchema.index({ userId: 1, timestamp: -1 })
MemorySchema.index({ userId: 1, role: 1, timestamp: -1 })
MemorySchema.index({ role: 1, userId: 1, conversationId: 1 })  // file memory queries
MemorySchema.index({ lastAccessed: -1 })

module.exports = mongoose.model('Memory', MemorySchema)
