const mongoose = require('mongoose')

const VibrationSchema = new mongoose.Schema({
  word:   { type: String, required: true },
  vector: { type: [Number], required: true }
}, { _id: false })

// Git-style revision history for surprised expectations
const RevisionSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  composite: { type: [Number], default: [] },
  timestamp: { type: Date, default: Date.now },
  context:   { type: String, default: '' }
}, { _id: false })

// ── Expectation: A future-facing projection ───────────────────
// Positioned on a forward Gabriel's Horn (mirror of Memory's past horn).
// x=1 (wide mouth) = imminent expectations, easily accessible
// x=7 (narrow tail) = far-future projections, speculative and hard to reach
const ExpectationSchema = new mongoose.Schema({
  text:           { type: String, required: true },         // "They'll bring up their career again"
  horizon:        { type: String, enum: ['imminent', 'near', 'far'], default: 'near' },
  hornX:          { type: Number, default: 1 },             // 1-7 on the future horn
  composite:      { type: [Number], default: [] },          // embedding vector
  vibrations:     { type: [VibrationSchema], default: [] }, // word-level decomposition
  confidence:     { type: Number, default: 0.5 },           // 0-1 prediction certainty
  urgency:        { type: Number, default: 0.1 },           // increases as expectedBy approaches

  // ── Status lifecycle ─────────────────────────────────────
  status: {
    type: String,
    enum: ['active', 'confirmed', 'surprised', 'lapsed'],
    default: 'active'
  },
  expectedBy:     { type: Date, required: true },           // when it should materialize

  // ── Resolution fields ────────────────────────────────────
  confirmedAt:    { type: Date, default: null },
  surprisedAt:    { type: Date, default: null },
  lapsedAt:       { type: Date, default: null },
  surprisedBy:    { type: String, default: '' },            // what actually happened (on surprise)
  confirmingText: { type: String, default: '' },            // what confirmed it

  // ── Predictive dissonance ────────────────────────────────
  predictiveDissonance: { type: Number, default: 0 },       // how wrong the prediction was (0-1)

  // ── Reconsolidation on surprise ──────────────────────────
  revisions:      { type: [RevisionSchema], default: [] },

  // ── Context ──────────────────────────────────────────────
  conversationId: { type: String, default: 'default' },
  timestamp:      { type: Date, default: Date.now }
})

ExpectationSchema.index({ conversationId: 1, status: 1, expectedBy: 1 })
ExpectationSchema.index({ conversationId: 1, timestamp: -1 })

module.exports = mongoose.model('Expectation', ExpectationSchema)
