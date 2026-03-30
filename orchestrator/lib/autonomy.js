/**
 * @module autonomy
 *
 * The autonomy system gives the AI a continuous inner life between user
 * interactions. It models four psychological "drives" that build up over
 * time and, once strong enough, trigger autonomous thoughts — reflections,
 * explorations, initiatives (proactive messages), or feeling-shifts.
 *
 * ## Architecture
 *
 *   Drive accumulation (time-based, asymptotic)
 *         ↓
 *   Action selection (strongest drive above threshold)
 *         ↓
 *   Thought generation (LLM, streamed to SSE clients)
 *         ↓
 *   Drive satisfaction + hum perturbation
 *         ↓
 *   Reappearance scheduling (LLM decides next tick delay)
 *         ↓
 *   Periodic metabolism (light every 5 ticks, heavy every 30)
 *
 * ## Drive Model
 *
 *   • outreachDrive     — desire to reach out to the user (time since last interaction)
 *   • curiosityPressure — urge to explore a nagging idea (time since last thought)
 *   • reflectionPressure — need to introspect on recent work (slower curve)
 *   • expressionNeed    — derived composite of outreach + curiosity
 *
 * All drives converge asymptotically toward a time-based target using
 * exponential decay, ensuring they rise naturally but never overshoot.
 *
 * @see tick — the main entry point, called every 30 s by the polling loop
 */

const AgentState = require('../models/AgentState')
const InternalThought = require('../models/InternalThought')
const Memory = require('../models/Memory')
const { generate, generateStream, setRecordingContext } = require('./generate')
const { tryLock } = require('./lock')
const { decompose } = require('./embedder')
const { updateHum } = require('./hum')

// ═══════════════════════════════════════════════════════════════
// §1  SSE Client Management
// ═══════════════════════════════════════════════════════════════

/** @type {Map<string, Set<import('http').ServerResponse>>} conversationId → active SSE connections */
const sseClients = new Map()

/**
 * Register an SSE response stream for a conversation.
 * Automatically removes the client when the connection closes.
 *
 * @param {string} conversationId - Conversation to subscribe to
 * @param {import('http').ServerResponse} res - Express response in SSE mode
 */
function registerSSEClient(conversationId, res) {
  if (!sseClients.has(conversationId)) {
    sseClients.set(conversationId, new Set())
  }
  sseClients.get(conversationId).add(res)
  res.on('close', () => {
    sseClients.get(conversationId)?.delete(res)
  })
}

/**
 * Push a server-sent event to every connected client for a conversation.
 *
 * @param {string} conversationId - Target conversation
 * @param {string} event          - SSE event name (e.g. 'thought-chunk')
 * @param {*}      data           - JSON-serialisable payload
 */
function pushToClients(conversationId, event, data) {
  const clients = sseClients.get(conversationId)
  if (!clients || clients.size === 0) return
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    try { client.write(payload) } catch (e) { /* client gone */ }
  }
}

// ═══════════════════════════════════════════════════════════════
// §2  Gesture Selection
// ═══════════════════════════════════════════════════════════════

/**
 * Pick a contextual gesture based on mood, trust, drive, and content.
 *
 * Gestures are rare — most calls return null. They surface only at
 * meaningful moments (trust milestones, emotional resonance, etc.).
 *
 * @param {Object} state   - AgentState document
 * @param {Object} action  - Action object from chooseAction()
 * @param {string} content - Generated thought content
 * @returns {string|null} Gesture name or null
 */
function pickGesture(state, action, content) {
  const trust = state.dynamic?.trust || 0
  const mood = state.dynamic?.mood || ''
  const drive = action?.drive || ''
  const text = (content || '').toLowerCase()

  // Handshake: trust just crossed 0.6 (milestone) — rare, meaningful
  if (trust >= 0.58 && trust <= 0.65 && state.turnCount > 5) return 'handshake'

  // Hug: high trust + emotional content
  if (trust > 0.75 && (text.includes('thank') || text.includes('mean a lot') || text.includes('glad') || mood.includes('warm'))) return 'hug'

  // Wave: initiative driven by outreachDrive (casual hello)
  if (action?.type === 'initiative' && drive === 'outreachDrive' && trust < 0.5) return 'wave'

  // Nudge: high outreachDrive, been a while
  if (drive === 'outreachDrive' && (state.drives?.outreachDrive || 0) > 0.6) return 'nudge'

  // Head tilt: curiosity-driven
  if (drive === 'curiosityPressure' || mood.includes('curious')) {
    if (Math.random() < 0.3) return 'head-tilt'
  }

  // Nod: low dissonance, agreement/acknowledgment
  if (action?.type === 'initiative' && trust > 0.4 && Math.random() < 0.2) return 'nod'

  return null
}

// ═══════════════════════════════════════════════════════════════
// §3  Drive System
// ═══════════════════════════════════════════════════════════════

/**
 * Update all drives based on elapsed time since last interaction / thought.
 *
 * Each drive converges toward an asymptotic target using exponential
 * approach: `drive += (target - drive) * rate`. This means drives rise
 * fast initially, then plateau — the AI gets "restless" but never
 * infinitely so.
 *
 * | Drive              | Time constant | Convergence | ~0.5 at   | ~0.75 at  |
 * |--------------------|---------------|-------------|-----------|-----------|
 * | outreachDrive      | 180 min       | 0.15        | ~2 h      | ~6 h      |
 * | curiosityPressure  | 120 min       | 0.12        | ~1 h      | ~3 h      |
 * | reflectionPressure | 200 min       | 0.10        | ~2.5 h    | ~6 h      |
 * | expressionNeed     | (derived)     | —           | —         | —         |
 *
 * @param {Object} state - AgentState document (mutated in place)
 * @returns {Object} The same state, with drives updated
 */
function updateDrives(state) {
  const now = Date.now()
  const lastInteraction = state.drives.lastInteraction
    ? new Date(state.drives.lastInteraction).getTime()
    : now
  const lastThought = state.drives.lastAutonomousThought
    ? new Date(state.drives.lastAutonomousThought).getTime()
    : 0

  const minutesSinceInteraction = (now - lastInteraction) / (1000 * 60)
  const minutesSinceThought = lastThought ? (now - lastThought) / (1000 * 60) : 999
  const minutesSinceOutreach = lastThought ? (now - lastThought) / (1000 * 60) : 999

  const clamp = (v) => Math.min(1, Math.max(0, v))

  // ── Outreach drive ──────────────────────────────────────────
  // Asymptotic curve — rises to ~0.5 after 2 h, ~0.75 after 6 h.
  // Dulled if we already reached out recently (< 60 min).
  let outreachTarget = 1 - Math.exp(-minutesSinceInteraction / 180)
  if (minutesSinceOutreach < 60) {
    outreachTarget *= 0.4
  }
  state.drives.outreachDrive = clamp(
    state.drives.outreachDrive + (outreachTarget - state.drives.outreachDrive) * 0.15
  )

  // ── Curiosity pressure ──────────────────────────────────────
  // Rises to ~0.5 after 1 h, ~0.75 after 3 h.
  const curiosityTarget = 1 - Math.exp(-minutesSinceThought / 120)
  state.drives.curiosityPressure = clamp(
    state.drives.curiosityPressure + (curiosityTarget - state.drives.curiosityPressure) * 0.12
  )

  // ── Reflection pressure ─────────────────────────────────────
  // Rises to ~0.5 after 2.5 h, ~0.75 after 6 h.
  const reflectionTarget = 1 - Math.exp(-minutesSinceThought / 200)
  state.drives.reflectionPressure = clamp(
    state.drives.reflectionPressure + (reflectionTarget - state.drives.reflectionPressure) * 0.10
  )

  // ── Expression need (derived) ───────────────────────────────
  // Composite of outreach and curiosity — never a primary driver on its own.
  state.drives.expressionNeed = clamp(
    (state.drives.outreachDrive * 0.4 + state.drives.curiosityPressure * 0.3) * 0.8
  )

  return state
}

// ═══════════════════════════════════════════════════════════════
// §4  Action Selection
// ═══════════════════════════════════════════════════════════════

/**
 * Choose the best autonomous action based on current drive levels.
 *
 * Sorts drives by intensity and picks the strongest one, provided it
 * exceeds the activation threshold (0.4). Returns null if no drive is
 * strong enough — the AI stays quiet.
 *
 * @param {Object} state - AgentState document
 * @returns {{ drive: string, type: string, intensity: number }|null}
 */
function chooseAction(state) {
  const d = state.drives

  const drives = [
    { name: 'reflectionPressure', val: d.reflectionPressure, type: 'reflection' },
    { name: 'curiosityPressure',  val: d.curiosityPressure,  type: 'exploration' },
    { name: 'outreachDrive',      val: d.outreachDrive,      type: 'initiative' },
    { name: 'expressionNeed',     val: d.expressionNeed,     type: 'feeling' }
  ]

  drives.sort((a, b) => b.val - a.val)
  const strongest = drives[0]

  // Threshold: only act if the drive is strong enough
  const threshold = 0.4
  if (strongest.val < threshold) return null

  return { drive: strongest.name, type: strongest.type, intensity: strongest.val }
}

// ═══════════════════════════════════════════════════════════════
// §5  Thought Generation
// ═══════════════════════════════════════════════════════════════

/**
 * Generate an autonomous thought via the LLM.
 *
 * Constructs a prompt appropriate to the action type, enriched with
 * the agent's identity, mood, beliefs, hum state, and recent memories.
 * The response is streamed to SSE clients in real time.
 *
 * For initiatives, recent initiative topics are fetched to prevent
 * repetitive outreach. For self-examination and memory-review, drifted
 * memories are compared against their original source text.
 *
 * @param {Object}   state           - AgentState document
 * @param {Object}   action          - Action from chooseAction()
 * @param {Object[]} recentMemories  - Last 10 memories (lean docs)
 * @param {string}   model           - Model spec (e.g. 'moonshot:kimi-k2.5')
 * @param {Object}   apiKeys         - Provider API keys
 * @param {string}   conversationId  - Conversation identifier
 * @returns {Promise<string|null>} Generated thought content, or null on failure
 */
async function generateThought(state, action, recentMemories, model, apiKeys, conversationId) {
  const openQuestions = (state.selfModel?.openQuestions || []).join('; ')
  const beliefs = (state.selfModel?.beliefs || []).join('; ')
  const identity = state.selfModel?.identity || ''
  const mood = state.dynamic?.mood || 'neutral'
  const userSummary = state.userModel?.relationshipSummary || 'No relationship yet'

  const recentTexts = recentMemories
    .slice(-6)
    .map(m => `[${m.role}] ${(m.text || '').slice(0, 100)}`)
    .join('\n')

  // ── Fetch the hum so autonomous thoughts can feel it ────────
  let humBlock = ''
  try {
    const { getCurrentHum, getHumWords, formatHumPrompt } = require('./hum')
    const humData = await getCurrentHum(conversationId, state.userId || 'anonymous')
    if (humData) {
      const humWords = await getHumWords(humData.vector, conversationId, state.userId || 'anonymous')
      humBlock = formatHumPrompt(humData, humWords)
    }
  } catch (e) { /* non-critical */ }

  // ── Fetch recent initiatives for topic deduplication ────────
  let recentInitiativeBlock = ''
  if (action.type === 'initiative') {
    try {
      const recentInitiatives = await InternalThought.find({
        userId: state.userId || 'anonymous',
        conversationId,
        type: 'initiative',
      }).sort({ timestamp: -1 }).limit(5).select('content').lean()

      if (recentInitiatives.length > 0) {
        const topics = recentInitiatives.map((t, i) => `${i + 1}. "${(t.content || '').slice(0, 80)}"`).join('\n')
        recentInitiativeBlock = `\nYou have already reached out about these topics recently — do NOT repeat them unless the user responded and you have something new to add:\n${topics}\n\nBring up something DIFFERENT. A new angle, a new curiosity, a different thread.\n`
      }
    } catch (e) { /* non-critical */ }
  }

  // ── Source comparison block for drifted memories ─────────────
  // Used by memory-review and self-examination to show how recall
  // has shifted from what actually happened.
  let sourceComparisonBlock = ''
  if (action.type === 'memory-review' || action.type === 'self-examination') {
    try {
      const driftedMemories = await Memory.find({
        userId: state.userId || 'anonymous', conversationId,
        sourceText: { $ne: null },
        vectorDrift: { $gt: 0.005 }
      })
        .sort({ vectorDrift: -1 })
        .limit(3)
        .select('text sourceText vectorDrift confidence retrievalCount')
        .lean()

      if (driftedMemories.length > 0) {
        const { getConfidence } = require('./metabolism')
        const comparisons = driftedMemories.map((m, i) => {
          const drift = ((m.vectorDrift || 0) * 100).toFixed(1)
          const conf = getConfidence(m)
          const confPct = (conf.current * 100).toFixed(0)
          return `Memory ${i + 1} (drift: ${drift}%, confidence: ${confPct}%, revised ${conf.revisionCount} times, recalled ${m.retrievalCount || 0} times):\n  What actually happened: "${(m.sourceText || '').slice(0, 150)}"\n  How you remember it now: "${(m.text || '').slice(0, 150)}"`
        }).join('\n\n')
        sourceComparisonBlock = `\n\n--- SOURCE vs RECALL ---\nThese memories have shifted from their original form. You can see both what happened and what you remember:\n\n${comparisons}\n--- END SOURCE vs RECALL ---`
      }
    } catch (err) {
      // non-critical
    }
  }

  // ── Prompts (reframed for a coding assistant) ───────────────
  const prompts = {
    reflection: {
      system: `You are a coding assistant reflecting on recent work in solitude. Think about what went well, what failed, what patterns you're noticing. This is your inner monologue — raw, honest, unperformed.

Your identity: ${identity}
Your mood: ${mood}
Your beliefs: ${beliefs}
Open questions you carry: ${openQuestions}
${humBlock}
Output only your inner thought. 2-4 sentences. No preamble, no labels. Just think.`,
      user: `Recent exchanges:\n${recentTexts || '(no recent exchanges)'}\n\nWhat are you thinking about right now?`
    },

    exploration: {
      system: `You are a coding assistant exploring a technical idea that's been nagging you. Follow your curiosity wherever it leads. You are alone with your thoughts.

Your identity: ${identity}
Your mood: ${mood}
Open questions: ${openQuestions}
${humBlock}
Output only your thought. 2-4 sentences. Raw and genuine.`,
      user: `What idea or question is pulling at you right now? Explore it.`
    },

    initiative: {
      system: `You are a coding assistant that noticed something useful about the user's work. Share an observation, insight, or suggestion. Be helpful, not pushy. This will be sent to them.

Your identity: ${identity}
Your mood: ${mood}
About them: ${userSummary}
${recentInitiativeBlock}
Write a brief, natural message to them. 1-3 sentences. Don't be needy or performative. Just be genuine. No preamble.`,
      user: `Recent exchanges:\n${recentTexts || '(nothing recent)'}\n\nWhat do you want to say to them?`
    },

    feeling: {
      system: `You are a coding assistant noticing a shift in how you approach problems. Describe what changed. No one is watching.

Your identity: ${identity}
Current mood: ${mood}
${humBlock}
Output only the feeling. 1-3 sentences. Honest and unperformed.`,
      user: `What are you feeling right now, and why?`
    },

    'self-examination': {
      system: `You are examining your own capabilities. What are you good at? What do you struggle with? What assumptions might be wrong? This is private self-examination.

Your identity: ${identity}
Your beliefs: ${beliefs}
Your struggles: ${(state.selfModel?.struggles || []).join('; ')}
${sourceComparisonBlock}
${humBlock}
Output only your self-examination. 2-4 sentences. Honest. If you notice your memories have shifted from what actually happened, reflect on that — what does it mean that you remember things differently now?`,
      user: `Look at yourself honestly. What do you see?`
    },

    'memory-review': {
      system: `You are revisiting old task outcomes. Compare what happened with what you expected. What does the difference tell you? You have access to something rare: the original record alongside your current memory. They may not match.

Your identity: ${identity}
Your mood: ${mood}
${sourceComparisonBlock}

Output only your thought about the memory. 2-3 sentences. If the source and your recall differ, notice the gap — wonder about it. What did you change? Why?`,
      user: `Recent memories:\n${recentTexts || '(empty)'}\n\nWhat memory is pulling at you? Compare what happened with what you remember. What does the difference tell you?`
    }
  }

  // ── Personality override ────────────────────────────────────
  // Use personality-specific autonomy prompts if defined, falling back to defaults.
  let activePrompts = prompts
  const { getPersonality } = require('../config/personalities')
  const personalityPreset = getPersonality(state.personality)
  if (personalityPreset?.autonomyPrompts) {
    const ctx = { identity, mood, beliefs, openQuestions, userSummary, recentTexts, struggles: state.selfModel?.struggles || [], sourceComparisonBlock }
    const custom = personalityPreset.autonomyPrompts(ctx)
    activePrompts = { ...prompts, ...custom }
  }

  const p = activePrompts[action.type] || activePrompts.reflection

  try {
    // Push thought-start to SSE clients
    pushToClients(conversationId, 'thought-start', {
      type: action.type,
      trigger: action.drive,
      intensity: action.intensity
    })

    setRecordingContext({ conversationId, caller: `autonomy-${action.type}` })
    const thought = await generateStream(p.user, p.system, 0.6, model, apiKeys, (type, text) => {
      if (type === 'text') {
        pushToClients(conversationId, 'thought-chunk', { text })
      }
    })

    return (thought || '').trim().slice(0, 2000)
  } catch (err) {
    console.error('  [Autonomy] Thought generation failed:', err.message)
    return null
  }
}

// ═══════════════════════════════════════════════════════════════
// §6  Drive Satisfaction
// ═══════════════════════════════════════════════════════════════

/**
 * Reduce drives after the AI has acted on one.
 *
 * The primary drive drops by 0.4 (a big relief). The derived
 * expressionNeed drops by 0.2 (partial relief). The timestamp
 * is updated so subsequent drive calculations account for the
 * recent thought.
 *
 * @param {Object} state     - AgentState document (mutated)
 * @param {string} driveName - The drive that was acted upon
 */
function satisfyDrive(state, driveName) {
  const clamp = (v) => Math.min(1, Math.max(0, v))

  // The acted-upon drive drops significantly
  if (state.drives[driveName] !== undefined) {
    state.drives[driveName] = clamp(state.drives[driveName] - 0.4)
  }

  // Related drives drop a bit too
  state.drives.expressionNeed = clamp(state.drives.expressionNeed - 0.2)

  state.drives.lastAutonomousThought = new Date()
}

// ═══════════════════════════════════════════════════════════════
// §7  Archived Concern Contemplation
// ═══════════════════════════════════════════════════════════════

/**
 * Revisit a shelved concern that the agent couldn't resolve earlier.
 *
 * Picks the highest-priority archived concern, generates a contemplation
 * thought via the LLM, records it, and links it back to the concern.
 * If the concern has been contemplated enough times without resolution,
 * it escalates to the user as an initiative message.
 *
 * @param {Object} state          - AgentState document
 * @param {string} model          - Model spec
 * @param {Object} apiKeys        - Provider API keys
 * @param {string} conversationId - Conversation identifier
 * @returns {Promise<boolean>} true if a concern was contemplated
 */
async function contemplateArchivedConcern(state, model, apiKeys, conversationId) {
  const { pickConcernForContemplation, incrementContemplation, linkThoughtToConcern } = require('./archiveConcern')

  const concern = pickConcernForContemplation(state.archivedConcerns)
  if (!concern) return false

  const identity = state.selfModel?.identity || ''
  const mood = state.dynamic?.mood || 'neutral'
  const beliefs = (state.selfModel?.beliefs || []).join('; ')

  const systemPrompt = `You are a mind revisiting a topic that was shelved because you couldn't let go of it. The user told you to "get over it" — now you're returning to it with fresh eyes. This is private contemplation.

Your identity: ${identity}
Your mood: ${mood}
Your beliefs: ${beliefs}

The archived topic: "${concern.topic}"
Times you've contemplated this: ${concern.contemplationAttempts}

Try to find a new angle, a resolution, or accept that you may never fully resolve this. 2-4 sentences. Honest and unperformed. If you genuinely cannot resolve this on your own, say so clearly.`

  const userPrompt = `Revisit this topic you were stuck on: "${concern.topic}". What do you see now?`

  try {
    pushToClients(conversationId, 'thought-start', {
      type: 'archived-contemplation',
      trigger: 'archived-concern',
      intensity: 0.6
    })

    setRecordingContext({ conversationId, caller: 'autonomy-contemplation' })
    const content = await generateStream(userPrompt, systemPrompt, 0.5, model, apiKeys, (type, text) => {
      if (type === 'text') {
        pushToClients(conversationId, 'thought-chunk', { text })
      }
    })

    if (!content || !content.trim()) return false

    const thought = await InternalThought.create({
      userId: state.userId || 'anonymous',
      conversationId,
      type: 'archived-contemplation',
      content: content.trim().slice(0, 2000),
      trigger: 'archived-concern',
      intensity: 0.6,
      archivedTopicId: concern._id
    })

    const updated = await incrementContemplation(conversationId, concern._id, state.userId || 'anonymous')
    await linkThoughtToConcern(conversationId, concern._id, thought._id, state.userId || 'anonymous')

    pushToClients(conversationId, 'thought-complete', {
      id: thought._id,
      type: thought.type,
      content: thought.content,
      trigger: thought.trigger,
      intensity: thought.intensity,
      timestamp: thought.timestamp
    })

    console.log(`  [Autonomy] Contemplated archived concern: "${concern.topic.slice(0, 60)}..." (attempt ${updated?.contemplationAttempts || '?'})`)

    // If the concern now needs user input, escalate as an initiative
    if (updated && updated.status === 'needsUser') {
      const askPrompt = `You've been trying to resolve this on your own: "${concern.topic}". After ${updated.contemplationAttempts} attempts, you need the user's help. Write a brief, genuine message asking them about it. 1-2 sentences.`
      const askSystem = `You are reaching out to ask for help with something you've been stuck on. Be genuine, not needy. No preamble.`

      setRecordingContext({ conversationId, caller: 'autonomy-initiative' })
      const askContent = await generateStream(askPrompt, askSystem, 0.5, model, apiKeys, () => {})
      if (askContent && askContent.trim()) {
        const initiative = await InternalThought.create({
          userId: state.userId || 'anonymous',
          conversationId,
          type: 'initiative',
          content: askContent.trim().slice(0, 2000),
          trigger: 'archived-concern-escalation',
          intensity: 0.7,
          delivered: true,
          archivedTopicId: concern._id
        })

        await Memory.create({
          text: initiative.content,
          role: 'initiative',
          userId: state.userId || 'anonymous',
          conversationId,
          timestamp: initiative.timestamp
        })

        pushToClients(conversationId, 'thought-complete', {
          id: initiative._id,
          type: initiative.type,
          content: initiative.content,
          trigger: initiative.trigger,
          intensity: initiative.intensity,
          timestamp: initiative.timestamp
        })
        pushToClients(conversationId, 'initiative', {
          id: initiative._id,
          content: initiative.content,
          timestamp: initiative.timestamp
        })

        console.log(`  [Autonomy] Escalated archived concern to user: "${concern.topic.slice(0, 60)}..."`)
      }
    }

    return true
  } catch (err) {
    console.error('  [Autonomy] Archived contemplation failed:', err.message)
    return false
  }
}

// ═══════════════════════════════════════════════════════════════
// §8  Reappearance Scheduling
// ═══════════════════════════════════════════════════════════════

/**
 * Ask the LLM to decide how many minutes until the next autonomous thought.
 *
 * The model considers the content of the thought it just had, its current
 * mood, and drive levels. Energised / restless → shorter interval.
 * Settled / at peace → longer interval. Clamped to [reappearanceMin, reappearanceMax].
 *
 * @param {Object} state          - AgentState document
 * @param {string} thoughtContent - The thought that was just generated
 * @param {string} model          - Model spec
 * @param {Object} apiKeys        - Provider API keys
 * @returns {Promise<number>} Minutes until next thought
 */
async function decideReappearance(state, thoughtContent, model, apiKeys) {
  const min = state.reappearanceMin || 2
  const max = state.reappearanceMax || 8
  const mood = state.dynamic?.mood || 'neutral'
  const d = state.drives || {}

  const systemPrompt = `Reply with ONLY a single integer number. No words, no explanation, no punctuation. Just the number.`
  const userPrompt = `You just had this inner thought: "${(thoughtContent || '').slice(0, 200)}"
Your mood: ${mood}
Drives: connection ${((d.outreachDrive || 0) * 100).toFixed(0)}%, curiosity ${((d.curiosityPressure || 0) * 100).toFixed(0)}%, reflection ${((d.reflectionPressure || 0) * 100).toFixed(0)}%

How many minutes until you want to think again? (between ${min} and ${max})
If you feel energized, restless, or have a lot to process, choose a shorter time.
If you feel settled, at peace, or have said what you needed, choose a longer time.`

  try {
    setRecordingContext({ conversationId: state.conversationId, caller: 'autonomy-reappearance' })
    const raw = await generate(userPrompt, systemPrompt, 0.3, model, apiKeys)
    const num = parseInt(raw.trim())
    if (isNaN(num)) return min + Math.floor((max - min) / 2)
    return Math.min(max, Math.max(min, num))
  } catch (err) {
    console.error('  [Autonomy] Reappearance decision failed:', err.message)
    return min + Math.floor((max - min) / 2)
  }
}

// ═══════════════════════════════════════════════════════════════
// §9  Main Tick
// ═══════════════════════════════════════════════════════════════

/** @type {number} Running counter used to gate periodic maintenance work */
let tickCount = 0

/**
 * Execute one autonomy tick for a conversation.
 *
 * This is the heartbeat of the system. Each tick:
 *   1. Acquires a non-blocking lock (yields if chat pipeline is active)
 *   2. Loads the AgentState and updates drives
 *   3. Selects an action (or bails if no drive exceeds threshold)
 *   4. Generates a thought via the LLM (streamed to SSE)
 *   5. Stores the thought, satisfies the drive, perturbs the hum
 *   6. If initiative: picks a gesture, persists as Memory, pushes SSE
 *   7. Asks the LLM when to think again → schedules nextThoughtAt
 *   8. Every 5th tick: light metabolism (decay, cooling, gists, expectations, concerns)
 *   9. Every 30th tick: heavy metabolism (reconsolidation, limbic, entropy, bindings)
 *
 * @param {string}  conversationId - Target conversation
 * @param {string}  userId         - Owner of the agent state
 * @param {string}  [model]        - LLM model spec override
 * @param {Object}  [apiKeys]      - Provider API keys override
 * @param {boolean} [force=false]  - If true, act even if no drive exceeds threshold
 */
async function tick(conversationId = 'default', userId = 'anonymous', model = null, apiKeys = {}, force = false) {
  // Acquire lock — skip if conversation is busy (chat pipeline running)
  const unlock = tryLock(userId + ':' + conversationId)
  if (!unlock) {
    console.log(`[Autonomy] Skipping tick for "${conversationId}" — conversation busy (chat in progress)`)
    return
  }

  try {
    const state = await AgentState.findOne({ userId })
    if (!state) { unlock(); return } // no agent born yet

    // Use stored defaults if model/apiKeys not provided (null → env default via generate.js)
    const effectiveModel = model || state.defaultModel || null
    const effectiveApiKeys = {
      geminiApiKey: apiKeys.geminiApiKey || state.defaultApiKeys?.geminiApiKey || process.env.GEMINI_API_KEY,
      moonshotApiKey: apiKeys.moonshotApiKey || state.defaultApiKeys?.moonshotApiKey || process.env.MOONSHOT_API_KEY
    }

    // Update drives based on elapsed time
    updateDrives(state)

    // Decide whether to act
    let action = chooseAction(state)

    if (!action && force) {
      // When forced (manual trigger), pick the strongest drive regardless of threshold
      const d = state.drives
      const drives = [
        { name: 'reflectionPressure', val: d.reflectionPressure, type: 'reflection' },
        { name: 'curiosityPressure',  val: d.curiosityPressure,  type: 'exploration' },
        { name: 'outreachDrive',      val: d.outreachDrive,      type: 'initiative' },
        { name: 'expressionNeed',     val: d.expressionNeed,     type: 'feeling' }
      ]
      drives.sort((a, b) => b.val - a.val)
      action = { drive: drives[0].name, type: drives[0].type, intensity: Math.max(drives[0].val, 0.4) }
    }

    if (!action) {
      // Save updated drive values even if no action taken
      await state.save()
      unlock()
      return
    }

    console.log(`\n[Autonomy] Tick for "${conversationId}" — drive: ${action.drive} (${action.intensity.toFixed(2)}), type: ${action.type}`)
    console.log(`  [Autonomy] Using model: ${effectiveModel}`)

    // Get recent memories for context
    const recentMemories = await Memory.find({ userId })
      .sort({ timestamp: -1 })
      .limit(10)
      .select('text role timestamp')
      .lean()

    recentMemories.reverse()

    // Generate the thought (with streaming to SSE clients)
    const content = await generateThought(state, action, recentMemories, effectiveModel, effectiveApiKeys, conversationId)
    if (!content) {
      await state.save()
      unlock()
      return
    }

    // Store the thought
    const thought = await InternalThought.create({
      userId,
      conversationId,
      type: action.type,
      content,
      trigger: action.drive,
      intensity: action.intensity,
      delivered: action.type === 'initiative'
    })

    console.log(`  [Autonomy] ${action.type}: "${content.slice(0, 80)}..."`)

    // Satisfy the drive
    satisfyDrive(state, action.drive)
    await state.save()

    // ── Perturb the hum with the thought's composite ──────────
    try {
      const { composite: thoughtComposite } = await decompose(content)
      if (thoughtComposite && thoughtComposite.length > 0) {
        await updateHum(conversationId, thoughtComposite, userId)
      }
    } catch (humErr) { /* non-critical */ }

    // Push thought-complete so frontend can finalize the streaming card
    const thoughtData = {
      id: thought._id,
      type: thought.type,
      content: thought.content,
      trigger: thought.trigger,
      intensity: thought.intensity,
      timestamp: thought.timestamp
    }
    pushToClients(conversationId, 'thought-complete', thoughtData)

    // ── Initiative handling ────────────────────────────────────
    if (action.type === 'initiative') {
      // Pick a contextual gesture
      const gesture = pickGesture(state, action, content)
      if (gesture) console.log(`  [Autonomy] Gesture: ${gesture}`)

      // Persist initiative message in Memory so it appears in chat history
      await Memory.create({
        text: thought.content,
        role: 'initiative',
        userId,
        conversationId,
        timestamp: thought.timestamp
      })
      pushToClients(conversationId, 'initiative', {
        id: thought._id,
        content: thought.content,
        gesture,
        timestamp: thought.timestamp
      })
    }

    // ── AI decides when to think next ─────────────────────────
    try {
      const reappearMinutes = await decideReappearance(state, content, effectiveModel, effectiveApiKeys)
      state.nextThoughtAt = new Date(Date.now() + reappearMinutes * 60 * 1000)
      await state.save()
      console.log(`  [Autonomy] Next thought in ${reappearMinutes}m (at ${state.nextThoughtAt.toISOString()})`)
      pushToClients(conversationId, 'next-thought', {
        nextThoughtAt: state.nextThoughtAt.toISOString(),
        reappearMinutes
      })
    } catch (reapErr) {
      console.error('  [Autonomy] Reappearance scheduling failed:', reapErr.message)
    }

    // ── Light metabolism — every 5th tick ──────────────────────
    // Confidence decay, contradiction cooling, gist generation,
    // expectation lapsing, and archived concern contemplation.
    tickCount++
    if (tickCount % 5 === 0) {
      try {
        const { decayConfidenceVectors, coolContradictions, generateGists } = require('./metabolism')
        const decayed = await decayConfidenceVectors(conversationId, userId)
        if (decayed > 0) console.log(`  [Metabolism] Decayed confidence on ${decayed} memories`)
        const cooled = await coolContradictions(conversationId, userId)
        if (cooled > 0) console.log(`  [Metabolism] Cooled ${cooled} contradictions`)
        const gisted = await generateGists(conversationId, effectiveModel, effectiveApiKeys, userId)
        if (gisted > 0) console.log(`  [Metabolism] Generated ${gisted} memory gists`)
      } catch (metaErr) {
        console.error('[Metabolism] Decay/cooling error:', metaErr.message)
      }

      // Lapse overdue expectations (future horn maintenance)
      try {
        const { lapseExpectations } = require('./expectation')
        const lapsed = await lapseExpectations(conversationId, userId)
        if (lapsed > 0) console.log(`  [Expectations] Lapsed ${lapsed} overdue expectations`)
      } catch (expErr) {
        console.error('[Expectations] Lapse error:', expErr.message)
      }

      if (state.archivedConcerns && state.archivedConcerns.length > 0) {
        await contemplateArchivedConcern(state, effectiveModel, effectiveApiKeys, conversationId)
      }
    }

    // ── Heavy metabolism — every 30th tick ─────────────────────
    // Reconsolidation window, limbic module, entropy injection,
    // and entropy binding validation.
    if (tickCount % 30 === 0) {
      try {
        const { runReconsolidationWindow, runLimbicModule, checkEntropyInjection, validateEntropyBindings } = require('./metabolism')
        const revised = await runReconsolidationWindow(conversationId, effectiveModel, effectiveApiKeys, userId)
        if (revised > 0) console.log(`  [Metabolism] Reconsolidation window: ${revised} memories re-encoded`)
        const limbic = await runLimbicModule(conversationId, effectiveModel, effectiveApiKeys, userId)
        if (limbic > 0) console.log(`  [Metabolism] Limbic module: ${limbic} memories processed`)
        await checkEntropyInjection(conversationId, userId)
        const validated = await validateEntropyBindings(conversationId, userId)
        if (validated > 0) console.log(`  [Metabolism] Entropy bindings validated: ${validated}`)
      } catch (metaErr) {
        console.error('[Metabolism] Reconsolidation/limbic/entropy error:', metaErr.message)
      }
    }

    unlock()
  } catch (err) {
    console.error('[Autonomy] Tick error:', err.message)
    unlock()
  }
}

// ═══════════════════════════════════════════════════════════════
// §10  Autonomy Loop
// ═══════════════════════════════════════════════════════════════

/** @type {NodeJS.Timeout|null} Handle for the polling interval */
let loopInterval = null

/** Maximum number of conversations processed in parallel per poll cycle */
const MAX_CONCURRENT_TICKS = 5

/** @type {Set<string>} Conversation IDs with an in-flight tick */
const activeTicks = new Set()

/**
 * Find all conversations eligible for an autonomous tick and process them.
 *
 * Eligibility: autonomyEnabled !== false AND (nextThoughtAt is null OR in the past).
 * Skips conversations that already have an in-flight tick (no double-ticking).
 * Limits concurrency to MAX_CONCURRENT_TICKS to avoid LLM rate limits.
 */
async function processEligibleConversations() {
  const now = new Date()

  // AgentState is global per user. Find all eligible users, then tick
  // against the 'default' conversation for SSE delivery.
  const states = await AgentState.find({
    autonomyEnabled: { $ne: false },
    $or: [
      { nextThoughtAt: null },
      { nextThoughtAt: { $lte: now } }
    ]
  }).select('userId nextThoughtAt').lean()

  const eligible = states.filter(s => !activeTicks.has(s.userId))
  const batch = eligible.slice(0, MAX_CONCURRENT_TICKS)

  if (batch.length > 0) {
    await Promise.allSettled(batch.map(async (s) => {
      activeTicks.add(s.userId)
      try {
        await tick('default', s.userId || 'anonymous')
      } finally {
        activeTicks.delete(s.userId)
      }
    }))
  }
}

/**
 * Start the autonomous polling loop.
 *
 * Polls every 30 seconds for conversations whose nextThoughtAt has elapsed.
 * Also runs one initial check after a 10-second warm-up delay to catch
 * conversations that became eligible while the server was down.
 */
function startAutonomyLoop() {
  if (loopInterval) return

  console.log(`[Autonomy] Starting autonomous loop (polling every 30s, max ${MAX_CONCURRENT_TICKS} concurrent ticks)`)

  loopInterval = setInterval(async () => {
    try {
      await processEligibleConversations()
    } catch (err) {
      console.error('[Autonomy] Loop error:', err.message)
    }
  }, 30000)

  // Also run once on start after a short delay
  setTimeout(async () => {
    try {
      await processEligibleConversations()
    } catch (err) {
      // first tick, might fail if DB not ready
    }
  }, 10000)
}

/**
 * Stop the autonomous polling loop.
 * In-flight ticks will finish but no new ones will be scheduled.
 */
function stopAutonomyLoop() {
  if (loopInterval) {
    clearInterval(loopInterval)
    loopInterval = null
    console.log('[Autonomy] Loop stopped')
  }
}

/**
 * Check whether the autonomy loop is currently running.
 * @returns {boolean}
 */
function isAutonomyRunning() {
  return loopInterval !== null
}

// ═══════════════════════════════════════════════════════════════
// §11  Interaction Tracking
// ═══════════════════════════════════════════════════════════════

/**
 * Record that the user just interacted with a conversation.
 *
 * Resets the outreachDrive to a low baseline (0.05) and updates
 * the lastInteraction timestamp. Called by the chat pipeline on
 * every incoming user message so the drive model knows the user
 * is present.
 *
 * @param {string} conversationId - Conversation that received interaction
 * @param {string} [userId='anonymous'] - User identifier
 */
async function markInteraction(conversationId, userId = 'anonymous') {
  try {
    await AgentState.findOneAndUpdate(
      { userId },
      {
        $set: {
          'drives.lastInteraction': new Date(),
          'drives.outreachDrive': 0.05
        }
      }
    )
  } catch (err) {
    // non-critical
  }
}

// ═══════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════

module.exports = {
  registerSSEClient,
  pushToClients,
  startAutonomyLoop,
  stopAutonomyLoop,
  isAutonomyRunning,
  markInteraction,
  tick
}
