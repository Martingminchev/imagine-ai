const ollamaProvider  = require('./providers/ollama')
const geminiProvider  = require('./providers/gemini')
const moonshotProvider = require('./providers/moonshot')
const Recording = require('../models/Recording')

const providers = {
  ollama:   ollamaProvider,
  gemini:   geminiProvider,
  moonshot: moonshotProvider
}

const DEFAULT_PROVIDER = () => process.env.LLM_PROVIDER || 'ollama'

// Thread-local recording context — set by pipeline/autonomy callers
// so recordings can be tagged with conversationId and caller origin
let _recordingCtx = {}

/**
 * Set the recording context for subsequent LLM calls.
 * Used by the pipeline and autonomy to tag recordings with origin info.
 * @param {{ conversationId?: string, caller?: string }} ctx
 */
function setRecordingContext(ctx) {
  _recordingCtx = ctx || {}
}

/**
 * Parse a model spec string into [providerName, modelName].
 *
 *   "gemini:gemini-2.0-flash"  -> ["gemini", "gemini-2.0-flash"]
 *   "ollama:llama3"            -> ["ollama", "llama3"]
 *   "llama3"                   -> [defaultProvider, "llama3"]
 *   null                       -> [defaultProvider, null]
 */
function parseModelSpec(spec) {
  const s = typeof spec === 'string' ? spec.trim() : ''
  if (!s) return [DEFAULT_PROVIDER(), null]

  for (const prefix of ['moonshot', 'gemini', 'ollama']) {
    if (s.startsWith(prefix + ':')) return [prefix, s.slice(prefix.length + 1) || null]
  }

  return [DEFAULT_PROVIDER(), s]
}

/**
 * Save a recording (fire-and-forget, never blocks the pipeline).
 */
function saveRecording(data) {
  Recording.create({ ..._recordingCtx, ...data }).catch(err => {
    console.error('  [Recording] save failed:', err.message)
  })
}

/**
 * Generate text using the configured LLM provider.
 */
async function generate(prompt, systemPrompt, temperature = 0.7, modelOverride = null, apiKeys = {}, caller = 'unknown') {
  const [providerName, model] = parseModelSpec(modelOverride)
  const provider = providers[providerName]
  if (!provider) throw new Error(`Unknown provider: "${providerName}"`)

  console.log(`  [LLM] ${providerName} / ${model || 'default'}`)

  const start = Date.now()
  let response = '', error = null

  try {
    response = await provider.generate(prompt, systemPrompt, temperature, model, apiKeys)
    return response
  } catch (err) {
    error = err.message
    throw err
  } finally {
    saveRecording({
      provider: providerName, model: model || 'default', caller,
      prompt, systemPrompt: systemPrompt || '', response: response || '',
      temperature, streaming: false, latencyMs: Date.now() - start, error,
      promptLength: (prompt || '').length,
      systemLength: (systemPrompt || '').length,
      responseLength: (response || '').length
    })
  }
}

/**
 * Stream text from the configured LLM provider.
 * Calls onChunk('text', token) for each streamed token.
 * Returns the full accumulated text.
 */
async function generateStream(prompt, systemPrompt, temperature = 0.7, modelOverride = null, apiKeys = {}, onChunk = () => {}, caller = 'unknown') {
  const [providerName, model] = parseModelSpec(modelOverride)
  const provider = providers[providerName]
  if (!provider) throw new Error(`Unknown provider: "${providerName}"`)

  const start = Date.now()
  let fullText = '', error = null

  try {
    if (!provider.generateStream) {
      fullText = await provider.generate(prompt, systemPrompt, temperature, model, apiKeys)
      onChunk('text', fullText)
      return fullText
    }

    console.log(`  [LLM] streaming ${providerName} / ${model || 'default'}`)
    fullText = await provider.generateStream(prompt, systemPrompt, temperature, model, apiKeys, onChunk)
    return fullText
  } catch (err) {
    error = err.message
    throw err
  } finally {
    saveRecording({
      provider: providerName, model: model || 'default', caller,
      prompt, systemPrompt: systemPrompt || '', response: fullText || '',
      temperature, streaming: true, latencyMs: Date.now() - start, error,
      promptLength: (prompt || '').length,
      systemLength: (systemPrompt || '').length,
      responseLength: (fullText || '').length
    })
  }
}

module.exports = { generate, generateStream, parseModelSpec, setRecordingContext }
