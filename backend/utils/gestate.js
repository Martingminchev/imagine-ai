const Memory = require('../models/Memory')
const AgentState = require('../models/AgentState')
const { decompose } = require('./embedder')
const { cosineSimilarity } = require('./similarity')
const { generate } = require('./generate')
const { storeExpectations } = require('./expectation')

const PHI_INV = (Math.sqrt(5) - 1) / 2   // 1/φ ≈ 0.618
const PHI_COMP = 1 - PHI_INV             // 1 - 1/φ ≈ 0.382

/**
 * Gestate a new AI instance with a full life history.
 * Takes a biographical description, generates memories spanning the lifespan,
 * processes them through the full pipeline, and births the AI with a populated horn.
 */
async function gestate(conversationId, biography, model, apiKeys, onProgress = () => {}) {
  const { age } = biography
  const now = Date.now()

  // ── Step 1: Generate life memories via LLM ──
  onProgress({ step: 'generating', detail: 'Creating life memories...' })
  const rawMemories = await generateLifeMemories(biography, model, apiKeys)
  onProgress({ step: 'generating', detail: `Generated ${rawMemories.length} memories` })

  // ── Step 2: Decompose each memory into composites + vibrations ──
  const memDocs = []
  for (let i = 0; i < rawMemories.length; i++) {
    if (i % 10 === 0 || i === rawMemories.length - 1) {
      onProgress({ step: 'decomposing', detail: `Processing memory ${i + 1}/${rawMemories.length}...` })
    }

    const mem = rawMemories[i]
    try {
      const { vibrations, composite } = await decompose(mem.text)
      const yearsAgo = Math.max(0, age - mem.age)
      const timestamp = new Date(now - yearsAgo * 365.25 * 24 * 60 * 60 * 1000)

      memDocs.push({
        text: mem.text,
        role: 'ai',
        composite,
        vibrations,
        conversationId,
        timestamp,
        emotionalValence: mem.emotional || 0,
        sourceText: mem.text,
        sourceComposite: [...composite],
        confidence: { initial: 1.0, current: 1.0, decayedAt: null, revisionCount: 0, entropyBudget: 1.0 },
        localDensity: 1,
        accessCount: mem.formative ? Math.floor(Math.random() * 6) + 3 : Math.floor(Math.random() * 2),
        dissonance: 0
      })
    } catch (err) {
      console.error(`  [Gestate] Failed to decompose memory ${i}: ${err.message}`)
    }
  }

  if (memDocs.length === 0) {
    throw new Error('No memories could be processed. Check Ollama connection.')
  }

  // ── Step 3: Compute density clusters ──
  onProgress({ step: 'density', detail: 'Computing memory density...' })
  computeBatchDensity(memDocs)

  // ── Step 4: Apply synthetic aging ──
  onProgress({ step: 'aging', detail: 'Applying temporal aging...' })
  applySyntheticAging(memDocs, now)

  // ── Step 5: Insert all memories ──
  onProgress({ step: 'storing', detail: `Storing ${memDocs.length} memories...` })
  await Memory.insertMany(memDocs)

  // ── Step 6: Build hum ground state ──
  onProgress({ step: 'hum', detail: 'Building ground state...' })
  await buildHumFromMemories(conversationId, memDocs)

  // ── Step 7: Create AgentState with LLM-derived personality ──
  onProgress({ step: 'state', detail: 'Evolving identity from life experience...' })
  await deriveAgentState(conversationId, biography, model, apiKeys)

  // ── Step 8: Generate birth expectations (forward orientation) ──
  onProgress({ step: 'anticipating', detail: 'Forming expectations about the future...' })
  const birthExpectations = await generateBirthExpectations(conversationId, biography, model, apiKeys)
  if (birthExpectations > 0) {
    onProgress({ step: 'anticipating', detail: `Born looking forward to ${birthExpectations} things` })
  }

  onProgress({ step: 'done', detail: `Born with ${memDocs.length} memories spanning ${age} years` })
  return { memoryCount: memDocs.length, conversationId }
}

/**
 * Ask the LLM to generate life memories from a biography.
 */
async function generateLifeMemories(biography, model, apiKeys) {
  const { name, age, background, formativeEvent, biggestLoss, beliefs, fears, joys, aloneTime, relationships, freeform } = biography

  const systemPrompt = `You are generating life memories for a fictional person. Return ONLY a valid JSON array. No markdown fences, no explanation, no preamble. Just the raw JSON array.`

  const userPrompt = `Generate life memories for this person:

Name: ${name || 'unnamed'}
Age: ${age || 30}
Background: ${background || 'not specified'}
What shaped them most: ${formativeEvent || 'not specified'}
What they lost: ${biggestLoss || 'not specified'}
What they believe: ${beliefs || 'not specified'}
What they fear: ${fears || 'not specified'}
What brings them joy: ${joys || 'not specified'}
What they do alone: ${aloneTime || 'not specified'}
Key relationships: ${relationships || 'not specified'}
Additional: ${freeform || 'none'}

Generate 80-120 memories spanning their entire life. Each memory is 1-3 sentences, first-person, as if recalling it now.

Include a mix of:
- Childhood (ages 3-12): sensory, simple, warm or confusing
- Adolescence (ages 13-18): identity, social, firsts
- Young adult (19-25): independence, love, mistakes
- Adult (26+): career, deepening bonds, loss, growth
- Recent (last 1-2 years): current state of mind
- Emotional landmarks: the moments that changed everything

Mix mundane with significant. Not everything is dramatic. A real person remembers the smell of rain as vividly as their first heartbreak.

Return a JSON array where each entry is:
{"age": <number>, "text": "<memory, first person>", "emotional": <-1.0 to 1.0>, "formative": <true/false>}`

  const raw = await generate(userPrompt, systemPrompt, 0.7, model, apiKeys, { conversationId: 'gestate', caller: 'gestate-memories' })

  // Parse JSON — handle markdown fences and extra text
  let jsonStr = raw.trim()
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  // Find the array boundaries
  const start = jsonStr.indexOf('[')
  const end = jsonStr.lastIndexOf(']')
  if (start === -1 || end === -1) {
    throw new Error('LLM did not return a valid JSON array of memories')
  }
  jsonStr = jsonStr.slice(start, end + 1)

  const memories = JSON.parse(jsonStr)
  if (!Array.isArray(memories) || memories.length === 0) {
    throw new Error('LLM returned empty or invalid memory array')
  }

  // Validate and clean
  return memories
    .filter(m => m && typeof m.text === 'string' && m.text.length > 5 && typeof m.age === 'number')
    .map(m => ({
      age: Math.max(1, Math.min(m.age, age)),
      text: m.text.slice(0, 500),
      emotional: typeof m.emotional === 'number' ? Math.max(-1, Math.min(1, m.emotional)) : 0,
      formative: !!m.formative
    }))
}

/**
 * Compute pairwise density for a batch of memories.
 */
function computeBatchDensity(memDocs) {
  const THRESHOLD = 0.55
  const INCREMENT = 0.15

  for (let i = 0; i < memDocs.length; i++) {
    let density = 1.0
    for (let j = 0; j < memDocs.length; j++) {
      if (i === j) continue
      if (!memDocs[i].composite?.length || !memDocs[j].composite?.length) continue
      const sim = cosineSimilarity(memDocs[i].composite, memDocs[j].composite)
      if (sim > THRESHOLD) density += INCREMENT
    }
    memDocs[i].localDensity = parseFloat(density.toFixed(2))
  }
}

/**
 * Apply synthetic aging to memories based on their timestamps.
 * Older memories get lower confidence, some vector drift, and revision marks.
 */
function applySyntheticAging(memDocs, now) {
  for (const mem of memDocs) {
    const ageMs = now - new Date(mem.timestamp).getTime()
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    const ageYears = ageDays / 365.25

    // Confidence decays with age — old interpretations become porous
    const confidenceDecay = Math.max(0.3, 1.0 - ageYears * 0.02)
    mem.confidence.current = parseFloat(confidenceDecay.toFixed(3))
    mem.confidence.decayedAt = new Date(now - Math.random() * 7 * 24 * 60 * 60 * 1000)

    // Vector drift — older memories shift from their original encoding
    if (ageYears > 1 && mem.composite?.length > 0) {
      const driftMagnitude = Math.min(0.08, ageYears * 0.002)
      const drifted = mem.composite.map(v => v + (Math.random() - 0.5) * driftMagnitude)
      // Compute drift distance
      let sumSq = 0
      for (let i = 0; i < mem.composite.length; i++) {
        const diff = drifted[i] - mem.composite[i]
        sumSq += diff * diff
      }
      mem.vectorDrift = parseFloat(Math.sqrt(sumSq).toFixed(5))
      mem.composite = drifted
    }

    // Formative memories with high access get revision marks
    if (mem.accessCount > 3 && ageYears > 2) {
      mem.confidence.revisionCount = Math.floor(ageYears / 3)
      mem.retrievalCount = mem.accessCount * 2
    }
  }
}

/**
 * Build the hum ground state and vector from a set of memories.
 * Computes the running mean (ground state) and golden-ratio-blends
 * the most recent memories into the hum vector.
 */
async function buildHumFromMemories(conversationId, memDocs) {
  const withComposites = memDocs.filter(m => m.composite?.length > 0)
  if (withComposites.length === 0) return

  const dims = withComposites[0].composite.length

  // Ground state = mean of all composites
  const groundState = new Array(dims).fill(0)
  for (const mem of withComposites) {
    for (let i = 0; i < dims; i++) {
      groundState[i] += mem.composite[i]
    }
  }
  for (let i = 0; i < dims; i++) {
    groundState[i] /= withComposites.length
  }

  // Hum vector = golden-ratio blend of the most recent memories
  // Sort by timestamp descending, take last 13 (F7)
  const sorted = [...withComposites].sort((a, b) =>
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  )
  const recent = sorted.slice(0, 13)

  let humVector = [...groundState]
  for (const mem of recent.reverse()) {
    humVector = humVector.map((h, i) =>
      PHI_INV * h + PHI_COMP * mem.composite[i]
    )
  }

  // Find the most recent memory timestamp for lastUpdated
  const latestTimestamp = sorted[0]?.timestamp || new Date()

  await AgentState.findOneAndUpdate(
    { conversationId },
    {
      $set: {
        'hum.vector': humVector,
        'hum.groundState': groundState,
        'hum.groundStateCount': withComposites.length,
        'hum.lastUpdated': latestTimestamp
      }
    },
    { upsert: true }
  )
}

/**
 * Derive the AgentState personality from the biography using the LLM.
 */
async function deriveAgentState(conversationId, biography, model, apiKeys) {
  const { name, age, background, formativeEvent, biggestLoss, beliefs, fears, joys, relationships } = biography

  const systemPrompt = `You are deriving a psychological profile from a life story. Return ONLY valid JSON. No markdown, no explanation.`

  const userPrompt = `Given this person's life:
Name: ${name || 'unnamed'}, Age: ${age || 30}
Background: ${background || ''}
What shaped them: ${formativeEvent || ''}
What they lost: ${biggestLoss || ''}
Beliefs: ${beliefs || ''}
Fears: ${fears || ''}
Joys: ${joys || ''}
Key relationships: ${relationships || ''}

Derive their psychological state. Return JSON:
{
  "core": {
    "honesty": <0-1>, "curiosity": <0-1>, "empathy": <0-1>,
    "selfPreservation": <0-1>, "courage": <0-1>, "integrity": <0-1>,
    "humility": <0-1>, "playfulness": <0-1>
  },
  "character": {
    "directness": <0-1>, "warmth": <0-1>, "humor": <0-1>,
    "patience": <0-1>, "assertiveness": <0-1>, "poeticness": <0-1>,
    "skepticism": <0-1>, "openness": <0-1>, "dominantStyle": "<word-word>"
  },
  "dynamic": {
    "mood": "<word-word>",
    "energy": <0-1>, "focus": <0-1>, "trust": <0-1>,
    "frustration": <0-1>, "excitement": <0-1>, "guardedness": <0-1>
  },
  "selfModel": {
    "identity": "<who they think they are, 1-2 sentences>",
    "strengths": ["<strength>", ...],
    "struggles": ["<struggle>", ...],
    "beliefs": ["<belief>", ...],
    "openQuestions": ["<question>", ...]
  }
}`

  try {
    const raw = await generate(userPrompt, systemPrompt, 0.3, model, apiKeys, { conversationId, caller: 'gestate-state' })
    let jsonStr = raw.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }
    const start = jsonStr.indexOf('{')
    const end = jsonStr.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      jsonStr = jsonStr.slice(start, end + 1)
    }

    const derived = JSON.parse(jsonStr)
    const clamp = (v) => Math.min(1, Math.max(0, v))

    const update = { personality: 'gestated' }

    if (derived.core) {
      update.core = {}
      for (const k of ['honesty', 'curiosity', 'empathy', 'selfPreservation', 'courage', 'integrity', 'humility', 'playfulness']) {
        if (typeof derived.core[k] === 'number') update.core[k] = clamp(derived.core[k])
      }
    }

    if (derived.character) {
      update.character = {}
      for (const k of ['directness', 'warmth', 'humor', 'patience', 'assertiveness', 'poeticness', 'skepticism', 'openness']) {
        if (typeof derived.character[k] === 'number') update.character[k] = clamp(derived.character[k])
      }
      if (typeof derived.character.dominantStyle === 'string') {
        update.character.dominantStyle = derived.character.dominantStyle.slice(0, 50)
      }
    }

    if (derived.dynamic) {
      update.dynamic = {}
      if (typeof derived.dynamic.mood === 'string') update.dynamic.mood = derived.dynamic.mood.slice(0, 100)
      for (const k of ['energy', 'focus', 'trust', 'frustration', 'excitement', 'guardedness']) {
        if (typeof derived.dynamic[k] === 'number') update.dynamic[k] = clamp(derived.dynamic[k])
      }
    }

    if (derived.selfModel) {
      update.selfModel = {}
      if (typeof derived.selfModel.identity === 'string') update.selfModel.identity = derived.selfModel.identity.slice(0, 500)
      if (Array.isArray(derived.selfModel.strengths)) update.selfModel.strengths = derived.selfModel.strengths.slice(0, 10).map(s => String(s).slice(0, 80))
      if (Array.isArray(derived.selfModel.struggles)) update.selfModel.struggles = derived.selfModel.struggles.slice(0, 10).map(s => String(s).slice(0, 80))
      if (Array.isArray(derived.selfModel.beliefs)) update.selfModel.beliefs = derived.selfModel.beliefs.slice(0, 10).map(s => String(s).slice(0, 100))
      if (Array.isArray(derived.selfModel.openQuestions)) update.selfModel.openQuestions = derived.selfModel.openQuestions.slice(0, 10).map(s => String(s).slice(0, 100))
    }

    await AgentState.findOneAndUpdate(
      { conversationId },
      { $set: update },
      { upsert: true }
    )

    console.log(`  [Gestate] AgentState derived: mood="${derived.dynamic?.mood}", identity="${(derived.selfModel?.identity || '').slice(0, 60)}..."`)
  } catch (err) {
    console.error(`  [Gestate] AgentState derivation failed: ${err.message}`)
    // Create minimal state so the conversation works
    await AgentState.findOneAndUpdate(
      { conversationId },
      { $set: { personality: 'gestated' } },
      { upsert: true }
    )
  }
}

/**
 * Generate initial expectations for a freshly gestated character.
 * A person isn't just their past — they wake up each day looking forward
 * to things, dreading things, anticipating what comes next.
 */
async function generateBirthExpectations(conversationId, biography, model, apiKeys) {
  const { name, age, background, fears, joys, relationships, freeform } = biography

  const systemPrompt = `You are generating the current expectations and anticipations of a fictional person — what they are looking forward to, dreading, or expecting to happen in the near and far future. These are NOT memories. These are forward-looking predictions based on their life situation.

Return ONLY a valid JSON array. No markdown, no explanation.`

  const userPrompt = `This person:
Name: ${name || 'unnamed'}, Age: ${age || 30}
Background: ${background || ''}
What they fear: ${fears || ''}
What brings them joy: ${joys || ''}
Key relationships: ${relationships || ''}
Additional: ${freeform || ''}

What are they currently expecting, anticipating, dreading, or looking forward to? Generate 3-5 expectations at different time horizons.

Include a mix:
- Things they're looking forward to (positive anticipation)
- Things they're worried about or expect to go wrong
- Neutral predictions about how their life will unfold

Each expectation should be specific and testable — not vague hopes. Written in first person, as inner thought.

Return JSON array where each entry is:
{"text": "<expectation, first person>", "horizon": "near|far", "confidence": <0.0-1.0>}

"near" = next few days/weeks. "far" = months ahead. Do NOT use "imminent" — there is no immediate context yet.`

  try {
    const raw = await generate(userPrompt, systemPrompt, 0.5, model, apiKeys, { conversationId, caller: 'gestate-expectations' })

    let jsonStr = raw.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }
    const start = jsonStr.indexOf('[')
    const end = jsonStr.lastIndexOf(']')
    if (start === -1 || end === -1) return 0
    jsonStr = jsonStr.slice(start, end + 1)

    const predictions = JSON.parse(jsonStr)
    if (!Array.isArray(predictions)) return 0

    const cleaned = predictions
      .filter(p => p.text && p.horizon && typeof p.confidence === 'number')
      .slice(0, 5)
      .map(p => ({
        text: String(p.text).slice(0, 500),
        horizon: ['near', 'far'].includes(p.horizon) ? p.horizon : 'near',
        confidence: Math.min(1, Math.max(0, p.confidence))
      }))

    if (cleaned.length === 0) return 0

    const stored = await storeExpectations(conversationId, cleaned)
    console.log(`  [Gestate] Born with ${stored.length} expectations`)
    return stored.length
  } catch (err) {
    console.error(`  [Gestate] Birth expectations failed: ${err.message}`)
    return 0
  }
}

module.exports = { gestate }
