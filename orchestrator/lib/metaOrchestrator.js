/**
 * @module metaOrchestrator
 *
 * Cross-project learning loop that synthesizes wisdom across all projects.
 *
 * While the per-project autonomy loop (autonomy.js) handles thought generation
 * within a single conversation, the meta-orchestrator operates at a higher level:
 * it periodically reviews lessons learned across ALL projects and synthesizes
 * generalized insights when patterns emerge.
 *
 * ## How It Works
 *
 *   1. Every META_TICK_INTERVAL (default 5 minutes), run a meta tick
 *   2. Query recent lessons from the global pool (last 24 hours)
 *   3. Cluster lessons by cosine similarity to detect recurring patterns
 *   4. If a cluster contains lessons from 2+ different conversations,
 *      ask the LLM to synthesize a generalized lesson
 *   5. Store the synthesis in the global pool with source: 'meta-synthesis'
 *
 * Synthesized lessons surface in all projects via the pipeline's compose step
 * (step 10: cross-project lessons), enabling organic knowledge transfer.
 *
 * Exports:
 *   metaTick()        — run one cycle of cross-project synthesis
 *   startMetaLoop()   — start the background polling loop
 *   stopMetaLoop()    — stop the background polling loop
 */

const Memory = require('../models/Memory')
const { cosineSimilarity } = require('./similarity')
const { GLOBAL_LESSONS_USER, GLOBAL_LESSONS_CONVERSATION } = require('./lessons')

// ═══════════════════════════════════════════════════════════════
// §1  Constants
// ═══════════════════════════════════════════════════════════════

/** How often the meta-orchestrator runs (default: 5 minutes) */
const META_TICK_INTERVAL = () => parseInt(process.env.META_TICK_INTERVAL || '300000', 10)

/** How far back to look for recent lessons (24 hours) */
const LESSON_LOOKBACK_MS = 24 * 60 * 60 * 1000

/** Minimum cosine similarity to consider two lessons related */
const CLUSTER_THRESHOLD = 0.6

/** Minimum cluster size to trigger synthesis */
const MIN_CLUSTER_SIZE = 2

/** Maximum syntheses per tick (avoid LLM overload) */
const MAX_SYNTHESES_PER_TICK = 2

/** Loop state */
let loopInterval = null

// ═══════════════════════════════════════════════════════════════
// §2  Pattern Detection
// ═══════════════════════════════════════════════════════════════

/**
 * Cluster recent lessons by cosine similarity.
 *
 * Uses greedy single-linkage clustering: for each unassigned lesson,
 * find all other lessons within CLUSTER_THRESHOLD and group them.
 * Only clusters containing lessons from 2+ different conversations
 * are returned (cross-project patterns).
 *
 * @param {Array<Object>} lessons - Lesson documents with composite vectors
 * @returns {Array<Array<Object>>} Clusters of related cross-project lessons
 */
function clusterLessons(lessons) {
  const assigned = new Set()
  const clusters = []

  for (let i = 0; i < lessons.length; i++) {
    if (assigned.has(i)) continue
    if (!lessons[i].composite || lessons[i].composite.length === 0) continue

    const cluster = [lessons[i]]
    assigned.add(i)

    for (let j = i + 1; j < lessons.length; j++) {
      if (assigned.has(j)) continue
      if (!lessons[j].composite || lessons[j].composite.length === 0) continue

      const sim = cosineSimilarity(lessons[i].composite, lessons[j].composite)
      if (sim >= CLUSTER_THRESHOLD) {
        cluster.push(lessons[j])
        assigned.add(j)
      }
    }

    // Only keep clusters that span multiple conversations (cross-project)
    const uniqueConversations = new Set(cluster.map(l => l.conversationId))
    if (cluster.length >= MIN_CLUSTER_SIZE && uniqueConversations.size >= 2) {
      clusters.push(cluster)
    }
  }

  return clusters
}

// ═══════════════════════════════════════════════════════════════
// §3  Lesson Synthesis
// ═══════════════════════════════════════════════════════════════

/**
 * Synthesize a generalized lesson from a cluster of related lessons.
 *
 * Asks the LLM to distill the common pattern across projects into
 * a single actionable insight. The synthesis is stored in the global
 * lesson pool with source: 'meta-synthesis'.
 *
 * @param {Array<Object>} cluster - Related lessons from multiple projects
 * @returns {Promise<Object|null>} The stored synthesis memory, or null if skipped
 */
async function synthesizeCluster(cluster) {
  const { generate } = require('./generate')
  const { storeMemory } = require('./resonance')

  const lessonTexts = cluster
    .map((l, i) => `${i + 1}. ${l.text}`)
    .join('\n')

  const systemPrompt = `You are synthesizing a cross-project coding lesson. Multiple projects independently learned similar things. Distill the common pattern into ONE concise, generalized lesson (1-2 sentences) that would help any project.

Do NOT reference specific projects. Make it universal and actionable.
Return ONLY the lesson text. No quotes, no preamble, no "Lesson:" prefix.`

  const userPrompt = `These lessons were learned independently across different projects:\n\n${lessonTexts}\n\nSynthesize the common pattern into a single generalized lesson.`

  try {
    const model = process.env.OLLAMA_MODEL || null
    const response = await generate(userPrompt, systemPrompt, 0.3, model, {}, 'meta-synthesis')
    const synthesized = (response || '').trim().slice(0, 500)

    if (!synthesized || synthesized.length < 20) return null

    const memory = await storeMemory(synthesized, 'lesson', {
      confidence: 0.9,
      userId: GLOBAL_LESSONS_USER,
      conversationId: GLOBAL_LESSONS_CONVERSATION,
      source: 'meta-synthesis'
    })

    console.log(`  [Meta] Synthesized: "${synthesized.slice(0, 80)}..."`)
    return memory
  } catch (err) {
    console.error('  [Meta] Synthesis failed:', err.message)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// §4  Meta Tick
// ═══════════════════════════════════════════════════════════════

/**
 * Run one cycle of cross-project lesson synthesis.
 *
 * Queries recent lessons from ALL conversations (not just the global pool),
 * clusters them by similarity, and synthesizes generalized insights from
 * cross-project patterns.
 *
 * @returns {Promise<number>} Number of syntheses created
 */
async function metaTick() {
  const cutoff = new Date(Date.now() - LESSON_LOOKBACK_MS)

  // Query recent lessons across ALL conversations (not just global pool)
  const recentLessons = await Memory.find({
    role: 'lesson',
    timestamp: { $gte: cutoff },
    source: { $ne: 'meta-synthesis' }   // exclude our own syntheses
  })
    .select('text composite conversationId timestamp')
    .limit(200)
    .lean()

  if (recentLessons.length < MIN_CLUSTER_SIZE) return 0

  // Find cross-project patterns
  const clusters = clusterLessons(recentLessons)
  if (clusters.length === 0) return 0

  console.log(`  [Meta] Found ${clusters.length} cross-project pattern(s)`)

  // Synthesize (capped to avoid LLM overload)
  let synthesized = 0
  for (const cluster of clusters.slice(0, MAX_SYNTHESES_PER_TICK)) {
    const result = await synthesizeCluster(cluster)
    if (result) synthesized++
  }

  return synthesized
}

// ═══════════════════════════════════════════════════════════════
// §5  Loop Management
// ═══════════════════════════════════════════════════════════════

/**
 * Start the meta-orchestrator background loop.
 * Polls at META_TICK_INTERVAL (default 5 minutes).
 */
function startMetaLoop() {
  if (loopInterval) return

  const interval = META_TICK_INTERVAL()
  console.log(`  [Meta] Starting cross-project learning loop (every ${Math.round(interval / 1000)}s)`)

  loopInterval = setInterval(async () => {
    try {
      await metaTick()
    } catch (err) {
      console.error('  [Meta] Tick failed:', err.message)
    }
  }, interval)
}

/**
 * Stop the meta-orchestrator background loop.
 */
function stopMetaLoop() {
  if (loopInterval) {
    clearInterval(loopInterval)
    loopInterval = null
    console.log('  [Meta] Loop stopped')
  }
}

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  metaTick,
  startMetaLoop,
  stopMetaLoop
}
