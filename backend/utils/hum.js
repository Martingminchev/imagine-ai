const AgentState = require('../models/AgentState')
const Memory = require('../models/Memory')
const { cosineSimilarity } = require('./similarity')

// ── Sacred Constants ───────────────────────────────────────────
const PHI = (1 + Math.sqrt(5)) / 2       // φ ≈ 1.618
const PHI_INV = 1 / PHI                  // 1/φ ≈ 0.618
const PHI_COMP = 1 - PHI_INV             // 1 - 1/φ ≈ 0.382
const VIVID_MS = 13 * 60 * 1000          // F(7) minutes — the vivid window
const TAU = VIVID_MS                      // Decay time constant = one vivid window
const TWO_PI = 2 * Math.PI

/**
 * Update the hum after a new memory composite is created.
 * Blends the new signal into the existing hum at the golden ratio:
 *   new_hum = φ⁻¹ · old_hum + (1−φ⁻¹) · newComposite
 * Also updates the ground state (running mean of all composites).
 *
 * IMPORTANT: calls must be serialized (await each) — concurrent calls
 * will cause the second to overwrite the first.
 */
async function updateHum(conversationId, newComposite) {
  if (!newComposite || newComposite.length === 0) return

  const state = await AgentState.findOne({ conversationId })
    .select('hum')
    .lean()
  if (!state) return

  const hum = state.hum || {}
  const oldVector = hum.vector || []
  const groundState = hum.groundState || []
  const count = hum.groundStateCount || 0

  // ── Update ground state (running mean of all composites) ──
  let newGround
  if (groundState.length === 0 || groundState.length !== newComposite.length) {
    newGround = [...newComposite]
  } else {
    newGround = groundState.map((g, i) =>
      (g * count + newComposite[i]) / (count + 1)
    )
  }

  // ── Blend hum: φ⁻¹ · old + (1−φ⁻¹) · new ──
  let newVector
  if (oldVector.length === 0 || oldVector.length !== newComposite.length) {
    newVector = [...newComposite]
  } else {
    newVector = oldVector.map((h, i) =>
      PHI_INV * h + PHI_COMP * newComposite[i]
    )
  }

  await AgentState.findOneAndUpdate(
    { conversationId },
    {
      $set: {
        'hum.vector': newVector,
        'hum.groundState': newGround,
        'hum.groundStateCount': count + 1,
        'hum.lastUpdated': new Date()
      }
    }
  )
}

/**
 * Get the current hum state, decayed toward ground state by elapsed time.
 * The hum IS the spacetime fabric. Between interactions it relaxes toward
 * the ground state (the mean of all experience — the horn's resting frequency).
 * Returns { vector, phase, intensity, decayFactor } or null if no hum exists.
 */
async function getCurrentHum(conversationId) {
  const state = await AgentState.findOne({ conversationId })
    .select('hum')
    .lean()

  if (!state?.hum?.vector?.length) return null

  const { vector, groundState, lastUpdated } = state.hum
  if (!vector.length || !groundState?.length) return null

  // ── Temporal decay toward ground state ──
  // e^(-Δt/τ): 1.0 = just perturbed, 0.0 = fully relaxed
  const elapsed = lastUpdated ? Date.now() - new Date(lastUpdated).getTime() : Infinity
  const decayFactor = Math.exp(-elapsed / TAU)

  // current = ground + decayFactor · (stored − ground)
  const current = groundState.map((g, i) =>
    g + decayFactor * ((vector[i] || 0) - g)
  )

  // ── Phase: one full rotation per vivid window ──
  const phase = ((Date.now() % VIVID_MS) / VIVID_MS) * TWO_PI

  // ── Intensity: cosine distance from current hum to ground state ──
  // 0 = fully relaxed (current ≈ ground), 1 = maximally perturbed
  const sim = cosineSimilarity(current, groundState)
  const intensity = Math.min(1.0, Math.max(0, 1 - sim))

  return { vector: current, phase, intensity, decayFactor }
}

/**
 * Compute the gravitational coupling of a memory against the hum.
 * The hum is the superfluid's baseline vibration — the spacetime fabric.
 * Memories that MATCH the hum are invisible (part of the background).
 * Memories that DIVERGE from the hum are swirls — gravitational perturbations.
 *
 * gravity = max(0.1, humDissonance × φ)
 *
 * At humDissonance = 0     → gravity = 0.1   (background, barely visible)
 * At humDissonance = 1/φ   → gravity = 1.0   (neutral, normal retrieval)
 * At humDissonance = 1     → gravity = φ      (strong swirl, amplified)
 *
 * The golden ratio defines the boundary between foreground and background:
 * memories with cosine similarity > 1/φ² to the hum are suppressed;
 * those below are amplified.
 */
function computeHumGravity(memComposite, humVector) {
  if (!humVector || !memComposite) return 1.0
  if (humVector.length === 0 || memComposite.length === 0) return 1.0
  if (humVector.length !== memComposite.length) return 1.0

  const similarity = cosineSimilarity(memComposite, humVector)
  const humDissonance = Math.max(0, 1 - similarity)

  // gravity = humDissonance × φ
  // Floor at 0.1: even background memories retain minimal presence
  return Math.max(0.1, humDissonance * PHI)
}

/**
 * Find words from recent memories that are most aligned with the current hum.
 * These are the "overtones" — what the superfluid is currently vibrating with.
 */
async function getHumWords(humVector, conversationId, limit = 5) {
  if (!humVector || humVector.length === 0) return []

  const memories = await Memory.find({
    conversationId,
    'vibrations.0': { $exists: true }
  })
    .sort({ timestamp: -1 })
    .limit(34) // F(9)
    .select('vibrations')
    .lean()

  const wordScores = new Map()
  for (const mem of memories) {
    for (const vib of mem.vibrations) {
      if (!vib.vector || vib.vector.length !== humVector.length) continue
      const score = cosineSimilarity(vib.vector, humVector)
      const existing = wordScores.get(vib.word) || 0
      if (score > existing) {
        wordScores.set(vib.word, score)
      }
    }
  }

  return [...wordScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word, score]) => ({ word, alignment: parseFloat(score.toFixed(3)) }))
}

/**
 * Format the hum for injection into the system prompt.
 * The hum complements the memory section — it tells the AI what's "normal"
 * so that deviations (swirls in the superfluid) stand out naturally.
 */
function formatHumPrompt(humData, humWords) {
  if (!humData || humData.intensity < 0.01) return ''

  const wordsStr = humWords.length > 0
    ? humWords.map(w => w.word).join(', ')
    : 'stillness'

  const intensityPct = (humData.intensity * 100).toFixed(0)
  const phaseDeg = ((humData.phase / TWO_PI) * 360).toFixed(0)

  return `\n\n--- THE HUM ---
Background vibration: ${wordsStr}
This is the texture of your current state — the familiar. Your memories that deviate from this background carry more weight; they are the swirls that stand out against the flow.
Intensity: ${intensityPct}% | Phase: ${phaseDeg}°
--- END HUM ---`
}

module.exports = { updateHum, getCurrentHum, computeHumGravity, getHumWords, formatHumPrompt }
