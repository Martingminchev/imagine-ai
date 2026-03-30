const Memory = require('../models/Memory')
const { cosineSimilarity } = require('./similarity')
const { generate } = require('./generate')
const { decompose } = require('./embedder')
const { getConfidence } = require('./metabolism')

/**
 * Reconsolidate retrieved memories — the core of reconstructive recall.
 *
 * On each retrieval:
 *  1. Preserve sourceText/sourceComposite on first access (immutable engram)
 *  2. Blend the memory's composite vector toward the retrieval context
 *  3. Decay confidence.current proportional to retrieval count + drift
 *  4. Accumulate emotional valence from the current interaction's dissonance
 *  5. Track vectorDrift (cumulative distance from original)
 *  6. Bump confidence.revisionCount on each retrieval-induced change
 *
 * @param {Array} retrievedMemories - resonant memories with _id and drag > 0
 * @param {Array} queryComposite - the current message's composite vector
 * @param {number} dissonance - current interaction dissonance (drives plasticity)
 * @param {number} agentEnergy - agent's current energy level (0-1)
 */
async function reconsolidate(retrievedMemories, queryComposite, dissonance = 0.5, agentEnergy = 0.5) {
  if (!retrievedMemories || retrievedMemories.length === 0) return
  if (!queryComposite || queryComposite.length === 0) return

  const updates = []

  for (const mem of retrievedMemories) {
    if (!mem._id || !mem.composite || mem.composite.length === 0) continue

    const conf = getConfidence(mem)
    const update = {
      $inc: { accessCount: 1, retrievalCount: 1 },
      $set: { lastAccessed: new Date() }
    }

    // 1. Preserve source on first retrieval (the crystalline event — never touched again)
    if (!mem.sourceText) {
      update.$set.sourceText = mem.text
    }
    if (!mem.sourceComposite || mem.sourceComposite.length === 0) {
      update.$set.sourceComposite = mem.composite
    }

    // 2. Compute plasticity: higher dissonance + higher energy = more malleable
    //    Base alpha is small (0.03), scaled by emotional intensity up to ~0.12
    const emotionalIntensity = (dissonance * 0.6) + (agentEnergy * 0.4)
    const alpha = 0.03 + (emotionalIntensity * 0.09)

    // 3. Blend composite toward retrieval context
    const newComposite = blendVectors(mem.composite, queryComposite, alpha)
    update.$set.composite = newComposite

    // 4. Compute drift from source (or from current if source not yet set)
    const sourceVec = (mem.sourceComposite && mem.sourceComposite.length > 0)
      ? mem.sourceComposite
      : mem.composite
    const drift = 1 - cosineSimilarity(newComposite, sourceVec)
    update.$set.vectorDrift = parseFloat(drift.toFixed(6))

    // 5. Accumulate emotional valence — each retrieval during high-dissonance
    //    moments adds emotional weight (persists as metadata, doesn't amplify retrieval)
    const valenceShift = (dissonance - 0.5) * 0.1 // positive for novel, negative for familiar
    update.$inc.emotionalValence = parseFloat(valenceShift.toFixed(4))

    // 6. Confidence.current decays with each retrieval — you're less sure each time
    //    Decay is faster for already-drifted memories
    const driftPenalty = drift * 0.5
    const newCurrent = Math.max(0.1, conf.current * (1 - (0.02 + driftPenalty * 0.03)))
    update.$set['confidence.current'] = parseFloat(newCurrent.toFixed(4))
    update.$inc['confidence.revisionCount'] = 1

    updates.push(Memory.updateOne({ _id: mem._id }, update))
  }

  if (updates.length > 0) {
    await Promise.all(updates)
  }

  return updates.length
}

/**
 * Blend two vectors: result = (1 - alpha) * a + alpha * b
 * This is the engram drift — the memory slides toward the retrieval context.
 */
function blendVectors(a, b, alpha) {
  if (!a || !b || a.length !== b.length) return a || []
  const result = new Array(a.length)
  for (let i = 0; i < a.length; i++) {
    result[i] = (1 - alpha) * a[i] + alpha * b[i]
  }
  return result
}

/**
 * Background text reconstruction for heavily-accessed archived memories.
 * Called post-response for memories that have drifted significantly.
 *
 * The LLM re-summarizes the memory from the AI's current perspective,
 * producing a new text that replaces the old one. The sourceText stays untouched.
 *
 * @param {string} conversationId
 * @param {Array} retrievedMemories - memories that were just accessed
 * @param {string} currentContext - brief description of what's being discussed
 * @param {string} model - LLM model to use
 * @param {Object} apiKeys
 */
async function reconstructMemories(conversationId, retrievedMemories, currentContext, model, apiKeys) {
  // Only reconstruct archived memories that have been retrieved many times
  // and have drifted significantly from their source
  const candidates = retrievedMemories.filter(m => {
    if (!m._id) return false
    const retrievals = (m.retrievalCount || 0)
    const drift = m.vectorDrift || 0
    const conf = getConfidence(m)
    // Needs: 5+ retrievals, measurable drift, not recently reconstructed
    if (retrievals < 5) return false
    if (drift < 0.01) return false
    if (conf.current > 0.8) return false // still quite confident, leave it
    // Don't reconstruct if already done recently (within 1 hour)
    if (m.reconstructedAt && (Date.now() - new Date(m.reconstructedAt).getTime()) < 3600000) return false
    return true
  })

  if (candidates.length === 0) return 0

  // Reconstruct at most 2 memories per turn to avoid LLM overload
  const toReconstruct = candidates.slice(0, 2)
  let count = 0

  for (const mem of toReconstruct) {
    try {
      const conf = getConfidence(mem)
      const sourceText = mem.sourceText || mem.text
      const systemPrompt = `You are reconstructing a memory. You have the original experience and you need to re-express it as you remember it NOW — not as it happened then. Details may blur. Emphasis may shift. Emotional coloring may change based on what has happened since. You are not correcting the memory — you are remembering it, which means changing it.

Current context: ${currentContext}
The memory has been accessed ${mem.retrievalCount || 0} times since it was formed.
Your confidence in this memory: ${(conf.current * 100).toFixed(0)}%
Times revised: ${conf.revisionCount}

Output ONLY the reconstructed memory text. No preamble, no labels. Just the memory as you recall it now.`

      const userPrompt = `Original memory:\n"${sourceText}"\n\nHow do you remember this now?`

      const reconstructed = await generate(userPrompt, systemPrompt, 0.4, model, apiKeys)
      const trimmed = (reconstructed || '').trim()
      if (!trimmed || trimmed.length < 10) continue

      // Re-embed the reconstructed text
      const { composite: newComposite, vibrations: newVibrations } = await decompose(trimmed)

      // Compute new drift from source
      const sourceVec = (mem.sourceComposite && mem.sourceComposite.length > 0)
        ? mem.sourceComposite
        : mem.composite
      const drift = 1 - cosineSimilarity(newComposite, sourceVec)

      // Push old interpretation to revisions[] (git-style history)
      // The event (sourceText) stays crystalline; we're versioning interpretations
      const newCurrent = Math.max(0.1, conf.current * 0.9) // reconstruction costs confidence

      await Memory.updateOne({ _id: mem._id }, {
        $set: {
          text: trimmed,
          composite: newComposite,
          vibrations: newVibrations,
          vectorDrift: parseFloat(drift.toFixed(6)),
          reconstructedAt: new Date(),
          'confidence.current': parseFloat(newCurrent.toFixed(4))
        },
        $inc: { 'confidence.revisionCount': 1 },
        $push: {
          revisions: {
            text: mem.text,
            composite: mem.composite,
            timestamp: new Date(),
            context: `Reconstruction during: ${currentContext.slice(0, 100)}`
          }
        }
      })

      count++
      console.log(`  [Reconsolidation] Reconstructed memory ${mem._id}: drift=${drift.toFixed(4)}, confidence=${newCurrent.toFixed(2)}, revision #${conf.revisionCount + 1}`)
    } catch (err) {
      console.error(`  [Reconsolidation] Failed to reconstruct memory ${mem._id}:`, err.message)
    }
  }

  return count
}

module.exports = { reconsolidate, reconstructMemories, blendVectors }
