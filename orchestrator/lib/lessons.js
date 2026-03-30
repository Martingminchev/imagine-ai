const { generate } = require('./generate')
const { storeMemory } = require('./resonance')
const Task = require('../models/Task')

/** Global namespace for cross-project shared lessons */
const GLOBAL_LESSONS_USER = '_system'
const GLOBAL_LESSONS_CONVERSATION = '_lessons'

/**
 * Record the outcome of a task and extract a reusable lesson.
 *
 * 1. Updates the task with outcome details.
 * 2. Asks the LLM to extract a concise lesson from the outcome.
 * 3. Stores the lesson as a local Memory with role='lesson'.
 * 4. Copies the lesson into the global pool for cross-project learning.
 * 5. Links the lesson back to the task.
 *
 * The local lesson surfaces in future resonance searches within this
 * conversation. The global copy enables cross-project transfer via
 * the pipeline's compose step and the meta-orchestrator.
 */
async function recordOutcome(taskId, { outcome, success, model = null, apiKeys = {} }) {
  const task = await Task.findById(taskId)
  if (!task) throw new Error('Task not found')

  task.outcome = outcome.slice(0, 2000)
  task.success = success
  task.status = success ? 'completed' : 'failed'
  task.completedAt = new Date()

  // Build context for lesson extraction
  const stepsContext = task.steps
    .map((s, i) => `Step ${i + 1}: ${s.title} [${s.status}]${s.output ? '\nOutput: ' + s.output.slice(0, 300) : ''}`)
    .join('\n')

  const systemPrompt = `You are extracting a reusable lesson from a coding task outcome. The lesson should be:
- Concise (1-2 sentences)
- Specific enough to be actionable next time
- Framed as advice for a future attempt at a similar task

Examples of good lessons:
- "When adding JWT auth to Express, configure CORS to allow the Authorization header in preflight requests."
- "React 19 useEffect cleanup runs synchronously — avoid async operations in the cleanup function."
- "PostgreSQL JSONB indexes require GIN, not B-tree — always check index type for JSON queries."

Return ONLY the lesson text. No quotes, no preamble, no "Lesson:" prefix.`

  const userPrompt = `Task: ${task.description}

Steps:
${stepsContext}

Outcome: ${outcome}
Result: ${success ? 'SUCCESS' : 'FAILURE'}

Extract a concise, reusable lesson from this experience.`

  let lessonText = ''

  try {
    lessonText = await generate(userPrompt, systemPrompt, 0.3, model, apiKeys, 'extract-lesson')
    lessonText = lessonText.trim().slice(0, 500)
  } catch (err) {
    // If LLM fails, use the raw outcome as the lesson
    lessonText = `${success ? 'Success' : 'Failed'}: ${outcome.slice(0, 300)}`
  }

  // Store as a local lesson — surfaces in resonance within this conversation
  const lessonMemory = await storeMemory(lessonText, 'lesson', {
    taskId: task._id,
    confidence: success ? 1.0 : 0.8
  })

  // Copy to global lesson pool — enables cross-project learning
  storeMemory(lessonText, 'lesson', {
    taskId: task._id,
    confidence: success ? 1.0 : 0.8,
    userId: GLOBAL_LESSONS_USER,
    conversationId: GLOBAL_LESSONS_CONVERSATION,
    source: 'cross-project'
  }).catch(err => {
    console.error('  [Lesson] Global pool copy failed (non-critical):', err.message)
  })

  task.lessonIds.push(lessonMemory._id)
  await task.save()

  console.log(`  [Lesson] ${success ? 'Success' : 'Failure'}: "${lessonText.slice(0, 80)}..."`)

  return { task, lesson: lessonMemory }
}

/**
 * Get all lessons, most recent first.
 * @param {number} [limit=50] - Maximum number of lessons to return
 */
async function getLessons(limit = 50) {
  const Memory = require('../models/Memory')
  return Memory.find({ role: 'lesson' })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean()
}

/**
 * Get global lessons (cross-project pool), most recent first.
 * @param {number} [limit=50] - Maximum number of lessons to return
 */
async function getGlobalLessons(limit = 50) {
  const Memory = require('../models/Memory')
  return Memory.find({
    role: 'lesson',
    userId: GLOBAL_LESSONS_USER,
    conversationId: GLOBAL_LESSONS_CONVERSATION
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean()
}

module.exports = {
  recordOutcome,
  getLessons,
  getGlobalLessons,
  GLOBAL_LESSONS_USER,
  GLOBAL_LESSONS_CONVERSATION
}
