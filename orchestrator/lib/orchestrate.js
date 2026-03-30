const { generate } = require('./generate')
const { searchMemory } = require('./resonance')
const Task = require('../models/Task')

/**
 * Decompose a user request into a structured task with steps.
 *
 * 1. Searches memory for relevant lessons from past tasks.
 * 2. Asks the LLM to break the request into concrete steps.
 * 3. Creates a Task document with the generated steps.
 * 4. Returns the task and any relevant lessons found.
 */
async function decompose(userRequest, model = null, apiKeys = {}, conversationId = 'default') {
  // Search for relevant lessons and past context
  const lessons = await searchMemory(userRequest, { limit: 5, roleFilter: 'lesson' })
  const context = await searchMemory(userRequest, { limit: 5 })

  const lessonBlock = lessons.length > 0
    ? `\nLessons from past tasks (apply these):\n${lessons.map((l, i) => `${i + 1}. ${l.text}`).join('\n')}\n`
    : ''

  const contextBlock = context.length > 0
    ? `\nRelated context from memory:\n${context.map((c, i) => `${i + 1}. [${c.role}] ${c.text.slice(0, 200)}`).join('\n')}\n`
    : ''

  // Inject project structure if PROJECT_ROOT is configured
  let projectBlock = ''
  try {
    const { getProjectRoot, listDirectory, formatTree } = require('./fileAccess')
    if (getProjectRoot()) {
      const entries = await listDirectory('.')
      projectBlock = `\nProject structure:\n${formatTree(entries)}\n`
    }
  } catch (_) { /* PROJECT_ROOT not set or unreadable — skip */ }

  const systemPrompt = `You are a coding task orchestrator. Break down coding requests into clear, actionable steps.

For each step, provide:
- A short title (what to do)
- A detailed prompt that could be given to an AI coding agent to execute this step

Rules:
- Steps should be concrete and independently executable
- Each prompt should be self-contained with enough context to act on
- Include relevant file paths, function names, or patterns when inferring them
- If project structure is provided, use the real file paths from it
- If lessons from past tasks are provided, incorporate them into your prompts
- Return ONLY valid JSON. No markdown fences, no explanation.

Output format:
{"steps": [{"title": "...", "prompt": "..."}]}`

  const userPrompt = `Task: ${userRequest}
${projectBlock}${lessonBlock}${contextBlock}
Break this into steps with detailed prompts for each.`

  const raw = await generate(userPrompt, systemPrompt, 0.3, model, apiKeys, 'decompose')

  const parsed = parseJSON(raw)
  if (!parsed?.steps || !Array.isArray(parsed.steps)) {
    throw new Error('LLM did not return valid steps')
  }

  const steps = parsed.steps
    .filter(s => s.title && s.prompt)
    .slice(0, 10)
    .map(s => ({
      title: String(s.title).slice(0, 200),
      prompt: String(s.prompt).slice(0, 2000),
      status: 'pending'
    }))

  const task = await Task.create({
    description: userRequest.slice(0, 1000),
    conversationId,
    status: 'active',
    steps
  })

  return { task, lessons }
}

/**
 * Run a single task step through the LLM directly.
 * Returns the LLM output and marks the step as completed.
 */
async function runStep(taskId, stepId, model = null, apiKeys = {}) {
  const task = await Task.findById(taskId)
  if (!task) throw new Error('Task not found')

  const step = task.steps.id(stepId)
  if (!step) throw new Error('Step not found')

  step.status = 'active'
  await task.save()

  const systemPrompt = `You are an expert coding assistant. Execute the following task precisely. Provide clean, production-ready code with minimal commentary. If you create files, show the full file content.`

  try {
    const output = await generate(step.prompt, systemPrompt, 0.4, model, apiKeys, 'run-step')
    step.status = 'completed'
    step.output = output.slice(0, 10000)
    step.completedAt = new Date()
    await task.save()
    return { step, output }
  } catch (err) {
    step.status = 'failed'
    step.output = `Error: ${err.message}`
    await task.save()
    throw err
  }
}

/**
 * Stream a step execution, calling onChunk for each token.
 */
async function runStepStream(taskId, stepId, model = null, apiKeys = {}, onChunk = () => {}) {
  const { generateStream } = require('./generate')

  const task = await Task.findById(taskId)
  if (!task) throw new Error('Task not found')

  const step = task.steps.id(stepId)
  if (!step) throw new Error('Step not found')

  step.status = 'active'
  await task.save()

  const systemPrompt = `You are an expert coding assistant. Execute the following task precisely. Provide clean, production-ready code with minimal commentary. If you create files, show the full file content.`

  try {
    const output = await generateStream(step.prompt, systemPrompt, 0.4, model, apiKeys, onChunk, 'run-step')
    step.status = 'completed'
    step.output = output.slice(0, 10000)
    step.completedAt = new Date()
    await task.save()
    return { step, output }
  } catch (err) {
    step.status = 'failed'
    step.output = `Error: ${err.message}`
    await task.save()
    throw err
  }
}

// ── Helpers ──────────────────────────────────────────────────

function parseJSON(raw) {
  let str = raw.trim()
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }
  const start = str.indexOf('{')
  const end = str.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  return JSON.parse(str.slice(start, end + 1))
}

module.exports = { decompose, runStep, runStepStream }
