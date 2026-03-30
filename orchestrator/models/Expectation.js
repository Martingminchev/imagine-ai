/**
 * Expectation — a future-facing prediction on the forward Gabriel's Horn.
 *
 * Positioned on a mirror of Memory's past horn:
 *   x = 1 (wide mouth)  → imminent expectations
 *   x = 7 (narrow tail) → far-future projections
 *
 * Expectations carry the same vibration / composite structure as memories so
 * that the circulation system can detect confirmation or surprise when an
 * incoming memory resonates with (or contradicts) an active expectation.
 *
 * Lifecycle: active → confirmed | surprised | lapsed
 */

const mongoose = require('mongoose')

const VibrationSchema = new mongoose.Schema({
  word:   { type: String, required: true },
  vector: { type: [Number], required: true }
}, { _id: false })

const RevisionSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  composite: { type: [Number], default: [] },
  timestamp: { type: Date, default: Date.now },
  context:   { type: String, default: '' }
}, { _id: false })

const ExpectationSchema = new mongoose.Schema({
  text:           { type: String, required: true },
  horizon: {
    type: String,
    enum: ['imminent', 'near', 'far'],
    default: 'near'
  },
  hornX:          { type: Number, default: 1 },
  composite:      { type: [Number], default: [] },
  vibrations:     { type: [VibrationSchema], default: [] },
  confidence:     { type: Number, default: 0.5 },
  urgency:        { type: Number, default: 0.1 },
  status: {
    type: String,
    enum: ['active', 'confirmed', 'surprised', 'lapsed'],
    default: 'active'
  },
  expectedBy:     { type: Date, required: true },
  confirmedAt:    { type: Date, default: null },
  surprisedAt:    { type: Date, default: null },
  lapsedAt:       { type: Date, default: null },
  surprisedBy:    { type: String, default: '' },
  confirmingText: { type: String, default: '' },
  predictiveDissonance: { type: Number, default: 0 },
  revisions:      { type: [RevisionSchema], default: [] },
  userId:         { type: String, default: 'anonymous' },
  conversationId: { type: String, default: 'default' },
  timestamp:      { type: Date, default: Date.now }
})

ExpectationSchema.index({ userId: 1, conversationId: 1, status: 1, expectedBy: 1 })
ExpectationSchema.index({ userId: 1, conversationId: 1, timestamp: -1 })

module.exports = mongoose.model('Expectation', ExpectationSchema)
