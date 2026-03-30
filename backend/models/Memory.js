const mongoose = require('mongoose')

const VibrationSchema = new mongoose.Schema({
  word:   { type: String, required: true },
  vector: { type: [Number], required: true }
}, { _id: false })

// ── Confidence Vector ──────────────────────────────────────────
// Events stay crystalline; interpretations become porous.
// initial = certainty at time of encoding (never changes)
// current = decaying certainty of the interpretation (softens over time)
// emotionalValence drives lambda — high charge = faster interpretive decay
const ConfidenceSchema = new mongoose.Schema({
  initial:        { type: Number, default: 1.0 },   // locked at creation
  current:        { type: Number, default: 1.0 },   // decays on storage schedule
  decayedAt:      { type: Date, default: null },     // last scheduled decay
  revisionCount:  { type: Number, default: 0 },      // how many times interpretation was revised
  entropyBudget:  { type: Number, default: 1.0 }     // degrades when contradictions metabolized
}, { _id: false })

// ── Revision Layer ─────────────────────────────────────────────
// Git-style history: old interpretations preserved, not overwritten.
const RevisionSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  composite: { type: [Number], default: [] },
  timestamp: { type: Date, default: Date.now },
  context:   { type: String, default: '' }        // what triggered the revision
}, { _id: false })

const MemorySchema = new mongoose.Schema({
  text:           { type: String, required: true },
  role:           { type: String, enum: ['user', 'ai', 'initiative'], required: true },
  composite:      { type: [Number], default: [] },
  vibrations:     { type: [VibrationSchema], default: [] },
  dissonance:     { type: Number, default: 0 },
  localDensity:   { type: Number, default: 1 },
  accessCount:    { type: Number, default: 0 },
  lastAccessed:   { type: Date, default: null },
  conversationId: { type: String, default: 'default' },
  timestamp:      { type: Date, default: Date.now },

  // ── Reconsolidation fields ─────────────────────────────────
  sourceText:      { type: String, default: null },      // immutable original text (the crystalline event)
  sourceComposite: { type: [Number], default: [] },      // immutable original vector
  retrievalCount:  { type: Number, default: 0 },         // times this memory was retrieved
  vectorDrift:     { type: Number, default: 0 },         // cumulative distance from sourceComposite
  emotionalValence:{ type: Number, default: 0 },         // accumulated emotional weight (persists as metadata)
  reconstructedAt: { type: Date, default: null },         // last time text was rewritten

  // ── Metabolic Memory fields ────────────────────────────────
  confidence:      { type: ConfidenceSchema, default: () => ({ initial: 1.0, current: 1.0, decayedAt: null, revisionCount: 0, entropyBudget: 1.0 }) },
  revisions:       { type: [RevisionSchema], default: [] },    // git-style interpretation history
  divergenceScore: { type: Number, default: 0 },               // from limbic counterfactual analysis
  metabolized:     { type: Boolean, default: true },            // false = active contradiction, capped retrieval
  limbicProcessedAt: { type: Date, default: null },             // last limbic module run

  // ── Fuzzy Recall ─────────────────────────────────────────────
  // As confidence decays, memories don't truncate — they degrade naturally.
  // gist = compressed emotional impression, generated when memory crosses threshold.
  gist:            { type: String, default: null },             // LLM-generated vague impression
  gistedAt:        { type: Date, default: null }                // when gist was last generated
})

MemorySchema.index({ conversationId: 1, timestamp: -1 })
MemorySchema.index({ lastAccessed: -1 })

module.exports = mongoose.model('Memory', MemorySchema)
