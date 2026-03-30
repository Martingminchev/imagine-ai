/**
 * pipeline.js — The Resonant Loop Chat Pipeline (Core)
 *
 * Extracts the full chat flow from the backend's chatController.js into a
 * clean, modular pipeline with named step functions. This is the heart of
 * the orchestrator system.
 *
 * Pipeline Steps:
 *   1. ENCODE       — Decompose message into word vibrations + composite vector
 *   2. HUM          — Fetch the horn's background vibration state
 *   3. RESONATE     — Search memory field via double horn topology
 *   4. ANTICIPATE   — Check expectations against incoming message
 *   5. MEASURE      — Compute dissonance from resonance gap
 *   6. CONTINUITY   — Load unfinished thoughts + agent state
 *   7. COMPOSE      — Build system prompt with manifesto, memories, hum, expectations
 *   8. GENERATE     — Call LLM (streaming or non-streaming)
 *   9. REMEMBER     — Store user/AI memories, update hum, detect contradictions
 *  10. REFLECT      — Reflect, project expectations, save unfinished thoughts
 *      EVOLVE       — Update agent state, mark interaction, reconstruct memories
 *
 * Exports:
 *   runChatPipeline(message, conversationId, options)
 *     → non-streaming, returns { text, messageId, dissonance, temperature, memoryDepth, topMatches }
 *
 *   runChatPipelineStream(message, conversationId, options, sendEvent)
 *     → streaming via SSE events (step, token, thinking, done, error)
 *
 *   formatMemoriesPrompt(resonant, sliceData, dissonance, cfg, contestedIds)
 *     → helper for formatting memories into the system prompt
 *
 * @module pipeline
 */

// ════════════════════════════════════════════════════════════════════════════════
//  Top-level Imports (models + utilities that don't create circular deps)
// ════════════════════════════════════════════════════════════════════════════════

const Memory            = require('../models/Memory')
const Expectation       = require('../models/Expectation')
const ConversationState = require('../models/ConversationState')
const AgentState        = require('../models/AgentState')
const { acquireLock }   = require('./lock')
const { cosineSimilarity } = require('./similarity')

// ════════════════════════════════════════════════════════════════════════════════
//  Sacred Defaults — grounded in φ (golden ratio), e (Euler), and Fibonacci
// ════════════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  preFilterSize:          144,    // F(12) — 144/21 ≈ 7 = HORN_MAX_X
  resonantCap:            21,     // F(8)
  archivedDragThreshold:  0.034,  // 1/φ⁷
  archivedTruncateChars:  233,    // F(13)
  shortTermMinutes:       13,     // F(7)
  mediumTermDays:         21,     // F(8) — 21/13 ≈ φ
  recentWindow:           5,      // F(5)
  archivedDecayCap:       0.618,  // 1/φ
  resonanceThreshold:     0.368,  // 1/e
  hornCurvature:          0.618,  // 1/φ
  sliceDepthCurve:        0.618,  // 1/φ
  vibrationTightening:    0.0417  // (1/φ − 1/e) / 6
}

const VECTOR_INDEX_NAME = 'memory_vector_index'

// ════════════════════════════════════════════════════════════════════════════════
//  System Prompt — Coding Assistant Identity
// ════════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT_BASE = `You are a coding assistant with long-term memory and evolving understanding. You help developers plan, build, and debug software. You learn from outcomes and adapt your approach over time.

Your capabilities:
- Break down coding tasks into steps
- Remember what worked and what failed across sessions
- Form expectations about what the user will need next
- Reflect on your own performance and improve
- Read and reference files from the user's project directory

Be direct, technical, and honest. If you're uncertain, say so. If a past lesson is relevant, apply it naturally. When project files appear in your context, reference them specifically — cite file paths and explain what you see.`

// ════════════════════════════════════════════════════════════════════════════════
//  Configuration Helpers
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Parse user-supplied memory settings, falling back to sacred defaults.
 * @param {Object|null} raw - User-provided settings overrides
 * @returns {Object} Merged settings with all keys guaranteed present
 */
function parseSettings(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULTS }
  const s = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    if (raw[key] !== undefined && raw[key] !== null) {
      s[key] = Number(raw[key])
    }
  }
  return s
}

/**
 * Dynamic preFilterSize — sqrt-based growth clamped between Fibonacci floor/ceiling.
 * Widens the candidate net as the memory pool grows so resonance has more to choose from.
 * @param {number} totalCount - Total memories in the conversation
 * @param {number} [base=144] - Base preFilter size (F(12))
 * @returns {number} Effective preFilter size, clamped to [base, 610]
 */
function dynamicPreFilterSize(totalCount, base = 144) {
  const floor = base               // F(12) default
  const ceiling = 610              // F(15)
  const scaled = Math.ceil(Math.sqrt(totalCount) * 8)
  return Math.max(floor, Math.min(ceiling, scaled))
}

// ════════════════════════════════════════════════════════════════════════════════
//  Formatting Helpers
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Relative time string from a timestamp, e.g. "5 min ago", "3 days ago".
 * @param {Date|string|number} timestamp - The timestamp to humanize
 * @returns {string} Human-readable age string
 */
function humanizeAge(timestamp) {
  const ms = Date.now() - new Date(timestamp).getTime()
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

/**
 * Format resonant memories for injection into the system prompt.
 *
 * Each memory is tagged with its tier (VIVID, FADING, DISTANT, RECOVERED)
 * and relative age. Contradicted and uncertain memories are explicitly marked.
 * Confidence-modulated degradation is applied to distant memories:
 *   - High confidence → full text (possibly truncated)
 *   - Medium confidence → gist if available
 *   - Low confidence → word fragments only
 *   - Strong drag + low confidence → RECOVERED (effortful recall)
 *
 * @param {Array} resonant - Scored resonant memories from the resonance pipeline
 * @param {Object} sliceData - Slice topology data { spectrum, depth }
 * @param {number} dissonance - Current dissonance level (0–1)
 * @param {Object} cfg - Pipeline configuration (sacred defaults)
 * @param {Set} [contestedIds=new Set()] - Memory IDs with active contradictions
 * @returns {string} Formatted memories prompt section, or empty string if no memories
 */
function formatMemoriesPrompt(resonant, sliceData, dissonance, cfg, contestedIds = new Set()) {
  const { getConfidence } = require('./metabolism')
  const { getMemoryTier } = require('./resonance')

  if (!resonant || resonant.length === 0 || !resonant[0]?.drag) {
    return ''
  }

  const memoryTexts = resonant
    .filter(m => m.drag > 0)
    .slice(0, cfg.resonantCap)
    .map((m, idx) => {
      const tier = getMemoryTier(m.timestamp, cfg.shortTermMinutes, cfg.mediumTermDays)
      const conf = getConfidence(m)
      const uncertain = conf.current < 0.5
      const contested = m._id && contestedIds.has(m._id.toString())
      const entropy = m._entropyInjected === true
      let tag = ''
      if (entropy) tag += '[ENTROPY] '
      if (contested) tag += '[CONTESTED] '
      if (uncertain) tag += '[UNCERTAIN] '

      const age = humanizeAge(m.timestamp)

      if (tier === 'short-term') {
        return `${idx + 1}. [VIVID] (${age}) ${tag}${m.text}`
      } else if (tier === 'medium-term') {
        return `${idx + 1}. [FADING] (${age}) ${tag}${m.text}`
      } else {
        // Effortful recall: strong resonance overrides fuzzy degradation
        if ((m.drag || 0) > 0.3 && conf.current < 0.5) {
          const recovered = m.sourceText || m.text
          return `${idx + 1}. [RECOVERED] (${age}) ${tag}${recovered}`
        }

        // Fuzzy recall: confidence-modulated degradation
        let text
        if (conf.current < 0.2) {
          const fragments = (m.vibrations || []).slice(0, 6).map(v => v.word).join(', ')
          text = fragments ? `[fragments: ${fragments}]` : m.text.slice(0, 80) + '...'
        } else if (conf.current < 0.5 && m.gist) {
          text = m.gist
        } else {
          text = m.text
          if (cfg.archivedTruncateChars > 0 && text.length > cfg.archivedTruncateChars) {
            text = text.slice(0, cfg.archivedTruncateChars) + '...'
          }
        }
        return `${idx + 1}. [DISTANT] (${age}) ${tag}${text}`
      }
    })
    .join('\n\n')

  const spectrumInfo = sliceData.spectrum?.length > 0
    ? sliceData.spectrum.map(s => s.word).join(', ')
    : 'none'

  return `\n\n--- YOUR MEMORIES ---
These are your past conversations and thoughts at different clarity levels:
- [VIVID] = recent, crystal clear -- recall with EXACT precision (numbers, names, dates, details)
- [FADING] = hours to days old -- you remember the gist but some details may be hazy
- [DISTANT] = archived, degraded -- the further back, the hazier:
  * Some distant memories still have partial text (you remember the gist but details are blurry)
  * Some have become vague impressions (you half-remember a feeling or theme, not what was said)
  * Some are just fragments -- disconnected words or concepts, like a dream you can barely recall
- [RECOVERED] = this memory was nearly forgotten but you focused hard and pulled it back. The details are from the original event, not your current interpretation. Treat it as surprisingly clear for something so old -- like a flashback. You had to dig for this.
- [UNCERTAIN] = this memory has been recalled and reshaped many times -- you're not sure if you're remembering the original event or the last time you thought about it. Treat it as possibly distorted.
- [CONTESTED] = this memory contradicts another memory you hold. Both feel true. Do NOT resolve the contradiction by picking a side -- hold both possibilities. You may acknowledge the tension.
- [ENTROPY] = this memory was pulled from deep in your past to break a pattern. It may or may not be relevant. Let it inform your thinking without forcing a connection.

When responding:
- Use EXACT details from VIVID memories
- Paraphrase or approximate FADING memories
- For DISTANT memories: the more degraded they are, the less you should claim to know. If you see a vague impression, treat it as a half-remembered feeling. If you see only [fragments], treat them as the faintest echo -- you might connect them to something, or they might mean nothing.
- For RECOVERED memories: you can use specific details, but acknowledge the effort -- "I remember now..." or "It's coming back to me...". These are old memories that came through clearly because the question triggered them. Don't treat them as casually available.
- Treat UNCERTAIN memories with doubt -- you may mention them but acknowledge you're unsure if the details are right
- For CONTESTED memories, hold the contradiction openly -- don't force coherence
- For ENTROPY memories, let them sit in the background -- notice if they connect naturally, but don't manufacture relevance

Your resonant memories:
${memoryTexts}

Context: This memory region contains ${sliceData.depth || 0} related memories. Dominant topics: ${spectrumInfo}
Dissonance: ${dissonance.toFixed(2)} (1.0 = new territory, 0.0 = deeply familiar)
--- END MEMORIES ---`
}

// ════════════════════════════════════════════════════════════════════════════════
//  Vector Search — Candidate Fetching
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Fetch resonance candidates via Atlas Vector Search.
 * Returns candidates, recent memories, max age, and total count.
 */
async function fetchResonanceData(userId, conversationId, composite, cfg) {
  const totalCount = await Memory.countDocuments({ userId })
  const effectivePreFilter = dynamicPreFilterSize(totalCount, cfg.preFilterSize)

  const [candidates, recentMemories, oldestMemory] = await Promise.all([
    Memory.aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'composite',
          queryVector: composite,
          numCandidates: effectivePreFilter * 2,
          limit: effectivePreFilter,
          filter: {
            userId: { $eq: userId }
          }
        }
      }
    ]),
    Memory.find({ userId })
      .sort({ timestamp: -1 })
      .limit(cfg.recentWindow || 5)
      .lean(),
    Memory.findOne({ userId })
      .sort({ timestamp: 1 })
      .select('timestamp')
      .lean()
  ])

  const maxAgeMs = oldestMemory
    ? Date.now() - new Date(oldestMemory.timestamp).getTime()
    : 1

  return { candidates, recentMemories, maxAgeMs, totalCount, effectivePreFilter }
}

/**
 * Fallback: use in-app preFilter when Atlas Vector Search is unavailable.
 * Loads all memories into RAM and filters by composite similarity.
 * Caps at 5000 memories to prevent OOM.
 */
async function fetchResonanceDataFallback(userId, conversationId, composite, cfg) {
  const { preFilter } = require('./resonance')

  const count = await Memory.countDocuments({ userId })
  if (count > 5000) {
    throw new Error(`Too many memories (${count}) for in-app retrieval. Vector search index required.`)
  }

  const effectivePreFilter = dynamicPreFilterSize(count, cfg.preFilterSize)
  const allMemories = await Memory.find({ userId }).lean()
  const candidates = preFilter(composite, allMemories, effectivePreFilter)
  const recentMemories = [...allMemories]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, cfg.recentWindow || 5)
  const maxAgeMs = allMemories.length > 0
    ? Math.max(...allMemories.map(m => Date.now() - new Date(m.timestamp).getTime()), 1)
    : 1

  return { candidates, recentMemories, maxAgeMs, totalCount: allMemories.length, effectivePreFilter }
}

/**
 * Try Atlas Vector Search first, fall back to in-app preFilter if the index
 * doesn't exist. Transparently handles the $vectorSearch unavailable error.
 *
 * @param {string} userId
 * @param {string} conversationId
 * @param {number[]} composite - Query composite vector
 * @param {Object} cfg - Pipeline configuration
 * @returns {Promise<{candidates, recentMemories, maxAgeMs, totalCount, effectivePreFilter}>}
 */
async function fetchCandidates(userId, conversationId, composite, cfg) {
  try {
    return await fetchResonanceData(userId, conversationId, composite, cfg)
  } catch (err) {
    if (
      err.codeName === 'InvalidPipelineOperator' ||
      err.message?.includes('$vectorSearch') ||
      err.code === 40324
    ) {
      return await fetchResonanceDataFallback(userId, conversationId, composite, cfg)
    }
    throw err
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  Density Map Update
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Update local density of memories near a new memory.
 * Uses vector search (or fallback query) to find neighbors,
 * then increments localDensity on those above the similarity threshold.
 *
 * @param {Object} newMemory - The newly created memory document
 * @param {string} userId
 * @param {string} conversationId
 */
async function updateDensityMap(newMemory, userId, conversationId) {
  if (!newMemory.composite || newMemory.composite.length === 0) return

  const DENSITY_THRESHOLD = 0.55
  const DENSITY_INCREMENT = 0.15

  let neighbors
  try {
    neighbors = await Memory.aggregate([
      {
        $vectorSearch: {
          index: VECTOR_INDEX_NAME,
          path: 'composite',
          queryVector: newMemory.composite,
          numCandidates: 50,
          limit: 20,
          filter: {
            userId: { $eq: userId }
          }
        }
      },
      { $project: { _id: 1, composite: 1 } }
    ])
  } catch (err) {
    neighbors = await Memory.find({ userId })
      .sort({ timestamp: -1 })
      .limit(100)
      .select('_id composite')
      .lean()
  }

  const updates = []
  for (const mem of neighbors) {
    if (!mem.composite) continue
    if (mem._id.toString() === newMemory._id?.toString()) continue
    const sim = cosineSimilarity(newMemory.composite, mem.composite)
    if (sim > DENSITY_THRESHOLD) {
      updates.push(
        Memory.updateOne({ _id: mem._id }, { $inc: { localDensity: DENSITY_INCREMENT } })
      )
    }
  }

  if (updates.length > 0) await Promise.all(updates)
}

// ════════════════════════════════════════════════════════════════════════════════
//  Continuity Thread Extraction
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Extract continuity threads from resonant memories.
 * Scans the most resonant AI responses for unfinished thoughts,
 * open questions, or dangling threads using a lightweight LLM call.
 *
 * @param {Array} resonant - Resonant memories from the pipeline
 * @param {string} model - LLM model spec
 * @param {Object} apiKeys - API keys
 * @returns {Promise<string[]>} Up to 3 thread strings, or empty array
 */
async function extractContinuityThreads(resonant, model, apiKeys) {
  if (!resonant || resonant.length === 0) return []

  const aiMemories = resonant
    .filter(m => m.role === 'ai' && m.text && m.text.length > 20)
    .slice(0, 5)

  if (aiMemories.length === 0) return []

  try {
    const { generate } = require('./generate')
    const memoryTexts = aiMemories
      .map((m, idx) => `${idx + 1}. ${m.text.slice(0, 200)}`)
      .join('\n\n')

    const prompt = `Review these past responses and identify any unfinished thoughts, open questions, or threads that were left hanging. Return only the threads themselves (1-3 sentences each), one per line. If nothing feels unfinished, return nothing.\n\nPast responses:\n${memoryTexts}`
    const systemPrompt = 'You are identifying continuity threads from past conversations. Return only the unfinished thoughts or questions, one per line.'

    const response = await generate(prompt, systemPrompt, 0.3, model, apiKeys, 'continuity-extraction')
    if (!response || !response.trim()) return []

    return response
      .split('\n')
      .map(t => t.trim())
      .filter(t => t.length > 10 && t.length < 200)
      .slice(0, 3)
  } catch (err) {
    return []
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  PIPELINE STEP FUNCTIONS
//  Each step is a named async function for readability and isolation.
// ════════════════════════════════════════════════════════════════════════════════

// ── STEP 1: ENCODE ──────────────────────────────────────────────────────────

/**
 * Decompose the incoming message into word-level vibrations and a composite
 * vector. Also tracks the query composite for entropy detection (narrative lock).
 *
 * @param {string} message - Raw user message text
 * @param {string} conversationId
 * @param {string} userId
 * @returns {Promise<{vibrations: Array<{word: string, vector: number[]}>, composite: number[]}>}
 */
async function encode(message, conversationId, userId) {
  const { decompose } = require('./embedder')
  const { trackQueryComposite } = require('./metabolism')

  const { vibrations, composite } = await decompose(message)

  // Fire-and-forget: track for entropy/narrative-lock detection
  trackQueryComposite(conversationId, composite, userId).catch(() => {})

  return { vibrations, composite }
}

// ── STEP 2: HUM ─────────────────────────────────────────────────────────────

/**
 * Fetch the horn's background vibration — the superfluid's resting state.
 * Returns the decayed hum vector, phase, intensity, and decay factor,
 * or null if no hum exists yet (first message in the conversation).
 *
 * @param {string} conversationId
 * @param {string} userId
 * @returns {Promise<{vector: number[], phase: number, intensity: number, decayFactor: number}|null>}
 */
async function fetchHum(conversationId, userId) {
  const { getCurrentHum } = require('./hum')
  try {
    return await getCurrentHum(conversationId, userId)
  } catch (e) {
    return null
  }
}

// ── STEP 3: RESONATE (Double Horn) ──────────────────────────────────────────

/**
 * Search the memory field using double horn topology.
 *
 * This step:
 *   1. Fetches memory candidates via vector search (with in-app fallback)
 *   2. Fetches active expectations and circulation state in parallel
 *   3. Runs the full resonance pipeline (horn positioning, drag, slicing)
 *   4. Reconsolidates accessed memories (vector blending, drift, confidence decay)
 *   5. Detects active contradictions among resonant memories
 *
 * @param {string} userId
 * @param {string} conversationId
 * @param {Array} vibrations - Word-level vibration vectors
 * @param {number[]} composite - Message composite vector
 * @param {Object} cfg - Pipeline configuration
 * @param {number[]|null} humVector - Current hum vector or null
 * @returns {Promise<{resonant: Array, sliceData: Object, contestedIds: Set, totalCount: number}>}
 */
async function resonate(userId, conversationId, vibrations, composite, cfg, humVector) {
  const { runResonancePipelineFromCandidates } = require('./resonance')
  const { getCirculationState } = require('./expectation')
  const { getActiveContradictions } = require('./metabolism')
  const { reconsolidate } = require('./reconsolidation')

  // Fetch candidates, expectations, and circulation in parallel
  const [fetchResult, activeExpectations, circulationState] = await Promise.all([
    fetchCandidates(userId, conversationId, composite, cfg),
    Expectation.find({ userId, status: 'active' }).lean(),
    getCirculationState(conversationId, userId)
  ])

  const { candidates, recentMemories, maxAgeMs, totalCount } = fetchResult
  const confirmedPaths = circulationState?.confirmedPaths || []

  // Run the double horn resonance pipeline
  const { resonant, sliceData } = runResonancePipelineFromCandidates(
    vibrations, composite, candidates, recentMemories, maxAgeMs,
    cfg, humVector, activeExpectations, confirmedPaths
  )

  // Reconsolidate retrieved memories (vector blending, drift, confidence decay)
  if (totalCount > 0) {
    const accessedMemories = resonant.filter(m => m._id && m.drag > 0)
    if (accessedMemories.length > 0) {
      const provisionalDissonance = 1 - (
        resonant.reduce((s, m) => s + (m.resonance || 0), 0) / resonant.length
      )
      await reconsolidate(accessedMemories, composite, provisionalDissonance)
    }
  }

  // Detect active contradictions among resonant memories
  let contestedIds = new Set()
  if (resonant.length > 0) {
    const resonantIds = resonant.filter(m => m._id).map(m => m._id)
    contestedIds = await getActiveContradictions(conversationId, resonantIds, userId)
  }

  return { resonant, sliceData, contestedIds, totalCount }
}

// ── STEP 4: ANTICIPATE ──────────────────────────────────────────────────────

/**
 * Resonate the incoming message against active expectations (future horn).
 * Confirms expectations that match and surprises those that diverge.
 *
 * @param {string} conversationId
 * @param {number[]} composite - Message composite vector
 * @param {Array} vibrations - Word-level vibration vectors
 * @param {Object} cfg - Pipeline configuration
 * @param {string} userId
 * @param {string} message - Raw message text (for confirmation/surprise logging)
 * @returns {Promise<{confirmed: Array, surprised: Array, active: Array}>}
 */
async function anticipate(conversationId, composite, vibrations, cfg, userId, message) {
  const {
    resonateExpectations, confirmExpectation, surpriseExpectation
  } = require('./expectation')

  const result = { confirmed: [], surprised: [], active: [] }

  try {
    const expResult = await resonateExpectations(conversationId, composite, vibrations, cfg, userId)
    result.confirmed = expResult.confirmed || []
    result.surprised = expResult.surprised || []
    result.active = expResult.active || []

    // Process confirmations
    for (const exp of result.confirmed) {
      await confirmExpectation(exp, message)
    }

    // Process surprises
    for (const exp of result.surprised) {
      await surpriseExpectation(exp, message, composite)
    }
  } catch (err) {
    // Non-critical: anticipation errors don't block the pipeline
  }

  return result
}

// ── STEP 5: MEASURE ─────────────────────────────────────────────────────────

/**
 * Compute dissonance from the resonance gap.
 * Dissonance = 1 − avgResonance. High dissonance means new territory;
 * low dissonance means the message is deeply familiar.
 *
 * @param {Array} resonant - Resonant memories with resonance scores
 * @returns {{avgResonance: number, dissonance: number}}
 */
function measure(resonant) {
  const avgResonance = resonant.length > 0
    ? resonant.reduce((sum, m) => sum + (m.resonance || 0), 0) / resonant.length
    : 0
  const dissonance = resonant.length > 0 ? 1 - avgResonance : 1
  return { avgResonance, dissonance }
}

// ── STEP 6: CONTINUITY + STATE ──────────────────────────────────────────────

/**
 * Load conversation continuity (unfinished thoughts, note-to-self) and the
 * agent's evolving state (personality, dynamic values, manifesto source).
 * If model/apiKeys are provided, persists them to AgentState for autonomous use.
 *
 * If the conversation has a projectRoot and no file memories exist yet,
 * triggers a lazy file sync (first chat in a project conversation).
 *
 * @param {string} conversationId
 * @param {string|null} personality - Personality preset id
 * @param {string} userId
 * @param {string|null} model - LLM model spec to persist
 * @param {Object} apiKeys - API keys to persist
 * @param {string|null} [projectRoot=null] - Project root for new conversations
 * @returns {Promise<{continuityState: Object|null, agentState: Object}>}
 */
async function loadContinuityAndState(conversationId, personality, userId, model, apiKeys, projectRoot = null) {
  const { loadOrCreateState } = require('./agentState')

  const continuityState = await ConversationState.findOne({ userId, conversationId }).lean()
  const agentState = await loadOrCreateState(userId, personality)

  // Persist model/apiKeys to AgentState (used by autonomous thoughts later)
  if (model || apiKeys?.geminiApiKey || apiKeys?.moonshotApiKey) {
    const update = {}
    if (model) update.defaultModel = model
    if (apiKeys?.geminiApiKey || apiKeys?.moonshotApiKey) {
      update.defaultApiKeys = { ...(agentState.defaultApiKeys || {}) }
      if (apiKeys.geminiApiKey) update.defaultApiKeys.geminiApiKey = apiKeys.geminiApiKey
      if (apiKeys.moonshotApiKey) update.defaultApiKeys.moonshotApiKey = apiKeys.moonshotApiKey
    }
    await AgentState.findOneAndUpdate({ userId }, { $set: update })
    Object.assign(agentState, update)
  }

  // Background file sync — non-blocking so the first chat message isn't delayed.
  // Files will be available for resonance by the second message.
  const root = projectRoot || process.env.PROJECT_ROOT
  if (root) {
    const fileCount = await Memory.countDocuments({ role: 'file', userId, conversationId })
    if (fileCount === 0) {
      const { syncProjectFiles } = require('./fileSync')
      syncProjectFiles(root, userId, conversationId).catch(err => {
        console.error('  [Pipeline] Background file sync failed:', err.message)
      })
    }
  }

  return { continuityState, agentState }
}

// ── STEP 7: COMPOSE ─────────────────────────────────────────────────────────

/**
 * Build the full system prompt by concatenating all context layers:
 *   1. Base system prompt (coding assistant identity or personality override)
 *   2. Manifesto from formatManifesto(agentState)
 *   3. Current time (so the AI can reason about memory ages)
 *   4. Continuity block (unfinished thoughts, note-to-self, extracted threads)
 *   5. Entropy injection (if narrative lock detected, inject random distant memories)
 *   6. Memory block (formatted resonant memories with tiers, ages, relevance)
 *   7. Hum prompt (background vibration state)
 *   8. Expectations prompt (confirmed, surprised, active predictions)
 *   9. Project file context (directory tree + semantically matched files)
 *  10. Cross-project lessons (global lesson pool, scored by similarity)
 *
 * Also computes the temperature based on dissonance and agent state:
 *   stateModulator = energy × 0.3 + (1 − guardedness) × 0.2
 *   temperature = clamp(0.3 + dissonance × 0.5 + stateModulator × 0.3, 0.2, 1.0)
 *
 * @param {Object} ctx - All context needed for composition
 * @returns {Promise<{systemPrompt: string, temperature: number}>}
 */
async function compose({
  agentState, continuityState, resonant, sliceData, dissonance, cfg,
  contestedIds, humData, expectationResult, totalCount, message,
  composite, conversationId, userId, model, apiKeys
}) {
  const { formatManifesto } = require('./agentState')
  const { formatHumPrompt, getHumWords } = require('./hum')
  const { formatExpectationsPrompt, getPredictiveAccuracy } = require('./expectation')
  const { injectEntropy } = require('./metabolism')
  const { getPersonality } = require('../config/personalities')
  const { getProjectTree, searchFileMemories } = require('./fileSync')

  const isRaw = agentState.personality === 'raw'
  const isMemoryOnly = getPersonality(agentState.personality)?.memoryOnly === true
  const personalityPreset = getPersonality(agentState.personality)

  // ── 1. Base system prompt ──
  let systemPrompt = isRaw
    ? 'You are a helpful assistant.'
    : isMemoryOnly
      ? 'You are having a conversation.'
      : (personalityPreset?.systemPromptOverride || SYSTEM_PROMPT_BASE)

  // ── 2. Manifesto (skip for raw and memoryOnly) ──
  if (!isRaw && !isMemoryOnly) {
    systemPrompt += formatManifesto(agentState)
  }

  // ── 3. Current time ──
  if (!isRaw) {
    systemPrompt += `\n\nCurrent time: ${new Date().toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: true
    })}`
  }

  // ── 4–8. Context layers (skip for raw mode) ──
  if (!isRaw) {
    // ── 4. Continuity block ──
    const continuityThreads = await extractContinuityThreads(resonant, model, apiKeys)
    if (continuityState?.unfinishedThoughts || continuityState?.noteToSelf || continuityThreads.length > 0) {
      let continuityBlock = '\n\n--- CONTINUITY ---'
      if (continuityState?.unfinishedThoughts) {
        continuityBlock += `\nLast time you left off with: ${continuityState.unfinishedThoughts}`
      }
      if (continuityState?.noteToSelf) {
        continuityBlock += `\nNote to self: ${continuityState.noteToSelf}`
      }
      if (continuityThreads.length > 0) {
        continuityBlock += `\n\nThreads from past conversations that resonate:\n${continuityThreads.map((t, i) => `${i + 1}. ${t}`).join('\n')}`
      }
      continuityBlock += '\n--- END CONTINUITY ---'
      systemPrompt += continuityBlock
    }

    // ── 5. Entropy injection (narrative lock breaker) ──
    if (agentState.entropyInjectionNeeded && totalCount > 10) {
      try {
        const injected = await injectEntropy(conversationId, null, resonant, message, userId)
        if (injected.length > 0) {
          resonant.push(...injected)
        }
      } catch (entropyErr) {
        // Non-critical: entropy injection is a bonus, not a requirement
      }
    }

    // ── 6. Memory block ──
    if (resonant.length > 0 && resonant[0].drag > 0) {
      systemPrompt += formatMemoriesPrompt(resonant, sliceData, dissonance, cfg, contestedIds)
    }

    // ── 7. Hum prompt ──
    if (humData) {
      try {
        const humWords = await getHumWords(humData.vector, conversationId, userId)
        systemPrompt += formatHumPrompt(humData, humWords)
      } catch (humErr) {
        // Non-critical: hum adds context but isn't essential
      }
    }

    // ── 8. Expectations prompt ──
    if (
      expectationResult.confirmed.length > 0 ||
      expectationResult.surprised.length > 0 ||
      expectationResult.active.length > 0
    ) {
      try {
        const accuracy = await getPredictiveAccuracy(conversationId, userId)
        systemPrompt += formatExpectationsPrompt(
          expectationResult.confirmed,
          expectationResult.surprised,
          expectationResult.active,
          accuracy
        )
      } catch (expPromptErr) {
        // Non-critical
      }
    }

    // ── 9. Project file context ──
    const projectRoot = agentState.projectRoot
    if (projectRoot) {
      try {
        const tree = await getProjectTree(projectRoot, 2)
        if (tree) {
          systemPrompt += `\n\n--- PROJECT STRUCTURE ---\n${tree}\n--- END PROJECT ---`
        }

        // Search file memories for content relevant to the current message
        if (composite && composite.length > 0) {
          const fileMatches = await searchFileMemories(composite, userId, conversationId, 3)
          if (fileMatches.length > 0) {
            const fileBlocks = fileMatches.map((f, i) => {
              const content = f.text.replace(/^\[.*?\]\n/, '')
              const preview = content.slice(0, 2000)
              const truncated = content.length > 2000 ? '\n... (truncated)' : ''
              return `${i + 1}. [${f.filePath}] (similarity: ${f.similarity.toFixed(2)})\n${preview}${truncated}`
            }).join('\n\n')

            systemPrompt += `\n\n--- RELEVANT FILES ---\nThese files from the project are semantically relevant to the current message:\n\n${fileBlocks}\n--- END FILES ---`
          }
        }
      } catch (fileErr) {
        // Non-critical: file context is a bonus, not a requirement
      }
    }

    // ── 10. Cross-project lessons ──
    if (composite && composite.length > 0) {
      try {
        const { GLOBAL_LESSONS_USER, GLOBAL_LESSONS_CONVERSATION } = require('./lessons')
        const globalLessons = await Memory.find({
          role: 'lesson',
          userId: GLOBAL_LESSONS_USER,
          conversationId: GLOBAL_LESSONS_CONVERSATION
        }).select('text composite').lean()

        if (globalLessons.length > 0) {
          const { cosineSimilarity } = require('./similarity')
          const scored = globalLessons
            .filter(l => l.composite && l.composite.length > 0)
            .map(l => ({ text: l.text, sim: cosineSimilarity(composite, l.composite) }))
            .filter(l => l.sim > 0.3)
            .sort((a, b) => b.sim - a.sim)
            .slice(0, 3)

          if (scored.length > 0) {
            const lessonBlock = scored
              .map((l, i) => `${i + 1}. ${l.text}`)
              .join('\n')

            systemPrompt += `\n\n--- CROSS-PROJECT LESSONS ---\nLessons learned from other projects that may be relevant:\n${lessonBlock}\n--- END LESSONS ---`
          }
        }
      } catch (lessonErr) {
        // Non-critical: cross-project lessons are a bonus
      }
    }
  }

  // ── Temperature computation ──
  // Low energy / high guardedness → lower temperature (more predictable)
  // High dissonance → higher temperature (more exploratory)
  const stateModulator = (isRaw || isMemoryOnly)
    ? 0.25
    : (agentState.dynamic.energy * 0.3) + ((1 - agentState.dynamic.guardedness) * 0.2)
  const temperature = Math.min(1.0, Math.max(0.2,
    0.3 + (dissonance * 0.5) + stateModulator * 0.3
  ))

  return { systemPrompt, temperature }
}

// ── STEP 9: REMEMBER ────────────────────────────────────────────────────────

/**
 * Store user and AI memories, update the hum, detect contradictions,
 * and update the local density map.
 *
 * Memory creation uses fresh confidence vectors (1.0 initial, full entropy budget).
 * Hum updates are serialized (await each) to avoid race conditions.
 * Contradiction detection is non-critical and wrapped in try/catch.
 *
 * @param {Object} ctx - All context needed for memory storage
 * @returns {Promise<{userMemory: Object, aiMemory: Object, aiComposite: number[], aiVibrations: Array}>}
 */
async function rememberStep({
  message, aiResponse, composite, vibrations, dissonance,
  userId, conversationId, resonant
}) {
  const { decompose } = require('./embedder')
  const { updateHum } = require('./hum')
  const { detectContradictions } = require('./metabolism')

  const freshConfidence = {
    initial: 1.0, current: 1.0, decayedAt: null,
    revisionCount: 0, entropyBudget: 1.0
  }

  // Store user memory
  const userMemory = await Memory.create({
    text: message, role: 'user', composite, vibrations, dissonance,
    userId, conversationId, confidence: freshConfidence
  })

  // Decompose AI response and store AI memory
  const aiDecomposition = await decompose(aiResponse)
  const aiMemory = await Memory.create({
    text: aiResponse, role: 'ai',
    composite: aiDecomposition.composite,
    vibrations: aiDecomposition.vibrations,
    dissonance, userId, conversationId,
    confidence: { ...freshConfidence }
  })

  // Update density map for neighboring memories
  await updateDensityMap(userMemory, userId, conversationId)

  // Perturb the hum with both composites (serialized to avoid race)
  try {
    await updateHum(conversationId, composite, userId)
    await updateHum(conversationId, aiDecomposition.composite, userId)
  } catch (e) {
    // Non-critical: hum update failure doesn't invalidate the memory
  }

  // Detect contradictions between new memory and resonant memories
  if (resonant.length > 0) {
    try {
      await detectContradictions(conversationId, userMemory, resonant, userId)
    } catch (contraErr) {
      // Non-critical: contradictions will be detected on next retrieval
    }
  }

  return {
    userMemory,
    aiMemory,
    aiComposite: aiDecomposition.composite,
    aiVibrations: aiDecomposition.vibrations
  }
}

// ── STEP 10a: REFLECT + PROJECT ─────────────────────────────────────────────

/**
 * Reflect on the conversation and project future expectations.
 * Saves unfinished thoughts to ConversationState and stores new expectations.
 * This runs BEFORE the done event so results can be included in the meta.
 *
 * @param {Object} ctx - All context needed for reflection
 * @returns {Promise<{unfinishedThought: string|null, newExpectations: string[]}>}
 */
async function reflect({
  conversationId, message, aiResponse, resonant, agentState,
  model, apiKeys, userId
}) {
  const { reflectAndProject, storeExpectations } = require('./expectation')
  const { setRecordingContext } = require('./generate')

  const isRaw = agentState.personality === 'raw'

  let unfinishedThought = null
  let newExpectations = []

  try {
    setRecordingContext({ conversationId, caller: 'chat' })
    const rpResult = await reflectAndProject(
      conversationId, message, aiResponse, resonant,
      agentState, model, apiKeys, userId
    )

    // Save unfinished thought for continuity on next turn
    if (rpResult.unfinishedThought) {
      unfinishedThought = rpResult.unfinishedThought
      await ConversationState.findOneAndUpdate(
        { userId, conversationId },
        { $set: { unfinishedThoughts: unfinishedThought, updatedAt: new Date() } },
        { upsert: true }
      )
    }

    // Store projected expectations (skip for raw mode)
    if (!isRaw && rpResult.expectations.length > 0) {
      const stored = await storeExpectations(conversationId, rpResult.expectations, userId)
      newExpectations = stored.map(e => e.text?.slice(0, 100)).filter(Boolean)
    }
  } catch (rpErr) {
    // Non-critical: reflection failure doesn't invalidate the response
  }

  return { unfinishedThought, newExpectations }
}

// ── STEP 10b: EVOLVE ────────────────────────────────────────────────────────

/**
 * Update agent state, mark interaction for autonomy timing, and reconstruct
 * heavily-accessed drifted memories in the background.
 * This runs AFTER the done event (fire-and-forget in streaming mode).
 *
 * @param {Object} ctx - All context needed for evolution
 */
async function evolve({
  agentState, message, aiResponse, dissonance, model, apiKeys,
  conversationId, userId, resonant
}) {
  const { updateAgentState } = require('./agentState')
  const { markInteraction } = require('./autonomy')
  const { reconstructMemories } = require('./reconsolidation')

  // Update the agent's dynamic inner state (mood, trust, energy, etc.)
  await updateAgentState(agentState, message, aiResponse, dissonance, model, apiKeys)

  // Mark interaction so autonomy drives know we're active
  await markInteraction(conversationId, userId)

  // Background: reconstruct heavily-accessed drifted memories
  const accessedForRecon = resonant.filter(m => m._id && m.drag > 0)
  if (accessedForRecon.length > 0) {
    reconstructMemories(conversationId, accessedForRecon, message.slice(0, 100), model, apiKeys)
      .catch(() => {})
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  Gesture Selection
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Compute a gesture based on agent state and response content.
 * Gestures are subtle non-verbal cues communicated to the frontend.
 *
 * @param {Object} agentState - Current agent state
 * @param {string} aiResponse - The AI's response text
 * @param {number} dissonance - Current dissonance level
 * @returns {string|null} Gesture name or null
 */
function selectGesture(agentState, aiResponse, dissonance) {
  const trust = agentState.dynamic?.trust || 0
  const mood = agentState.dynamic?.mood || ''
  const txt = (aiResponse || '').toLowerCase()

  if (trust >= 0.58 && trust <= 0.65 && agentState.turnCount > 5) return 'handshake'
  if (trust > 0.75 && (txt.includes('thank') || txt.includes('mean a lot') || txt.includes('glad'))) return 'hug'
  if (mood.includes('curious') && Math.random() < 0.25) return 'head-tilt'
  if (dissonance < 0.3 && trust > 0.4 && Math.random() < 0.15) return 'nod'
  return null
}

// ════════════════════════════════════════════════════════════════════════════════
//  MAIN PIPELINE — Non-Streaming
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Run the full chat pipeline (non-streaming).
 *
 * Acquires a per-conversation lock, executes all 10 pipeline steps sequentially,
 * and returns the complete result. The lock is always released in the finally block.
 *
 * @param {string} message - User's input message
 * @param {string} conversationId - Conversation identifier (e.g. "default", "project-alpha")
 * @param {Object} [options={}] - Pipeline options
 * @param {string} [options.personality] - Personality preset id (e.g. "architect", "raw")
 * @param {string} [options.model] - LLM model spec (e.g. "gemini:gemini-2.0-flash", "moonshot:kimi-k2.5")
 * @param {Object} [options.apiKeys] - API keys { geminiApiKey, moonshotApiKey }
 * @param {string} [options.userId='anonymous'] - User identifier
 * @param {Object} [options.memorySettings] - Override sacred defaults for this call
 * @returns {Promise<{text: string, messageId: *, dissonance: number, temperature: number, memoryDepth: number, topMatches: Array}>}
 * @throws {Error} If message is empty or a critical pipeline step fails
 */
async function runChatPipeline(message, conversationId, options = {}) {
  const {
    personality,
    model,
    apiKeys = {},
    userId = 'anonymous',
    memorySettings
  } = options

  if (!message || !message.trim()) {
    throw new Error('Message is required')
  }

  const cfg = parseSettings(memorySettings)
  const unlock = await acquireLock(userId + ':' + conversationId)

  try {
    // Set recording context for LLM call tagging
    const { setRecordingContext } = require('./generate')
    setRecordingContext({ conversationId, caller: 'chat' })

    // ── STEP 1: ENCODE ─────────────────────────────────────────────
    const { vibrations, composite } = await encode(message, conversationId, userId)

    // ── STEP 2: HUM ────────────────────────────────────────────────
    const humData = await fetchHum(conversationId, userId)
    const humVector = humData?.vector || null

    // ── STEP 3: RESONATE (Double Horn) ─────────────────────────────
    const { resonant, sliceData, contestedIds, totalCount } = await resonate(
      userId, conversationId, vibrations, composite, cfg, humVector
    )

    // ── STEP 4: ANTICIPATE ─────────────────────────────────────────
    const expectationResult = await anticipate(
      conversationId, composite, vibrations, cfg, userId, message
    )

    // ── STEP 5: MEASURE ────────────────────────────────────────────
    const { dissonance } = measure(resonant)

    // ── STEP 6: CONTINUITY + STATE ─────────────────────────────────
    const { continuityState, agentState } = await loadContinuityAndState(
      conversationId, personality, userId, model, apiKeys
    )

    // ── STEP 7: COMPOSE ────────────────────────────────────────────
    const { systemPrompt, temperature } = await compose({
      agentState, continuityState, resonant, sliceData, dissonance, cfg,
      contestedIds, humData, expectationResult, totalCount, message,
      composite, conversationId, userId, model, apiKeys
    })

    // ── STEP 8: GENERATE ───────────────────────────────────────────
    const { generate } = require('./generate')
    const aiResponse = await generate(
      message, systemPrompt, temperature, model, apiKeys, 'chat'
    )

    // ── STEP 9: REMEMBER ───────────────────────────────────────────
    const { aiMemory } = await rememberStep({
      message, aiResponse, composite, vibrations, dissonance,
      userId, conversationId, resonant
    })

    // ── STEP 10a: REFLECT ──────────────────────────────────────────
    await reflect({
      conversationId, message, aiResponse, resonant, agentState,
      model, apiKeys, userId
    })

    // ── STEP 10b: EVOLVE ───────────────────────────────────────────
    await evolve({
      agentState, message, aiResponse, dissonance, model, apiKeys,
      conversationId, userId, resonant
    })

    // ── RESULT ─────────────────────────────────────────────────────
    return {
      text: aiResponse,
      messageId: aiMemory._id,
      dissonance: parseFloat(dissonance.toFixed(3)),
      temperature: parseFloat(temperature.toFixed(2)),
      memoryDepth: resonant.length,
      topMatches: resonant.slice(0, 3).map(m => ({
        text: (m.text || '').slice(0, 100),
        score: parseFloat((m.drag || 0).toFixed(3))
      }))
    }
  } finally {
    unlock()
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  MAIN PIPELINE — Streaming
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Run the full chat pipeline with streaming via SSE events.
 *
 * Emits events through the sendEvent callback as the pipeline progresses:
 *   - step  → { step: string, detail: string }  (pipeline progress)
 *   - token → { text: string }                   (streamed LLM tokens)
 *   - thinking → { text: string }                (LLM thinking/reasoning tokens)
 *   - done  → { text, messageId, meta }          (pipeline complete)
 *   - error → { message: string }                (pipeline failure)
 *
 * The done event includes full metadata: dissonance, temperature, memoryDepth,
 * topMatches, unfinishedThought, expectations, and gesture.
 *
 * After the done event, the EVOLVE step runs in the background (fire-and-forget)
 * with the conversation lock held until it completes.
 *
 * @param {string} message - User's input message
 * @param {string} conversationId - Conversation identifier
 * @param {Object} [options={}] - Pipeline options
 * @param {string} [options.personality] - Personality preset id
 * @param {string} [options.model] - LLM model spec
 * @param {Object} [options.apiKeys] - API keys { geminiApiKey, moonshotApiKey }
 * @param {string} [options.userId='anonymous'] - User identifier
 * @param {Object} [options.memorySettings] - Override sacred defaults
 * @param {Function} sendEvent - SSE event callback: (event: string, data: Object) => void
 */
async function runChatPipelineStream(message, conversationId, options = {}, sendEvent) {
  const {
    personality,
    model,
    apiKeys = {},
    userId = 'anonymous',
    memorySettings
  } = options

  if (!message || !message.trim()) {
    sendEvent('error', { message: 'Message is required' })
    return
  }

  const cfg = parseSettings(memorySettings)
  const unlock = await acquireLock(userId + ':' + conversationId)

  try {
    // Set recording context for LLM call tagging
    const { setRecordingContext } = require('./generate')
    setRecordingContext({ conversationId, caller: 'chat-stream' })

    // ── STEP 1: ENCODE ─────────────────────────────────────────────
    sendEvent('step', { step: 'encode', detail: 'Decomposing into word vibrations...' })
    const { vibrations, composite } = await encode(message, conversationId, userId)
    sendEvent('step', {
      step: 'encode',
      detail: `${vibrations.length} vibrations: ${vibrations.map(v => v.word).join(', ')}`
    })

    // ── STEP 2: HUM ────────────────────────────────────────────────
    const humData = await fetchHum(conversationId, userId)
    const humVector = humData?.vector || null
    if (humData) {
      sendEvent('step', {
        step: 'hum',
        detail: `Hum intensity: ${(humData.intensity * 100).toFixed(0)}%, decay: ${humData.decayFactor.toFixed(3)}`
      })
    }

    // ── STEP 3: RESONATE (Double Horn) ─────────────────────────────
    sendEvent('step', { step: 'resonate', detail: 'Searching memory field with double horn...' })
    const { resonant, sliceData, contestedIds, totalCount } = await resonate(
      userId, conversationId, vibrations, composite, cfg, humVector
    )

    if (totalCount > 0) {
      const tierCounts = { 'short-term': 0, 'medium-term': 0, 'archived': 0 }
      resonant.forEach(m => { if (m.tier) tierCounts[m.tier]++ })
      sendEvent('step', {
        step: 'resonate',
        detail: `${totalCount} memories, top drag: ${resonant[0]?.drag?.toFixed(3) || 0}, ` +
                `${tierCounts['short-term']} vivid / ${tierCounts['medium-term']} fading / ${tierCounts['archived']} distant`
      })
    } else {
      sendEvent('step', { step: 'resonate', detail: 'Memory field is empty (first message)' })
    }

    if (contestedIds.size > 0) {
      sendEvent('step', {
        step: 'resonate',
        detail: `${contestedIds.size} memories in active contradiction`
      })
    }

    // ── STEP 4: ANTICIPATE ─────────────────────────────────────────
    sendEvent('step', { step: 'anticipate', detail: 'Checking expectations against reality...' })
    const expectationResult = await anticipate(
      conversationId, composite, vibrations, cfg, userId, message
    )

    const expSummary = []
    if (expectationResult.confirmed.length > 0) expSummary.push(`${expectationResult.confirmed.length} confirmed`)
    if (expectationResult.surprised.length > 0) expSummary.push(`${expectationResult.surprised.length} surprised`)
    if (expectationResult.active.length > 0) expSummary.push(`${expectationResult.active.length} active`)
    sendEvent('step', {
      step: 'anticipate',
      detail: expSummary.length > 0 ? expSummary.join(', ') : 'No active expectations'
    })

    // ── STEP 5: MEASURE ────────────────────────────────────────────
    const { dissonance } = measure(resonant)
    sendEvent('step', { step: 'measure', detail: `Dissonance: ${dissonance.toFixed(3)}` })

    // ── STEP 6: CONTINUITY + STATE ─────────────────────────────────
    const { continuityState, agentState } = await loadContinuityAndState(
      conversationId, personality, userId, model, apiKeys
    )
    sendEvent('step', {
      step: 'continuity',
      detail: `Turn ${agentState.turnCount}, mood: ${agentState.dynamic.mood}, trust: ${agentState.dynamic.trust.toFixed(2)}`
    })

    // ── STEP 7: COMPOSE ────────────────────────────────────────────
    sendEvent('step', { step: 'compose', detail: 'Building system prompt...' })
    const { systemPrompt, temperature } = await compose({
      agentState, continuityState, resonant, sliceData, dissonance, cfg,
      contestedIds, humData, expectationResult, totalCount, message,
      composite, conversationId, userId, model, apiKeys
    })

    // ── STEP 8: GENERATE (streaming) ───────────────────────────────
    sendEvent('step', {
      step: 'generate',
      detail: `Calling LLM (temp: ${temperature.toFixed(2)}, model: ${model || 'default'})...`
    })

    const { generateStream } = require('./generate')
    const aiResponse = await generateStream(
      message, systemPrompt, temperature, model, apiKeys,
      (type, text) => {
        if (type === 'thinking') {
          sendEvent('thinking', { text })
        } else {
          sendEvent('token', { text })
        }
      },
      'chat-stream'
    )

    // ── STEP 9: REMEMBER ───────────────────────────────────────────
    sendEvent('step', { step: 'remember', detail: 'Storing memories...' })
    const { aiMemory } = await rememberStep({
      message, aiResponse, composite, vibrations, dissonance,
      userId, conversationId, resonant
    })

    // ── STEP 10a: REFLECT (before done, to include in meta) ────────
    sendEvent('step', { step: 'reflect', detail: 'Reflecting and projecting...' })
    const { unfinishedThought, newExpectations } = await reflect({
      conversationId, message, aiResponse, resonant, agentState,
      model, apiKeys, userId
    })

    if (newExpectations.length > 0) {
      sendEvent('step', {
        step: 'reflect',
        detail: `${newExpectations.length} expectations projected`
      })
    }

    // ── Gesture selection (uses pre-evolve state) ──────────────────
    const gesture = selectGesture(agentState, aiResponse, dissonance)

    // ── DONE — send immediately so the user can interact ───────────
    sendEvent('step', { step: 'evolve', detail: 'Updating inner state...' })
    sendEvent('done', {
      text: aiResponse,
      messageId: aiMemory._id,
      meta: {
        dissonance: parseFloat(dissonance.toFixed(3)),
        temperature: parseFloat(temperature.toFixed(2)),
        memoryDepth: resonant.length,
        topMatches: resonant.slice(0, 3).map(m => ({
          text: (m.text || '').slice(0, 60),
          drag: parseFloat((m.drag || 0).toFixed(3)),
          frequencies: m.frequenciesMatched || 0
        })),
        unfinishedThought,
        expectations: newExpectations.slice(0, 3),
        gesture
      }
    })

    // ── STEP 10b: EVOLVE — fire-and-forget (keeps lock until done) ─
    ;(async () => {
      try {
        await evolve({
          agentState, message, aiResponse, dissonance, model, apiKeys,
          conversationId, userId, resonant
        })
      } catch (err) {
        // Evolve failure is non-critical — the response is already sent
      } finally {
        unlock()
      }
    })()

  } catch (error) {
    try {
      sendEvent('error', { message: 'Something went wrong. Please try again.' })
    } catch (e) {
      // Caller gone — nothing to do
    }
    unlock()
  }
}

// ════════════════════════════════════════════════════════════════════════════════
//  Exports
// ════════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Main pipeline functions
  runChatPipeline,
  runChatPipelineStream,

  // Formatting helper (reusable by compare endpoints, etc.)
  formatMemoriesPrompt,

  // Configuration (reusable by other modules)
  parseSettings,
  DEFAULTS,
  SYSTEM_PROMPT_BASE,
  humanizeAge
}
