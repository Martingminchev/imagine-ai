const express = require('express')
const router = express.Router()

const Memory = require('../models/Memory')
const Task = require('../models/Task')
const { isReady } = require('../lib/db')
const { searchMemory, storeMemory } = require('../lib/resonance')
const { generateStream } = require('../lib/generate')
const { decompose, runStepStream } = require('../lib/orchestrate')
const { recordOutcome, getLessons } = require('../lib/lessons')

/* ================================================================
 *  Health + Status
 * ================================================================ */

/**
 * GET /api/health
 * Quick liveness probe — returns 'ok' once the DB is connected.
 */
router.get('/health', (req, res) => {
  res.json({ status: isReady() ? 'ok' : 'starting' })
})

/**
 * GET /api/status
 * Extended readiness check with mind statistics.
 * Returns DB state, document counts, provider info, and autonomy status.
 */
router.get('/status', async (req, res) => {
  try {
    const InternalThought = require('../models/InternalThought')
    const Expectation = require('../models/Expectation')
    const AgentState = require('../models/AgentState')
    const { isAutonomyRunning } = require('../lib/autonomy')

    const [memoryCount, lessonCount, taskCount, thoughtCount, expectationCount, activeConversations] =
      await Promise.all([
        Memory.countDocuments(),
        Memory.countDocuments({ role: 'lesson' }),
        Task.countDocuments(),
        InternalThought.countDocuments(),
        Expectation.countDocuments(),
        AgentState.countDocuments()
      ])

    res.json({
      db: isReady() ? 'connected' : 'connecting',
      memories: memoryCount,
      lessons: lessonCount,
      tasks: taskCount,
      thoughts: thoughtCount,
      expectations: expectationCount,
      activeConversations,
      autonomyRunning: isAutonomyRunning(),
      provider: process.env.LLM_PROVIDER || 'ollama',
      embedProvider: process.env.EMBED_PROVIDER || 'ollama'
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Chat — streaming SSE
 * ================================================================ */

/**
 * POST /api/chat/stream
 * Main conversational endpoint. Runs the full mind pipeline and streams
 * the AI response back via Server-Sent Events.
 *
 * Body: { message, conversationId?, personality?, model? }
 * Headers: x-user-id (optional, defaults to 'anonymous')
 *
 * SSE events emitted:
 *   step      — pipeline progress updates
 *   token     — streamed response tokens
 *   thought   — internal reasoning surfaced to the client
 *   done      — final summary when generation completes
 *   error     — on failure
 */
router.post('/chat/stream', async (req, res) => {
  const { message, conversationId = 'default', personality, model } = req.body
  if (!message) return res.status(400).json({ error: 'Message is required' })

  const userId = req.headers['x-user-id'] || 'anonymous'

  const apiKeys = {
    geminiApiKey: process.env.GEMINI_API_KEY || req.body.geminiApiKey,
    moonshotApiKey: process.env.MOONSHOT_API_KEY || req.body.moonshotApiKey,
    openaiApiKey: process.env.OPENAI_API_KEY || req.body.openaiApiKey
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // The pipeline manages its own locking internally — no lock here
  try {
    const { runChatPipelineStream } = require('../lib/pipeline')
    await runChatPipelineStream(message, conversationId, {
      personality,
      model,
      apiKeys,
      userId
    }, sendEvent)
    // Pipeline sends its own 'done' event with full metadata
  } catch (err) {
    console.error('Chat stream error:', err.message)
    sendEvent('error', { message: err.message })
  }

  res.end()
})

/* ================================================================
 *  SSE Events — autonomous thoughts
 * ================================================================ */

/**
 * GET /api/events
 * Long-lived SSE connection. The server pushes autonomous thoughts,
 * initiative messages, and internal reasoning to connected clients.
 *
 * Query: conversationId? (default 'default'), userId?
 * Headers: x-user-id (fallback)
 */
router.get('/events', (req, res) => {
  const { conversationId = 'default' } = req.query
  const userId = req.query.userId || req.headers['x-user-id'] || 'anonymous'

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  try {
    const { registerSSEClient } = require('../lib/autonomy')
    registerSSEClient(conversationId, res)
  } catch (err) {
    console.error('SSE registration error:', err.message)
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`)
    res.end()
    return
  }

  // Keep-alive ping every 30 seconds to prevent proxies from closing
  const keepAlive = setInterval(() => {
    try {
      res.write(':ping\n\n')
    } catch (_) {
      clearInterval(keepAlive)
    }
  }, 30000)

  req.on('close', () => {
    clearInterval(keepAlive)
  })
})

/* ================================================================
 *  History
 * ================================================================ */

/**
 * GET /api/history
 * Returns conversation message history (user, ai, initiative roles).
 *
 * Query: conversationId?, limit? (default 50), before? (ISO date for pagination)
 * Headers: x-user-id
 */
router.get('/history', async (req, res) => {
  const { conversationId = 'default', limit = 50, before } = req.query
  const userId = req.headers['x-user-id'] || 'anonymous'

  try {
    const filter = {
      userId,
      conversationId,
      role: { $in: ['user', 'ai', 'initiative'] }
    }
    if (before) {
      filter.timestamp = { $lt: new Date(before) }
    }

    const messages = await Memory.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .select('text role timestamp dissonance gist')
      .lean()

    res.json(messages.reverse())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Personalities
 * ================================================================ */

/**
 * GET /api/personalities
 * Returns the list of available personality presets.
 */
router.get('/personalities', (req, res) => {
  try {
    const { getPersonalityList } = require('../config/personalities')
    res.json(getPersonalityList())
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Agent State
 * ================================================================ */

/**
 * GET /api/state
 * Returns the global agent state for the user.
 * The agent has a single persistent identity across all conversations.
 *
 * Headers: x-user-id
 */
router.get('/state', async (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous'

  try {
    const AgentState = require('../models/AgentState')
    const state = await AgentState.findOne({ userId }).lean()
    if (!state) return res.status(404).json({ error: 'No state found' })
    res.json(state)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Autonomy
 * ================================================================ */

/**
 * POST /api/autonomy/settings
 * Configure autonomy parameters for the global agent.
 *
 * Body: { autonomyEnabled?, reappearanceMin?, reappearanceMax? }
 * Headers: x-user-id
 */
router.post('/autonomy/settings', async (req, res) => {
  const {
    conversationId = 'default',
    autonomyEnabled,
    reappearanceMin,
    reappearanceMax
  } = req.body
  const userId = req.headers['x-user-id'] || 'anonymous'

  try {
    const AgentState = require('../models/AgentState')

    const update = {}
    if (typeof autonomyEnabled === 'boolean') update.autonomyEnabled = autonomyEnabled
    if (reappearanceMin != null) update.reappearanceMin = reappearanceMin
    if (reappearanceMax != null) update.reappearanceMax = reappearanceMax

    await AgentState.findOneAndUpdate(
      { userId },
      { $set: update },
      { upsert: true }
    )

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * POST /api/autonomy/tick
 * Manually trigger an autonomy tick for a conversation.
 * The forced flag bypasses cooldown checks.
 *
 * Body: { conversationId?, model? }
 * Headers: x-user-id
 */
router.post('/autonomy/tick', async (req, res) => {
  const { conversationId = 'default', model } = req.body
  const userId = req.headers['x-user-id'] || 'anonymous'

  try {
    const { tick } = require('../lib/autonomy')
    await tick(conversationId, userId, model, {}, true)
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Conversations
 * ================================================================ */

/**
 * GET /api/conversations
 * List all conversations for the current user.
 *
 * Headers: x-user-id
 */
router.get('/conversations', async (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous'

  try {
    // Conversations are derived from distinct conversationId values in Memory.
    // The agent state is global — conversations are just workspaces.
    const convs = await Memory.aggregate([
      { $match: { userId, role: { $in: ['user', 'ai'] } } },
      { $group: {
        _id: '$conversationId',
        turnCount: { $sum: 1 },
        updatedAt: { $max: '$timestamp' }
      }},
      { $sort: { updatedAt: -1 } }
    ])

    res.json(convs.map(c => ({
      id: c._id,
      turnCount: Math.floor(c.turnCount / 2),
      updatedAt: c.updatedAt
    })))
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * DELETE /api/conversations/:id
 * Delete a conversation workspace and its scoped data (chat memories,
 * unfinished thoughts, expectations, contradictions).
 * The global agent state is never deleted here.
 *
 * Headers: x-user-id
 */
router.delete('/conversations/:id', async (req, res) => {
  const userId = req.headers['x-user-id'] || 'anonymous'
  const conversationId = req.params.id

  try {
    const ConversationState = require('../models/ConversationState')
    const InternalThought = require('../models/InternalThought')
    const Expectation = require('../models/Expectation')
    const Contradiction = require('../models/Contradiction')

    // Delete conversation-scoped data only. AgentState is global — never deleted here.
    await Promise.all([
      Memory.deleteMany({ userId, conversationId }),
      ConversationState.deleteMany({ userId, conversationId }),
      InternalThought.deleteMany({ userId, conversationId }),
      Expectation.deleteMany({ userId, conversationId }),
      Contradiction.deleteMany({ userId, conversationId })
    ])

    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Files — read-only project access
 * ================================================================ */

/**
 * GET /api/files
 * List directory contents within the configured PROJECT_ROOT.
 * Returns entries sorted directories-first, excluding ignored paths.
 *
 * Query: path? (relative to PROJECT_ROOT, defaults to '.')
 * Returns: { root, path, entries: [{ name, type, size }] }
 */
router.get('/files', async (req, res) => {
  const { getProjectRoot, listDirectory } = require('../lib/fileAccess')

  const root = getProjectRoot()
  if (!root) return res.status(400).json({ error: 'PROJECT_ROOT is not configured in .env' })

  const relativePath = req.query.path || '.'

  try {
    const entries = await listDirectory(relativePath)
    res.json({ root, path: relativePath, entries })
  } catch (err) {
    if (err.message === 'Path escapes project root') {
      return res.status(403).json({ error: err.message })
    }
    res.status(404).json({ error: err.message })
  }
})

/**
 * GET /api/files/read
 * Read a single file within the configured PROJECT_ROOT.
 * Binary files are refused. Files over 100KB are truncated.
 *
 * Query: path (required, relative to PROJECT_ROOT)
 * Returns: { path, content, size, truncated }
 */
router.get('/files/read', async (req, res) => {
  const { getProjectRoot, readFile } = require('../lib/fileAccess')

  const root = getProjectRoot()
  if (!root) return res.status(400).json({ error: 'PROJECT_ROOT is not configured in .env' })

  const relativePath = req.query.path
  if (!relativePath) return res.status(400).json({ error: 'Query parameter "path" is required' })

  try {
    const result = await readFile(relativePath)
    res.json(result)
  } catch (err) {
    if (err.message === 'Path escapes project root') {
      return res.status(403).json({ error: err.message })
    }
    if (err.message.startsWith('Binary file type')) {
      return res.status(400).json({ error: err.message })
    }
    res.status(404).json({ error: err.message })
  }
})

/**
 * POST /api/files/sync
 * Trigger an incremental sync of project files into the memory system.
 * Requires a projectRoot (from body or PROJECT_ROOT env var).
 *
 * Body: { conversationId?, projectRoot? }
 * Headers: x-user-id
 * Returns: { synced, skipped, deleted }
 */
router.post('/files/sync', async (req, res) => {
  const { conversationId = 'default', projectRoot } = req.body
  const userId = req.headers['x-user-id'] || 'anonymous'

  try {
    const root = projectRoot || process.env.PROJECT_ROOT
    if (!root) {
      return res.status(400).json({ error: 'No projectRoot provided and PROJECT_ROOT not set in .env' })
    }

    const { syncProjectFiles } = require('../lib/fileSync')
    const result = await syncProjectFiles(root, userId, conversationId)
    res.json(result)
  } catch (err) {
    console.error('File sync error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Projects — conversation + directory binding
 * ================================================================ */

/**
 * POST /api/projects
 * Create a project conversation — binds a conversationId to a directory.
 * Sets projectRoot on AgentState and triggers an initial file sync.
 *
 * Body: { conversationId, projectRoot, personality?, model? }
 * Headers: x-user-id
 * Returns: { conversationId, projectRoot, fileSync: { synced, skipped, deleted } }
 */
router.post('/projects', async (req, res) => {
  const { conversationId, projectRoot, personality, model } = req.body
  const userId = req.headers['x-user-id'] || 'anonymous'

  if (!conversationId) return res.status(400).json({ error: 'conversationId is required' })
  if (!projectRoot) return res.status(400).json({ error: 'projectRoot is required' })

  try {
    const { loadOrCreateState } = require('../lib/agentState')
    const AgentState = require('../models/AgentState')

    // Ensure the global agent state exists
    await loadOrCreateState(userId, personality || null)

    // Persist model if provided
    if (model) {
      await AgentState.findOneAndUpdate(
        { userId },
        { $set: { defaultModel: model } }
      )
    }

    // Trigger initial file sync
    const { syncProjectFiles } = require('../lib/fileSync')
    const fileSync = await syncProjectFiles(projectRoot, userId, conversationId)

    res.json({ conversationId, projectRoot, fileSync })
  } catch (err) {
    console.error('Project creation error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Tasks: decompose
 * ================================================================ */

/**
 * POST /api/tasks
 * Decompose a coding task description into executable steps.
 *
 * Body: { description, model? }
 */
router.post('/tasks', async (req, res) => {
  const { description, model, conversationId = 'default' } = req.body
  if (!description) return res.status(400).json({ error: 'Description is required' })

  try {
    const { task, lessons } = await decompose(description, model, {}, conversationId)
    res.json({ task, lessons: lessons.map(l => l.text) })
  } catch (err) {
    console.error('Decompose error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Tasks: list
 * ================================================================ */

/**
 * GET /api/tasks
 * List tasks. Optionally filter by conversationId.
 *
 * Query: conversationId? (if provided, returns only that project's tasks)
 */
router.get('/tasks', async (req, res) => {
  try {
    const filter = {}
    if (req.query.conversationId) {
      filter.conversationId = req.query.conversationId
    }
    const tasks = await Task.find(filter)
      .sort({ timestamp: -1 })
      .limit(50)
      .lean()
    res.json(tasks)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Tasks: get one
 * ================================================================ */

/**
 * GET /api/tasks/:id
 * Retrieve a single task by its ID.
 */
router.get('/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).lean()
    if (!task) return res.status(404).json({ error: 'Task not found' })
    res.json(task)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Tasks: run a step (streaming SSE)
 * ================================================================ */

/**
 * POST /api/tasks/:taskId/steps/:stepId/run
 * Execute a single task step via LLM, streaming tokens back as SSE.
 *
 * Body: { model? }
 */
router.post('/tasks/:taskId/steps/:stepId/run', async (req, res) => {
  const { taskId, stepId } = req.params
  const { model } = req.body || {}

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    sendEvent('step', { step: 'running', detail: 'Executing step via LLM...' })

    await runStepStream(taskId, stepId, model, {}, (type, token) => {
      if (type === 'text') sendEvent('token', { text: token })
    })

    sendEvent('done', {})
    res.end()
  } catch (err) {
    sendEvent('error', { message: err.message })
    res.end()
  }
})

/* ================================================================
 *  Tasks: report outcome
 * ================================================================ */

/**
 * PATCH /api/tasks/:id/outcome
 * Report the outcome of a task. If successful, a lesson is extracted.
 *
 * Body: { outcome, success (boolean), model? }
 */
router.patch('/tasks/:id/outcome', async (req, res) => {
  const { outcome, success, model } = req.body
  if (!outcome) return res.status(400).json({ error: 'Outcome is required' })
  if (typeof success !== 'boolean') return res.status(400).json({ error: 'Success (boolean) is required' })

  try {
    const result = await recordOutcome(req.params.id, { outcome, success, model })
    res.json({
      task: result.task,
      lesson: { text: result.lesson.text, id: result.lesson._id }
    })
  } catch (err) {
    console.error('Outcome error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/* ================================================================
 *  Lessons
 * ================================================================ */

/**
 * GET /api/lessons
 * List the most recent lessons (extracted from task outcomes).
 */
router.get('/lessons', async (req, res) => {
  try {
    const lessons = await getLessons(50)
    res.json(lessons)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

/**
 * GET /api/lessons/global
 * List lessons from the cross-project global pool.
 * Includes both direct copies and meta-synthesized lessons.
 */
router.get('/lessons/global', async (req, res) => {
  try {
    const { getGlobalLessons } = require('../lib/lessons')
    const lessons = await getGlobalLessons(50)
    res.json(lessons)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
