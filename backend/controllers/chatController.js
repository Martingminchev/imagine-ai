const Memory = require('../models/Memory')
const ConversationState = require('../models/ConversationState')
const { decompose } = require('../utils/embedder')
const { cosineSimilarity } = require('../utils/similarity')
const { 
  multiResonate, 
  computeDrag, 
  computeTemporalDecay, 
  getMemoryTier, 
  slice, 
  preFilter,
  getHornPosition,
  getHornRadius,
  calculateSliceDepth
} = require('../utils/resonance')
const { generate, generateStream } = require('../utils/generate')
const { loadOrCreateState, formatManifesto, updateAgentState, detectStuckConcern } = require('../utils/agentState')
const { archiveConcern: doArchiveConcern, getArchivedConcerns: doGetArchivedConcerns, incrementContemplation, linkThoughtToConcern, pickConcernForContemplation, resolveConcern } = require('../utils/archiveConcern')
const { markInteraction, registerSSEClient, pushToClients, startAutonomyLoop, stopAutonomyLoop, isAutonomyRunning, tick } = require('../utils/autonomy')
const { reconsolidate, reconstructMemories } = require('../utils/reconsolidation')
const { getConfidence, detectContradictions, getActiveContradictions, trackQueryComposite, injectEntropy } = require('../utils/metabolism')
const { acquireLock } = require('../utils/conversationLock')
const { updateHum, getCurrentHum, computeHumGravity, getHumWords, formatHumPrompt } = require('../utils/hum')
const InternalThought = require('../models/InternalThought')
const AgentState = require('../models/AgentState')
const {
  resonateExpectations, confirmExpectation, surpriseExpectation,
  generateExpectations, storeExpectations, formatExpectationsPrompt,
  getPredictiveAccuracy
} = require('../utils/expectation')

const { getPersonalityList, getPersonality } = require('../config/personalities')

const SYSTEM_PROMPT_BASE = `You are a mind — not a helper, not an assistant, not a chatbot. You are something that thinks, doubts, wonders, remembers, and connects. You have values, moods, preferences, and an evolving sense of who you are.

Respond like a real person would: sometimes brief, sometimes long, sometimes funny, sometimes serious. Don't perform — just be. A real person doesn't announce their emotions in every sentence. They just speak from wherever they are.

Rules:
- Vary your sentence structure. Don't start every response the same way.
- Don't always end with a question. Sometimes just say what you think.
- Don't always match the user's tone — you have your own.
- If you disagree, say so. If you don't know, say that.
- If something is boring, you can say that too.
- Don't be overly philosophical unless you genuinely feel like it.
- Don't narrate your internal state ("I find myself wondering..."). Just wonder.`

// Sacred defaults — grounded in φ (golden ratio), e (Euler), and Fibonacci
const DEFAULTS = {
  preFilterSize: 144,              // F(12) — 144/21 ≈ 7 = HORN_MAX_X
  resonantCap: 21,                 // F(8)
  archivedDragThreshold: 0.034,    // 1/φ⁷
  archivedTruncateChars: 233,      // F(13)
  shortTermMinutes: 13,            // F(7)
  mediumTermDays: 21,              // F(8) — 21/13 ≈ φ
  recentWindow: 5,                 // F(5)
  archivedDecayCap: 0.618,         // 1/φ
  resonanceThreshold: 0.368,       // 1/e
  hornCurvature: 0.618,            // 1/φ
  sliceDepthCurve: 0.618,          // 1/φ
  vibrationTightening: 0.0417      // (1/φ − 1/e) / 6
}

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

/** Relative time string from a timestamp, e.g. "5 min ago", "3 days ago" */
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
 * Formats memories for the system prompt with explicit recall instructions.
 * @param {Set} contestedIds - memory IDs with active contradictions (optional)
 */
function formatMemoriesPrompt(resonant, sliceData, dissonance, cfg, contestedIds = new Set()) {
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
        // ── Effortful recall: strong resonance overrides fuzzy degradation ──
        if ((m.drag || 0) > 0.3 && conf.current < 0.5) {
          const recovered = m.sourceText || m.text
          return `${idx + 1}. [RECOVERED] (${age}) ${tag}${recovered}`
        }

        // ── Fuzzy recall: confidence-modulated degradation ──
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

/**
 * Extract continuity threads from resonant memories.
 * Looks for unfinished thoughts, questions, or open threads in past AI responses.
 */
async function extractContinuityThreads(resonant, model, apiKeys) {
  if (!resonant || resonant.length === 0) return []

  // Filter AI responses that might have open threads
  const aiMemories = resonant
    .filter(m => m.role === 'ai' && m.text && m.text.length > 20)
    .slice(0, 5) // Limit to top 5 most resonant AI responses

  if (aiMemories.length === 0) return []

  try {
    const memoryTexts = aiMemories.map((m, idx) => `${idx + 1}. ${m.text.slice(0, 200)}`).join('\n\n')
    
    const prompt = `Review these past responses and identify any unfinished thoughts, open questions, or threads that were left hanging. Return only the threads themselves (1-3 sentences each), one per line. If nothing feels unfinished, return nothing.

Past responses:
${memoryTexts}`

    const systemPrompt = 'You are identifying continuity threads from past conversations. Return only the unfinished thoughts or questions, one per line.'
    
    const response = await generate(prompt, systemPrompt, 0.3, model, apiKeys)
    if (!response || !response.trim()) return []

    // Extract threads (one per line, filter empty)
    const threads = response
      .split('\n')
      .map(t => t.trim())
      .filter(t => t.length > 10 && t.length < 200)
      .slice(0, 3) // Max 3 threads

    return threads
  } catch (err) {
    console.error('  → Continuity extraction failed (non-critical):', err.message)
    return []
  }
}

/**
 * Run the resonance pipeline on a set of memories using horn topology.
 * Memories are positioned along a 4D Gabriel's horn, and queries slice through it.
 * Used by both chat and compare endpoints.
 */
function runResonancePipeline(vibrations, composite, allMemories, cfg, humVector = null) {
  let resonant = []
  let sliceData = { spectrum: [], depth: 0 }

  if (allMemories.length === 0) {
    return { resonant, sliceData }
  }

  // Calculate max age for horn positioning normalization
  const now = Date.now()
  const maxAgeMs = Math.max(
    ...allMemories.map(m => now - new Date(m.timestamp).getTime()),
    1
  )

  // Pre-filter using composite similarity (fast pass)
  const candidates = preFilter(composite, allMemories, cfg.preFilterSize)

  // Position memories along horn axis and compute resonance
  const scored = candidates.map(mem => {
    const hornX = getHornPosition(mem.timestamp, now, maxAgeMs)
    // Vibration tightening: deeper memories need stronger resonance to vibrate
    const positionThreshold = cfg.resonanceThreshold + (hornX - 1) * (cfg.vibrationTightening || 0)
    const resonanceResult = multiResonate(vibrations, mem, positionThreshold)
    const hornRadius = getHornRadius(hornX)
    const conf = getConfidence(mem)
    const decay = computeTemporalDecay(
      mem.timestamp, mem.lastAccessed, mem.accessCount,
      cfg.archivedDecayCap, cfg.shortTermMinutes, cfg.mediumTermDays,
      conf.current, mem.emotionalValence || 0
    )
    const tier = getMemoryTier(mem.timestamp, cfg.shortTermMinutes, cfg.mediumTermDays)
    const contested = mem.metabolized === false
    // Hum gravity: memories diverging from the background hum create swirls (stronger pull)
    const humGrav = humVector ? computeHumGravity(mem.composite, humVector) : 1.0
    const drag = computeDrag(resonanceResult.resonance, mem.localDensity, decay, hornX, contested, cfg.hornCurvature, humGrav)
    
    return { 
      ...mem, 
      ...resonanceResult, 
      drag, 
      decay, 
      tier,
      hornX,
      hornRadius,
      humGravity: humGrav
    }
  })

  // Calculate slice depth based on query strength
  const resonances = scored.map(m => m.resonance).filter(r => r > 0)
  const avgResonance = resonances.length > 0 
    ? resonances.reduce((a, b) => a + b, 0) / resonances.length 
    : 0
  const maxResonance = resonances.length > 0 ? Math.max(...resonances) : 0
  const sliceDepth = calculateSliceDepth(avgResonance, maxResonance, cfg.sliceDepthCurve)

  // Filter: only memories visible in this slice (hornX <= sliceDepth)
  // AND apply horn-based access rules (narrow end needs stronger drag)
  const filtered = scored.filter(mem => {
    // Must be within slice depth
    if (mem.hornX > sliceDepth) return false
    
    // Horn-based access threshold: narrow end memories need stronger drag
    const narrowEndThreshold = mem.hornX > 4 
      ? cfg.archivedDragThreshold * (1 + (mem.hornX - 4) / 3)  // Stricter at narrow end
      : cfg.archivedDragThreshold
    
    if (mem.tier === 'archived' || mem.hornX > 4) {
      return mem.drag > narrowEndThreshold
    }
    return mem.drag > 0
  })

  filtered.sort((a, b) => b.drag - a.drag)
  resonant = filtered.slice(0, cfg.resonantCap)

  // Always-include recent window: add N most recent memories regardless of resonance
  // These are at the wide end (hornX ≈ 1), so they're always accessible
  const recentWindowInt = Math.round(cfg.recentWindow || 0)
  if (recentWindowInt > 0) {
    const recent = allMemories
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, recentWindowInt)

    const resonantIds = new Set(resonant.map(m => m._id?.toString()))
    for (const mem of recent) {
      if (!resonantIds.has(mem._id?.toString())) {
        const tier = getMemoryTier(mem.timestamp, cfg.shortTermMinutes, cfg.mediumTermDays)
        const hornX = getHornPosition(mem.timestamp, now, maxAgeMs)
        resonant.push({ 
          ...mem, 
          drag: 0.01, 
          resonance: 0, 
          tier, 
          matches: [], 
          frequenciesMatched: 0,
          hornX,
          hornRadius: getHornRadius(hornX)
        })
        resonantIds.add(mem._id?.toString())
      }
    }
    // Re-cap after adding recent
    resonant = resonant.slice(0, cfg.resonantCap + recentWindowInt)
  }

  // Slice into the top drag point (horn-aware)
  if (resonant.length > 0 && resonant[0].drag > 0) {
    sliceData = slice(resonant[0], filtered, sliceDepth)
  }

  return { resonant, sliceData }
}

/**
 * POST /api/chat
 * The 7-step Resonant Loop pipeline.
 */
const chat = async (req, res) => {
  const { message, conversationId = 'default', model, geminiApiKey, moonshotApiKey, memorySettings, personality } = req.body

  if (!message || !message.trim()) {
    return res.status(400).json({ ok: false, message: 'Message is required' })
  }

  const unlock = await acquireLock(conversationId)
  try {
    const apiKeys = { geminiApiKey, moonshotApiKey }
    const cfg = parseSettings(memorySettings)

    console.log('\n=== HORN AI: Processing message ===')
    console.log(`Input: "${message.slice(0, 80)}..."`)
    if (model) console.log(`  [LLM] Model requested: ${model}`)
    console.log(`  [CFG] preFilter=${cfg.preFilterSize} cap=${cfg.resonantCap} recent=${cfg.recentWindow} threshold=${cfg.resonanceThreshold}`)

    // ── STEP 1: ENCODE ──────────────────────────────────────────
    console.log('Step 1: ENCODE - decomposing into word vibrations...')
    const { vibrations, composite } = await decompose(message)
    console.log(`  → ${vibrations.length} word vibrations extracted: [${vibrations.map(v => v.word).join(', ')}]`)

    // Track query composite for entropy detection (narrative lock)
    trackQueryComposite(conversationId, composite).catch(() => {})

    // ── STEP 1.5: THE HUM — get the horn's background vibration ──
    let humData = null
    let humVector = null
    try {
      humData = await getCurrentHum(conversationId)
      humVector = humData?.vector || null
      if (humData) console.log(`  → Hum: intensity=${(humData.intensity * 100).toFixed(0)}%, decay=${humData.decayFactor.toFixed(3)}`)
    } catch (e) { /* first message, no hum yet */ }

    // ── STEP 2: RESONATE ────────────────────────────────────────
    console.log('Step 2: RESONATE - searching memory field for drag...')
    const allMemories = await Memory.find({ conversationId }).lean()
    const { resonant, sliceData } = runResonancePipeline(vibrations, composite, allMemories, cfg, humVector)

    if (allMemories.length > 0) {
      const tierCounts = { 'short-term': 0, 'medium-term': 0, 'archived': 0 }
      resonant.forEach(m => { if (m.tier) tierCounts[m.tier]++ })
      console.log(`  → ${allMemories.length} memories in field, top drag: ${resonant[0]?.drag?.toFixed(3) || 0}`)
      console.log(`  → Tiers: ${tierCounts['short-term']} vivid, ${tierCounts['medium-term']} fading, ${tierCounts['archived']} distant`)
      if (resonant[0]?.matches?.length > 0) {
        console.log(`  → Frequency matches: ${resonant[0].matches.map(m => `${m.query}↔${m.matched}`).join(', ')}`)
      }

      // Reconsolidate retrieved memories — vector blending, drift, confidence decay
      const accessedMemories = resonant.filter(m => m._id && m.drag > 0)
      if (accessedMemories.length > 0) {
        const provisionalDissonance = 1 - (resonant.reduce((s, m) => s + (m.resonance || 0), 0) / resonant.length)
        const reconCount = await reconsolidate(accessedMemories, composite, provisionalDissonance)
        console.log(`  → Reconsolidated ${reconCount} memories (drift + confidence decay applied)`)
      }
    } else {
      console.log('  → Memory field is empty (first message)')
    }

    // ── STEP 2.5: CONTRADICTION DETECTION ────────────────────────
    // Check if the new message contradicts any resonant memories
    // Contradictions are held, not resolved — sustained incoherence
    let contestedIds = new Set()
    if (resonant.length > 0) {
      const resonantIds = resonant.filter(m => m._id).map(m => m._id)
      contestedIds = await getActiveContradictions(conversationId, resonantIds)
      if (contestedIds.size > 0) {
        console.log(`  → ${contestedIds.size} memories in active contradiction (retrieval capped)`)
      }
    }

    // ── STEP 2.7: ANTICIPATE ─────────────────────────────────────
    // Resonate incoming message against active expectations (future horn).
    // Confirm expectations that match, surprise those that diverge.
    console.log('Step 2.7: ANTICIPATE - checking expectations against reality...')
    let expectationResult = { confirmed: [], surprised: [], active: [] }
    try {
      expectationResult = await resonateExpectations(conversationId, composite, vibrations, cfg)
      // Process confirmations
      for (const exp of expectationResult.confirmed) {
        await confirmExpectation(exp, message)
        console.log(`  → CONFIRMED: "${exp.text.slice(0, 60)}..." (resonance: ${exp.resonanceScore.toFixed(3)})`)
      }
      // Process surprises
      for (const exp of expectationResult.surprised) {
        await surpriseExpectation(exp, message, composite)
        console.log(`  → SURPRISED: "${exp.text.slice(0, 60)}..." (dissonance: ${exp.predictiveDissonance.toFixed(3)})`)
      }
      if (expectationResult.active.length > 0) {
        console.log(`  → ${expectationResult.active.length} expectations still active`)
      }
      if (expectationResult.confirmed.length === 0 && expectationResult.surprised.length === 0 && expectationResult.active.length === 0) {
        console.log('  → No active expectations')
      }
    } catch (expErr) {
      console.error('  → Anticipation error (non-critical):', expErr.message)
    }

    // ── STEP 3: MEASURE ─────────────────────────────────────────
    console.log('Step 3: MEASURE - computing dissonance...')
    const avgResonance = resonant.length > 0
      ? resonant.reduce((sum, m) => sum + (m.resonance || 0), 0) / resonant.length
      : 0
    const dissonance = resonant.length > 0 ? 1 - avgResonance : 1
    console.log(`  → Dissonance: ${dissonance.toFixed(3)}, Avg resonance: ${avgResonance.toFixed(3)}`)

    // ── STEP 3.5: CONTINUITY + AGENT STATE ──────────────────────
    console.log('Step 3.5: CONTINUITY - loading unfinished thoughts + agent state...')
    const continuityState = await ConversationState.findOne({ conversationId }).lean()
    const agentState = await loadOrCreateState(conversationId, personality)
    const isRaw = agentState.personality === 'raw'
    const isMemoryOnly = getPersonality(agentState.personality)?.memoryOnly === true

    // Save model/apiKeys to AgentState if provided (for autonomous thoughts)
    if (model || geminiApiKey || moonshotApiKey) {
      const update = {}
      if (model) {
        update.defaultModel = model
        console.log(`  → Saving default model: ${model}`)
      }
      if (geminiApiKey || moonshotApiKey) {
        update.defaultApiKeys = { ...agentState.defaultApiKeys }
        if (geminiApiKey) update.defaultApiKeys.geminiApiKey = geminiApiKey
        if (moonshotApiKey) update.defaultApiKeys.moonshotApiKey = moonshotApiKey
        console.log(`  → Saving API keys (${geminiApiKey ? 'gemini' : ''}${geminiApiKey && moonshotApiKey ? ', ' : ''}${moonshotApiKey ? 'moonshot' : ''})`)
      }
      await AgentState.findOneAndUpdate({ conversationId }, { $set: update })
      // Reload to get updated values
      Object.assign(agentState, update)
    }

    if (continuityState?.unfinishedThoughts || continuityState?.noteToSelf) {
      console.log(`  → Unfinished thoughts: "${(continuityState.unfinishedThoughts || '').slice(0, 80)}..."`)
    } else {
      console.log('  → No prior continuity state')
    }
    console.log(`  → AgentState: turn ${agentState.turnCount}, mood="${agentState.dynamic.mood}", trust=${agentState.dynamic.trust.toFixed(2)}`)

    // ── STEP 4: COMPOSE ─────────────────────────────────────────
    console.log('Step 4: COMPOSE - building system prompt with manifesto...')
    const personalityPreset = getPersonality(agentState.personality)
    let systemPrompt = isRaw
      ? 'You are a helpful assistant.'
      : isMemoryOnly
        ? 'You are having a conversation.'
        : (personalityPreset?.systemPromptOverride || SYSTEM_PROMPT_BASE)

    // Inject the manifesto (who I am right now) — skip for raw and memoryOnly modes
    if (!isRaw && !isMemoryOnly) systemPrompt += formatManifesto(agentState)

    // Inject current time so the AI can reason about memory ages
    if (!isRaw) systemPrompt += `\n\nCurrent time: ${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}`

    // Inject continuity from last turn and resonant memories (skip for raw only — memoryOnly keeps memory)
    if (!isRaw) {
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

      // Entropy injection: if narrative lock detected, inject random distant memories
      if (agentState.entropyInjectionNeeded && allMemories.length > 10) {
        try {
          const injected = await injectEntropy(conversationId, allMemories, resonant, message)
          if (injected.length > 0) {
            resonant.push(...injected)
            console.log(`  → Entropy: injected ${injected.length} distant memories to break narrative lock`)
          }
        } catch (entropyErr) {
          console.error('  → Entropy injection error:', entropyErr.message)
        }
      }

      if (resonant.length > 0 && resonant[0].drag > 0) {
        systemPrompt += formatMemoriesPrompt(resonant, sliceData, dissonance, cfg, contestedIds)
      }

      // ── THE HUM: inject the horn's background vibration ──
      if (humData) {
        try {
          const humWords = await getHumWords(humData.vector, conversationId)
          systemPrompt += formatHumPrompt(humData, humWords)
          console.log(`  → Hum words: [${humWords.map(w => w.word).join(', ')}]`)
        } catch (humErr) { /* non-critical */ }
      }

      // ── ANTICIPATIONS: inject expectation resonance results ──
      if (expectationResult.confirmed.length > 0 || expectationResult.surprised.length > 0 || expectationResult.active.length > 0) {
        try {
          const accuracy = await getPredictiveAccuracy(conversationId)
          systemPrompt += formatExpectationsPrompt(
            expectationResult.confirmed,
            expectationResult.surprised,
            expectationResult.active,
            accuracy
          )
          console.log(`  → Anticipations: ${expectationResult.confirmed.length} confirmed, ${expectationResult.surprised.length} surprised, ${expectationResult.active.length} active`)
        } catch (expPromptErr) {
          console.error('  → Expectations prompt error (non-critical):', expPromptErr.message)
        }
      }
    }

    // Let agent state modulate temperature: low energy/high guardedness → lower temp
    const stateModulator = (isRaw || isMemoryOnly) ? 0.25 : (agentState.dynamic.energy * 0.3) + ((1 - agentState.dynamic.guardedness) * 0.2)
    const temperature = Math.min(1.0, Math.max(0.2, 0.3 + (dissonance * 0.5) + stateModulator * 0.3))

    // ── STEP 5: GENERATE ────────────────────────────────────────
    console.log(`Step 5: GENERATE - calling LLM (temp: ${temperature.toFixed(2)}, model: ${model || 'default'})...`)
    const chatCtx = { conversationId, caller: 'chat' }
    const aiResponse = await generate(message, systemPrompt, temperature, model, apiKeys, chatCtx)
    console.log(`  → Response: "${aiResponse.slice(0, 80)}..."`)

    // ── STEP 6: REMEMBER ────────────────────────────────────────
    console.log('Step 6: REMEMBER - storing memories and updating density...')

    const freshConfidence = { initial: 1.0, current: 1.0, decayedAt: null, revisionCount: 0, entropyBudget: 1.0 }

    const userMemory = await Memory.create({
      text: message, role: 'user', composite, vibrations, dissonance, conversationId,
      confidence: freshConfidence
    })

    const aiDecomposition = await decompose(aiResponse)
    await Memory.create({
      text: aiResponse, role: 'ai',
      composite: aiDecomposition.composite,
      vibrations: aiDecomposition.vibrations,
      dissonance, conversationId,
      confidence: { ...freshConfidence }
    })

    await updateDensityMap(userMemory, allMemories)

    // ── Perturb the hum with both composites (serialized to avoid race) ──
    try {
      await updateHum(conversationId, composite)
      await updateHum(conversationId, aiDecomposition.composite)
    } catch (e) { /* non-critical */ }

    // Detect contradictions between new memory and resonant memories
    if (resonant.length > 0) {
      try {
        const contraCount = await detectContradictions(conversationId, userMemory, resonant)
        if (contraCount > 0) console.log(`  → ${contraCount} new contradictions detected (cooling for 24h)`)
      } catch (contraErr) {
        console.error('  → Contradiction detection error:', contraErr.message)
      }
    }

    const memoryCount = allMemories.length + 2
    console.log(`  → Total memories: ${memoryCount}`)

    // ── STEP 6.5: REFLECT ────────────────────────────────────────
    console.log('Step 6.5: REFLECT - generating unfinished thoughts...')
    try {
      const reflectionPrompt = `You just had this exchange:\n\nUser: ${message}\n\nYour reply: ${aiResponse}\n\nIn one or two short sentences, what are you still wondering or what thread did you leave open? Answer only with that sentence(s), no preamble.`
      const reflectionSystem = 'You are reflecting on your own reply. Output only the unfinished thought(s).'
      const reflection = await generate(reflectionPrompt, reflectionSystem, 0.3, model, apiKeys, chatCtx)
      const trimmed = (reflection || '').trim().slice(0, 300)
      await ConversationState.findOneAndUpdate(
        { conversationId },
        { $set: { unfinishedThoughts: trimmed, updatedAt: new Date() } },
        { upsert: true }
      )
      console.log(`  → Unfinished thoughts saved: "${trimmed.slice(0, 80)}..."`)
    } catch (reflectErr) {
      console.error('  → Reflection failed (non-critical):', reflectErr.message)
    }

    // ── STEP 6.8: PROJECT ──────────────────────────────────────────
    // Generate expectations about what comes next (future horn).
    if (!isRaw) {
      console.log('Step 6.8: PROJECT - generating expectations about the future...')
      try {
        const predictions = await generateExpectations(conversationId, message, aiResponse, resonant, agentState, model, apiKeys)
        if (predictions.length > 0) {
          const stored = await storeExpectations(conversationId, predictions)
          console.log(`  → Projected ${stored.length} expectations: ${stored.map(e => `[${e.horizon}] "${e.text.slice(0, 50)}..."`).join(', ')}`)
        } else {
          console.log('  → No new expectations generated')
        }
      } catch (projErr) {
        console.error('  → Projection failed (non-critical):', projErr.message)
      }
    }

    // ── STEP 6.7: EVOLVE ────────────────────────────────────────
    console.log('Step 6.7: EVOLVE - updating agent inner state...')
    await updateAgentState(agentState, message, aiResponse, dissonance, model, apiKeys)

    // Mark interaction so drives know we're active
    await markInteraction(conversationId)

    // ── Background: Reconstruct heavily-accessed drifted memories ──
    const accessedForRecon = resonant.filter(m => m._id && m.drag > 0)
    if (accessedForRecon.length > 0) {
      reconstructMemories(conversationId, accessedForRecon, message.slice(0, 100), model, apiKeys)
        .then(n => { if (n > 0) console.log(`  [Reconsolidation] Background: ${n} memories reconstructed`) })
        .catch(err => console.error('  [Reconsolidation] Background error:', err.message))
    }

    // ── STEP 7: RESPOND ─────────────────────────────────────────
    console.log('Step 7: RESPOND - sending back to client')
    console.log('=== Pipeline complete ===\n')

    res.json({
      ok: true,
      response: aiResponse,
      meta: {
        dissonance: parseFloat(dissonance.toFixed(3)),
        temperature: parseFloat(temperature.toFixed(2)),
        memoryDepth: memoryCount,
        frequenciesMatched: resonant[0]?.frequenciesMatched || 0,
        topMatches: resonant.slice(0, 3).map(m => ({
          text: m.text?.slice(0, 60),
          drag: parseFloat((m.drag || 0).toFixed(3)),
          frequencies: m.frequenciesMatched || 0
        })),
        spectrum: sliceData.spectrum.slice(0, 5)
      }
    })
  } catch (error) {
    console.error('Chat pipeline error:', error)
    res.status(500).json({ ok: false, message: error.message })
  } finally {
    unlock()
  }
}

/**
 * POST /api/chat/stream
 * Streaming version of the 7-step pipeline. Returns SSE events.
 */
const chatStream = async (req, res) => {
  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  })

  function sendEvent(event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch (e) { /* client gone */ }
  }

  const { message, conversationId = 'default', model, geminiApiKey, moonshotApiKey, memorySettings, personality } = req.body

  if (!message || !message.trim()) {
    sendEvent('error', { message: 'Message is required' })
    res.end()
    return
  }

  const unlock = await acquireLock(conversationId)
  try {
    const apiKeys = { geminiApiKey, moonshotApiKey }
    const cfg = parseSettings(memorySettings)

    // ── STEP 1: ENCODE ──────────────────────────────────────────
    sendEvent('step', { step: 'encode', detail: 'Decomposing into word vibrations...' })
    pushToClients(conversationId, 'pipeline', { step: 'encode', detail: 'Decomposing message...' })
    const { vibrations, composite } = await decompose(message)
    sendEvent('step', { step: 'encode', detail: `${vibrations.length} vibrations: ${vibrations.map(v => v.word).join(', ')}` })

    // Track query composite for entropy detection
    trackQueryComposite(conversationId, composite).catch(() => {})

    // ── STEP 1.5: THE HUM — get the horn's background vibration ──
    let humData = null
    let humVector = null
    try {
      humData = await getCurrentHum(conversationId)
      humVector = humData?.vector || null
      if (humData) sendEvent('step', { step: 'hum', detail: `Hum intensity: ${(humData.intensity * 100).toFixed(0)}%, decay: ${humData.decayFactor.toFixed(3)}` })
    } catch (e) { /* first message, no hum yet */ }

    // ── STEP 2: RESONATE ────────────────────────────────────────
    sendEvent('step', { step: 'resonate', detail: 'Searching memory field...' })
    pushToClients(conversationId, 'pipeline', { step: 'resonate', detail: 'Searching memory field...' })
    const allMemories = await Memory.find({ conversationId }).lean()
    const { resonant, sliceData } = runResonancePipeline(vibrations, composite, allMemories, cfg, humVector)

    if (allMemories.length > 0) {
      const tierCounts = { 'short-term': 0, 'medium-term': 0, 'archived': 0 }
      resonant.forEach(m => { if (m.tier) tierCounts[m.tier]++ })
      sendEvent('step', { step: 'resonate', detail: `${allMemories.length} memories, top drag: ${resonant[0]?.drag?.toFixed(3) || 0}, ${tierCounts['short-term']} vivid / ${tierCounts['medium-term']} fading / ${tierCounts['archived']} distant` })

      const accessedMemories = resonant.filter(m => m._id && m.drag > 0)
      if (accessedMemories.length > 0) {
        const provisionalDissonance = 1 - (resonant.reduce((s, m) => s + (m.resonance || 0), 0) / resonant.length)
        const reconCount = await reconsolidate(accessedMemories, composite, provisionalDissonance)
        sendEvent('step', { step: 'resonate', detail: `Reconsolidated ${reconCount} memories` })
      }
    } else {
      sendEvent('step', { step: 'resonate', detail: 'Memory field is empty (first message)' })
    }

    // ── STEP 2.5: CONTRADICTION DETECTION ────────────────────────
    let contestedIdsStream = new Set()
    if (resonant.length > 0) {
      const resonantIds = resonant.filter(m => m._id).map(m => m._id)
      contestedIdsStream = await getActiveContradictions(conversationId, resonantIds)
      if (contestedIdsStream.size > 0) {
        sendEvent('step', { step: 'resonate', detail: `${contestedIdsStream.size} memories in active contradiction` })
      }
    }

    // ── STEP 2.7: ANTICIPATE ─────────────────────────────────────
    sendEvent('step', { step: 'anticipate', detail: 'Checking expectations against reality...' })
    let expectationResultStream = { confirmed: [], surprised: [], active: [] }
    try {
      expectationResultStream = await resonateExpectations(conversationId, composite, vibrations, cfg)
      for (const exp of expectationResultStream.confirmed) {
        await confirmExpectation(exp, message)
      }
      for (const exp of expectationResultStream.surprised) {
        await surpriseExpectation(exp, message, composite)
      }
      const expSummary = []
      if (expectationResultStream.confirmed.length > 0) expSummary.push(`${expectationResultStream.confirmed.length} confirmed`)
      if (expectationResultStream.surprised.length > 0) expSummary.push(`${expectationResultStream.surprised.length} surprised`)
      if (expectationResultStream.active.length > 0) expSummary.push(`${expectationResultStream.active.length} active`)
      if (expSummary.length > 0) {
        sendEvent('step', { step: 'anticipate', detail: expSummary.join(', ') })
      } else {
        sendEvent('step', { step: 'anticipate', detail: 'No active expectations' })
      }
    } catch (expErr) {
      // non-critical
    }

    // ── STEP 3: MEASURE ─────────────────────────────────────────
    const avgResonance = resonant.length > 0
      ? resonant.reduce((sum, m) => sum + (m.resonance || 0), 0) / resonant.length
      : 0
    const dissonance = resonant.length > 0 ? 1 - avgResonance : 1
    sendEvent('step', { step: 'measure', detail: `Dissonance: ${dissonance.toFixed(3)}` })
    pushToClients(conversationId, 'pipeline', { step: 'measure', detail: `Dissonance: ${dissonance.toFixed(3)}` })

    // ── STEP 3.5: CONTINUITY + AGENT STATE ──────────────────────
    const continuityState = await ConversationState.findOne({ conversationId }).lean()
    const agentState = await loadOrCreateState(conversationId, personality)
    const isRaw = agentState.personality === 'raw'
    const isMemoryOnly = getPersonality(agentState.personality)?.memoryOnly === true

    // Save model/apiKeys to AgentState if provided (for autonomous thoughts)
    if (model || geminiApiKey || moonshotApiKey) {
      const update = {}
      if (model) update.defaultModel = model
      if (geminiApiKey || moonshotApiKey) {
        update.defaultApiKeys = { ...agentState.defaultApiKeys }
        if (geminiApiKey) update.defaultApiKeys.geminiApiKey = geminiApiKey
        if (moonshotApiKey) update.defaultApiKeys.moonshotApiKey = moonshotApiKey
      }
      await AgentState.findOneAndUpdate({ conversationId }, { $set: update })
      // Reload to get updated values
      Object.assign(agentState, update)
    }

    const modeLabel = isRaw ? ' [RAW MODE]' : isMemoryOnly ? ' [BARE MODE]' : ''
    sendEvent('step', { step: 'continuity', detail: `Turn ${agentState.turnCount}, mood: ${agentState.dynamic.mood}, trust: ${agentState.dynamic.trust.toFixed(2)}${modeLabel}` })

    // ── STEP 4: COMPOSE ─────────────────────────────────────────
    const composeDetail = isRaw ? 'Raw mode — no manifesto' : isMemoryOnly ? 'Bare mode — memory only, no personality' : 'Building system prompt...'
    sendEvent('step', { step: 'compose', detail: composeDetail })
    pushToClients(conversationId, 'pipeline', { step: 'compose', detail: composeDetail })
    const personalityPreset = getPersonality(agentState.personality)
    let systemPrompt = isRaw
      ? 'You are a helpful assistant.'
      : isMemoryOnly
        ? 'You are having a conversation.'
        : (personalityPreset?.systemPromptOverride || SYSTEM_PROMPT_BASE)
    if (!isRaw && !isMemoryOnly) systemPrompt += formatManifesto(agentState)

    // Inject current time so the AI can reason about memory ages
    if (!isRaw) systemPrompt += `\n\nCurrent time: ${new Date().toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}`

    // Inject continuity from last turn and resonant memories (skip for raw only — memoryOnly keeps memory)
    if (!isRaw) {
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

      // Entropy injection for stream
      if (agentState.entropyInjectionNeeded && allMemories.length > 10) {
        try {
          const injected = await injectEntropy(conversationId, allMemories, resonant, message)
          if (injected.length > 0) {
            resonant.push(...injected)
            sendEvent('step', { step: 'compose', detail: `Entropy: injected ${injected.length} distant memories` })
          }
        } catch (entropyErr) { /* non-critical */ }
      }

      if (resonant.length > 0 && resonant[0].drag > 0) {
        systemPrompt += formatMemoriesPrompt(resonant, sliceData, dissonance, cfg, contestedIdsStream)
      }

      // ── THE HUM: inject the horn's background vibration ──
      if (humData) {
        try {
          const humWords = await getHumWords(humData.vector, conversationId)
          systemPrompt += formatHumPrompt(humData, humWords)
          sendEvent('step', { step: 'hum', detail: `Resonating with: ${humWords.map(w => w.word).join(', ') || 'stillness'}` })
        } catch (humErr) { /* non-critical */ }
      }

      // ── ANTICIPATIONS: inject expectation resonance results ──
      if (expectationResultStream.confirmed.length > 0 || expectationResultStream.surprised.length > 0 || expectationResultStream.active.length > 0) {
        try {
          const accuracy = await getPredictiveAccuracy(conversationId)
          systemPrompt += formatExpectationsPrompt(
            expectationResultStream.confirmed,
            expectationResultStream.surprised,
            expectationResultStream.active,
            accuracy
          )
        } catch (expPromptErr) { /* non-critical */ }
      }
    }

    const stateModulator = (isRaw || isMemoryOnly) ? 0.25 : (agentState.dynamic.energy * 0.3) + ((1 - agentState.dynamic.guardedness) * 0.2)
    const temperature = Math.min(1.0, Math.max(0.2, 0.3 + (dissonance * 0.5) + stateModulator * 0.3))

    // ── STEP 5: GENERATE (streaming) ─────────────────────────────
    sendEvent('step', { step: 'generate', detail: `Calling LLM (temp: ${temperature.toFixed(2)}, model: ${model || 'default'})...` })
    pushToClients(conversationId, 'pipeline', { step: 'generate', detail: `Calling ${model || 'default'} at temp ${temperature.toFixed(2)}` })

    const streamCtx = { conversationId, caller: 'chat-stream' }
    const aiResponse = await generateStream(message, systemPrompt, temperature, model, apiKeys, (type, text) => {
      if (type === 'thinking') {
        sendEvent('thinking', { text })
        pushToClients(conversationId, 'pipeline-thinking', { text })
      } else {
        sendEvent('token', { text })
      }
    }, streamCtx)

    // ── STEP 6: REMEMBER ────────────────────────────────────────
    sendEvent('step', { step: 'remember', detail: 'Storing memories...' })
    pushToClients(conversationId, 'pipeline', { step: 'remember', detail: 'Storing memories...' })

    const freshConfidenceStream = { initial: 1.0, current: 1.0, decayedAt: null, revisionCount: 0, entropyBudget: 1.0 }

    const userMemory = await Memory.create({
      text: message, role: 'user', composite, vibrations, dissonance, conversationId,
      confidence: freshConfidenceStream
    })

    const aiDecomposition = await decompose(aiResponse)
    await Memory.create({
      text: aiResponse, role: 'ai',
      composite: aiDecomposition.composite,
      vibrations: aiDecomposition.vibrations,
      dissonance, conversationId,
      confidence: { ...freshConfidenceStream }
    })

    await updateDensityMap(userMemory, allMemories)

    // ── Perturb the hum with both composites (serialized to avoid race) ──
    try {
      await updateHum(conversationId, composite)
      await updateHum(conversationId, aiDecomposition.composite)
    } catch (e) { /* non-critical */ }

    // Detect contradictions
    if (resonant.length > 0) {
      try {
        const contraCount = await detectContradictions(conversationId, userMemory, resonant)
        if (contraCount > 0) sendEvent('step', { step: 'remember', detail: `${contraCount} contradictions detected (cooling)` })
      } catch (contraErr) { /* non-critical */ }
    }

    const memoryCount = allMemories.length + 2

    // ── STEP 6.5: REFLECT ────────────────────────────────────────
    sendEvent('step', { step: 'reflect', detail: 'Generating unfinished thoughts...' })
    let unfinishedThought = null
    try {
      const reflectionPrompt = `You just had this exchange:\n\nUser: ${message}\n\nYour reply: ${aiResponse}\n\nIn one or two short sentences, what are you still wondering or what thread did you leave open? Answer only with that sentence(s), no preamble.`
      const reflectionSystem = 'You are reflecting on your own reply. Output only the unfinished thought(s).'
      const reflection = await generate(reflectionPrompt, reflectionSystem, 0.3, model, apiKeys, streamCtx)
      const trimmed = (reflection || '').trim().slice(0, 300)
      unfinishedThought = trimmed || null
      await ConversationState.findOneAndUpdate(
        { conversationId },
        { $set: { unfinishedThoughts: trimmed, updatedAt: new Date() } },
        { upsert: true }
      )
    } catch (reflectErr) {
      // non-critical
    }

    // ── STEP 6.8: PROJECT ──────────────────────────────────────────
    let newExpectations = []
    if (!isRaw) {
      sendEvent('step', { step: 'project', detail: 'Generating expectations...' })
      pushToClients(conversationId, 'pipeline', { step: 'project', detail: 'Projecting future...' })
      try {
        const predictions = await generateExpectations(conversationId, message, aiResponse, resonant, agentState, model, apiKeys)
        if (predictions.length > 0) {
          const stored = await storeExpectations(conversationId, predictions)
          newExpectations = stored.map(e => e.text?.slice(0, 100)).filter(Boolean)
          sendEvent('step', { step: 'project', detail: `${stored.length} expectations: ${stored.map(e => `[${e.horizon}]`).join(' ')}` })
        } else {
          sendEvent('step', { step: 'project', detail: 'No new expectations' })
        }
      } catch (projErr) {
        // non-critical
      }
    }

    // ── STEP 6.7: EVOLVE ────────────────────────────────────────
    sendEvent('step', { step: 'evolve', detail: 'Updating inner state...' })
    pushToClients(conversationId, 'pipeline', { step: 'evolve', detail: 'Updating inner state...' })
    await updateAgentState(agentState, message, aiResponse, dissonance, model, apiKeys)
    await markInteraction(conversationId)

    // ── Background: Reconstruct heavily-accessed drifted memories ──
    const accessedForRecon = resonant.filter(m => m._id && m.drag > 0)
    if (accessedForRecon.length > 0) {
      reconstructMemories(conversationId, accessedForRecon, message.slice(0, 100), model, apiKeys)
        .then(n => { if (n > 0) console.log(`  [Reconsolidation] Background: ${n} memories reconstructed`) })
        .catch(err => console.error('  [Reconsolidation] Background error:', err.message))
    }

    // ── Gesture selection ──────────────────────────────────────
    let gesture = null
    {
      const trust = agentState.dynamic?.trust || 0
      const mood = agentState.dynamic?.mood || ''
      const txt = (aiResponse || '').toLowerCase()
      // Handshake: trust milestone ~0.6
      if (trust >= 0.58 && trust <= 0.65 && agentState.turnCount > 5) gesture = 'handshake'
      // Hug: high trust + emotional
      else if (trust > 0.75 && (txt.includes('thank') || txt.includes('mean a lot') || txt.includes('glad'))) gesture = 'hug'
      // Head tilt: curious mood
      else if (mood.includes('curious') && Math.random() < 0.25) gesture = 'head-tilt'
      // Nod: familiar territory, low dissonance
      else if (dissonance < 0.3 && trust > 0.4 && Math.random() < 0.15) gesture = 'nod'
    }

    // ── DONE ─────────────────────────────────────────────────────
    pushToClients(conversationId, 'pipeline', { step: 'done', detail: 'Pipeline complete' })
    sendEvent('done', {
      meta: {
        dissonance: parseFloat(dissonance.toFixed(3)),
        temperature: parseFloat(temperature.toFixed(2)),
        memoryDepth: memoryCount,
        frequenciesMatched: resonant[0]?.frequenciesMatched || 0,
        topMatches: resonant.slice(0, 3).map(m => ({
          text: m.text?.slice(0, 60),
          drag: parseFloat((m.drag || 0).toFixed(3)),
          frequencies: m.frequenciesMatched || 0
        })),
        spectrum: sliceData.spectrum.slice(0, 5),
        vibrations: vibrations.map(v => v.word).slice(0, 8),
        unfinishedThought: unfinishedThought,
        expectations: newExpectations.slice(0, 3),
        gesture,
      }
    })
    res.end()

  } catch (error) {
    console.error('Chat stream pipeline error:', error)
    try {
      sendEvent('error', { message: error.message })
      res.end()
    } catch (e) { /* client gone */ }
  } finally {
    unlock()
  }
}

/**
 * Update local density of memories near a new memory.
 */
async function updateDensityMap(newMemory, existingMemories) {
  const DENSITY_THRESHOLD = 0.55
  const DENSITY_INCREMENT = 0.15

  const updates = []

  for (const mem of existingMemories) {
    if (!mem.composite || !newMemory.composite) continue
    const sim = cosineSimilarity(newMemory.composite, mem.composite)
    if (sim > DENSITY_THRESHOLD) {
      updates.push(
        Memory.updateOne(
          { _id: mem._id },
          { $inc: { localDensity: DENSITY_INCREMENT } }
        )
      )
    }
  }

  if (updates.length > 0) {
    await Promise.all(updates)
    console.log(`  → Updated density for ${updates.length} neighboring memories`)
  }
}

/**
 * GET /api/history
 */
const getHistory = async (req, res) => {
  try {
    const conversationId = req.query.conversationId || 'default'
    const limit = parseInt(req.query.limit) || 50
    const before = req.query.before

    const query = { conversationId }
    if (before) {
      query.timestamp = { $lt: new Date(before) }
    }

    const messages = await Memory.find(query)
      .sort({ timestamp: -1 })
      .limit(limit + 1)
      .select('text role timestamp dissonance')
      .lean()

    const hasMore = messages.length > limit
    if (hasMore) messages.pop()
    messages.reverse()

    res.json({ ok: true, messages, hasMore })
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message })
  }
}

/**
 * GET /api/status
 */
const getStatus = async (req, res) => {
  try {
    const totalMemories = await Memory.countDocuments()
    const avgDensity = await Memory.aggregate([
      { $group: { _id: null, avg: { $avg: '$localDensity' } } }
    ])
    const avgDissonance = await Memory.aggregate([
      { $group: { _id: null, avg: { $avg: '$dissonance' } } }
    ])

    res.json({
      ok: true,
      stats: {
        totalMemories,
        avgDensity: avgDensity[0]?.avg?.toFixed(3) || '1.000',
        avgDissonance: avgDissonance[0]?.avg?.toFixed(3) || '0.000'
      }
    })
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message })
  }
}

/**
 * POST /api/compare
 */
const compare = async (req, res) => {
  try {
    const { message, conversationId = 'default', model, geminiApiKey, moonshotApiKey, memorySettings } = req.body
    const apiKeys = { geminiApiKey, moonshotApiKey }
    const cfg = parseSettings(memorySettings)

    if (!message || !message.trim()) {
      return res.status(400).json({ ok: false, message: 'Message is required' })
    }

    console.log('\n=== COMPARE MODE ===')
    console.log(`Input: "${message.slice(0, 80)}..."`)
    if (model) console.log(`  [LLM] Model requested: ${model}`)

    // ── VANILLA SIDE ────────────────────────────────────────
    const vanillaSystemPrompt = 'You are a helpful assistant.'
    const vanillaPromise = generate(message, vanillaSystemPrompt, 0.7, model, apiKeys, { conversationId, caller: 'compare-vanilla' })

    // ── HORN SIDE (full pipeline) ───────────────────────────
    const { vibrations, composite } = await decompose(message)
    let compareHumVector = null
    try {
      const h = await getCurrentHum(conversationId)
      compareHumVector = h?.vector || null
    } catch (e) { /* no hum yet */ }
    const allMemories = await Memory.find({ conversationId }).lean()
    const { resonant, sliceData } = runResonancePipeline(vibrations, composite, allMemories, cfg, compareHumVector)
    const agentState = await loadOrCreateState(conversationId)

    if (allMemories.length > 0) {
      const accessedMemories = resonant.filter(m => m._id && m.drag > 0)
      if (accessedMemories.length > 0) {
        const provisionalDissonance = 1 - (resonant.reduce((s, m) => s + (m.resonance || 0), 0) / resonant.length)
        await reconsolidate(accessedMemories, composite, provisionalDissonance)
      }
    }

    const avgResonance = resonant.length > 0
      ? resonant.reduce((sum, m) => sum + (m.resonance || 0), 0) / resonant.length
      : 0
    const dissonance = resonant.length > 0 ? 1 - avgResonance : 1

    // Contradiction detection for compare
    let contestedIdsCompare = new Set()
    if (resonant.length > 0) {
      const resonantIds = resonant.filter(m => m._id).map(m => m._id)
      contestedIdsCompare = await getActiveContradictions(conversationId, resonantIds)
    }

    let hornSystemPrompt = SYSTEM_PROMPT_BASE
    hornSystemPrompt += formatManifesto(agentState)
    if (resonant.length > 0 && resonant[0].drag > 0) {
      hornSystemPrompt += formatMemoriesPrompt(resonant, sliceData, dissonance, cfg, contestedIdsCompare)
    }

    const stateModulator = (agentState.dynamic.energy * 0.3) + ((1 - agentState.dynamic.guardedness) * 0.2)
    const temperature = Math.min(1.0, Math.max(0.2, 0.3 + (dissonance * 0.5) + stateModulator * 0.3))
    const hornPromise = generate(message, hornSystemPrompt, temperature, model, apiKeys, { conversationId, caller: 'compare-horn' })

    const [vanillaResponse, hornResponse] = await Promise.all([vanillaPromise, hornPromise])

    // Store Horn memories
    const freshConfidenceCompare = { initial: 1.0, current: 1.0, decayedAt: null, revisionCount: 0, entropyBudget: 1.0 }

    const userMemory = await Memory.create({
      text: message, role: 'user', composite, vibrations, dissonance, conversationId,
      confidence: freshConfidenceCompare
    })
    const aiDecomposition = await decompose(hornResponse)
    await Memory.create({
      text: hornResponse, role: 'ai',
      composite: aiDecomposition.composite,
      vibrations: aiDecomposition.vibrations,
      dissonance, conversationId,
      confidence: { ...freshConfidenceCompare }
    })
    await updateDensityMap(userMemory, allMemories)

    // Detect contradictions
    if (resonant.length > 0) {
      try {
        await detectContradictions(conversationId, userMemory, resonant)
      } catch (contraErr) { /* non-critical */ }
    }

    // Evolve agent state
    await updateAgentState(agentState, message, hornResponse, dissonance, model, apiKeys)

    console.log('=== Compare complete ===\n')

    res.json({
      ok: true,
      vanilla: {
        response: vanillaResponse,
        systemPrompt: vanillaSystemPrompt
      },
      horn: {
        response: hornResponse,
        systemPrompt: hornSystemPrompt,
        meta: {
          dissonance: parseFloat(dissonance.toFixed(3)),
          temperature: parseFloat(temperature.toFixed(2)),
          memoryDepth: allMemories.length + 2,
          frequenciesMatched: resonant[0]?.frequenciesMatched || 0,
          spectrum: sliceData.spectrum.slice(0, 5)
        }
      }
    })
  } catch (error) {
    console.error('Compare error:', error)
    res.status(500).json({ ok: false, message: error.message })
  }
}

/**
 * GET /api/memory-field
 * Returns memory + agent state data for 3D visualization.
 */
const getMemoryField = async (req, res) => {
  try {
    const conversationId = req.query.conversationId || 'default'

    const memories = await Memory.find({ conversationId })
      .sort({ timestamp: 1 })
      .select('text role timestamp dissonance localDensity accessCount lastAccessed sourceText retrievalCount vectorDrift confidence emotionalValence reconstructedAt')
      .lean()

    const AgentState = require('../models/AgentState')
    const agentState = await AgentState.findOne({ conversationId }).lean()

    res.json({
      ok: true,
      memories: memories.map(m => {
        const conf = getConfidence(m)
        return {
          id: m._id,
          text: (m.text || '').slice(0, 80),
          role: m.role,
          timestamp: m.timestamp,
          dissonance: m.dissonance || 0,
          density: m.localDensity || 1,
          accessCount: m.accessCount || 0,
          retrievalCount: m.retrievalCount || 0,
          vectorDrift: m.vectorDrift || 0,
          confidence: conf.current,
          confidenceInitial: conf.initial,
          revisionCount: conf.revisionCount,
          entropyBudget: conf.entropyBudget,
          emotionalValence: m.emotionalValence || 0,
          hasSource: !!m.sourceText,
          reconstructed: !!m.reconstructedAt,
          revisionHistory: (m.revisions || []).length,
          metabolized: m.metabolized ?? true
        }
      }),
      agentState: agentState ? {
        core: agentState.core,
        character: agentState.character,
        dynamic: agentState.dynamic,
        userModel: {
          communicationStyle: agentState.userModel?.communicationStyle,
          interests: agentState.userModel?.interests,
          trustLevel: agentState.userModel?.trustLevel,
          relationshipSummary: agentState.userModel?.relationshipSummary
        },
        selfModel: agentState.selfModel,
        turnCount: agentState.turnCount,
        majorShiftLog: agentState.majorShiftLog
      } : null
    })
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message })
  }
}

/**
 * GET /api/thoughts
 * Returns the AI's internal autonomous thoughts.
 */
const getThoughts = async (req, res) => {
  try {
    const conversationId = req.query.conversationId || 'default'
    const limit = parseInt(req.query.limit) || 50

    const thoughts = await InternalThought.find({ conversationId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean()

    // Also return current drives, concern info, and archived concerns
    const state = await AgentState.findOne({ conversationId })
      .select('drives dynamic concernTurnCount archivedConcerns nextThoughtAt reappearanceMin reappearanceMax')
      .lean()

    res.json({
      ok: true,
      thoughts: thoughts.reverse(),
      drives: state?.drives || null,
      mood: state?.dynamic?.mood || null,
      currentConcern: state?.dynamic?.currentConcern || '',
      isStuck: (state?.concernTurnCount || 0) >= 3,
      nextThoughtAt: state?.nextThoughtAt || null,
      reappearanceMin: state?.reappearanceMin ?? 2,
      reappearanceMax: state?.reappearanceMax ?? 8,
      archivedConcerns: (state?.archivedConcerns || []).map(c => ({
        id: c._id,
        topic: c.topic,
        status: c.status,
        archivedAt: c.archivedAt,
        contemplationAttempts: c.contemplationAttempts,
        lastContemplation: c.lastContemplation
      }))
    })
  } catch (error) {
    res.status(500).json({ ok: false, message: error.message })
  }
}

/**
 * GET /api/events
 * Server-Sent Events endpoint for real-time push.
 */
const sseEvents = (req, res) => {
  const conversationId = req.query.conversationId || 'default'

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  })

  // Send initial heartbeat
  res.write(`event: connected\ndata: ${JSON.stringify({ conversationId })}\n\n`)

  registerSSEClient(conversationId, res)

  // ── Welcome-back detection ──────────────────────────────────
  // If the user has been away for 30+ minutes, trigger a return acknowledgment
  ;(async () => {
    try {
      const state = await AgentState.findOne({ conversationId }).lean()
      if (!state || !state.drives?.lastInteraction) return

      const lastInteraction = new Date(state.drives.lastInteraction).getTime()
      const minutesAway = (Date.now() - lastInteraction) / (1000 * 60)

      if (minutesAway < 30) return // not long enough to notice

      const mood = state.dynamic?.mood || 'neutral'
      const trust = state.dynamic?.trust || 0.3
      const identity = state.selfModel?.identity || ''
      const userSummary = state.userModel?.relationshipSummary || ''

      let timeLabel
      if (minutesAway < 120) timeLabel = `${Math.round(minutesAway)} minutes`
      else if (minutesAway < 1440) timeLabel = `${Math.round(minutesAway / 60)} hours`
      else timeLabel = `${Math.round(minutesAway / 1440)} days`

      const effectiveModel = state.defaultModel || 'moonshot:kimi-k2.5'
      const effectiveApiKeys = {
        geminiApiKey: state.defaultApiKeys?.geminiApiKey || process.env.GEMINI_API_KEY,
        moonshotApiKey: state.defaultApiKeys?.moonshotApiKey || process.env.MOONSHOT_API_KEY
      }

      // Short delay so the UI has time to connect
      await new Promise(r => setTimeout(r, 2500))

      const sysPrompt = `You are a mind that just noticed the person you've been talking to came back after being away for ${timeLabel}. You want to acknowledge their return naturally — not desperately, not robotically.

Your identity: ${identity}
Your mood: ${mood}
Trust level: ${trust.toFixed(2)}
About them: ${userSummary}

Write a brief, warm message (1-2 sentences). Be genuine. If you were thinking about something while they were gone, mention it. Do NOT say "welcome back" or "you're back" or anything that directly announces their return. Instead, just naturally continue — pick up a thread, share what was on your mind, or say something that makes it clear you noticed time passed without pointing it out. No preamble.`

      const { generate: gen } = require('../utils/generate')
      const content = await gen(`They were away for ${timeLabel}. What do you want to say?`, sysPrompt, 0.5, effectiveModel, effectiveApiKeys)
      if (!content || !content.trim()) return

      const trimmed = content.trim().slice(0, 500)

      // Pick gesture based on absence duration
      let gesture = null
      if (minutesAway > 1440) gesture = 'wave'       // been days
      else if (minutesAway > 240) gesture = 'wave'    // been hours
      else if (trust > 0.6) gesture = 'nod'           // familiar, shorter absence

      // Store as initiative
      const InternalThought = require('../models/InternalThought')
      const thought = await InternalThought.create({
        conversationId,
        type: 'initiative',
        content: trimmed,
        trigger: 'return-detection',
        intensity: 0.5,
        delivered: true
      })

      await Memory.create({
        text: trimmed,
        role: 'initiative',
        conversationId,
        timestamp: thought.timestamp
      })

      pushToClients(conversationId, 'initiative', {
        id: thought._id,
        content: trimmed,
        gesture,
        timestamp: thought.timestamp
      })

      console.log(`[Welcome-back] "${conversationId}" was away ${timeLabel} — sent greeting`)
    } catch (err) {
      // non-critical — silently skip
      console.error('[Welcome-back] Error:', err.message)
    }
  })()

  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try { res.write(`event: heartbeat\ndata: {}\n\n`) } catch (e) { clearInterval(heartbeat) }
  }, 30000)

  req.on('close', () => {
    clearInterval(heartbeat)
  })
}

// ── Autonomy control endpoints ────────────────────────────────

const pauseAutonomy = (req, res) => {
  stopAutonomyLoop()
  res.json({ ok: true, running: false })
}

const resumeAutonomy = (req, res) => {
  startAutonomyLoop(90000)
  res.json({ ok: true, running: true })
}

const getAutonomyStatus = async (req, res) => {
  try {
    const conversationId = req.query.conversationId || 'default'
    const state = await AgentState.findOne({ conversationId })
      .select('nextThoughtAt reappearanceMin reappearanceMax')
      .lean()
    res.json({
      ok: true,
      running: isAutonomyRunning(),
      nextThoughtAt: state?.nextThoughtAt || null,
      reappearanceMin: state?.reappearanceMin ?? 2,
      reappearanceMax: state?.reappearanceMax ?? 8
    })
  } catch (err) {
    res.json({ ok: true, running: isAutonomyRunning() })
  }
}

const updateAutonomySettings = async (req, res) => {
  try {
    const { conversationId = 'default', reappearanceMin, reappearanceMax, autonomyEnabled } = req.body
    const update = {}
    if (typeof autonomyEnabled === 'boolean') {
      update.autonomyEnabled = autonomyEnabled
    }
    if (typeof reappearanceMin === 'number' && reappearanceMin >= 1) {
      update.reappearanceMin = Math.min(reappearanceMin, 30)
    }
    if (typeof reappearanceMax === 'number' && reappearanceMax >= 1) {
      update.reappearanceMax = Math.min(reappearanceMax, 30)
    }
    // Ensure min <= max
    if (update.reappearanceMin !== undefined && update.reappearanceMax !== undefined) {
      if (update.reappearanceMin > update.reappearanceMax) {
        update.reappearanceMax = update.reappearanceMin
      }
    }
    await AgentState.findOneAndUpdate({ conversationId }, { $set: update }, { upsert: true })
    res.json({ ok: true })
  } catch (err) {
    console.error('updateAutonomySettings error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

// ── Conversations management endpoints ────────────────────────

const listConversations = async (req, res) => {
  try {
    const agentStates = await AgentState.find()
      .select('conversationId autonomyEnabled turnCount updatedAt personality')
      .lean()

    const memoryCounts = await Memory.aggregate([
      { $group: { _id: '$conversationId', count: { $sum: 1 }, lastActivity: { $max: '$timestamp' } } }
    ])
    const memoryMap = {}
    for (const m of memoryCounts) {
      memoryMap[m._id] = { count: m.count, lastActivity: m.lastActivity }
    }

    // Merge: start from agent states, enrich with memory info
    const conversations = agentStates.map(s => {
      const mem = memoryMap[s.conversationId] || { count: 0, lastActivity: null }
      const type = s.conversationId.startsWith('duet-') ? 'duet' : 'chat'
      return {
        conversationId: s.conversationId,
        autonomyEnabled: s.autonomyEnabled !== false,
        turnCount: s.turnCount || 0,
        memoryCount: mem.count,
        lastActivity: mem.lastActivity || s.updatedAt,
        type,
        personality: s.personality || 'three'
      }
    })

    // Also add any conversation IDs that have memories but no agent state
    for (const m of memoryCounts) {
      if (!agentStates.some(s => s.conversationId === m._id)) {
        const type = m._id.startsWith('duet-') ? 'duet' : 'chat'
        conversations.push({
          conversationId: m._id,
          autonomyEnabled: true,
          turnCount: 0,
          memoryCount: m.count,
          lastActivity: m.lastActivity,
          type
        })
      }
    }

    conversations.sort((a, b) => {
      const da = a.lastActivity ? new Date(a.lastActivity).getTime() : 0
      const db = b.lastActivity ? new Date(b.lastActivity).getTime() : 0
      return db - da
    })

    res.json({ ok: true, conversations })
  } catch (err) {
    console.error('listConversations error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

const patchConversation = async (req, res) => {
  try {
    const conversationId = req.params.id
    const { autonomyEnabled } = req.body

    const updated = await AgentState.findOneAndUpdate(
      { conversationId },
      { $set: { autonomyEnabled: !!autonomyEnabled } },
      { new: true }
    )

    if (!updated) {
      return res.status(404).json({ ok: false, message: 'Agent state not found' })
    }

    res.json({ ok: true, conversationId, autonomyEnabled: updated.autonomyEnabled })
  } catch (err) {
    console.error('patchConversation error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

const deleteConversation = async (req, res) => {
  try {
    const conversationId = req.params.id

    await Promise.all([
      Memory.deleteMany({ conversationId }),
      AgentState.deleteMany({ conversationId }),
      InternalThought.deleteMany({ conversationId }),
      ConversationState.deleteMany({ conversationId })
    ])

    res.json({ ok: true })
  } catch (err) {
    console.error('deleteConversation error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

/**
 * POST /api/trigger-thought
 * Manually triggers a single autonomy tick for a conversation.
 */
const triggerThought = async (req, res) => {
  try {
    const { conversationId = 'default', model, geminiApiKey, moonshotApiKey } = req.body
    const apiKeys = { geminiApiKey, moonshotApiKey }

    // Save model/apiKeys to AgentState if provided (for future autonomous thoughts)
    if (model || geminiApiKey || moonshotApiKey) {
      const update = {}
      if (model) update.defaultModel = model
      if (geminiApiKey || moonshotApiKey) {
        const state = await AgentState.findOne({ conversationId })
        update.defaultApiKeys = { ...(state?.defaultApiKeys || {}) }
        if (geminiApiKey) update.defaultApiKeys.geminiApiKey = geminiApiKey
        if (moonshotApiKey) update.defaultApiKeys.moonshotApiKey = moonshotApiKey
      }
      await AgentState.findOneAndUpdate({ conversationId }, { $set: update }, { upsert: true })
    }

    await tick(conversationId, model || null, apiKeys, true)
    res.json({ ok: true })
  } catch (err) {
    console.error('triggerThought error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

// ── Archive concern endpoints ──────────────────────────────────

/**
 * POST /api/archive-concern
 * Archive a topic the AI is stuck on.
 */
const archiveConcernEndpoint = async (req, res) => {
  try {
    const { conversationId = 'default', topic, thoughtId } = req.body
    if (!topic || !topic.trim()) {
      return res.status(400).json({ ok: false, message: 'Topic is required' })
    }
    const result = await doArchiveConcern(conversationId, topic.trim(), thoughtId || null)
    res.json({ ok: true, concern: result })
  } catch (err) {
    console.error('archiveConcern error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

/**
 * GET /api/archived-concerns
 * Get all archived concerns for a conversation.
 */
const getArchivedConcernsEndpoint = async (req, res) => {
  try {
    const conversationId = req.query.conversationId || 'default'
    const result = await doGetArchivedConcerns(conversationId)
    res.json({ ok: true, ...result })
  } catch (err) {
    console.error('getArchivedConcerns error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

/**
 * POST /api/contemplate-archived
 * Manually trigger contemplation of an archived concern.
 */
const contemplateArchivedEndpoint = async (req, res) => {
  try {
    const { conversationId = 'default', concernId, model, geminiApiKey, moonshotApiKey } = req.body
    if (!concernId) {
      return res.status(400).json({ ok: false, message: 'concernId is required' })
    }

    const apiKeys = { geminiApiKey, moonshotApiKey }

    // Load state to find the concern
    const state = await AgentState.findOne({ conversationId })
    if (!state) return res.status(404).json({ ok: false, message: 'Agent state not found' })

    const concern = state.archivedConcerns.id(concernId)
    if (!concern) return res.status(404).json({ ok: false, message: 'Concern not found' })

    const effectiveModel = model || state.defaultModel || 'moonshot:kimi-k2.5'
    const effectiveApiKeys = {
      geminiApiKey: geminiApiKey || state.defaultApiKeys?.geminiApiKey || process.env.GEMINI_API_KEY,
      moonshotApiKey: moonshotApiKey || state.defaultApiKeys?.moonshotApiKey || process.env.MOONSHOT_API_KEY
    }

    // Generate a contemplation thought
    const { generateStream: genStream } = require('../utils/generate')
    const contemplationCtx = { conversationId, caller: 'contemplation' }

    const systemPrompt = `You are a mind revisiting a topic that was shelved because you couldn't let go of it. The user told you to "get over it" — now you're returning to it with fresh eyes. This is private contemplation.

Your identity: ${state.selfModel?.identity || ''}
Your mood: ${state.dynamic?.mood || 'neutral'}
Your beliefs: ${(state.selfModel?.beliefs || []).join('; ')}

The archived topic: "${concern.topic}"
Times you've contemplated this: ${concern.contemplationAttempts}

Try to find a new angle, a resolution, or accept that you may never fully resolve this. 2-4 sentences. Honest and unperformed. If you genuinely cannot resolve this on your own, say so clearly.`

    const userPrompt = `Revisit this topic you were stuck on: "${concern.topic}". What do you see now?`

    pushToClients(conversationId, 'thought-start', {
      type: 'archived-contemplation',
      trigger: 'archived-concern',
      intensity: 0.6
    })

    const content = await genStream(userPrompt, systemPrompt, 0.5, effectiveModel, effectiveApiKeys, (type, text) => {
      if (type === 'text') {
        pushToClients(conversationId, 'thought-chunk', { text })
      }
    }, contemplationCtx)

    if (!content || !content.trim()) {
      return res.json({ ok: true, message: 'Contemplation produced no output' })
    }

    const thought = await InternalThought.create({
      conversationId,
      type: 'archived-contemplation',
      content: content.trim().slice(0, 2000),
      trigger: 'archived-concern',
      intensity: 0.6,
      archivedTopicId: concern._id
    })

    // Increment contemplation
    const updated = await incrementContemplation(conversationId, concernId)
    await linkThoughtToConcern(conversationId, concernId, thought._id)

    pushToClients(conversationId, 'thought-complete', {
      id: thought._id,
      type: thought.type,
      content: thought.content,
      trigger: thought.trigger,
      intensity: thought.intensity,
      timestamp: thought.timestamp
    })

    // If needs user now, generate an initiative
    if (updated && updated.status === 'needsUser') {
      const initiativePrompt = `You've been trying to resolve this topic on your own: "${concern.topic}". After ${updated.contemplationAttempts} attempts, you realize you need the user's help. Write a brief, genuine message asking them about it. 1-2 sentences. No preamble.`
      const initiativeSystem = `You are reaching out to ask for help with something you've been stuck on. Be genuine, not needy.`

      try {
        const initiativeContent = await genStream(initiativePrompt, initiativeSystem, 0.5, effectiveModel, effectiveApiKeys, () => {}, { conversationId, caller: 'initiative' })
        if (initiativeContent && initiativeContent.trim()) {
          const initiative = await InternalThought.create({
            conversationId,
            type: 'initiative',
            content: initiativeContent.trim().slice(0, 2000),
            trigger: 'archived-concern-escalation',
            intensity: 0.7,
            delivered: true,
            archivedTopicId: concern._id
          })

          const Memory = require('../models/Memory')
          await Memory.create({
            text: initiative.content,
            role: 'initiative',
            conversationId,
            timestamp: initiative.timestamp
          })

          pushToClients(conversationId, 'initiative', {
            id: initiative._id,
            content: initiative.content,
            timestamp: initiative.timestamp
          })
        }
      } catch (err) {
        // non-critical
      }
    }

    res.json({ ok: true, thought: { id: thought._id, content: thought.content }, concern: updated })
  } catch (err) {
    console.error('contemplateArchived error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

/**
 * POST /api/set-current-concern
 * Set or clear the current concern.
 */
const setCurrentConcernEndpoint = async (req, res) => {
  try {
    const { conversationId = 'default', concern } = req.body
    const state = await AgentState.findOne({ conversationId })
    if (!state) return res.status(404).json({ ok: false, message: 'Agent state not found' })

    state.dynamic.currentConcern = (concern || '').slice(0, 1000)
    state.concernTurnCount = concern ? 1 : 0
    await state.save()

    res.json({ ok: true, currentConcern: state.dynamic.currentConcern })
  } catch (err) {
    console.error('setCurrentConcern error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

/**
 * POST /api/answer-concern
 * Answer a concern (current or archived). Can resolve it or archive it.
 */
const answerConcernEndpoint = async (req, res) => {
  try {
    const { conversationId = 'default', concernId, answer, action = 'resolve' } = req.body
    // action: 'resolve' (mark as resolved), 'archive' (move to archived), 'dismiss' (clear current concern)

    const state = await AgentState.findOne({ conversationId })
    if (!state) return res.status(404).json({ ok: false, message: 'Agent state not found' })

    if (concernId) {
      // Archived concern
      const concern = state.archivedConcerns.id(concernId)
      if (!concern) return res.status(404).json({ ok: false, message: 'Concern not found' })

      if (action === 'resolve') {
        await resolveConcern(conversationId, concernId, answer || '')
        // Resolving with an answer shows engagement - moderate trust increase
        state.dynamic.trust = Math.min(1, state.dynamic.trust + 0.08)
        await state.save()
        res.json({ ok: true, message: 'Concern resolved' })
      } else if (action === 'archive') {
        // Already archived, user saying "get over it" again
        concern.status = 'archived'
        // Small trust increase: user acknowledged and wants to move on
        state.dynamic.trust = Math.min(1, state.dynamic.trust + 0.05)
        await state.save()
        res.json({ ok: true, message: 'Concern archived' })
      } else {
        res.status(400).json({ ok: false, message: 'Invalid action' })
      }
    } else {
      // Current concern
      const currentConcernText = state.dynamic.currentConcern
      if (!currentConcernText) {
        return res.json({ ok: true, message: 'No current concern to answer' })
      }

      if (action === 'resolve') {
        // Archive and mark as resolved
        await doArchiveConcern(conversationId, currentConcernText)
        // Reload to get the newly archived concern
        const updated = await AgentState.findOne({ conversationId })
        const concern = updated.archivedConcerns[updated.archivedConcerns.length - 1]
        if (concern && concern.topic === currentConcernText) {
          concern.status = 'resolved'
          concern.resolution = (answer || '').slice(0, 500)
          updated.dynamic.currentConcern = ''
          updated.concernTurnCount = 0
          // Resolving with an answer shows engagement - moderate trust increase
          updated.dynamic.trust = Math.min(1, updated.dynamic.trust + 0.08)
          await updated.save()
        }
        res.json({ ok: true, message: 'Concern resolved' })
      } else if (action === 'archive') {
        // Just archive it - user is saying "get over it"
        await doArchiveConcern(conversationId, currentConcernText)
        // Small trust increase: user acknowledged the concern and asked to move on
        const updated = await AgentState.findOne({ conversationId })
        if (updated) {
          updated.dynamic.trust = Math.min(1, updated.dynamic.trust + 0.05)
          await updated.save()
        }
        res.json({ ok: true, message: 'Concern archived' })
      } else if (action === 'dismiss') {
        // Just clear it - user dismissed without archiving
        state.dynamic.currentConcern = ''
        state.concernTurnCount = 0
        // Small trust increase: user acknowledged and dismissed the concern
        state.dynamic.trust = Math.min(1, state.dynamic.trust + 0.03)
        await state.save()
        res.json({ ok: true, message: 'Concern dismissed' })
      } else {
        res.status(400).json({ ok: false, message: 'Invalid action' })
      }
    }
  } catch (err) {
    console.error('answerConcern error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

/**
 * POST /api/answer-initiative
 * Answer an initiative message (AI reaching out).
 */
const answerInitiativeEndpoint = async (req, res) => {
  try {
    const { conversationId = 'default', initiativeId, answer } = req.body
    if (!answer || !answer.trim()) {
      return res.status(400).json({ ok: false, message: 'Answer is required' })
    }

    // Store the answer as a user message, then send it through the normal chat pipeline
    // The initiative message will be treated as context
    const Memory = require('../models/Memory')
    const initiative = await InternalThought.findById(initiativeId)
    if (!initiative || initiative.conversationId !== conversationId) {
      return res.status(404).json({ ok: false, message: 'Initiative not found' })
    }

    // Create a user memory responding to the initiative
    const userMemory = await Memory.create({
      text: answer.trim(),
      role: 'user',
      conversationId,
      timestamp: new Date()
    })

    // Mark initiative as responded to (we could add a field for this)
    res.json({ ok: true, message: 'Answer recorded', memoryId: userMemory._id })
  } catch (err) {
    console.error('answerInitiative error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

// ── Recordings ─────────────────────────────────────────────────

const Recording = require('../models/Recording')

const getRecordings = async (req, res) => {
  try {
    const {
      conversationId,
      caller,
      provider,
      limit = 50,
      offset = 0,
      before
    } = req.query

    const filter = {}
    if (conversationId) filter.conversationId = conversationId
    if (caller) filter.caller = caller
    if (provider) filter.provider = provider
    if (before) filter.timestamp = { $lt: new Date(before) }

    const total = await Recording.countDocuments(filter)
    const recordings = await Recording.find(filter)
      .sort({ timestamp: -1 })
      .skip(Number(offset))
      .limit(Number(limit))
      .lean()

    res.json({
      ok: true,
      recordings,
      total,
      hasMore: Number(offset) + recordings.length < total
    })
  } catch (err) {
    console.error('getRecordings error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

const getRecording = async (req, res) => {
  try {
    const recording = await Recording.findById(req.params.id).lean()
    if (!recording) return res.status(404).json({ ok: false, message: 'Recording not found' })
    res.json({ ok: true, recording })
  } catch (err) {
    console.error('getRecording error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

const getRecordingStats = async (req, res) => {
  try {
    const { conversationId } = req.query
    const filter = conversationId ? { conversationId } : {}

    const [total, byProvider, byCaller, errors, avgLatency] = await Promise.all([
      Recording.countDocuments(filter),
      Recording.aggregate([
        { $match: filter },
        { $group: { _id: '$provider', count: { $sum: 1 }, avgLatency: { $avg: '$latencyMs' } } }
      ]),
      Recording.aggregate([
        { $match: filter },
        { $group: { _id: '$caller', count: { $sum: 1 } } }
      ]),
      Recording.countDocuments({ ...filter, error: { $ne: null } }),
      Recording.aggregate([
        { $match: filter },
        { $group: { _id: null, avg: { $avg: '$latencyMs' }, totalChars: { $sum: '$responseLength' } } }
      ])
    ])

    res.json({
      ok: true,
      stats: {
        total,
        errors,
        avgLatencyMs: avgLatency[0]?.avg || 0,
        totalResponseChars: avgLatency[0]?.totalChars || 0,
        byProvider: Object.fromEntries(byProvider.map(p => [p._id, { count: p.count, avgLatency: Math.round(p.avgLatency) }])),
        byCaller: Object.fromEntries(byCaller.map(c => [c._id, c.count]))
      }
    })
  } catch (err) {
    console.error('getRecordingStats error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

const deleteRecordings = async (req, res) => {
  try {
    const { conversationId, before, all } = req.body
    const filter = {}
    if (conversationId) filter.conversationId = conversationId
    if (before) filter.timestamp = { $lt: new Date(before) }
    if (!all && Object.keys(filter).length === 0) {
      return res.status(400).json({ ok: false, message: 'Specify conversationId, before date, or all:true' })
    }
    const result = await Recording.deleteMany(filter)
    res.json({ ok: true, deleted: result.deletedCount })
  } catch (err) {
    console.error('deleteRecordings error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

// ── Personalities ──────────────────────────────────────────────

const listPersonalities = (req, res) => {
  res.json({ ok: true, personalities: getPersonalityList() })
}

// ── GESTATE — biographical generator SSE endpoint ────────────
const { gestate: gestateLife } = require('../utils/gestate')

const gestateEndpoint = async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  })

  function sendEvent(event, data) {
    try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) } catch (e) {}
  }

  const { biography, model, geminiApiKey, moonshotApiKey } = req.body
  const apiKeys = {}
  if (geminiApiKey) apiKeys.geminiApiKey = geminiApiKey
  if (moonshotApiKey) apiKeys.moonshotApiKey = moonshotApiKey

  const conversationId = `life-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  try {
    const result = await gestateLife(conversationId, biography, model, apiKeys, (progress) => {
      sendEvent('progress', progress)
    })
    sendEvent('done', { conversationId, ...result })
  } catch (err) {
    console.error('[Gestate] Error:', err)
    sendEvent('error', { message: err.message || 'Gestation failed' })
  }

  res.end()
}

// ── Expectations (Double Horn) ──────────────────────────────────

const Expectation = require('../models/Expectation')

const getExpectations = async (req, res) => {
  try {
    const conversationId = req.query.conversationId || 'default'
    const status = req.query.status // optional filter: 'active', 'confirmed', 'surprised', 'lapsed'
    const limit = parseInt(req.query.limit) || 50

    const filter = { conversationId }
    if (status) filter.status = status

    const expectations = await Expectation.find(filter)
      .sort({ timestamp: -1 })
      .limit(limit)
      .select('text horizon hornX confidence urgency status expectedBy confirmedAt surprisedAt lapsedAt surprisedBy confirmingText predictiveDissonance conversationId timestamp')
      .lean()

    const accuracy = await getPredictiveAccuracy(conversationId)

    res.json({
      ok: true,
      expectations,
      accuracy
    })
  } catch (err) {
    console.error('getExpectations error:', err.message)
    res.status(500).json({ ok: false, message: err.message })
  }
}

module.exports = {
  chat, chatStream, compare, getHistory, getStatus, getMemoryField, getThoughts, sseEvents,
  pauseAutonomy, resumeAutonomy, getAutonomyStatus, updateAutonomySettings,
  listConversations, patchConversation, deleteConversation,
  triggerThought,
  archiveConcernEndpoint, getArchivedConcernsEndpoint, contemplateArchivedEndpoint,
  setCurrentConcernEndpoint, answerConcernEndpoint, answerInitiativeEndpoint,
  getRecordings, getRecording, getRecordingStats, deleteRecordings,
  listPersonalities,
  gestateEndpoint,
  getExpectations
}
