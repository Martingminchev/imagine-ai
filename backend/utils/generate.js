const ollamaProvider = require('./providers/ollama')
const geminiProvider = require('./providers/gemini')
const moonshotProvider = require('./providers/moonshot')
const Recording = require('../models/Recording')

const providers = {
  ollama: ollamaProvider,
  gemini: geminiProvider,
  moonshot: moonshotProvider
}

const DEFAULT_PROVIDER = () => process.env.LLM_PROVIDER || 'ollama'

/**
 * Parse a model spec into [provider, model].
 * Formats:
 *   "gemini:gemini-2.0-flash"  → ["gemini", "gemini-2.0-flash"]
 *   "moonshot:kimi-k2.5"       → ["moonshot", "kimi-k2.5"]
 *   "qwen3-coder:480b-cloud"   → [defaultProvider, "qwen3-coder:480b-cloud"]
 *   null                       → [defaultProvider, null]
 */
function parseModelSpec(modelSpec) {
  const spec = typeof modelSpec === 'string' ? modelSpec.trim() : ''
  if (!spec) return [DEFAULT_PROVIDER(), null]

  // Check cloud providers first (explicit prefix)
  if (spec.startsWith('moonshot:')) return ['moonshot', spec.slice(9) || null]
  if (spec.startsWith('gemini:')) return ['gemini', spec.slice(7) || null]
  if (spec.startsWith('ollama:')) return ['ollama', spec.slice(7) || null]

  // No prefix = use default provider with full spec as model name
  return [DEFAULT_PROVIDER(), spec]
}

// ── Recording context ─────────────────────────────────────────
// Callers set this before generate() to tag recordings with context.
// { conversationId, caller }
let _recordingCtx = {}

function setRecordingContext(ctx) {
  _recordingCtx = ctx || {}
}

/**
 * Save a recording to MongoDB (fire-and-forget, never blocks the pipeline).
 */
function saveRecording(data) {
  Recording.create(data).catch(err => {
    console.error('  [Recording] Failed to save:', err.message)
  })
}

/**
 * Generate text using the appropriate provider.
 * @param {Object} apiKeys - Optional { geminiApiKey, moonshotApiKey } from request; overrides env.
 * @param {Object} recordingCtx - Optional { conversationId, caller } for recording. If provided, overrides the global context (avoids race conditions between concurrent pipelines).
 */
async function generate(prompt, systemPrompt, temperature = 0.7, modelOverride = null, apiKeys = {}, recordingCtx = null) {
  const ctx = recordingCtx || _recordingCtx
  const [providerName, model] = parseModelSpec(modelOverride)
  const provider = providers[providerName]

  if (!provider) {
    throw new Error(`Unknown LLM provider: "${providerName}". Available: ${Object.keys(providers).join(', ')}`)
  }

  console.log(`  [LLM] Provider: ${providerName}, Model: ${model || 'default'}`)

  const start = Date.now()
  let response = ''
  let error = null

  try {
    response = await provider.generate(prompt, systemPrompt, temperature, model, apiKeys)
    return response
  } catch (err) {
    error = err.message
    throw err
  } finally {
    saveRecording({
      conversationId: ctx.conversationId || 'unknown',
      provider: providerName,
      model: model || 'default',
      caller: ctx.caller || 'unknown',
      prompt,
      systemPrompt: systemPrompt || '',
      response: response || '',
      temperature,
      streaming: false,
      latencyMs: Date.now() - start,
      error,
      promptLength: (prompt || '').length,
      systemLength: (systemPrompt || '').length,
      responseLength: (response || '').length
    })
  }
}

/**
 * List available providers and their status.
 */
function listProviders() {
  return {
    ollama: { available: true, needsKey: false },
    gemini: { available: !!process.env.GEMINI_API_KEY, needsKey: true },
    moonshot: { available: !!process.env.MOONSHOT_API_KEY, needsKey: true }
  }
}

/**
 * Streaming generation using the appropriate provider.
 * @param {Function} onChunk - Called with (type, text) where type is 'text' or 'thinking'
 * @param {Object} recordingCtx - Optional { conversationId, caller } for recording.
 * @returns {Promise<string>} The full accumulated text
 */
async function generateStream(prompt, systemPrompt, temperature = 0.7, modelOverride = null, apiKeys = {}, onChunk = () => {}, recordingCtx = null) {
  const ctx = recordingCtx || _recordingCtx
  const [providerName, model] = parseModelSpec(modelOverride)
  const provider = providers[providerName]

  if (!provider) {
    throw new Error(`Unknown LLM provider: "${providerName}". Available: ${Object.keys(providers).join(', ')}`)
  }

  const start = Date.now()
  let fullText = ''
  let fullThinking = ''
  let error = null

  // Wrap onChunk to capture thinking tokens for the recording
  const wrappedOnChunk = (type, text) => {
    if (type === 'thinking') fullThinking += text
    onChunk(type, text)
  }

  try {
    if (!provider.generateStream) {
      console.log(`  [LLM] Provider ${providerName} has no streaming support, falling back to non-streaming`)
      fullText = await provider.generate(prompt, systemPrompt, temperature, model, apiKeys)
      onChunk('text', fullText)
      return fullText
    }

    console.log(`  [LLM] Streaming via ${providerName}, Model: ${model || 'default'}`)
    fullText = await provider.generateStream(prompt, systemPrompt, temperature, model, apiKeys, wrappedOnChunk)
    return fullText
  } catch (err) {
    error = err.message
    throw err
  } finally {
    saveRecording({
      conversationId: ctx.conversationId || 'unknown',
      provider: providerName,
      model: model || 'default',
      caller: ctx.caller || 'unknown',
      prompt,
      systemPrompt: systemPrompt || '',
      response: fullText || '',
      thinking: fullThinking || '',
      temperature,
      streaming: true,
      latencyMs: Date.now() - start,
      error,
      promptLength: (prompt || '').length,
      systemLength: (systemPrompt || '').length,
      responseLength: (fullText || '').length
    })
  }
}

module.exports = { generate, generateStream, listProviders, setRecordingContext }
