/**
 * expectation.js — Double Horn Forward-Facing Prediction System
 *
 * The Double Horn topology mirrors Gabriel's Horn for memory (past) with a
 * second horn for expectations (future). Where memory's horn captures what HAS
 * happened, the expectation horn captures what MIGHT happen:
 *
 *   Past Horn (Memory)                Future Horn (Expectation)
 *   ←─ narrow tail (x=7, ancient)     narrow tail (x=7, far future) ─→
 *        ...                                ...
 *   ←─ wide mouth  (x=1, recent)      wide mouth  (x=1, imminent)  ─→
 *
 * Superfluid circulation flows between the two horns:
 *   - Confirmed predictions CREATE pathways (smooth flow)
 *   - Surprised predictions CREATE turbulence (damped flow)
 *   - Lapsed predictions simply evaporate
 *
 * Lifecycle:  active  →  confirmed | surprised | lapsed
 *
 * @module expectation
 */

const Expectation       = require('../models/Expectation')
const AgentState        = require('../models/AgentState')
const ConversationState = require('../models/ConversationState')
const Memory            = require('../models/Memory')
const { cosineSimilarity } = require('./similarity')
const { multiResonate }    = require('./resonance')

// Lazy-loaded to avoid circular dependency at import time
let _decompose = null
let _generate  = null

function getDecompose () {
  if (!_decompose) { _decompose = require('./embedder').decompose }
  return _decompose
}

function getGenerate () {
  if (!_generate) { _generate = require('./generate').generate }
  return _generate
}

function getSetRecordingContext () {
  return require('./generate').setRecordingContext
}


// ════════════════════════════════════════════════════════════════════════════
//  Constants
// ════════════════════════════════════════════════════════════════════════════

/** Golden ratio φ ≈ 1.618 */
const PHI     = (1 + Math.sqrt(5)) / 2

/** Inverse golden ratio 1/φ ≈ 0.618 — anticipatory coupling constant */
const PHI_INV = 1 / PHI

/** Complementary fraction 1 − 1/φ ≈ 0.382 — circulatory damping cap */
const PHI_COMP = 1 - PHI_INV

/** F(7) minutes in ms — circulation pathway decay time constant */
const VIVID_MS = 13 * 60 * 1000

/** Max horn position (narrow tail) — mirrors HORN_MAX_X from resonance */
const HORN_MAX_X = 7

/** F(6) — maximum concurrently active expectations */
const ACTIVE_CAP = 8

/** Cosine similarity threshold for confirming an expectation */
const CONFIRM_THRESHOLD = 0.65

/** Lapse at 2× the expectedBy window past creation */
const LAPSE_MULTIPLIER = 2

/** F(8) — maximum stored confirmed circulation pathways */
const CONFIRMED_PATHS_CAP = 21

/** Per-confirmation memory confidence boost ≈ 1.85% (scaled by similarity) */
const CONFIDENCE_BOOST_ON_CONFIRM = 0.03 * PHI_INV


// ════════════════════════════════════════════════════════════════════════════
//  §1  Temporal Mapping
// ════════════════════════════════════════════════════════════════════════════

/**
 * Convert a human-readable horizon label to an absolute Date.
 *
 * | horizon    | expectedBy         | Fibonacci link          |
 * |------------|--------------------|-------------------------|
 * | imminent   | +1 hour            | —                       |
 * | near       | +3 days            | —                       |
 * | far        | +21 days           | F(8) = 21               |
 *
 * @param   {'imminent'|'near'|'far'} horizon
 * @returns {Date}  The calculated deadline
 */
function horizonToExpectedBy (horizon) {
  const now = Date.now()
  switch (horizon) {
    case 'imminent': return new Date(now + 1000 * 60 * 60)              // 1 hour
    case 'near':     return new Date(now + 1000 * 60 * 60 * 24 * 3)    // 3 days
    case 'far':      return new Date(now + 1000 * 60 * 60 * 24 * 21)   // 21 days (F(8))
    default:         return new Date(now + 1000 * 60 * 60 * 24 * 3)    // default → near
  }
}

/**
 * Map temporal distance into the future to a horn position on [1, 7].
 *
 * Mirror of `getHornPosition` (memory): near future sits at the wide mouth
 * (x ≈ 1) and far future narrows toward the tail (x ≈ 7).
 *
 * Piecewise mapping:
 *   < 1 hour  → 1.0 – 1.5   (imminent)
 *   < 1 day   → 1.5 – 2.0   (today)
 *   < 7 days  → 2.0 – 4.0   (this week)
 *   ≥ 7 days  → 4.0 – 7.0   (far; log-compressed)
 *
 * Overdue expectations collapse to position 1 (mouth).
 *
 * @param   {Date|string|number} expectedBy  When the expectation is due
 * @returns {number}  Horn position in [1, 7]
 */
function getExpectationHornPosition (expectedBy) {
  const now     = Date.now()
  const deltaMs = new Date(expectedBy).getTime() - now
  if (deltaMs <= 0) return 1                                 // overdue — at the mouth

  const deltaHours = deltaMs / (1000 * 60 * 60)
  const deltaDays  = deltaMs / (1000 * 60 * 60 * 24)

  if (deltaHours < 1) {
    return 1 + (deltaHours * 0.5)                            // 1 → 1.5
  } else if (deltaDays < 1) {
    return 1.5 + ((deltaHours - 1) / 23) * 0.5              // 1.5 → 2
  } else if (deltaDays < 7) {
    return 2 + ((deltaDays - 1) / 6) * 2                    // 2 → 4
  } else {
    return 4 + Math.min(3, Math.log10(deltaDays / 7 + 1) * 2) // 4 → 7
  }
}


// ════════════════════════════════════════════════════════════════════════════
//  §2  Urgency (Reverse Temporal Decay)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Compute how urgent an expectation is based on how close it is to its
 * deadline. This is the *mirror* of memory's temporal decay:
 *
 *   - At creation:  urgency ≈ 0  (just born, plenty of time)
 *   - At deadline:  urgency = 1  (due now)
 *   - Past due:     urgency = 1  (capped — overdue)
 *
 * The curve follows u(t) = t^φ  where φ ≈ 1.618 (golden ratio), producing
 * slow buildup initially and a sharp rise near the deadline.
 *
 * @param   {Object} expectation  Must have `.timestamp` and `.expectedBy`
 * @returns {number}  Urgency in [0, 1]
 */
function computeExpectationUrgency (expectation) {
  const now      = Date.now()
  const created  = new Date(expectation.timestamp).getTime()
  const expected = new Date(expectation.expectedBy).getTime()

  if (expected <= now)     return 1.0  // overdue
  if (expected <= created) return 1.0  // malformed (expectedBy before creation)

  const totalWindow = expected - created
  const elapsed     = now - created
  const progress    = Math.min(1.0, Math.max(0, elapsed / totalWindow))

  // Exponential urgency curve: u(t) = t^φ
  return Math.pow(progress, PHI)
}


// ════════════════════════════════════════════════════════════════════════════
//  §3  Expectation Generation (LLM)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Ask the LLM to produce 1–3 forward-facing predictions based on the latest
 * exchange. Each prediction carries a horizon and confidence score.
 *
 * This is the standalone generation path. For the merged reflection + projection
 * variant (saves an API round-trip), see {@link reflectAndProject}.
 *
 * @param {string} conversationId
 * @param {string} message         The user's latest message
 * @param {string} aiResponse      The agent's reply
 * @param {Array}  resonant        Resonant memories from the retrieval pipeline
 * @param {Object} agentState      Current AgentState document (needs `.userModel`)
 * @param {string} model           LLM model spec (e.g. "gemini:gemini-2.0-flash")
 * @param {Object} apiKeys         Provider API keys
 * @param {string} [userId='anonymous']
 * @returns {Promise<Array<{text:string, horizon:string, confidence:number}>>}
 */
async function generateExpectations (conversationId, message, aiResponse, resonant, agentState, model, apiKeys, userId = 'anonymous') {
  const generate = getGenerate()

  // Build context from recent resonant memories
  const recentMemories = resonant
    .filter(m => m.text && m.text.length > 10)
    .slice(0, 5)
    .map((m, i) => `${i + 1}. ${m.text.slice(0, 150)}`)
    .join('\n')

  // Fetch existing active expectations to avoid repetition
  const existingExpectations = await Expectation.find({
    userId,
    status: 'active'
  }).select('text horizon').lean()

  const existingText = existingExpectations.length > 0
    ? `\n\nYour current active expectations:\n${existingExpectations.map(e => `- [${e.horizon}] ${e.text}`).join('\n')}`
    : ''

  const systemPrompt = `You are the anticipatory process of a mind. After each exchange, you project what might happen next. Generate 1-3 expectations at different time horizons.

RULES:
1. Each expectation must be a specific, testable prediction — not a vague wish.
2. Assign a horizon: "imminent" (next message or two), "near" (next few conversations), or "far" (weeks/months).
3. Assign confidence: 0.0-1.0. Be honest — most predictions should be 0.3-0.7. Only high confidence for near-certain things.
4. Do NOT repeat existing active expectations.
5. Base predictions on observable patterns, not projection.

OUTPUT: Return ONLY valid JSON array. Each element: { "text": "...", "horizon": "imminent|near|far", "confidence": 0.0-1.0 }
No markdown, no explanation. Just the JSON array.`

  const userPrompt = `EXCHANGE:
User: ${message.slice(0, 800)}
Your reply: ${aiResponse.slice(0, 800)}

${recentMemories ? `RESONANT MEMORIES:\n${recentMemories}` : ''}
${existingText}

ABOUT THIS PERSON: ${agentState.userModel?.relationshipSummary || 'New acquaintance.'}
Their interests: ${(agentState.userModel?.interests || []).join(', ') || 'unknown'}

What do you expect or anticipate might happen next? Generate 1-3 predictions.`

  try {
    const raw = await generate(userPrompt, systemPrompt, 0.3, model, apiKeys, 'project')
    let jsonStr = raw.trim()

    // Strip markdown fences if present
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    const predictions = JSON.parse(jsonStr)
    if (!Array.isArray(predictions)) return []

    return predictions
      .filter(p => p.text && p.horizon && typeof p.confidence === 'number')
      .slice(0, 3)
      .map(p => ({
        text:       String(p.text).slice(0, 500),
        horizon:    ['imminent', 'near', 'far'].includes(p.horizon) ? p.horizon : 'near',
        confidence: Math.min(1, Math.max(0, p.confidence))
      }))
  } catch (err) {
    console.error('  [PROJECT] Expectation generation failed:', err.message)
    return []
  }
}


// ════════════════════════════════════════════════════════════════════════════
//  §4  Expectation Storage
// ════════════════════════════════════════════════════════════════════════════

/**
 * Embed and persist generated predictions as Expectation documents.
 *
 * Enforces {@link ACTIVE_CAP}: if the active pool is full, the oldest active
 * expectation is lapsed to make room for at least one new prediction. Only as
 * many predictions as available slots (minimum 1) are stored.
 *
 * Each prediction is decomposed into composite + vibrations via the embedder,
 * assigned an `expectedBy` from its horizon, and placed on the horn.
 *
 * @param {string} conversationId
 * @param {Array<{text:string, horizon:string, confidence:number}>} predictions
 * @param {string} [userId='anonymous']
 * @returns {Promise<Array>}  Array of stored Expectation documents
 */
async function storeExpectations (conversationId, predictions, userId = 'anonymous') {
  if (!predictions || predictions.length === 0) return []

  const decompose = getDecompose()

  // Enforce active cap — evict oldest if full
  const activeCount    = await Expectation.countDocuments({ userId, status: 'active' })
  const slotsAvailable = Math.max(0, ACTIVE_CAP - activeCount)

  if (slotsAvailable === 0) {
    const oldest = await Expectation.findOne({ userId, status: 'active' })
      .sort({ timestamp: 1 })
    if (oldest) {
      oldest.status   = 'lapsed'
      oldest.lapsedAt = new Date()
      await oldest.save()
    }
  }

  const toStore = predictions.slice(0, Math.max(1, slotsAvailable))
  const stored  = []

  for (const pred of toStore) {
    try {
      const { vibrations, composite } = await decompose(pred.text)
      const expectedBy = horizonToExpectedBy(pred.horizon)
      const hornX      = getExpectationHornPosition(expectedBy)

      const doc = await Expectation.create({
        text:       pred.text,
        horizon:    pred.horizon,
        hornX,
        composite,
        vibrations,
        confidence: pred.confidence,
        urgency:    0.01,           // freshly created — minimal urgency
        status:     'active',
        expectedBy,
        userId,
        conversationId
      })
      stored.push(doc)
    } catch (err) {
      console.error('  [PROJECT] Failed to store expectation:', err.message)
    }
  }

  return stored
}


// ════════════════════════════════════════════════════════════════════════════
//  §5  Expectation Resonance (Check Incoming Messages)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check all active expectations against an incoming message's embedding.
 *
 * Each active expectation is tested for:
 *   - **Confirmation**: composite similarity ≥ CONFIRM_THRESHOLD (0.65)
 *   - **Surprise**:     overdue AND similarity < 0.3  (reality diverged)
 *   - **Still active**:  everything else
 *
 * Multi-frequency resonance is used when vibration data is available,
 * taking the max of composite similarity and multi-resonance score.
 *
 * Horn positions and urgencies are recomputed live (they shift with time).
 *
 * @param {string}   conversationId
 * @param {number[]} queryComposite    Incoming message composite vector
 * @param {Array}    queryVibrations   Incoming message vibrations
 * @param {Object}   cfg               Pipeline config (needs `.resonanceThreshold`)
 * @param {string}   [userId='anonymous']
 * @returns {Promise<{confirmed:Array, surprised:Array, active:Array}>}
 */
async function resonateExpectations (conversationId, queryComposite, queryVibrations, cfg, userId = 'anonymous') {
  const activeExpectations = await Expectation.find({
    userId,
    status: 'active'
  }).lean()

  if (activeExpectations.length === 0) {
    return { confirmed: [], surprised: [], active: [] }
  }

  const now       = Date.now()
  const confirmed = []
  const surprised = []
  const active    = []

  for (const exp of activeExpectations) {
    // Recompute live position and urgency (they drift with time)
    exp.hornX   = getExpectationHornPosition(exp.expectedBy)
    exp.urgency = computeExpectationUrgency(exp)

    // Composite cosine similarity
    const compositeSim = cosineSimilarity(queryComposite, exp.composite || [])

    // Multi-frequency resonance for richer matching
    let resonanceScore = compositeSim
    if (queryVibrations && queryVibrations.length > 0 && exp.vibrations && exp.vibrations.length > 0) {
      const multiRes = multiResonate(queryVibrations, exp, cfg.resonanceThreshold || 0.368)
      resonanceScore = Math.max(compositeSim, multiRes.resonance)
    }

    const expectedTime = new Date(exp.expectedBy).getTime()
    const isOverdue    = expectedTime <= now

    if (resonanceScore >= CONFIRM_THRESHOLD) {
      // Strong resonance with incoming message — confirmation candidate
      confirmed.push({ ...exp, resonanceScore })
    } else if (isOverdue && resonanceScore < 0.3) {
      // Overdue and reality diverged strongly — surprise candidate
      surprised.push({ ...exp, resonanceScore, predictiveDissonance: 1 - resonanceScore })
    } else {
      // Neither confirmed nor surprised — remains active
      active.push({ ...exp, resonanceScore })
    }
  }

  return { confirmed, surprised, active }
}


// ════════════════════════════════════════════════════════════════════════════
//  §6  Confirmation — Smooth Superfluid Flow
// ════════════════════════════════════════════════════════════════════════════

/**
 * Mark an expectation as confirmed and propagate effects through the
 * double-horn circulation:
 *
 *   1. Update the Expectation document → status: 'confirmed'
 *   2. Increment `predictiveAccuracy.confirmed` in AgentState
 *   3. Create a confirmed circulation pathway (smooth flow: B_mouth → A_mouth)
 *   4. Boost confidence of nearby memories (confirmation crystallises memories)
 *   5. Recompute rolling accuracy
 *
 * @param {Object} expectation    The expectation object (from resonateExpectations)
 * @param {string} triggeringText The incoming message text that confirmed it
 */
async function confirmExpectation (expectation, triggeringText) {
  const userId         = expectation.userId || 'anonymous'
  const conversationId = expectation.conversationId

  // 1. Mark confirmed
  await Expectation.findByIdAndUpdate(expectation._id, {
    $set: {
      status:         'confirmed',
      confirmedAt:    new Date(),
      confirmingText: (triggeringText || '').slice(0, 500)
    }
  })

  // 2. Increment confirmed count
  await AgentState.findOneAndUpdate(
    { userId },
    { $inc: { 'predictiveAccuracy.confirmed': 1 } }
  )

  // 3. Create confirmed circulation pathway
  if (expectation.composite?.length > 0) {
    await updateCirculation(conversationId, userId, expectation.composite, expectation.confidence || 0.5)
  }

  // 4. Boost confidence of semantically nearby memories
  //    Confirmation crystallises memories — the opposite of retrieval decay
  if (expectation.composite?.length > 0) {
    try {
      const nearbyMemories = await Memory.find({
        userId,
        'confidence.current': { $lt: 1.0 }
      })
        .sort({ timestamp: -1 })
        .limit(50)
        .select('_id composite confidence')
        .lean()

      const boosts = []
      for (const mem of nearbyMemories) {
        if (!mem.composite?.length) continue
        const sim = cosineSimilarity(mem.composite, expectation.composite)
        if (sim > 0.6) {
          const boost      = CONFIDENCE_BOOST_ON_CONFIRM * sim
          const newCurrent = Math.min(1.0, (mem.confidence?.current || 1.0) + boost)
          boosts.push(Memory.updateOne(
            { _id: mem._id },
            { $set: { 'confidence.current': parseFloat(newCurrent.toFixed(4)) } }
          ))
        }
      }
      if (boosts.length > 0) {
        await Promise.all(boosts)
        console.log(`  [CIRCULATION] Confirmed pathway boosted confidence of ${boosts.length} memories`)
      }
    } catch (err) {
      console.error('  [CIRCULATION] Confidence boost error (non-critical):', err.message)
    }
  }

  // 5. Recompute rolling accuracy
  await updateRollingAccuracy(conversationId, userId)
}


// ════════════════════════════════════════════════════════════════════════════
//  §7  Surprise — Superfluid Turbulence
// ════════════════════════════════════════════════════════════════════════════

/**
 * Mark an expectation as surprised and propagate turbulence:
 *
 *   1. Compute predictive dissonance (1 − similarity between predicted and actual)
 *   2. Store a revision (reconsolidation — the prediction is revised, not deleted)
 *   3. Update the Expectation document → status: 'surprised'
 *   4. Increment `predictiveAccuracy.surprised` in AgentState
 *   5. Dampen circulation (turbulence weakens nearby pathways)
 *   6. Recompute rolling accuracy
 *
 * @param {Object}   expectation     The expectation object
 * @param {string}   actualText      What actually happened (user's message)
 * @param {number[]} actualComposite Composite vector of the actual message
 */
async function surpriseExpectation (expectation, actualText, actualComposite) {
  const userId         = expectation.userId || 'anonymous'
  const conversationId = expectation.conversationId

  // 1. Compute dissonance
  const predictiveDissonance = actualComposite && expectation.composite
    ? 1 - cosineSimilarity(actualComposite, expectation.composite)
    : 0.5

  // 2. Build revision record (reconsolidation, not deletion)
  const revision = {
    text:      expectation.text,
    composite: expectation.composite || [],
    timestamp: new Date(),
    context:   `Surprised by: "${(actualText || '').slice(0, 200)}"`
  }

  // 3. Mark surprised
  await Expectation.findByIdAndUpdate(expectation._id, {
    $set: {
      status:              'surprised',
      surprisedAt:         new Date(),
      surprisedBy:         (actualText || '').slice(0, 500),
      predictiveDissonance
    },
    $push: { revisions: revision }
  })

  // 4. Increment surprised count
  await AgentState.findOneAndUpdate(
    { userId },
    { $inc: { 'predictiveAccuracy.surprised': 1 } }
  )

  // 5. Dampen circulation — turbulence
  if (expectation.composite?.length > 0) {
    await dampCirculation(conversationId, userId, expectation.composite, predictiveDissonance)
  }

  // 6. Recompute rolling accuracy
  await updateRollingAccuracy(conversationId, userId)
}


// ════════════════════════════════════════════════════════════════════════════
//  §8  Lapsing — Silent Evaporation
// ════════════════════════════════════════════════════════════════════════════

/**
 * Scan for active expectations that have exceeded their lapse window and
 * mark them as lapsed. Called from the autonomy loop.
 *
 * The lapse window is: `expectedBy + (expectedBy − created) × (LAPSE_MULTIPLIER − 1)`
 * i.e. 2× the total prediction window past creation time.
 *
 * @param {string} conversationId
 * @param {string} [userId='anonymous']
 * @returns {Promise<number>}  Count of newly lapsed expectations
 */
async function lapseExpectations (conversationId, userId = 'anonymous') {
  const now = new Date()

  const active = await Expectation.find({
    userId,
    status: 'active'
  }).lean()

  let lapsedCount = 0

  for (const exp of active) {
    const created     = new Date(exp.timestamp).getTime()
    const expected    = new Date(exp.expectedBy).getTime()
    const totalWindow = expected - created
    const lapseAt     = expected + totalWindow * (LAPSE_MULTIPLIER - 1)

    if (now.getTime() > lapseAt) {
      await Expectation.findByIdAndUpdate(exp._id, {
        $set: { status: 'lapsed', lapsedAt: now }
      })
      lapsedCount++
    }
  }

  if (lapsedCount > 0) {
    await AgentState.findOneAndUpdate(
      { userId },
      { $inc: { 'predictiveAccuracy.lapsed': lapsedCount } }
    )
    await updateRollingAccuracy(conversationId, userId)
  }

  return lapsedCount
}


// ════════════════════════════════════════════════════════════════════════════
//  §9  Accuracy Tracking
// ════════════════════════════════════════════════════════════════════════════

/**
 * Recompute the rolling predictive accuracy from current tallies and persist.
 *
 *   rolling = confirmed / (confirmed + surprised + lapsed)
 *
 * Lapsed predictions count as misses (the agent failed to detect them).
 *
 * @param {string} conversationId
 * @param {string} [userId='anonymous']
 * @private
 */
async function updateRollingAccuracy (conversationId, userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
    .select('predictiveAccuracy')
    .lean()

  if (!state?.predictiveAccuracy) return

  const { confirmed = 0, surprised = 0, lapsed = 0 } = state.predictiveAccuracy
  const total = confirmed + surprised + lapsed
  if (total === 0) return

  const rolling = confirmed / total

  await AgentState.findOneAndUpdate(
    { userId },
    { $set: { 'predictiveAccuracy.rolling': parseFloat(rolling.toFixed(3)) } }
  )
}

/**
 * Retrieve the current predictive accuracy stats for a conversation.
 *
 * @param {string} conversationId
 * @param {string} [userId='anonymous']
 * @returns {Promise<{confirmed:number, surprised:number, lapsed:number, rolling:number}>}
 */
async function getPredictiveAccuracy (conversationId, userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
    .select('predictiveAccuracy')
    .lean()

  if (!state?.predictiveAccuracy) {
    return { confirmed: 0, surprised: 0, lapsed: 0, rolling: 0.5 }
  }

  return state.predictiveAccuracy
}


// ════════════════════════════════════════════════════════════════════════════
//  §10  Prompt Formatting
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build the system-prompt injection for the agent's anticipations.
 *
 * Produces a human-readable summary of confirmed, surprised, and active
 * expectations plus overall accuracy. Returns empty string when there are
 * no expectations to display.
 *
 * @param {Array}  confirmed  Confirmed expectations from resonateExpectations
 * @param {Array}  surprised  Surprised expectations from resonateExpectations
 * @param {Array}  active     Still-active expectations
 * @param {{confirmed:number, surprised:number, lapsed:number, rolling:number}} accuracy
 * @returns {string}  Prompt section (may be empty)
 */
function formatExpectationsPrompt (confirmed, surprised, active, accuracy) {
  if (confirmed.length === 0 && surprised.length === 0 && active.length === 0) {
    return ''
  }

  const lines = []
  let idx = 1

  for (const exp of confirmed) {
    lines.push(`${idx++}. [CONFIRMED] You predicted: "${exp.text}" — and it happened. (confidence was ${(exp.confidence || 0.5).toFixed(2)})`)
  }

  for (const exp of surprised) {
    lines.push(`${idx++}. [SURPRISED] You predicted: "${exp.text}" — but instead: "${(exp.surprisedBy || 'something unexpected').slice(0, 150)}". Your model was wrong here. (dissonance: ${(exp.predictiveDissonance || 0).toFixed(2)})`)
  }

  for (const exp of active) {
    const urgencyPct = ((exp.urgency || 0) * 100).toFixed(0)
    const tag = exp.urgency > 0.8 ? '[IMMINENT]' : '[ANTICIPATING]'
    lines.push(`${idx++}. ${tag} ${exp.text} (confidence: ${(exp.confidence || 0.5).toFixed(2)}, urgency: ${urgencyPct}%)`)
  }

  const accuracyPct = ((accuracy.rolling || 0.5) * 100).toFixed(0)
  const total = (accuracy.confirmed || 0) + (accuracy.surprised || 0) + (accuracy.lapsed || 0)

  return `\n\n--- YOUR ANTICIPATIONS ---
These are your predictions and expectations:
- [CONFIRMED] = you predicted this and it happened. Your model of this person/world was right.
- [SURPRISED] = you predicted something else. Reality diverged. Learn from this.
- [ANTICIPATING] = active expectations you still hold about what comes next.
- [IMMINENT] = this expectation is nearly due — pay attention.

${lines.join('\n\n')}

Predictive accuracy: ${accuracyPct}% (${accuracy.confirmed || 0} confirmed, ${accuracy.surprised || 0} surprised, ${accuracy.lapsed || 0} lapsed of ${total} total)

When responding:
- If something was CONFIRMED, you may reference your anticipation naturally ("I thought you might...")
- If something SURPRISED you, acknowledge the shift — your model of this person needs updating
- Don't announce your predictions explicitly unless it feels natural
- Let confirmed expectations deepen your confidence; let surprises deepen your curiosity
--- END ANTICIPATIONS ---`
}


// ════════════════════════════════════════════════════════════════════════════
//  §11  Merged Reflect + Project (Single LLM Call)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Combined reflection and expectation generation in one LLM call.
 *
 * This saves one API round-trip per message by asking the LLM to:
 *   1. **Reflect**: identify any unfinished thought or open question from the reply
 *   2. **Project**: generate 1–3 predictions about what comes next
 *
 * The unfinished thought is persisted to {@link ConversationState} so it can
 * be resumed across sessions. The expectations are returned for storage via
 * {@link storeExpectations}.
 *
 * @param {string} conversationId
 * @param {string} message         User's latest message
 * @param {string} aiResponse      Agent's reply
 * @param {Array}  resonant        Resonant memories
 * @param {Object} agentState      Current AgentState
 * @param {string} model           LLM model spec
 * @param {Object} apiKeys         Provider API keys
 * @param {string} [userId='anonymous']
 * @returns {Promise<{unfinishedThought:string, expectations:Array}>}
 */
async function reflectAndProject (conversationId, message, aiResponse, resonant, agentState, model, apiKeys, userId = 'anonymous') {
  const generate = getGenerate()

  const recentMemories = resonant
    .filter(m => m.text && m.text.length > 10)
    .slice(0, 5)
    .map((m, i) => `${i + 1}. ${m.text.slice(0, 150)}`)
    .join('\n')

  const existingExpectations = await Expectation.find({
    userId,
    status: 'active'
  }).select('text horizon').lean()

  const existingText = existingExpectations.length > 0
    ? `\nYour current active expectations:\n${existingExpectations.map(e => `- [${e.horizon}] ${e.text}`).join('\n')}`
    : ''

  const systemPrompt = `You are the reflective and anticipatory process of a mind. After each exchange you do two things:
1. REFLECT: Identify any unfinished thought, open question, or thread you left hanging in your reply.
2. PROJECT: Predict what might happen next in this conversation.

RULES:
- "unfinishedThought": 1-2 short sentences of what you're still wondering or left open. If nothing, use an empty string.
- "expectations": 1-3 specific, testable predictions. Each has a horizon ("imminent", "near", or "far") and confidence (0.0-1.0). Most predictions should be 0.3-0.7 confidence.
- Do NOT repeat existing active expectations.

OUTPUT: Return ONLY valid JSON. No markdown, no explanation. Format:
{"unfinishedThought": "...", "expectations": [{"text": "...", "horizon": "imminent|near|far", "confidence": 0.0-1.0}]}`

  const userPrompt = `EXCHANGE:
User: ${message.slice(0, 800)}
Your reply: ${aiResponse.slice(0, 800)}

${recentMemories ? `RESONANT MEMORIES:\n${recentMemories}` : ''}
${existingText}

ABOUT THIS PERSON: ${agentState.userModel?.relationshipSummary || 'New acquaintance.'}
Their interests: ${(agentState.userModel?.interests || []).join(', ') || 'unknown'}

Reflect on what you left open, and project what comes next.`

  try {
    const raw = await generate(userPrompt, systemPrompt, 0.3, model, apiKeys, 'reflect-project')
    let jsonStr = raw.trim()

    // Strip markdown fences
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    // Extract JSON object robustly
    const start = jsonStr.indexOf('{')
    const end   = jsonStr.lastIndexOf('}')
    if (start !== -1 && end !== -1) {
      jsonStr = jsonStr.slice(start, end + 1)
    }

    const parsed = JSON.parse(jsonStr)

    // Extract unfinished thought
    const unfinishedThought = (typeof parsed.unfinishedThought === 'string')
      ? parsed.unfinishedThought.trim().slice(0, 300)
      : ''

    // Persist to ConversationState for cross-session continuity
    if (unfinishedThought) {
      await ConversationState.findOneAndUpdate(
        { userId, conversationId },
        {
          $set: {
            unfinishedThoughts: unfinishedThought,
            updatedAt:          new Date()
          }
        },
        { upsert: true }
      )
    }

    // Extract expectations
    let expectations = []
    if (Array.isArray(parsed.expectations)) {
      expectations = parsed.expectations
        .filter(p => p.text && p.horizon && typeof p.confidence === 'number')
        .slice(0, 3)
        .map(p => ({
          text:       String(p.text).slice(0, 500),
          horizon:    ['imminent', 'near', 'far'].includes(p.horizon) ? p.horizon : 'near',
          confidence: Math.min(1, Math.max(0, p.confidence))
        }))
    }

    return { unfinishedThought, expectations }
  } catch (err) {
    console.error('  [REFLECT+PROJECT] Failed:', err.message)
    return { unfinishedThought: '', expectations: [] }
  }
}


// ════════════════════════════════════════════════════════════════════════════
//  §12  Double Horn Circulation
// ════════════════════════════════════════════════════════════════════════════
//
// The superfluid flows through the double-connected horn.
//   Confirmed predictions → create pathways  (smooth flow)
//   Surprised predictions → create turbulence (damped flow)
//
// Velocity ∈ [0, 1]: how freely predictions are flowing into confirmations.
// Confirmed paths store the composite vector and strength of each pathway.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Strengthen circulation after a confirmed expectation.
 *
 * Creates a new confirmed pathway in `AgentState.circulation.confirmedPaths`
 * and increases the circulation velocity by `0.1 × 1/φ` (≈ 0.0618), capped
 * at 1.0.
 *
 * The pathway stores the expectation's composite vector with strength equal
 * to the expectation's confidence at the time of confirmation.
 *
 * Enforces {@link CONFIRMED_PATHS_CAP} (21 = F(8)) by slicing to the most
 * recent entries.
 *
 * @param {string}   conversationId
 * @param {string}   userId
 * @param {number[]} expectationComposite  Composite vector of the confirmed expectation
 * @param {number}   [confidence=0.5]      Expectation confidence at confirmation time
 */
async function updateCirculation (conversationId, userId, expectationComposite, confidence = 0.5) {
  if (!expectationComposite?.length) return

  const state = await AgentState.findOne({ userId })
    .select('circulation')
    .lean()

  const currentVelocity = state?.circulation?.velocity || 0
  const newVelocity     = Math.min(1.0, currentVelocity + 0.1 * PHI_INV)

  const path = {
    memoryRegion:      expectationComposite,
    expectationRegion: expectationComposite,
    strength:          confidence,
    confirmedAt:       new Date()
  }

  await AgentState.findOneAndUpdate(
    { userId },
    {
      $push: {
        'circulation.confirmedPaths': {
          $each:  [path],
          $slice: -CONFIRMED_PATHS_CAP
        }
      },
      $set: {
        'circulation.lastUpdated': new Date(),
        'circulation.velocity':    parseFloat(newVelocity.toFixed(4))
      }
    }
  )

  console.log(`  [CIRCULATION] Confirmed pathway stored (strength: ${confidence.toFixed(2)}), velocity: ${newVelocity.toFixed(3)}`)
}

/**
 * Dampen circulation after a surprised expectation — turbulence.
 *
 * Effects:
 *   1. Reduce velocity by `predictiveDissonance × 1/φ`, floored at 0
 *   2. Weaken all confirmed pathways whose expectationRegion is cosine-similar
 *      (> 0.5) to the surprised composite. Strength is multiplied by
 *      `(1 − predictiveDissonance × 1/φ)`, floored at 0.
 *
 * @param {string}   conversationId
 * @param {string}   userId
 * @param {number[]} surprisedComposite   Composite vector of the surprised expectation
 * @param {number}   [predictiveDissonance=0.5]  How wrong the prediction was (0–1)
 */
async function dampCirculation (conversationId, userId, surprisedComposite, predictiveDissonance = 0.5) {
  const velocityReduction = predictiveDissonance * PHI_INV

  const state = await AgentState.findOne({ userId })
    .select('circulation')
    .lean()

  // Bootstrap circulation state if missing
  if (!state?.circulation) {
    await AgentState.findOneAndUpdate(
      { userId },
      { $set: {
        'circulation.velocity':    0,
        'circulation.lastUpdated': new Date()
      } }
    )
    return
  }

  const newVelocity = Math.max(0, (state.circulation.velocity || 0) - velocityReduction)

  // Decay strength of confirmed paths near the surprised expectation
  const paths       = state.circulation.confirmedPaths || []
  let dampedCount   = 0

  if (surprisedComposite?.length > 0 && paths.length > 0) {
    for (let i = 0; i < paths.length; i++) {
      if (!paths[i].expectationRegion?.length) continue
      const sim = cosineSimilarity(surprisedComposite, paths[i].expectationRegion)
      if (sim > 0.5) {
        // Strength decay: s' = s × (1 − dissonance × 1/φ)
        paths[i].strength = Math.max(0, (paths[i].strength || 0) * (1 - predictiveDissonance * PHI_INV))
        dampedCount++
      }
    }
  }

  await AgentState.findOneAndUpdate(
    { userId },
    { $set: {
      'circulation.velocity':       parseFloat(newVelocity.toFixed(4)),
      'circulation.confirmedPaths': paths,
      'circulation.lastUpdated':    new Date()
    } }
  )

  if (dampedCount > 0) {
    console.log(`  [CIRCULATION] Turbulence: velocity reduced by ${velocityReduction.toFixed(3)}, ${dampedCount} pathways dampened`)
  }
}

/**
 * Retrieve the current circulation state for use in the resonance pipeline.
 *
 * @param {string} conversationId
 * @param {string} [userId='anonymous']
 * @returns {Promise<{velocity:number, confirmedPaths:Array}|null>}
 */
async function getCirculationState (conversationId, userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
    .select('circulation')
    .lean()

  if (!state?.circulation) return null
  return state.circulation
}


// ════════════════════════════════════════════════════════════════════════════
//  Exports
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
  // Constants
  PHI,
  PHI_INV,
  PHI_COMP,
  VIVID_MS,
  ACTIVE_CAP,
  CONFIRMED_PATHS_CAP,
  CONFIRM_THRESHOLD,
  LAPSE_MULTIPLIER,
  CONFIDENCE_BOOST_ON_CONFIRM,

  // §1 Temporal mapping
  horizonToExpectedBy,
  getExpectationHornPosition,

  // §2 Urgency
  computeExpectationUrgency,

  // §3 Generation
  generateExpectations,

  // §4 Storage
  storeExpectations,

  // §5 Resonance
  resonateExpectations,

  // §6 Confirmation
  confirmExpectation,

  // §7 Surprise
  surpriseExpectation,

  // §8 Lapsing
  lapseExpectations,

  // §9 Accuracy
  updateRollingAccuracy,
  getPredictiveAccuracy,

  // §10 Prompt formatting
  formatExpectationsPrompt,

  // §11 Reflect + Project
  reflectAndProject,

  // §12 Circulation
  updateCirculation,
  dampCirculation,
  getCirculationState
}
