const mongoose = require('mongoose')

const RecordingSchema = new mongoose.Schema({
  conversationId: { type: String, default: 'default', index: true },
  provider:       { type: String, required: true },             // gemini, moonshot, ollama
  model:          { type: String, default: null },              // specific model name
  caller:         { type: String, default: 'unknown' },        // chat, chat-stream, compare, autonomy, duet, contemplation
  prompt:         { type: String, required: true },             // user/trigger prompt sent to LLM
  systemPrompt:   { type: String, default: '' },               // full system prompt (the consciousness window)
  response:       { type: String, default: '' },               // LLM response text
  thinking:       { type: String, default: '' },               // thinking/reasoning tokens if any
  temperature:    { type: Number, default: 0.7 },
  streaming:      { type: Boolean, default: false },
  latencyMs:      { type: Number, default: 0 },                // wall-clock time of the call
  error:          { type: String, default: null },              // error message if call failed
  promptLength:   { type: Number, default: 0 },                // char count of prompt
  systemLength:   { type: Number, default: 0 },                // char count of system prompt
  responseLength: { type: Number, default: 0 },                // char count of response
  timestamp:      { type: Date, default: Date.now }
})

RecordingSchema.index({ timestamp: -1 })
RecordingSchema.index({ provider: 1, timestamp: -1 })
RecordingSchema.index({ caller: 1, timestamp: -1 })

module.exports = mongoose.model('Recording', RecordingSchema)
