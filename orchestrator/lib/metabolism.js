/**
 * metabolism.js — Metabolic Processing of Memories
 *
 * Memories are not static records. They decay, contradict each other,
 * reconsolidate under review, and eventually blur into vague impressions.
 * This module implements the five phases of memory metabolism:
 *
 *   Phase 1  Confidence Vector Decay      — exponential erosion of certainty
 *   Phase 2  Contradiction Buffers        — sustained incoherence between clashing memories
 *   Phase 3  Reconsolidation Window       — scheduled LLM re-encoding of hot memories
 *   Phase 4  Limbic Module                — counterfactual stress-testing of emotional memories
 *            Entropy Injection            — narrative-lock detection and random perturbation
 *   Phase 5  Gist Generation              — fuzzy impressions when confidence drops low
 *
 * Every decay rate, threshold, and formula is load-bearing.
 * Do not tune constants without understanding the downstream effects.
 */

const Memory       = require('../models/Memory')
const Contradiction = require('../models/Contradiction')
const AgentState   = require('../models/AgentState')
const { cosineSimilarity } = require('./similarity')

// ════════════════════════════════════════════════════════════════════
//  Backward-Compatibility Helper
// ════════════════════════════════════════════════════════════════════

/**
 * Normalize legacy scalar confidence to the canonical vector format.
 * Used everywhere confidence is read — ensures a uniform shape regardless
 * of whether the memory was created before or after the vector schema.
 *
 * @param   {Object} mem - A memory document (or lean object).
 * @returns {{ initial: number, current: number, decayedAt: Date|null, revisionCount: number, entropyBudget: number }}
 */
function getConfidence(mem) {
  if (mem.confidence && typeof mem.confidence === 'object' && 'current' in mem.confidence) {
    return mem.confidence
  }
  // Legacy scalar → migrate to vector
  const scalar = (typeof mem.confidence === 'number') ? mem.confidence : 1.0
  return {
    initial:        scalar,
    current:        scalar,
    decayedAt:      null,
    revisionCount:  0,
    entropyBudget:  1.0
  }
}

// ════════════════════════════════════════════════════════════════════
//  Phase 1 — Confidence Vector Decay
// ════════════════════════════════════════════════════════════════════
//
//  Events stay crystalline.  Interpretations become porous.
//  Lambda scales with |emotionalValence| — high emotional charge
//  accelerates interpretive decay (the anti-smoothing).
//  The event trace (sourceText / sourceComposite) is never touched.

/**
 * Apply exponential decay to confidence.current for a batch of memories.
 *
 * Formula:
 *   λ = baseLambda + |emotionalValence| × 0.02
 *   decayed = initial × e^(−λ × ageHours)
 *   newCurrent = clamp(decayed + noise, 0.1, 1.0)
 *
 * Noise:  uniform ±0.02  (σ ≈ 0.02)
 * Batch:  200 memories per call (gradual decay covers the full set over cycles).
 * Skip:   memories already floored at ≤ 0.1.
 *
 * @param   {string} conversationId
 * @param   {string} [userId='anonymous']
 * @returns {Promise<number>} Count of memories updated.
 */
async function decayConfidenceVectors(conversationId, userId = 'anonymous') {
  const memories = await Memory.find({
    userId,
    role: { $ne: 'file' },                    // file memories are immune to decay
    'confidence.current': { $gt: 0.1 }       // skip already-floored memories
  })
    .select('confidence emotionalValence timestamp')
    .limit(200)                               // batch cap — full set reached over cycles
    .lean()

  if (memories.length === 0) return 0

  const now     = Date.now()
  const updates = []

  for (const mem of memories) {
    const conf     = getConfidence(mem)
    const ageMs    = now - new Date(mem.timestamp).getTime()
    const ageHours = ageMs / (1000 * 60 * 60)

    // Base decay rate
    const baseLambda = 0.005

    // Salience multiplier: high |emotionalValence| → faster decay.
    // This is the anti-smoothing — strong emotions make you LESS certain
    // about your interpretation over time, not more.
    const salience      = Math.abs(mem.emotionalValence || 0)
    const salienceLambda = baseLambda + (salience * 0.02)

    // Exponential decay:  new_current = initial × e^(−λt) + noise(σ)
    const decayed    = conf.initial * Math.exp(-salienceLambda * ageHours)
    const noise      = (Math.random() - 0.5) * 0.04    // σ ≈ 0.02
    const newCurrent = Math.max(0.1, Math.min(1.0, decayed + noise))

    // Only update if meaningfully different (avoid DB churn)
    if (Math.abs(newCurrent - conf.current) < 0.005) continue

    updates.push(Memory.updateOne(
      { _id: mem._id },
      { $set: {
        'confidence.current': parseFloat(newCurrent.toFixed(4)),
        'confidence.decayedAt': new Date()
      }}
    ))
  }

  if (updates.length > 0) {
    await Promise.all(updates)
  }

  return updates.length
}

// ════════════════════════════════════════════════════════════════════
//  Phase 2 — Contradiction Buffers
// ════════════════════════════════════════════════════════════════════
//
//  When two memories are semantically close but point in opposite
//  directions, don't resolve the contradiction — hold it.  Create
//  sustained incoherence.  Both memories get capped retrieval weight
//  until the contradiction is metabolized.

/**
 * Compute sign divergence between two vectors on top-magnitude dimensions.
 * Measures how many of the most important dimensions carry opposite signs.
 *
 * @param   {number[]} a    - First composite vector.
 * @param   {number[]} b    - Second composite vector.
 * @param   {number}  [topN=20] - Number of top dimensions to inspect.
 * @returns {number}  0–1:  0 = same direction, 1 = completely opposite.
 */
function computeSignDivergence(a, b, topN = 20) {
  if (!a || !b || a.length !== b.length) return 0

  // Find top-N dimensions by combined magnitude
  const dims = a.map((val, i) => ({ i, mag: Math.abs(val) + Math.abs(b[i]) }))
  dims.sort((x, y) => y.mag - x.mag)
  const topDims = dims.slice(0, Math.min(topN, dims.length))

  let signFlips = 0
  for (const d of topDims) {
    if (a[d.i] * b[d.i] < 0) signFlips++     // opposite signs
  }

  return signFlips / topDims.length
}

/**
 * Detect contradictions between a new memory and its resonant neighbours.
 *
 * A contradiction is declared when:
 *   cosineSimilarity > 0.65   (same topic)
 *   AND signDivergence > 0.25 (opposing interpretations)
 *
 * Creates a Contradiction document with a 24-hour cooling timer.
 * Both participating memories are marked `metabolized: false` to cap
 * their retrieval weight while the contradiction is live.
 *
 * @param   {string}  conversationId
 * @param   {Object}  newMemory        - The freshly stored memory (must have .composite).
 * @param   {Array}   resonantMemories - Memories that resonated with the new one.
 * @param   {string}  [userId='anonymous']
 * @returns {Promise<number>} Count of contradictions created.
 */
async function detectContradictions(conversationId, newMemory, resonantMemories, userId = 'anonymous') {
  if (!newMemory?.composite || newMemory.composite.length === 0) return 0
  if (!resonantMemories || resonantMemories.length === 0) return 0

  let created = 0

  for (const mem of resonantMemories) {
    if (!mem._id || !mem.composite || mem.composite.length === 0) continue
    // Skip self
    if (newMemory._id && mem._id.toString() === newMemory._id.toString()) continue

    const similarity = cosineSimilarity(newMemory.composite, mem.composite)

    // High similarity means they're about the same topic
    if (similarity < 0.65) continue

    // Check for opposition: sign divergence on top-magnitude dimensions.
    // If two vectors are about the same thing but "pointing differently",
    // the top dimensions will have opposite signs.
    const signDivergence = computeSignDivergence(newMemory.composite, mem.composite)

    // Threshold: high similarity + meaningful sign divergence = contradiction
    if (signDivergence < 0.25) continue

    // Check if contradiction already exists between these two memories
    const existing = await Contradiction.findOne({
      userId,
      status: { $in: ['active', 'cooling'] },
      $or: [
        { memoryA: newMemory._id, memoryB: mem._id },
        { memoryA: mem._id, memoryB: newMemory._id }
      ]
    })
    if (existing) continue

    const tensionScore  = similarity * signDivergence      // higher = more tense
    const coolingHours  = 24
    const coolingExpires = new Date(Date.now() + coolingHours * 60 * 60 * 1000)

    await Contradiction.create({
      memoryA:      newMemory._id,
      memoryB:      mem._id,
      tensionScore: parseFloat(tensionScore.toFixed(4)),
      coolingExpires,
      status:       'cooling',
      userId,
      conversationId
    })

    // Mark both memories as having active contradictions (capped retrieval)
    await Memory.updateMany(
      { _id: { $in: [newMemory._id, mem._id] } },
      { $set: { metabolized: false } }
    )

    created++
    console.log(`  [Contradiction] Detected between memories: similarity=${similarity.toFixed(3)}, signDiv=${signDivergence.toFixed(3)}, tension=${tensionScore.toFixed(3)}`)
  }

  return created
}

/**
 * Metabolize expired contradictions.
 * When a contradiction's cooling timer expires:
 *   1. Reduce entropy budget by 0.1 on both participating memories.
 *   2. Mark both memories as `metabolized: true`.
 *   3. Transition the Contradiction document to 'metabolized' status.
 *
 * @param   {string} conversationId
 * @param   {string} [userId='anonymous']
 * @returns {Promise<number>} Count of contradictions metabolized.
 */
async function coolContradictions(conversationId, userId = 'anonymous') {
  const expired = await Contradiction.find({
    userId,
    status: 'cooling',
    coolingExpires: { $lt: new Date() }
  }).lean()

  if (expired.length === 0) return 0

  let metabolized = 0

  for (const contra of expired) {
    // Reduce entropy budget on both memories (contradiction cost)
    await Memory.updateMany(
      { _id: { $in: [contra.memoryA, contra.memoryB] } },
      {
        $set: { metabolized: true },
        $inc: { 'confidence.entropyBudget': -0.1 }
      }
    )

    // Mark contradiction as metabolized
    await Contradiction.updateOne(
      { _id: contra._id },
      { $set: { status: 'metabolized', metabolizedAt: new Date() } }
    )

    metabolized++
  }

  if (metabolized > 0) {
    console.log(`  [Metabolism] Metabolized ${metabolized} contradictions`)
  }

  return metabolized
}

/**
 * Return the set of memory IDs currently involved in active or cooling
 * contradictions.  Used by the retrieval pipeline to tag contested memories
 * so their retrieval weight can be capped.
 *
 * @param   {string}   conversationId
 * @param   {Array}    memoryIds - Array of ObjectId or string IDs to check.
 * @param   {string}   [userId='anonymous']
 * @returns {Promise<Set<string>>} Set of contested memory-ID strings.
 */
async function getActiveContradictions(conversationId, memoryIds, userId = 'anonymous') {
  if (!memoryIds || memoryIds.length === 0) return new Set()

  const contradictions = await Contradiction.find({
    userId,
    status: { $in: ['active', 'cooling'] },
    $or: [
      { memoryA: { $in: memoryIds } },
      { memoryB: { $in: memoryIds } }
    ]
  }).select('memoryA memoryB').lean()

  const contested = new Set()
  for (const c of contradictions) {
    contested.add(c.memoryA.toString())
    contested.add(c.memoryB.toString())
  }
  return contested
}

// ════════════════════════════════════════════════════════════════════
//  Phase 3 — Reconsolidation Window
// ════════════════════════════════════════════════════════════════════
//
//  Every slow cycle: find the top 10% most-accessed memories from
//  the past 24 hours and re-encode them through the LLM.
//  Old interpretations are pushed to revisions[] (git-style history).
//  sourceText / sourceComposite stay untouched (crystalline event).

/**
 * Run the scheduled reconsolidation window.
 *
 * Selection:  memories accessed in the past 24 h, sorted by accessCount desc.
 *             Top 10 % are taken (min 1, max 5).
 * Cooldown:   skip any memory revised within the last 6 hours.
 * Process:    LLM re-expresses the memory given current understanding.
 *             New text is re-embedded, drift from source is measured,
 *             old text is pushed to revisions[].
 * Cost:       each revision reduces confidence.current by 5 %.
 *
 * @param   {string} conversationId
 * @param   {string} model    - LLM model identifier.
 * @param   {Object} apiKeys  - Provider API keys.
 * @param   {string} [userId='anonymous']
 * @returns {Promise<number>} Count of memories revised.
 */
async function runReconsolidationWindow(conversationId, model, apiKeys, userId = 'anonymous') {
  // Lazy requires to avoid circular dependencies
  const { generate }  = require('./generate')
  const { decompose } = require('./embedder')

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  // Find memories accessed in the past 24 h, sorted by access count
  const recentlyAccessed = await Memory.find({
    userId,
    lastAccessed: { $gte: oneDayAgo }
  })
    .sort({ accessCount: -1 })
    .select('text sourceText composite sourceComposite confidence retrievalCount accessCount emotionalValence revisions timestamp')
    .lean()

  if (recentlyAccessed.length === 0) return 0

  // Take top 10 % (at least 1, at most 5)
  const topCount   = Math.max(1, Math.min(5, Math.ceil(recentlyAccessed.length * 0.1)))
  const candidates = recentlyAccessed.slice(0, topCount)

  let revised = 0

  for (const mem of candidates) {
    // Skip if recently reconstructed (within 6 hours)
    const revisions = mem.revisions || []
    if (revisions.length > 0) {
      const lastRevision = revisions[revisions.length - 1]
      if (lastRevision.timestamp && (Date.now() - new Date(lastRevision.timestamp).getTime()) < 6 * 60 * 60 * 1000) {
        continue
      }
    }

    try {
      const conf       = getConfidence(mem)
      const sourceText = mem.sourceText || mem.text

      const systemPrompt = `You are revisiting a memory during a reconsolidation window. You have the original experience and need to re-express it as you understand it NOW — given everything you've learned since it was formed. This is not correction; it is the natural drift of interpretation over time.

The memory was formed at: ${new Date(mem.timestamp).toISOString()}
It has been accessed ${mem.accessCount || 0} times.
Your current confidence in this interpretation: ${(conf.current * 100).toFixed(0)}%
Times previously revised: ${conf.revisionCount}

Output ONLY the re-interpreted memory text. No preamble, no labels.`

      const userPrompt = `Original experience:\n"${sourceText}"\n\nCurrent interpretation:\n"${mem.text}"\n\nGiven everything learned since this was formed, how would you phrase this differently?`

      const revised_text = await generate(userPrompt, systemPrompt, 0.4, model, apiKeys)
      const trimmed = (revised_text || '').trim()
      if (!trimmed || trimmed.length < 10) continue

      // Re-embed the revised text
      const { composite: newComposite } = await decompose(trimmed)

      // Compute drift from the crystalline source
      const sourceVec = (mem.sourceComposite && mem.sourceComposite.length > 0)
        ? mem.sourceComposite : mem.composite
      const drift = 1 - cosineSimilarity(newComposite, sourceVec)

      // Revision costs a little confidence (5 %)
      const newCurrent = Math.max(0.1, conf.current * 0.95)

      await Memory.updateOne({ _id: mem._id }, {
        $set: {
          text:       trimmed,
          composite:  newComposite,
          vectorDrift: parseFloat(drift.toFixed(6)),
          'confidence.current': parseFloat(newCurrent.toFixed(4))
        },
        $inc: { 'confidence.revisionCount': 1 },
        $push: {
          revisions: {
            text:      mem.text,
            composite: mem.composite,
            timestamp: new Date(),
            context:   'Scheduled reconsolidation window'
          }
        }
      })

      revised++
      console.log(`  [ReconWindow] Revised memory ${mem._id}: drift=${drift.toFixed(4)}, revision #${conf.revisionCount + 1}`)
    } catch (err) {
      console.error(`  [ReconWindow] Failed to revise memory ${mem._id}:`, err.message)
    }
  }

  return revised
}

// ════════════════════════════════════════════════════════════════════
//  Phase 3b — Limbic Module (Counterfactual Analysis)
// ════════════════════════════════════════════════════════════════════
//
//  For high-emotional-salience memories, run counterfactual permutations.
//  "If X had happened differently, would this still matter?"
//  High divergence = interpretation was context-dependent → reduce confidence.
//  Low divergence  = interpretation is robust → leave it alone.

/**
 * Run the limbic counterfactual module.
 *
 * Selection:  memories with |emotionalValence| > 0.3 that haven't been
 *             limbic-processed in the past 6 hours, sorted by valence desc,
 *             limited to 3 per cycle.
 * Process:    LLM imagines a counterfactual version and scores divergence 0–1.
 * Effect:     divergence > 0.6 → confidence reduced by up to 15 %
 *               reduction = divergenceScore × 0.15
 *
 * @param   {string} conversationId
 * @param   {string} model
 * @param   {Object} apiKeys
 * @param   {string} [userId='anonymous']
 * @returns {Promise<number>} Count of memories processed.
 */
async function runLimbicModule(conversationId, model, apiKeys, userId = 'anonymous') {
  // Lazy requires to avoid circular dependencies
  const { generate }  = require('./generate')
  const { decompose } = require('./embedder')

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000)

  // Find memories with significant emotional valence, not recently limbic-processed
  const candidates = await Memory.find({
    userId,
    $and: [
      { $or: [
        { emotionalValence: { $gt: 0.3 } },
        { emotionalValence: { $lt: -0.3 } }
      ]},
      { $or: [
        { limbicProcessedAt: null },
        { limbicProcessedAt: { $lt: sixHoursAgo } }
      ]}
    ]
  })
    .sort({ emotionalValence: -1 })
    .limit(3)
    .select('text composite confidence emotionalValence timestamp')
    .lean()

  if (candidates.length === 0) return 0

  let processed = 0

  for (const mem of candidates) {
    try {
      const systemPrompt = `You are running a counterfactual analysis on a memory with high emotional weight. Your task: imagine the key event had gone differently. Then assess whether the memory's significance would change.

Output a single paragraph: the counterfactual version of the memory. Then on a new line, output a number 0-1 indicating DIVERGENCE: 0 = the memory would matter just as much regardless, 1 = the memory only matters because of specific context that could easily have been different.

Format:
[counterfactual paragraph]
DIVERGENCE: [0-1]`

      const userPrompt = `Memory (emotional weight: ${(mem.emotionalValence || 0).toFixed(2)}):\n"${mem.text}"\n\nIf the key element of this had happened differently, would it still matter?`

      const result  = await generate(userPrompt, systemPrompt, 0.5, model, apiKeys)
      const trimmed = (result || '').trim()

      // Parse divergence score from LLM output
      const divergenceMatch = trimmed.match(/DIVERGENCE:\s*([\d.]+)/i)
      const divergenceScore = divergenceMatch ? parseFloat(divergenceMatch[1]) : 0.5

      const conf   = getConfidence(mem)
      const update = {
        $set: {
          divergenceScore:   parseFloat(Math.min(1, Math.max(0, divergenceScore)).toFixed(4)),
          limbicProcessedAt: new Date()
        }
      }

      // High divergence → interpretation was context-dependent, reduce confidence
      if (divergenceScore > 0.6) {
        const reduction = divergenceScore * 0.15          // up to 15 % reduction
        const newCurrent = Math.max(0.1, conf.current * (1 - reduction))
        update.$set['confidence.current'] = parseFloat(newCurrent.toFixed(4))
        console.log(`  [Limbic] Memory ${mem._id}: divergence=${divergenceScore.toFixed(2)} (high) → confidence reduced to ${newCurrent.toFixed(2)}`)
      } else {
        console.log(`  [Limbic] Memory ${mem._id}: divergence=${divergenceScore.toFixed(2)} (robust interpretation)`)
      }

      await Memory.updateOne({ _id: mem._id }, update)
      processed++
    } catch (err) {
      console.error(`  [Limbic] Failed to process memory ${mem._id}:`, err.message)
    }
  }

  return processed
}

// ════════════════════════════════════════════════════════════════════
//  Phase 4 — Entropy Injection
// ════════════════════════════════════════════════════════════════════
//
//  If retrieval patterns show > 80 % consistency over recent queries,
//  the system is telling itself the same story.  Inject random distant
//  memories to break narrative lock.  Retrospective validation:
//  bindings that survive 3 reconsolidation cycles = signal; frayed = noise.

/**
 * Track a query composite for narrative lock detection.
 * Maintains a rolling buffer of the last 50 query composites in AgentState.
 *
 * @param {string}   conversationId
 * @param {number[]} composite - The query's composite vector.
 * @param {string}   [userId='anonymous']
 */
async function trackQueryComposite(conversationId, composite, userId = 'anonymous') {
  if (!composite || composite.length === 0) return

  await AgentState.findOneAndUpdate(
    { userId },
    {
      $push: {
        recentQueryComposites: {
          $each:  [{ composite, timestamp: new Date() }],
          $slice: -50   // keep last 50
        }
      }
    }
  )
}

/**
 * Check if entropy injection is needed (narrative lock detection).
 *
 * Algorithm:
 *   1. Load the last 50 query composites from AgentState.
 *   2. Sample pairwise cosine similarities (strided, not exhaustive).
 *   3. If avgPairwiseSimilarity > 0.80, set entropyInjectionNeeded flag.
 *
 * Requires at least 10 composites before activation.
 *
 * @param   {string}  conversationId
 * @param   {string}  [userId='anonymous']
 * @returns {Promise<boolean>} True if narrative lock is detected.
 */
async function checkEntropyInjection(conversationId, userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
    .select('recentQueryComposites entropyInjectionNeeded')
    .lean()

  if (!state?.recentQueryComposites || state.recentQueryComposites.length < 10) {
    return false
  }

  const composites = state.recentQueryComposites
    .filter(q => q.composite && q.composite.length > 0)
    .map(q => q.composite)

  if (composites.length < 10) return false

  // Sample pairwise similarities (strided — not all pairs, too expensive for 50)
  let totalSim = 0
  let pairs    = 0
  const step   = Math.max(1, Math.floor(composites.length / 10))

  for (let i = 0; i < composites.length; i += step) {
    for (let j = i + step; j < composites.length; j += step) {
      totalSim += cosineSimilarity(composites[i], composites[j])
      pairs++
    }
  }

  const avgSimilarity = pairs > 0 ? totalSim / pairs : 0
  const narrativeLock = avgSimilarity > 0.80

  if (narrativeLock !== (state.entropyInjectionNeeded || false)) {
    await AgentState.findOneAndUpdate(
      { userId },
      { $set: { entropyInjectionNeeded: narrativeLock } }
    )
  }

  if (narrativeLock) {
    console.log(`  [Entropy] Narrative lock detected: avg query similarity = ${avgSimilarity.toFixed(3)}`)
  }

  return narrativeLock
}

/**
 * Inject entropy: sample random distant memories and append them to the
 * resonant set.  Called during the chat pipeline when the
 * `entropyInjectionNeeded` flag is set.
 *
 * Selection:
 *   - Memories older than 7 days (distant).
 *   - Randomly sampled via $sample (5 candidates), then trimmed to 2–3.
 *   - Excludes memories already in the resonant set.
 *
 * Side effects:
 *   - Clears the entropyInjectionNeeded flag.
 *   - Stores entropy bindings in AgentState for retrospective survival tracking.
 *
 * @param   {string}      conversationId
 * @param   {Array|null}  allMemories    - DEPRECATED, no longer used. Kept for API compat.
 * @param   {Array}       resonant       - Currently resonant memories (excluded from injection).
 * @param   {string}      currentContext - Current user message text.
 * @param   {string}      [userId='anonymous']
 * @returns {Promise<Array>} Injected memory objects, tagged with _entropyInjected: true.
 */
async function injectEntropy(conversationId, allMemories, resonant, currentContext, userId = 'anonymous') {
  // Memories older than 7 days are "distant"
  const cutoffDate  = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const resonantIds = new Set(resonant.filter(m => m._id).map(m => m._id.toString()))

  // Fetch random distant memories directly from DB
  const distantCandidates = await Memory.aggregate([
    {
      $match: {
        userId,
        timestamp: { $lt: cutoffDate },
        _id: { $nin: resonant.filter(m => m._id).map(m => m._id) }
      }
    },
    { $sample: { size: 5 } }
  ])

  // Filter out any that ended up in resonant (edge case with aggregation)
  const filtered = distantCandidates.filter(m => !resonantIds.has(m._id.toString()))

  if (filtered.length === 0) return []

  // Take 2–3 memories
  const sampleSize = Math.min(3, filtered.length)
  const injected   = filtered.slice(0, sampleSize)

  // Create entropy bindings for retrospective tracking
  const bindings = injected.map(m => ({
    injectedMemoryId: m._id,
    boundToContext:   (currentContext || '').slice(0, 200),
    injectedAt:       new Date(),
    survivedCycles:   0,
    status:           'active'
  }))

  await AgentState.findOneAndUpdate(
    { userId },
    {
      $set:  { entropyInjectionNeeded: false },
      $push: {
        entropyBindings: { $each: bindings, $slice: -50 }   // keep last 50
      }
    }
  )

  console.log(`  [Entropy] Injected ${injected.length} distant memories into context`)

  // Tag them for the prompt formatter
  return injected.map(m => ({
    ...m,
    _entropyInjected:  true,
    drag:              0.05,
    resonance:         0,
    matches:           [],
    frequenciesMatched: 0,
    tier:              'archived'
  }))
}

/**
 * Validate entropy bindings retrospectively.
 *
 * For each active binding, check if the injected memory's revisions since
 * injection show a stable connection (survived reconsolidation) or frayed
 * (reverted / drifted away).
 *
 * Classification:
 *   ≥ 3 revision cycles since injection   → 'signal'  (was meaningful)
 *   > 7 days old without hitting 3 cycles  → 'noise'   (expired)
 *
 * Called during the slow metabolism cycle.
 *
 * @param   {string} conversationId
 * @param   {string} [userId='anonymous']
 * @returns {Promise<number>} Count of bindings that changed status.
 */
async function validateEntropyBindings(conversationId, userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
    .select('entropyBindings')
    .lean()

  if (!state?.entropyBindings || state.entropyBindings.length === 0) return 0

  const activeBindings = state.entropyBindings.filter(b => b.status === 'active')
  if (activeBindings.length === 0) return 0

  let validated = 0

  for (const binding of activeBindings) {
    const mem = await Memory.findById(binding.injectedMemoryId)
      .select('revisions reconstructedAt')
      .lean()

    if (!mem) continue

    // Count revisions since injection
    const revisionsSinceInjection = (mem.revisions || []).filter(
      r => new Date(r.timestamp) > new Date(binding.injectedAt)
    ).length

    const newSurvivedCycles = revisionsSinceInjection
    let newStatus = 'active'

    if (newSurvivedCycles >= 3) {
      newStatus = 'signal'    // survived 3 reconsolidation cycles = was meaningful
      console.log(`  [Entropy] Binding ${binding.injectedMemoryId} classified as SIGNAL (survived ${newSurvivedCycles} cycles)`)
    } else if (Date.now() - new Date(binding.injectedAt).getTime() > 7 * 24 * 60 * 60 * 1000) {
      // Older than 7 days without hitting 3 cycles = noise
      newStatus = 'noise'
      console.log(`  [Entropy] Binding ${binding.injectedMemoryId} classified as NOISE (expired)`)
    }

    if (newStatus !== 'active' || newSurvivedCycles !== binding.survivedCycles) {
      await AgentState.updateOne(
        { userId, 'entropyBindings.injectedMemoryId': binding.injectedMemoryId },
        { $set: {
          'entropyBindings.$.survivedCycles': newSurvivedCycles,
          'entropyBindings.$.status':         newStatus
        }}
      )
      validated++
    }
  }

  return validated
}

// ════════════════════════════════════════════════════════════════════
//  Phase 5 — Gist Generation (Fuzzy Recall)
// ════════════════════════════════════════════════════════════════════
//
//  As confidence decays, memories don't just truncate — they degrade
//  into vague, emotionally-coloured impressions.  Gists are generated
//  when confidence crosses below the threshold, producing a compressed
//  version of the memory the way a human would half-remember something
//  from months ago.

/** Confidence threshold below which a gist is generated */
const GIST_CONFIDENCE_THRESHOLD = 0.5

/**
 * Generate gists for memories whose confidence has dropped below threshold.
 *
 * Selection:  confidence.current < 0.5, no gist yet, sorted most-degraded first.
 * Limit:      3 per cycle (avoid LLM overload).
 * Process:    LLM produces a vague, first-person impression — not a summary.
 * Output:     Stored as `gist` field on the Memory document, max 300 chars.
 *
 * @param   {string} conversationId
 * @param   {string} model
 * @param   {Object} apiKeys
 * @param   {string} [userId='anonymous']
 * @returns {Promise<number>} Count of gists generated.
 */
async function generateGists(conversationId, model, apiKeys, userId = 'anonymous') {
  // Lazy require to avoid circular dependency
  const { generate } = require('./generate')

  // Find memories that need gists:
  //   - confidence below threshold
  //   - no gist yet (or gist is stale — confidence dropped significantly since last gist)
  const candidates = await Memory.find({
    userId,
    'confidence.current': { $lt: GIST_CONFIDENCE_THRESHOLD },
    gist: null
  })
    .sort({ 'confidence.current': 1 })     // most degraded first
    .limit(3)
    .select('text sourceText confidence emotionalValence vibrations timestamp')
    .lean()

  if (candidates.length === 0) return 0

  let generated = 0

  for (const mem of candidates) {
    try {
      const conf    = getConfidence(mem)
      const confPct = (conf.current * 100).toFixed(0)
      const valence = mem.emotionalValence || 0
      const emotionHint = valence > 0.2  ? 'emotionally charged (positive)'
        : valence < -0.2 ? 'emotionally charged (negative)'
        : 'emotionally neutral'

      // Use vibration words as semantic anchors
      const vibWords = (mem.vibrations || []).slice(0, 8).map(v => v.word).join(', ')

      const systemPrompt = `You are compressing a memory into a vague impression — the way a person remembers something from long ago. Not a summary. An impression.

RULES:
- Lose exact words, names may blur, numbers disappear
- Keep the emotional feeling and the core gist
- The lower the confidence, the hazier it should be
- At very low confidence, it should feel like a half-remembered dream
- One sentence, maximum two. No quotes. No timestamps.
- Write in first person as the one remembering ("Something about...", "I think there was...", "A feeling of...")

Memory confidence: ${confPct}%
Emotional tone: ${emotionHint}
Key concepts: ${vibWords || 'unclear'}

Output ONLY the impression. Nothing else.`

      const sourceText  = mem.sourceText || mem.text
      const userPrompt  = `Original memory:\n"${sourceText.slice(0, 500)}"\n\nHow would you vaguely remember this?`

      const gist    = await generate(userPrompt, systemPrompt, 0.4, model, apiKeys, 'gist-generation')
      const trimmed = (gist || '').trim()

      if (!trimmed || trimmed.length < 5) continue

      await Memory.updateOne({ _id: mem._id }, {
        $set: {
          gist:     trimmed.slice(0, 300),
          gistedAt: new Date()
        }
      })

      generated++
      console.log(`  [Gist] Generated for memory ${mem._id} (conf=${confPct}%): "${trimmed.slice(0, 60)}..."`)
    } catch (err) {
      console.error(`  [Gist] Failed for memory ${mem._id}:`, err.message)
    }
  }

  return generated
}

// ════════════════════════════════════════════════════════════════════
//  Exports
// ════════════════════════════════════════════════════════════════════

module.exports = {
  // Helpers
  getConfidence,
  computeSignDivergence,

  // Phase 1 — Confidence Decay
  decayConfidenceVectors,

  // Phase 2 — Contradiction Buffers
  detectContradictions,
  coolContradictions,
  getActiveContradictions,

  // Phase 3 — Reconsolidation + Limbic
  runReconsolidationWindow,
  runLimbicModule,

  // Phase 4 — Entropy Injection
  trackQueryComposite,
  checkEntropyInjection,
  injectEntropy,
  validateEntropyBindings,

  // Phase 5 — Gist Generation
  generateGists,
  GIST_CONFIDENCE_THRESHOLD
}
