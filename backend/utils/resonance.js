const { cosineSimilarity } = require('./similarity')

// ── Sacred Constants (Gabriel's Horn Topology) ────────────────────
const HORN_MAX_X = 7                       // 7 — days of creation, completion
const HORN_SCALE = Math.PI / 2             // π/2 — sacred ratio for radius
const HORN_Y_SCALE = Math.PI / 4           // π/4 — sacred vertical scaling

/**
 * Calculate memory position along the horn axis based on age.
 * x=1 (wide mouth) = newest memories, easily accessible
 * x=7 (narrow tail) = oldest memories, require strong resonance
 * @param {Date|string|number} timestamp - Memory timestamp
 * @param {Date|number} now - Current time (default: Date.now())
 * @param {number} maxAgeMs - Maximum age in milliseconds (for normalization)
 * @returns {number} hornX position ∈ [1, 7]
 */
function getHornPosition(timestamp, now = Date.now(), maxAgeMs = null) {
  const ageMs = now - new Date(timestamp).getTime()
  
  if (maxAgeMs === null || maxAgeMs === 0) {
    // If no max age provided, use exponential mapping
    // Recent (0-1 day) → x=1-2 (wide)
    // Medium (1-7 days) → x=2-4
    // Old (7+ days) → x=4-7 (narrow)
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    if (ageDays < 1) {
      return 1 + ageDays  // 1 → 2
    } else if (ageDays < 7) {
      return 2 + ((ageDays - 1) / 6) * 2  // 2 → 4
    } else {
      return 4 + Math.min(3, Math.log10(ageDays / 7 + 1) * 2)  // 4 → 7
    }
  }
  
  // Normalized mapping: t=0 (newest) → x=1, t=1 (oldest) → x=7
  const t = Math.min(1, Math.max(0, ageMs / maxAgeMs))
  return 1 + t * (HORN_MAX_X - 1)  // 1 + t*6
}

/**
 * Calculate horn radius at a given position.
 * radius(x) = (1/x) * π/2
 * @param {number} hornX - Position along horn axis ∈ [1, 7]
 * @returns {number} Radius at that position
 */
function getHornRadius(hornX) {
  return (1 / Math.max(1, Math.min(HORN_MAX_X, hornX))) * HORN_SCALE
}

/**
 * Calculate slice depth based on query resonance strength.
 * Strong queries slice deeper into the narrow end (can access old memories).
 * Weak queries only see the wide end (recent memories).
 * @param {number} avgResonance - Average resonance strength of query (0-1)
 * @param {number} maxResonance - Maximum resonance found (0-1)
 * @param {number} sliceDepthCurve - Power-curve exponent (default 1.0 = linear)
 * @returns {number} Maximum hornX position visible in this slice ∈ [1, 7]
 */
function calculateSliceDepth(avgResonance, maxResonance, sliceDepthCurve = 1.0) {
  // Handle edge cases: if no resonance, default to shallow slice (recent memories only)
  if (!avgResonance && !maxResonance) {
    return 1.5  // Very shallow slice, only very recent memories
  }
  
  // Combine average and max resonance to determine slice depth
  // Strong resonance (high values) → deep slice (high hornX, narrow end)
  // Weak resonance (low values) → shallow slice (low hornX, wide end)
  const combinedStrength = Math.min(1.0, Math.max(0.0, avgResonance * 0.6 + maxResonance * 0.4))
  
  // Power-curve: controls how resonance maps to depth
  // sliceDepthCurve < 1.0 → moderate resonance reaches deep (generous)
  // sliceDepthCurve > 1.0 → only strong resonance reaches the narrow end (strict)
  const curved = Math.pow(combinedStrength, sliceDepthCurve)
  
  const minSlice = 1.0
  const maxSlice = HORN_MAX_X
  return minSlice + curved * (maxSlice - minSlice)
}

/**
 * Multi-frequency resonance check.
 * Each query word vibration is tested against each memory word vibration.
 * A memory that resonates on MANY frequencies scores higher than one
 * that matches on just one -- like a chord vs a single note.
 */
function multiResonate(queryVibrations, memory, threshold = 0.45) {
  if (!memory.vibrations || memory.vibrations.length === 0) {
    // Fallback: compare composites directly
    const score = cosineSimilarity(
      queryVibrations.map(v => v.vector).reduce((acc, v) => {
        if (acc.length === 0) return [...v]
        return acc.map((val, i) => val + v[i])
      }, []),
      memory.composite
    )
    return {
      breadth: score > threshold ? 1 : 0,
      depth: score,
      resonance: score,
      matches: [],
      frequenciesMatched: score > threshold ? 1 : 0
    }
  }

  let totalResonance = 0
  let frequenciesMatched = 0
  const matches = []

  for (const qVib of queryVibrations) {
    let bestScore = 0
    let bestMatch = null

    for (const mVib of memory.vibrations) {
      const score = cosineSimilarity(qVib.vector, mVib.vector)
      if (score > bestScore) {
        bestScore = score
        bestMatch = mVib.word
      }
    }

    if (bestScore > threshold) {
      frequenciesMatched++
      totalResonance += bestScore
      matches.push({
        query: qVib.word,
        matched: bestMatch,
        score: bestScore
      })
    }
  }

  const queryCount = queryVibrations.length || 1
  const breadth = frequenciesMatched / queryCount
  const depth = frequenciesMatched > 0 ? totalResonance / frequenciesMatched : 0

  return {
    breadth,
    depth,
    resonance: breadth * depth,
    matches,
    frequenciesMatched
  }
}

/**
 * Classify a memory into a temporal tier based on its age.
 * @param {number} shortTermMinutes - VIVID cutoff in minutes (default 5)
 * @param {number} mediumTermDays - FADING cutoff in days (default 7)
 */
function getMemoryTier(timestamp, shortTermMinutes = 5, mediumTermDays = 7) {
  const ageMs = Date.now() - new Date(timestamp).getTime()
  const ageMinutes = ageMs / (1000 * 60)
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  if (ageMinutes < shortTermMinutes) return 'short-term'
  if (ageDays < mediumTermDays) return 'medium-term'
  return 'archived'
}

/**
 * Compute temporal decay for a memory.
 * Recent memories are strong (1.0), older ones fade.
 * Confidence.current modulates retrieval strength — porous interpretations surface weaker.
 * Emotional salience REDUCES the access bonus (inverted from original design):
 *   high |emotionalValence| = emotion persists as metadata but STOPS amplifying retrieval.
 * @param {number} archivedDecayCap - Max strength for archived memories (default 0.3)
 * @param {number} shortTermMinutes - VIVID cutoff in minutes (default 5)
 * @param {number} mediumTermDays - FADING cutoff in days (default 7)
 * @param {number} confidenceCurrent - confidence.current from the confidence vector (default 1.0)
 * @param {number} emotionalValence - accumulated emotional weight (default 0)
 */
function computeTemporalDecay(timestamp, lastAccessed, accessCount = 0, archivedDecayCap = 0.3, shortTermMinutes = 5, mediumTermDays = 7, confidenceCurrent = 1.0, emotionalValence = 0) {
  const now = Date.now()
  const referenceTime = lastAccessed ? new Date(lastAccessed).getTime() : new Date(timestamp).getTime()
  const ageMs = now - new Date(timestamp).getTime()
  const sinceLast = now - referenceTime
  const ageMinutes = ageMs / (1000 * 60)
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  const sinceLastDays = sinceLast / (1000 * 60 * 60 * 24)

  let baseDecay = 1.0

  // Scale time constant with medium-term window size.
  // Original: tau=3 for 7-day window → boundary decay ≈ 0.097
  // Scaled: tau = mediumTermDays * 3/7 → boundary always ≈ 0.097 regardless of window
  const tau = mediumTermDays * 3 / 7

  if (ageMinutes < shortTermMinutes) {
    baseDecay = 1.0
  } else if (ageDays < mediumTermDays) {
    baseDecay = Math.exp(-ageDays / tau)
  } else {
    // Continue from medium-term boundary (always ≈ 0.097)
    const boundaryDecay = Math.exp(-mediumTermDays / tau) // exp(-7/3) ≈ 0.097 invariant
    baseDecay = boundaryDecay * Math.exp(-(ageDays - mediumTermDays) / 30) * archivedDecayCap
  }

  // Access bonus — but inverted by emotional salience
  // High |emotionalValence| dampens the access bonus: the emotion persists
  // as metadata (you know it mattered) but it stops amplifying retrieval
  const cappedAccess = Math.min(accessCount, 10)
  const salience = Math.min(1.0, Math.abs(emotionalValence || 0))
  const salienceDamper = 1 - (salience * 0.6)  // 0→1.0, high salience→0.4
  const accessBonus = 1 + (cappedAccess * 0.1 * salienceDamper)

  const refreshBonus = lastAccessed && sinceLastDays < 1 ? 1.3 : 1.0

  // Confidence modulates final strength — porous interpretations surface weaker
  const confidenceMultiplier = 0.5 + (confidenceCurrent * 0.5)  // range [0.55, 1.0]

  const finalDecay = Math.min(1.0, Math.max(0.1, baseDecay * accessBonus * refreshBonus * confidenceMultiplier))
  return finalDecay
}

/**
 * Drag = resonance amplified by local density, temporal decay, and hum gravity.
 * In horn topology, drag also accounts for horn position (narrow end needs more drag).
 * Contested memories (active contradictions) are capped — they can inform but not dominate.
 * @param {boolean} contested - whether this memory has an active contradiction (default false)
 * @param {number} hornCurvature - power-law exponent for narrow-end penalty (default 1.0 = linear)
 * @param {number} humGravity - gravitational coupling from hum divergence (default 1.0 = no hum)
 */
function computeDrag(resonance, localDensity, temporalDecay = 1.0, hornX = null, contested = false, hornCurvature = 1.0, humGravity = 1.0) {
  let drag = resonance * (localDensity || 1) * temporalDecay * humGravity
  
  // Horn topology: memories at narrow end (high hornX) need stronger drag to surface
  // This represents the "gravity" of the singularity pulling memories inward
  if (hornX !== null && hornX > 1) {
    // Narrow end penalty: power-law curve controlled by hornCurvature
    // At curvature=1.0 (linear): penalty ramps evenly across the horn
    // At curvature=2.0+: penalty concentrates at the singularity (x=5-7)
    const t = (hornX - 1) / (HORN_MAX_X - 1) // 0 at mouth, 1 at singularity
    const narrowEndPenalty = 1 + Math.pow(t, hornCurvature) * 2.5
    drag = drag / narrowEndPenalty
  }

  // Contested memories: cap drag at 0.5 — they can inform retrieval but not dominate it
  // This prevents narrative collapse from one side of a contradiction winning
  if (contested) {
    drag = Math.min(drag, 0.5)
  }
  
  return drag
}

/**
 * Slice into the memory field at a drag point using horn topology.
 * Finds memories in the same "slice" - similar semantic content AND similar horn position.
 * @param {Object} dragPoint - The core memory to slice around
 * @param {Array} allResults - All scored memories
 * @param {number} sliceDepth - Maximum hornX visible in this slice (optional, for horn-aware filtering)
 * @param {number} radius - Semantic similarity threshold (default 0.5)
 */
function slice(dragPoint, allResults, sliceDepth = null, radius = 0.5) {
  const dragPointHornX = dragPoint.hornX || 1
  
  const neighborhood = allResults.filter(mem => {
    if (mem._id && dragPoint._id && mem._id.toString() === dragPoint._id.toString()) return true
    if (!mem.composite || !dragPoint.composite) return false
    
    // Semantic similarity check
    const semanticSimilar = cosineSimilarity(mem.composite, dragPoint.composite) > radius
    
    // Horn topology check: memories should be near each other on the horn axis
    // Within ±1 hornX position (memories flow together through the horn)
    const memHornX = mem.hornX || 1
    const hornDistance = Math.abs(memHornX - dragPointHornX)
    const hornNearby = hornDistance <= 1.5  // Allow some spread along horn
    
    // If sliceDepth provided, ensure memory is within visible slice
    const withinSlice = sliceDepth === null || memHornX <= sliceDepth
    
    return semanticSimilar && hornNearby && withinSlice
  })

  const wordCounts = {}
  for (const mem of neighborhood) {
    if (!mem.vibrations) continue
    for (const vib of mem.vibrations) {
      wordCounts[vib.word] = (wordCounts[vib.word] || 0) + 1
    }
  }

  const spectrum = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, intensity: count }))

  return {
    core: dragPoint,
    context: neighborhood.slice(0, 7),
    spectrum,
    depth: neighborhood.length,
    sliceDepth: sliceDepth || dragPointHornX,
    hornPosition: dragPointHornX
  }
}

/**
 * Pre-filter memories using composite similarity before expensive multi-frequency check.
 */
function preFilter(queryComposite, memories, topN = 50) {
  return memories
    .filter(m => m.composite && m.composite.length > 0)
    .map(mem => ({
      ...mem,
      _compositeScore: cosineSimilarity(queryComposite, mem.composite)
    }))
    .sort((a, b) => b._compositeScore - a._compositeScore)
    .slice(0, topN)
}

module.exports = { 
  multiResonate, 
  computeDrag, 
  computeTemporalDecay, 
  getMemoryTier, 
  slice, 
  preFilter,
  getHornPosition,
  getHornRadius,
  calculateSliceDepth
}
