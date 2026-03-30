const Expectation = require('../models/Expectation')
const AgentState = require('../models/AgentState')
const { cosineSimilarity } = require('./similarity')
const { multiResonate, preFilter } = require('./resonance')
const { decompose } = require('./embedder')
const { generate } = require('./generate')

// ── Sacred Constants ───────────────────────────────────────────
const HORN_MAX_X = 7
const ACTIVE_CAP = 8                          // F(6) — max active expectations
const CONFIRM_THRESHOLD = 0.65                 // cosine sim above this = confirmation candidate
const LAPSE_MULTIPLIER = 2                     // lapse at 2× the expectedBy window

// ── Horn Position (Future-Facing) ──────────────────────────────
// Maps temporal distance into the future to horn position.
// Mirror of getHornPosition: near future = wide mouth (x≈1), far = narrow tail (x≈7)

function getExpectationHornPosition(expectedBy) {
  const now = Date.now()
  const deltaMs = new Date(expectedBy).getTime() - now
  if (deltaMs <= 0) return 1 // overdue — at the mouth

  const deltaHours = deltaMs / (1000 * 60 * 60)
  const deltaDays = deltaMs / (1000 * 60 * 60 * 24)

  if (deltaHours < 1) {
    return 1 + (deltaHours * 0.5)                      // 1 → 1.5  (imminent)
  } else if (deltaDays < 1) {
    return 1.5 + ((deltaHours - 1) / 23) * 0.5         // 1.5 → 2  (today)
  } else if (deltaDays < 7) {
    return 2 + ((deltaDays - 1) / 6) * 2               // 2 → 4    (this week)
  } else {
    return 4 + Math.min(3, Math.log10(deltaDays / 7 + 1) * 2)  // 4 → 7 (far)
  }
}

// ── Urgency (Reverse Temporal Decay) ───────────────────────────
// Urgency increases as expectedBy approaches — opposite of memory decay.
// At creation: low urgency. At expectedBy: urgency peaks at 1.0.
// Past expectedBy: urgency stays at 1.0 (overdue).

function computeExpectationUrgency(expectation) {
  const now = Date.now()
  const created = new Date(expectation.timestamp).getTime()
  const expected = new Date(expectation.expectedBy).getTime()

  if (expected <= now) return 1.0  // overdue
  if (expected <= created) return 1.0  // malformed

  const totalWindow = expected - created
  const elapsed = now - created
  const progress = Math.min(1.0, Math.max(0, elapsed / totalWindow))

  // Exponential urgency curve: slow buildup, sharp rise near deadline
  // u(t) = t^φ where φ ≈ 1.618 (golden ratio)
  const PHI = (1 + Math.sqrt(5)) / 2
  return Math.pow(progress, PHI)
}

// ── Generate Expectations ──────────────────────────────────────
// LLM produces 1-3 expectations after each exchange.

async function generateExpectations(conversationId, userMessage, aiResponse, resonant, agentState, model, apiKeys) {
  const recentMemories = resonant
    .filter(m => m.text && m.text.length > 10)
    .slice(0, 5)
    .map((m, i) => `${i + 1}. ${m.text.slice(0, 150)}`)
    .join('\n')

  const existingExpectations = await Expectation.find({
    conversationId,
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
User: ${userMessage.slice(0, 800)}
Your reply: ${aiResponse.slice(0, 800)}

${recentMemories ? `RESONANT MEMORIES:\n${recentMemories}` : ''}
${existingText}

ABOUT THIS PERSON: ${agentState.userModel?.relationshipSummary || 'New acquaintance.'}
Their interests: ${(agentState.userModel?.interests || []).join(', ') || 'unknown'}

What do you expect or anticipate might happen next? Generate 1-3 predictions.`

  const recordingCtx = { conversationId, caller: 'project' }

  try {
    const raw = await generate(userPrompt, systemPrompt, 0.3, model, apiKeys, recordingCtx)
    let jsonStr = raw.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    const predictions = JSON.parse(jsonStr)
    if (!Array.isArray(predictions)) return []

    return predictions
      .filter(p => p.text && p.horizon && typeof p.confidence === 'number')
      .slice(0, 3)
      .map(p => ({
        text: String(p.text).slice(0, 500),
        horizon: ['imminent', 'near', 'far'].includes(p.horizon) ? p.horizon : 'near',
        confidence: Math.min(1, Math.max(0, p.confidence))
      }))
  } catch (err) {
    console.error('  [PROJECT] Expectation generation failed:', err.message)
    return []
  }
}

// ── Horizon to expectedBy Date ─────────────────────────────────

function horizonToExpectedBy(horizon) {
  const now = Date.now()
  switch (horizon) {
    case 'imminent': return new Date(now + 1000 * 60 * 60)            // 1 hour
    case 'near':     return new Date(now + 1000 * 60 * 60 * 24 * 3)  // 3 days
    case 'far':      return new Date(now + 1000 * 60 * 60 * 24 * 21) // 21 days (F(8))
    default:         return new Date(now + 1000 * 60 * 60 * 24 * 3)
  }
}

// ── Store Expectations ─────────────────────────────────────────
// Embeds and persists generated expectations. Enforces the active cap.

async function storeExpectations(conversationId, predictions) {
  if (!predictions || predictions.length === 0) return []

  // Check active count and enforce cap
  const activeCount = await Expectation.countDocuments({ conversationId, status: 'active' })
  const slotsAvailable = Math.max(0, ACTIVE_CAP - activeCount)

  if (slotsAvailable === 0) {
    // Lapse the oldest active to make room for at least 1
    const oldest = await Expectation.findOne({ conversationId, status: 'active' })
      .sort({ timestamp: 1 })
    if (oldest) {
      oldest.status = 'lapsed'
      oldest.lapsedAt = new Date()
      await oldest.save()
    }
  }

  const toStore = predictions.slice(0, Math.max(1, slotsAvailable))
  const stored = []

  for (const pred of toStore) {
    try {
      const { vibrations, composite } = await decompose(pred.text)
      const expectedBy = horizonToExpectedBy(pred.horizon)
      const hornX = getExpectationHornPosition(expectedBy)

      const doc = await Expectation.create({
        text: pred.text,
        horizon: pred.horizon,
        hornX,
        composite,
        vibrations,
        confidence: pred.confidence,
        urgency: 0.01, // just created
        status: 'active',
        expectedBy,
        conversationId
      })
      stored.push(doc)
    } catch (err) {
      console.error('  [PROJECT] Failed to store expectation:', err.message)
    }
  }

  return stored
}

// ── Resonate Expectations ──────────────────────────────────────
// Check incoming message against active expectations.
// Returns { confirmed, surprised, active } arrays.

async function resonateExpectations(conversationId, queryComposite, queryVibrations, cfg) {
  const activeExpectations = await Expectation.find({
    conversationId,
    status: 'active'
  }).lean()

  if (activeExpectations.length === 0) {
    return { confirmed: [], surprised: [], active: [] }
  }

  const now = Date.now()
  const confirmed = []
  const surprised = []
  const active = []

  for (const exp of activeExpectations) {
    // Update horn position (it shifts as time passes)
    exp.hornX = getExpectationHornPosition(exp.expectedBy)
    exp.urgency = computeExpectationUrgency(exp)

    // Compute resonance between query and expectation
    const compositeSim = cosineSimilarity(queryComposite, exp.composite || [])

    // Multi-frequency resonance for richer matching
    let resonanceScore = compositeSim
    if (queryVibrations && queryVibrations.length > 0 && exp.vibrations && exp.vibrations.length > 0) {
      const multiRes = multiResonate(queryVibrations, exp, cfg.resonanceThreshold || 0.368)
      resonanceScore = Math.max(compositeSim, multiRes.resonance)
    }

    const expectedTime = new Date(exp.expectedBy).getTime()
    const isOverdue = expectedTime <= now
    const isDue = expectedTime <= now + (expectedTime - new Date(exp.timestamp).getTime()) * 0.5 // within half the window

    if (resonanceScore >= CONFIRM_THRESHOLD) {
      // Confirmation candidate: strong resonance with the incoming message
      confirmed.push({ ...exp, resonanceScore })
    } else if (isOverdue && resonanceScore < 0.3) {
      // Surprise candidate: expectation was due but message diverges strongly
      surprised.push({ ...exp, resonanceScore, predictiveDissonance: 1 - resonanceScore })
    } else {
      // Still active
      active.push({ ...exp, resonanceScore })
    }
  }

  return { confirmed, surprised, active }
}

// ── Confirm Expectation ────────────────────────────────────────

async function confirmExpectation(expectation, triggeringText) {
  await Expectation.findByIdAndUpdate(expectation._id, {
    $set: {
      status: 'confirmed',
      confirmedAt: new Date(),
      confirmingText: (triggeringText || '').slice(0, 500)
    }
  })

  // Update predictive accuracy in AgentState
  await AgentState.findOneAndUpdate(
    { conversationId: expectation.conversationId },
    {
      $inc: { 'predictiveAccuracy.confirmed': 1 }
    }
  )

  await updateRollingAccuracy(expectation.conversationId)
}

// ── Surprise Expectation ───────────────────────────────────────

async function surpriseExpectation(expectation, actualText, actualComposite) {
  const predictiveDissonance = actualComposite && expectation.composite
    ? 1 - cosineSimilarity(actualComposite, expectation.composite)
    : 0.5

  // Create a revision (reconsolidation — the expectation is revised, not deleted)
  const revision = {
    text: expectation.text,
    composite: expectation.composite || [],
    timestamp: new Date(),
    context: `Surprised by: "${(actualText || '').slice(0, 200)}"`
  }

  await Expectation.findByIdAndUpdate(expectation._id, {
    $set: {
      status: 'surprised',
      surprisedAt: new Date(),
      surprisedBy: (actualText || '').slice(0, 500),
      predictiveDissonance
    },
    $push: { revisions: revision }
  })

  // Update predictive accuracy in AgentState
  await AgentState.findOneAndUpdate(
    { conversationId: expectation.conversationId },
    {
      $inc: { 'predictiveAccuracy.surprised': 1 }
    }
  )

  await updateRollingAccuracy(expectation.conversationId)
}

// ── Lapse Expectations ─────────────────────────────────────────
// Called from autonomy loop. Marks overdue expectations as lapsed.

async function lapseExpectations(conversationId) {
  const now = new Date()

  // Find active expectations that are past their lapse window (2× expectedBy)
  const active = await Expectation.find({
    conversationId,
    status: 'active'
  }).lean()

  let lapsedCount = 0

  for (const exp of active) {
    const created = new Date(exp.timestamp).getTime()
    const expected = new Date(exp.expectedBy).getTime()
    const totalWindow = expected - created
    const lapseAt = expected + totalWindow * (LAPSE_MULTIPLIER - 1)

    if (now.getTime() > lapseAt) {
      await Expectation.findByIdAndUpdate(exp._id, {
        $set: { status: 'lapsed', lapsedAt: now }
      })
      lapsedCount++
    }
  }

  if (lapsedCount > 0) {
    await AgentState.findOneAndUpdate(
      { conversationId },
      { $inc: { 'predictiveAccuracy.lapsed': lapsedCount } }
    )
    await updateRollingAccuracy(conversationId)
  }

  return lapsedCount
}

// ── Rolling Accuracy ───────────────────────────────────────────

async function updateRollingAccuracy(conversationId) {
  const state = await AgentState.findOne({ conversationId })
    .select('predictiveAccuracy')
    .lean()

  if (!state?.predictiveAccuracy) return

  const { confirmed = 0, surprised = 0, lapsed = 0 } = state.predictiveAccuracy
  const total = confirmed + surprised + lapsed
  if (total === 0) return

  // Rolling accuracy: confirmed / total (lapsed count as misses)
  const rolling = confirmed / total

  await AgentState.findOneAndUpdate(
    { conversationId },
    { $set: { 'predictiveAccuracy.rolling': parseFloat(rolling.toFixed(3)) } }
  )
}

// ── Predictive Accuracy ────────────────────────────────────────

async function getPredictiveAccuracy(conversationId) {
  const state = await AgentState.findOne({ conversationId })
    .select('predictiveAccuracy')
    .lean()

  if (!state?.predictiveAccuracy) {
    return { confirmed: 0, surprised: 0, lapsed: 0, rolling: 0.5 }
  }

  return state.predictiveAccuracy
}

// ── Format Expectations Prompt ─────────────────────────────────
// Builds the prompt section injected into the system prompt.

function formatExpectationsPrompt(confirmed, surprised, active, accuracy) {
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

module.exports = {
  generateExpectations,
  storeExpectations,
  resonateExpectations,
  confirmExpectation,
  surpriseExpectation,
  lapseExpectations,
  getExpectationHornPosition,
  computeExpectationUrgency,
  formatExpectationsPrompt,
  getPredictiveAccuracy,
  horizonToExpectedBy
}
