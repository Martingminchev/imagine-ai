/**
 * Recording — LLM call audit log.
 *
 * Every call to a language model is recorded here with full prompt/response
 * text, latency, token counts, and optional chain-of-thought (thinking).
 * Used for debugging, cost tracking, and replay analysis.
 */

const mongoose = require('mongoose')

const RecordingSchema = new mongoose.Schema({
  provider:       { type: String, required: true },
  userId:         { type: String, default: 'anonymous' },
  conversationId: { type: String, default: 'default' },
  model:          { type: String, default: null },
  caller:         { type: String, default: 'unknown' },
  prompt:         { type: String, required: true },
  systemPrompt:   { type: String, default: '' },
  response:       { type: String, default: '' },
  thinking:       { type: String, default: '' },
  temperature:    { type: Number, default: 0.7 },
  streaming:      { type: Boolean, default: false },
  latencyMs:      { type: Number, default: 0 },
  error:          { type: String, default: null },
  promptLength:   { type: Number, default: 0 },
  systemLength:   { type: Number, default: 0 },
  responseLength: { type: Number, default: 0 },
  timestamp:      { type: Date, default: Date.now }
})

RecordingSchema.index({ timestamp: -1 })
RecordingSchema.index({ caller: 1, timestamp: -1 })

module.exports = mongoose.model('Recording', RecordingSchema)
