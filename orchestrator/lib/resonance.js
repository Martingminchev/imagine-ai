const { cosineSimilarity } = require('./similarity')

// ════════════════════════════════════════════════════════════════════
//  Sacred Constants (Gabriel's Horn Topology)
// ════════════════════════════════════════════════════════════════════

const HORN_MAX_X  = 7                       // 7 — days of creation, completion
const HORN_SCALE  = Math.PI / 2             // π/2 — sacred ratio for radius
const HORN_Y_SCALE = Math.PI / 4            // π/4 — sacred vertical scaling

// ── Double Horn Constants (Golden Ratio) ─────────────────────────
const PHI      = (1 + Math.sqrt(5)) / 2    // φ ≈ 1.618
const PHI_INV  = 1 / PHI                   // 1/φ ≈ 0.618 — anticipatory coupling
const PHI_COMP = 1 - PHI_INV               // 1 - 1/φ ≈ 0.382 — circulatory cap
const VIVID_MS = 13 * 60 * 1000            // F(7) minutes — circulation decay τ

// ── Default pipeline configuration (Fibonacci-sacred values) ─────
const DEFAULT_CFG = {
  preFilterSize:          144,              // F(12) — 144/21 ≈ 7 = HORN_MAX_X
  resonantCap:            21,               // F(8)
  archivedDragThreshold:  0.034,            // 1/φ⁷
  shortTermMinutes:       13,               // F(7)
  mediumTermDays:         21,               // F(8) — 21/13 ≈ φ
  recentWindow:           5,                // F(5)
  archivedDecayCap:       0.618,            // 1/φ
  resonanceThreshold:     0.368,            // 1/e
  hornCurvature:          0.618,            // 1/φ
  sliceDepthCurve:        0.618,            // 1/φ
  vibrationTightening:    0.0417            // (1/φ − 1/e) / 6
}

// ════════════════════════════════════════════════════════════════════
//  Horn Topology
// ════════════════════════════════════════════════════════════════════

/**
 * Map a memory's age to a position along the Gabriel's Horn axis.
 *
 * The horn is a surface of revolution with radius 1/x, spanning x ∈ [1, 7].
 * - x = 1 (wide mouth) → newest memories, easily accessible
 * - x = 7 (narrow tail / singularity) → oldest memories, require strong resonance
 *
 * When `maxAgeMs` is provided the mapping is linear (normalized).
 * Otherwise an exponential scheme partitions three age bands:
 *   recent (0–1 day) → x ∈ [1, 2]
 *   medium (1–7 days) → x ∈ [2, 4]
 *   old    (7+ days)  → x ∈ [4, 7]  (log-scaled)
 *
 * @param {Date|string|number} timestamp - Memory creation timestamp
 * @param {Date|number}        [now=Date.now()] - Reference "now" instant
 * @param {number|null}        [maxAgeMs=null]  - Oldest memory age (ms) for normalisation
 * @returns {number} hornX position ∈ [1, 7]
 */
function getHornPosition(timestamp, now = Date.now(), maxAgeMs = null) {
  const ageMs = now - new Date(timestamp).getTime()

  if (maxAgeMs === null || maxAgeMs === 0) {
    const ageDays = ageMs / (1000 * 60 * 60 * 24)
    if (ageDays < 1) {
      return 1 + ageDays                                       // 1 → 2
    } else if (ageDays < 7) {
      return 2 + ((ageDays - 1) / 6) * 2                      // 2 → 4
    } else {
      return 4 + Math.min(3, Math.log10(ageDays / 7 + 1) * 2) // 4 → 7
    }
  }

  // Normalised mapping: t=0 (newest) → x=1, t=1 (oldest) → x=7
  const t = Math.min(1, Math.max(0, ageMs / maxAgeMs))
  return 1 + t * (HORN_MAX_X - 1)  // 1 + t·6
}

/**
 * Horn radius at a given position: radius(x) = (1/x) · π/2.
 *
 * At x = 1 the radius is π/2 ≈ 1.571 (wide mouth).
 * At x = 7 the radius is π/14 ≈ 0.224 (narrow tail).
 *
 * @param {number} hornX - Position along horn axis ∈ [1, 7]
 * @returns {number} Radius at that position
 */
function getHornRadius(hornX) {
  return (1 / Math.max(1, Math.min(HORN_MAX_X, hornX))) * HORN_SCALE
}

/**
 * Determine how deep into the horn a query can "see".
 *
 * Strong queries slice deep (high hornX → old memories).
 * Weak queries only reach the wide mouth (recent memories).
 *
 * Combined strength = 0.6 · avgResonance + 0.4 · maxResonance, then raised
 * to `sliceDepthCurve` power:
 *   curve < 1 → generous (moderate resonance reaches deep)
 *   curve > 1 → strict  (only strong resonance reaches the tail)
 *
 * @param {number} avgResonance    - Average resonance of query matches (0–1)
 * @param {number} maxResonance    - Peak resonance found (0–1)
 * @param {number} [sliceDepthCurve=1.0] - Power-curve exponent
 * @returns {number} Maximum visible hornX ∈ [1, 7]
 */
function calculateSliceDepth(avgResonance, maxResonance, sliceDepthCurve = 1.0) {
  if (!avgResonance && !maxResonance) return 1.5

  const combinedStrength = Math.min(1.0, Math.max(0.0,
    avgResonance * 0.6 + maxResonance * 0.4
  ))
  const curved = Math.pow(combinedStrength, sliceDepthCurve)
  const minSlice = 1.0
  const maxSlice = HORN_MAX_X
  return minSlice + curved * (maxSlice - minSlice)
}

// ════════════════════════════════════════════════════════════════════
//  Resonance
// ════════════════════════════════════════════════════════════════════

/**
 * Multi-frequency resonance check (word-level vibration matching).
 *
 * Each query word vibration is tested against every memory word vibration.
 * A memory that resonates on many frequencies scores higher — like a chord
 * vs a single note.
 *
 * Falls back to composite-level cosine similarity when the memory has no
 * word-level vibrations.
 *
 * @param {Array<{word:string, vector:number[]}>} queryVibrations - Query word vectors
 * @param {Object}  memory          - Memory document with .vibrations and .composite
 * @param {number}  [threshold=0.45] - Minimum cosine similarity for a frequency match
 * @returns {{ breadth: number, depth: number, resonance: number,
 *             matches: Array<{query:string, matched:string, score:number}>,
 *             frequenciesMatched: number }}
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
      breadth:            score > threshold ? 1 : 0,
      depth:              score,
      resonance:          score,
      matches:            [],
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
      matches.push({ query: qVib.word, matched: bestMatch, score: bestScore })
    }
  }

  const queryCount = queryVibrations.length || 1
  const breadth    = frequenciesMatched / queryCount
  const depth      = frequenciesMatched > 0 ? totalResonance / frequenciesMatched : 0

  return {
    breadth,
    depth,
    resonance: breadth * depth,
    matches,
    frequenciesMatched
  }
}

// ════════════════════════════════════════════════════════════════════
//  Temporal Classification & Decay
// ════════════════════════════════════════════════════════════════════

/**
 * Classify a memory into a temporal tier based on its age.
 *
 * @param {Date|string|number} timestamp          - Memory creation time
 * @param {number}             [shortTermMinutes=5] - VIVID cutoff (minutes)
 * @param {number}             [mediumTermDays=7]   - FADING cutoff (days)
 * @returns {'short-term'|'medium-term'|'archived'}
 */
function getMemoryTier(timestamp, shortTermMinutes = 5, mediumTermDays = 7) {
  const ageMs      = Date.now() - new Date(timestamp).getTime()
  const ageMinutes = ageMs / (1000 * 60)
  const ageDays    = ageMs / (1000 * 60 * 60 * 24)

  if (ageMinutes < shortTermMinutes) return 'short-term'
  if (ageDays < mediumTermDays)      return 'medium-term'
  return 'archived'
}

/**
 * Compute temporal decay for a memory.
 *
 * Tier behaviour:
 *   short-term  → baseDecay = 1.0 (full strength)
 *   medium-term → exponential decay: exp(-ageDays / τ),  τ = mediumTermDays·3/7
 *   archived    → continues from medium boundary × exp(-(age−window)/30) × cap
 *
 * Modifiers:
 *   accessBonus     — up to +100 % from access count, dampened by emotional salience
 *   refreshBonus    — ×1.3 if accessed in the last 24 h
 *   confidenceMult  — porous interpretations (low confidence.current) surface weaker
 *
 * @param {Date|string|number} timestamp        - Memory creation time
 * @param {Date|string|null}   lastAccessed     - Last access time
 * @param {number}             [accessCount=0]  - Times the memory was retrieved
 * @param {number}             [archivedDecayCap=0.3]   - Max strength for archived
 * @param {number}             [shortTermMinutes=5]     - VIVID cutoff
 * @param {number}             [mediumTermDays=7]       - FADING cutoff
 * @param {number}             [confidenceCurrent=1.0]  - confidence.current
 * @param {number}             [emotionalValence=0]     - Accumulated emotional weight
 * @returns {number} Decay factor ∈ [0.1, 1.0]
 */
function computeTemporalDecay(
  timestamp,
  lastAccessed,
  accessCount      = 0,
  archivedDecayCap = 0.3,
  shortTermMinutes = 5,
  mediumTermDays   = 7,
  confidenceCurrent = 1.0,
  emotionalValence  = 0
) {
  const now           = Date.now()
  const referenceTime = lastAccessed
    ? new Date(lastAccessed).getTime()
    : new Date(timestamp).getTime()
  const ageMs         = now - new Date(timestamp).getTime()
  const sinceLast     = now - referenceTime
  const ageMinutes    = ageMs / (1000 * 60)
  const ageDays       = ageMs / (1000 * 60 * 60 * 24)
  const sinceLastDays = sinceLast / (1000 * 60 * 60 * 24)

  // Scale τ with window: boundary decay ≈ 0.097 regardless of window size
  const tau = mediumTermDays * 3 / 7

  let baseDecay = 1.0
  if (ageMinutes < shortTermMinutes) {
    baseDecay = 1.0
  } else if (ageDays < mediumTermDays) {
    baseDecay = Math.exp(-ageDays / tau)
  } else {
    const boundaryDecay = Math.exp(-mediumTermDays / tau) // exp(-7/3) ≈ 0.097
    baseDecay = boundaryDecay * Math.exp(-(ageDays - mediumTermDays) / 30) * archivedDecayCap
  }

  // Access bonus — inverted by emotional salience
  const cappedAccess   = Math.min(accessCount, 10)
  const salience       = Math.min(1.0, Math.abs(emotionalValence || 0))
  const salienceDamper = 1 - (salience * 0.6)           // 0→1.0, high salience→0.4
  const accessBonus    = 1 + (cappedAccess * 0.1 * salienceDamper)

  const refreshBonus   = lastAccessed && sinceLastDays < 1 ? 1.3 : 1.0

  // Confidence modulates final strength — porous interpretations surface weaker
  const confidenceMultiplier = 0.5 + (confidenceCurrent * 0.5) // range [0.5, 1.0]

  return Math.min(1.0, Math.max(0.1,
    baseDecay * accessBonus * refreshBonus * confidenceMultiplier
  ))
}

// ════════════════════════════════════════════════════════════════════
//  Hum Gravity
// ════════════════════════════════════════════════════════════════════

/**
 * Gravitational coupling from background hum divergence.
 *
 * Memories that deviate from the hum vector create "swirls" — they are
 * more interesting, so they pull harder.
 *
 *   gravity = max(0.1, humDissonance × φ)
 *
 * @param {number[]} memComposite - Memory composite vector
 * @param {number[]} humVector    - Current background hum vector
 * @returns {number} Gravity factor ∈ [0.1, ~φ]
 */
function computeHumGravity(memComposite, humVector) {
  if (!memComposite || !humVector || memComposite.length === 0) return 1.0
  if (humVector.length === 0 || humVector.length !== memComposite.length) return 1.0

  const similarity    = cosineSimilarity(memComposite, humVector)
  const humDissonance = Math.max(0, 1 - similarity)
  return Math.max(0.1, humDissonance * PHI)
}

// ════════════════════════════════════════════════════════════════════
//  Drag Calculation
// ════════════════════════════════════════════════════════════════════

/**
 * Compute drag — the total force pulling a memory into retrieval.
 *
 *   drag = resonance × localDensity × temporalDecay × humGravity
 *          × anticipatoryPrime × circularBoost
 *          ÷ narrowEndPenalty(hornX, hornCurvature)
 *
 * Narrow-end penalty:  penalty = 1 + t^curvature · 2.5  where t = (x−1)/6.
 * Contested memories (active contradictions) are hard-capped at 0.5 —
 * they can inform retrieval but never dominate it.
 *
 * @param {number}  resonance          - Multi-frequency resonance score
 * @param {number}  localDensity       - Neighbourhood density weight
 * @param {number}  [temporalDecay=1]  - Temporal decay factor
 * @param {number|null} [hornX=null]   - Horn axis position (null = skip horn penalty)
 * @param {boolean} [contested=false]  - Whether memory has active contradictions
 * @param {number}  [hornCurvature=1]  - Power-law exponent for narrow-end penalty
 * @param {number}  [humGravity=1]     - Hum divergence gravity
 * @param {number}  [anticipatoryPrime=1] - Double-horn expectation prime
 * @param {number}  [circularBoost=1]  - Double-horn confirmed-path boost
 * @returns {number} Final drag value
 */
function computeDrag(
  resonance,
  localDensity,
  temporalDecay     = 1.0,
  hornX             = null,
  contested         = false,
  hornCurvature     = 1.0,
  humGravity        = 1.0,
  anticipatoryPrime = 1.0,
  circularBoost     = 1.0
) {
  let drag = resonance * (localDensity || 1) * temporalDecay * humGravity

  // Double horn: anticipatory priming — expectations pre-activate memory regions
  drag *= anticipatoryPrime

  // Double horn: circulatory boost — confirmed pathways amplify retrieval
  drag *= circularBoost

  // Horn topology: narrow-end penalty (memories deeper in the horn need
  // stronger drag to surface — the singularity's gravitational pull)
  if (hornX !== null && hornX > 1) {
    const t = (hornX - 1) / (HORN_MAX_X - 1)              // 0 at mouth, 1 at singularity
    const narrowEndPenalty = 1 + Math.pow(t, hornCurvature) * 2.5
    drag = drag / narrowEndPenalty
  }

  // Contested memories: cap at 0.5 — prevents narrative collapse
  if (contested) {
    drag = Math.min(drag, 0.5)
  }

  return drag
}

// ════════════════════════════════════════════════════════════════════
//  Slice (Horn-Aware Neighbourhood Extraction)
// ════════════════════════════════════════════════════════════════════

/**
 * Slice into the memory field around a drag point using horn topology.
 *
 * Finds memories that are both semantically similar AND nearby on the
 * horn axis (±1.5 hornX), then builds a frequency spectrum of the
 * neighbourhood.
 *
 * @param {Object} dragPoint  - Core memory to slice around (needs .composite, .hornX)
 * @param {Array}  allResults - All scored memories
 * @param {number|null} [sliceDepth=null] - Max hornX visible in this slice
 * @param {number} [radius=0.5]          - Cosine similarity threshold
 * @returns {{ core: Object, context: Object[], spectrum: Array<{word:string, intensity:number}>,
 *             depth: number, sliceDepth: number, hornPosition: number }}
 */
function slice(dragPoint, allResults, sliceDepth = null, radius = 0.5) {
  const dragPointHornX = dragPoint.hornX || 1

  const neighborhood = allResults.filter(mem => {
    // Always include the drag point itself
    if (mem._id && dragPoint._id &&
        mem._id.toString() === dragPoint._id.toString()) return true
    if (!mem.composite || !dragPoint.composite) return false

    // Semantic similarity check
    const semanticSimilar = cosineSimilarity(mem.composite, dragPoint.composite) > radius

    // Horn topology check: ±1.5 hornX positions (memories flow together)
    const memHornX     = mem.hornX || 1
    const hornDistance  = Math.abs(memHornX - dragPointHornX)
    const hornNearby   = hornDistance <= 1.5

    // Slice depth filter (if provided)
    const withinSlice  = sliceDepth === null || memHornX <= sliceDepth

    return semanticSimilar && hornNearby && withinSlice
  })

  // Build frequency spectrum from neighbourhood vibrations
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
    core:         dragPoint,
    context:      neighborhood.slice(0, 7),
    spectrum,
    depth:        neighborhood.length,
    sliceDepth:   sliceDepth || dragPointHornX,
    hornPosition: dragPointHornX
  }
}

// ════════════════════════════════════════════════════════════════════
//  Pre-Filter
// ════════════════════════════════════════════════════════════════════

/**
 * Fast pre-filter: rank memories by composite cosine similarity and keep
 * only the top-N candidates before the expensive multi-frequency pass.
 *
 * @param {number[]} queryComposite - Query composite vector
 * @param {Object[]} memories       - All memories (need .composite)
 * @param {number}   [topN=50]      - How many to keep
 * @returns {Object[]} Top-N memories sorted by composite similarity (descending)
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

// ════════════════════════════════════════════════════════════════════
//  Double Horn — Anticipatory Priming
// ════════════════════════════════════════════════════════════════════
//
// Active expectations pre-activate memory regions in the retrospective horn.
// When the system predicted "user will discuss X" and they do, memories about
// X get a φ⁻¹-coupled boost BEFORE full resonance scoring.
// This is a learned prior over the retrieval space.

/**
 * Compute anticipatory prime for a memory based on active expectations.
 *
 * Memories semantically close to urgent, confident expectations are amplified.
 *
 *   prime = 1 + φ⁻¹ · max(sim · urgency · confidence)
 *
 * @param {number[]} memComposite      - Memory composite vector
 * @param {Array<{composite:number[], urgency?:number, confidence?:number}>} activeExpectations
 * @returns {number} Priming factor ∈ [1.0, ~φ]
 */
function computeAnticipatoryPrime(memComposite, activeExpectations) {
  if (!activeExpectations?.length || !memComposite?.length) return 1.0

  let maxPrime = 0
  for (const exp of activeExpectations) {
    if (!exp.composite?.length) continue
    const sim   = cosineSimilarity(memComposite, exp.composite)
    const prime = sim * (exp.urgency || 0.01) * (exp.confidence || 0.5)
    if (prime > maxPrime) maxPrime = prime
  }
  return 1 + PHI_INV * maxPrime
}

// ════════════════════════════════════════════════════════════════════
//  Double Horn — Circulatory Boost
// ════════════════════════════════════════════════════════════════════
//
// Confirmed prediction-reality pathways create persistent flow through
// the double horn. The superfluid circulates: B_mouth → A_mouth.
// Memories aligned with proven pathways are easier to retrieve.
// Paths decay with τ = VIVID_MS.

/**
 * Compute circulatory boost for a memory from confirmed expectation pathways.
 *
 *   boost = 1 + min(φ_comp, Σ strength·decay·sim)
 *
 * Only pathways with sim > 0.5 contribute. Decay = exp(-age / VIVID_MS).
 *
 * @param {number[]} memComposite - Memory composite vector
 * @param {Array<{memoryRegion:number[], strength?:number, confirmedAt:Date|string|number}>} confirmedPaths
 * @returns {number} Boost factor ∈ [1.0, ~1.382]
 */
function computeCirculatoryBoost(memComposite, confirmedPaths) {
  if (!confirmedPaths?.length || !memComposite?.length) return 1.0

  let boost = 0
  const now  = Date.now()
  for (const path of confirmedPaths) {
    if (!path.memoryRegion?.length) continue
    const age   = now - new Date(path.confirmedAt).getTime()
    const decay = Math.exp(-age / VIVID_MS)
    const sim   = cosineSimilarity(memComposite, path.memoryRegion)
    if (sim > 0.5) boost += (path.strength || 0) * decay * sim
  }
  return 1 + Math.min(PHI_COMP, boost)
}

// ════════════════════════════════════════════════════════════════════
//  Double Horn — Cross-Horn Slice Depth
// ════════════════════════════════════════════════════════════════════
//
// Expectations deepen access into the retrospective horn.
// "I was expecting this, so I can reach deeper into memory."
// Strong expectation resonance extends slice by up to φ⁻¹ of remaining depth.

/**
 * Extend base slice depth using cross-horn expectation resonance.
 *
 *   extended = base + deepening · φ⁻¹ · (HORN_MAX_X − base)
 *
 * @param {number}  baseDepth          - Slice depth from single-horn calc
 * @param {Array|null} activeExpectations - Active expectations with .composite, .confidence
 * @param {number[]}   queryComposite    - Current query composite vector
 * @returns {number} Extended slice depth ∈ [baseDepth, HORN_MAX_X]
 */
function calculateSliceDepthDoubleHorn(baseDepth, activeExpectations, queryComposite) {
  let deepening = 0
  if (activeExpectations && queryComposite) {
    for (const exp of activeExpectations) {
      if (!exp.composite?.length) continue
      const sim = cosineSimilarity(queryComposite, exp.composite)
      if (sim > 0.5) deepening = Math.max(deepening, sim * (exp.confidence || 0.5))
    }
  }
  const remaining = HORN_MAX_X - baseDepth
  return Math.min(HORN_MAX_X, baseDepth + deepening * PHI_INV * remaining)
}

// ════════════════════════════════════════════════════════════════════
//  Main Resonance Pipeline
// ════════════════════════════════════════════════════════════════════

/**
 * Run the full horn-topology resonance pipeline on pre-filtered candidates.
 *
 * Pipeline stages:
 *  1. Score each candidate (hornX, multi-frequency resonance, decay, drag)
 *  2. Calculate single-horn slice depth, then extend via double-horn expectations
 *  3. Filter by slice depth and drag thresholds (narrow-end gets stricter)
 *  4. Inject recent-window memories (always at the horn mouth, low drag)
 *  5. Slice into the top drag point for neighbourhood context
 *
 * @param {Array<{word:string, vector:number[]}>} vibrations - Query word vibrations
 * @param {number[]}   composite       - Query composite vector
 * @param {Object[]}   candidates      - Pre-filtered candidate memories
 * @param {Object[]}   recentMemories  - N most-recent memories (for recent window)
 * @param {number}     maxAgeMs        - Age of oldest memory (ms), for horn positioning
 * @param {Object}     cfg             - Pipeline configuration (see DEFAULT_CFG)
 * @param {number[]|null} [humVector=null]          - Current hum vector
 * @param {Array|null}    [activeExpectations=null] - Double-horn expectations
 * @param {Array|null}    [confirmedPaths=null]     - Double-horn confirmed paths
 * @returns {{ resonant: Object[], sliceData: Object }}
 */
function runResonancePipelineFromCandidates(
  vibrations, composite, candidates, recentMemories,
  maxAgeMs, cfg, humVector = null, activeExpectations = null, confirmedPaths = null
) {
  let resonant  = []
  let sliceData = { spectrum: [], depth: 0 }

  if (candidates.length === 0 && recentMemories.length === 0) {
    return { resonant, sliceData }
  }

  const now            = Date.now()
  const effectiveMaxAge = maxAgeMs || 1

  // ── Stage 1: Score every candidate ─────────────────────────────
  const scored = candidates.map(mem => {
    const hornX              = getHornPosition(mem.timestamp, now, effectiveMaxAge)
    const positionThreshold  = cfg.resonanceThreshold + (hornX - 1) * (cfg.vibrationTightening || 0)
    const resonanceResult    = multiResonate(vibrations, mem, positionThreshold)
    const hornRadius         = getHornRadius(hornX)
    const conf               = mem.confidence || { initial: 1.0, current: 1.0 }
    const confCurrent        = typeof conf === 'number' ? conf : (conf.current ?? 1.0)
    const decay              = computeTemporalDecay(
      mem.timestamp, mem.lastAccessed, mem.accessCount,
      cfg.archivedDecayCap, cfg.shortTermMinutes, cfg.mediumTermDays,
      confCurrent, mem.emotionalValence || 0
    )
    const tier     = getMemoryTier(mem.timestamp, cfg.shortTermMinutes, cfg.mediumTermDays)
    const contested = mem.metabolized === false
    const humGrav  = humVector ? computeHumGravity(mem.composite, humVector) : 1.0

    // Double horn: anticipatory priming from prospective horn
    const aPrime   = computeAnticipatoryPrime(mem.composite, activeExpectations)
    // Double horn: circulatory boost from confirmed prediction pathways
    const cBoost   = computeCirculatoryBoost(mem.composite, confirmedPaths)

    let drag = computeDrag(
      resonanceResult.resonance, mem.localDensity, decay, hornX,
      contested, cfg.hornCurvature, humGrav, aPrime, cBoost
    )

    // File memories get a reliability boost — stable project knowledge
    if (mem.role === 'file') drag *= 1.2

    return {
      ...mem,
      ...resonanceResult,
      drag, decay, tier, hornX, hornRadius,
      humGravity:        humGrav,
      anticipatoryPrime: aPrime,
      circularBoost:     cBoost
    }
  })

  // ── Stage 2: Slice depth ───────────────────────────────────────
  const resonances   = scored.map(m => m.resonance).filter(r => r > 0)
  const avgResonance = resonances.length > 0
    ? resonances.reduce((a, b) => a + b, 0) / resonances.length
    : 0
  const maxResonance    = resonances.length > 0 ? Math.max(...resonances) : 0
  const baseSliceDepth  = calculateSliceDepth(avgResonance, maxResonance, cfg.sliceDepthCurve)
  const sliceDepth      = calculateSliceDepthDoubleHorn(baseSliceDepth, activeExpectations, composite)

  // ── Stage 3: Filter by slice depth & drag thresholds ───────────
  const filtered = scored.filter(mem => {
    if (mem.hornX > sliceDepth) return false
    const narrowEndThreshold = mem.hornX > 4
      ? cfg.archivedDragThreshold * (1 + (mem.hornX - 4) / 3)
      : cfg.archivedDragThreshold
    if (mem.tier === 'archived' || mem.hornX > 4) {
      return mem.drag > narrowEndThreshold
    }
    return mem.drag > 0
  })

  filtered.sort((a, b) => b.drag - a.drag)
  resonant = filtered.slice(0, cfg.resonantCap)

  // ── Stage 4: Recent window injection ───────────────────────────
  const recentWindowInt = Math.round(cfg.recentWindow || 0)
  if (recentWindowInt > 0 && recentMemories.length > 0) {
    const resonantIds = new Set(resonant.map(m => m._id?.toString()))
    for (const mem of recentMemories.slice(0, recentWindowInt)) {
      if (!resonantIds.has(mem._id?.toString())) {
        const tier   = getMemoryTier(mem.timestamp, cfg.shortTermMinutes, cfg.mediumTermDays)
        const hornX  = getHornPosition(mem.timestamp, now, effectiveMaxAge)
        resonant.push({
          ...mem,
          drag:               0.01,
          resonance:          0,
          tier,
          matches:            [],
          frequenciesMatched: 0,
          hornX,
          hornRadius:         getHornRadius(hornX)
        })
        resonantIds.add(mem._id?.toString())
      }
    }
    resonant = resonant.slice(0, cfg.resonantCap + recentWindowInt)
  }

  // ── Stage 5: Slice into top drag point ─────────────────────────
  if (resonant.length > 0 && resonant[0].drag > 0) {
    sliceData = slice(resonant[0], filtered, sliceDepth)
  }

  return { resonant, sliceData }
}

// ════════════════════════════════════════════════════════════════════
//  Backward-Compatible Wrappers
// ════════════════════════════════════════════════════════════════════

/**
 * High-level memory search that wraps the full horn resonance pipeline.
 *
 * Steps:
 *  1. Decompose query text into vibrations + composite via embedder
 *  2. Load memories from the database (optionally filtered by role)
 *  3. Pre-filter by composite similarity
 *  4. Run the full resonance pipeline (horn topology, double horn, drag)
 *  5. Return resonant results sorted by drag
 *
 * Also increments access counts on retrieved memories (fire-and-forget).
 *
 * @param {string} queryText          - Natural-language query
 * @param {Object} [options]
 * @param {number} [options.limit=10]        - Max results to return
 * @param {string|null} [options.roleFilter] - Only search memories with this role
 * @returns {Promise<Object[]>} Resonant memories sorted by drag (descending)
 */
async function searchMemory(queryText, { limit = 10, roleFilter = null } = {}) {
  const { decompose } = require('./embedder')
  const Memory        = require('../models/Memory')

  const { vibrations, composite } = await decompose(queryText)
  if (!composite || composite.length === 0) return []

  const filter = {}
  if (roleFilter) filter.role = roleFilter

  const memories = await Memory.find(filter)
    .select('text role composite vibrations confidence timestamp accessCount lastAccessed localDensity emotionalValence metabolized')
    .lean()

  if (memories.length === 0) return []

  // Pre-filter to top candidates by composite similarity
  const candidates = preFilter(composite, memories.filter(m => m.composite?.length > 0), DEFAULT_CFG.preFilterSize)

  // Recent window: N newest memories
  const recentMemories = [...memories]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, DEFAULT_CFG.recentWindow)

  // Max age for horn positioning
  const now      = Date.now()
  const maxAgeMs = Math.max(
    ...memories.map(m => now - new Date(m.timestamp).getTime()),
    1
  )

  // Run the full pipeline (no hum / expectations / confirmed paths in simple mode)
  const { resonant } = runResonancePipelineFromCandidates(
    vibrations, composite, candidates, recentMemories,
    maxAgeMs, { ...DEFAULT_CFG, resonantCap: limit }
  )

  // Increment access counts in background (fire-and-forget)
  if (resonant.length > 0) {
    const ids = resonant.filter(m => m._id).map(m => m._id)
    if (ids.length > 0) {
      Memory.updateMany(
        { _id: { $in: ids } },
        { $inc: { accessCount: 1 }, $set: { lastAccessed: new Date() } }
      ).catch(() => {})
    }
  }

  return resonant
}

/**
 * Store a new memory with word-level vibrations and composite embedding.
 *
 * @param {string} text               - Memory text content
 * @param {string} role               - Memory role ('user' | 'ai' | 'lesson')
 * @param {Object} [options]
 * @param {string|null} [options.taskId]        - Linked task ID
 * @param {number}      [options.confidence]    - Initial confidence (0–1)
 * @param {string}      [options.userId]        - Override userId (for global pools)
 * @param {string}      [options.conversationId] - Override conversationId (for global pools)
 * @param {string}      [options.source]        - Origin tag (e.g. 'meta-synthesis')
 * @returns {Promise<Object>} Created Memory document
 */
async function storeMemory(text, role, {
  taskId = null, confidence = 1.0,
  userId, conversationId, source
} = {}) {
  const { decompose } = require('./embedder')
  const Memory        = require('../models/Memory')

  const { vibrations, composite } = await decompose(text)

  const doc = {
    text, role, composite, vibrations, taskId,
    confidence: {
      initial: confidence,
      current: confidence,
      revisionCount: 0,
      entropyBudget: 1.0
    }
  }

  if (userId) doc.userId = userId
  if (conversationId) doc.conversationId = conversationId
  if (source) doc.source = source

  return Memory.create(doc)
}

// ════════════════════════════════════════════════════════════════════
//  Exports
// ════════════════════════════════════════════════════════════════════

module.exports = {
  // Constants
  HORN_MAX_X,
  HORN_SCALE,
  HORN_Y_SCALE,
  PHI,
  PHI_INV,
  PHI_COMP,
  VIVID_MS,
  DEFAULT_CFG,

  // Horn Topology
  getHornPosition,
  getHornRadius,
  calculateSliceDepth,

  // Resonance
  multiResonate,

  // Temporal
  getMemoryTier,
  computeTemporalDecay,

  // Hum Gravity
  computeHumGravity,

  // Drag
  computeDrag,

  // Slice
  slice,

  // Pre-filter
  preFilter,

  // Double Horn
  computeAnticipatoryPrime,
  computeCirculatoryBoost,
  calculateSliceDepthDoubleHorn,

  // Pipeline
  runResonancePipelineFromCandidates,

  // Backward-compatible wrappers
  searchMemory,
  storeMemory
}
