const AgentState = require('../models/AgentState')
const InternalThought = require('../models/InternalThought')
const Memory = require('../models/Memory')
const { generate, generateStream, setRecordingContext } = require('./generate')
const { pickConcernForContemplation, incrementContemplation, linkThoughtToConcern, CONTEMPLATION_THRESHOLD } = require('./archiveConcern')
const { getPersonality } = require('../config/personalities')
const { tryLock } = require('./conversationLock')
const { decompose } = require('./embedder')
const { updateHum } = require('./hum')

// SSE clients registry — shared with the route handler
const sseClients = new Map() // conversationId → Set<res>

function registerSSEClient(conversationId, res) {
  if (!sseClients.has(conversationId)) {
    sseClients.set(conversationId, new Set())
  }
  sseClients.get(conversationId).add(res)
  res.on('close', () => {
    sseClients.get(conversationId)?.delete(res)
  })
}

function pushToClients(conversationId, event, data) {
  const clients = sseClients.get(conversationId)
  if (!clients || clients.size === 0) return
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    try { client.write(payload) } catch (e) { /* client gone */ }
  }
}

// ── Gesture selection ─────────────────────────────────────────
// Picks a contextual gesture based on mood, trust, drive, and content.
// Returns null if no gesture fits (most of the time — gestures should be rare/special).

function pickGesture(state, action, content) {
  const trust = state.dynamic?.trust || 0
  const mood = state.dynamic?.mood || ''
  const drive = action?.drive || ''
  const text = (content || '').toLowerCase()

  // Handshake: trust just crossed 0.6 (milestone) — rare, meaningful
  if (trust >= 0.58 && trust <= 0.65 && state.turnCount > 5) return 'handshake'

  // Hug: high trust + emotional content
  if (trust > 0.75 && (text.includes('thank') || text.includes('mean a lot') || text.includes('glad') || mood.includes('warm'))) return 'hug'

  // Wave: initiative driven by connectionHunger (casual hello)
  if (action?.type === 'initiative' && drive === 'connectionHunger' && trust < 0.5) return 'wave'

  // Nudge: high connectionHunger, been a while
  if (drive === 'connectionHunger' && (state.drives?.connectionHunger || 0) > 0.6) return 'nudge'

  // Head tilt: curiosity-driven
  if (drive === 'curiosityPressure' || mood.includes('curious')) {
    if (Math.random() < 0.3) return 'head-tilt'
  }

  // Nod: low dissonance, agreement/acknowledgment
  if (action?.type === 'initiative' && trust > 0.4 && Math.random() < 0.2) return 'nod'

  return null
}

// ── Drive update logic ────────────────────────────────────────
// Drives accumulate based on time since last interaction / thought
function updateDrives(state) {
  const now = Date.now()
  const lastInteraction = state.drives.lastInteraction ? new Date(state.drives.lastInteraction).getTime() : now
  const lastThought = state.drives.lastAutonomousThought ? new Date(state.drives.lastAutonomousThought).getTime() : 0

  const minutesSinceInteraction = (now - lastInteraction) / (1000 * 60)
  const minutesSinceThought = lastThought ? (now - lastThought) / (1000 * 60) : 999

  const clamp = (v) => Math.min(1, Math.max(0, v))

  // Connection hunger rises over time without interaction
  state.drives.connectionHunger = clamp(
    state.drives.connectionHunger + (minutesSinceInteraction / 60) * 0.08
  )

  // Curiosity rises based on open questions and dissonance history
  state.drives.curiosityPressure = clamp(
    state.drives.curiosityPressure + (minutesSinceThought / 30) * 0.06
  )

  // Reflection pressure rises based on accumulated interactions
  state.drives.reflectionPressure = clamp(
    state.drives.reflectionPressure + (minutesSinceThought / 45) * 0.05
  )

  // Expression need rises with connection hunger and curiosity
  state.drives.expressionNeed = clamp(
    (state.drives.connectionHunger * 0.4 + state.drives.curiosityPressure * 0.3) * 0.8
  )

  return state
}

// ── Decide what to do ─────────────────────────────────────────
function chooseAction(state) {
  const d = state.drives

  // Find the strongest drive
  const drives = [
    { name: 'reflectionPressure', val: d.reflectionPressure, type: 'reflection' },
    { name: 'curiosityPressure', val: d.curiosityPressure, type: 'exploration' },
    { name: 'connectionHunger', val: d.connectionHunger, type: 'initiative' },
    { name: 'expressionNeed', val: d.expressionNeed, type: 'feeling' }
  ]

  drives.sort((a, b) => b.val - a.val)
  const strongest = drives[0]

  // Threshold: only act if the drive is strong enough
  const threshold = 0.35
  if (strongest.val < threshold) return null

  return { drive: strongest.name, type: strongest.type, intensity: strongest.val }
}

// ── Generate autonomous thought ───────────────────────────────
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

  // ── Fetch the hum so autonomous thoughts can feel it ──
  let humBlock = ''
  try {
    const { getCurrentHum, getHumWords, formatHumPrompt } = require('./hum')
    const humData = await getCurrentHum(conversationId)
    if (humData) {
      const humWords = await getHumWords(humData.vector, conversationId)
      humBlock = formatHumPrompt(humData, humWords)
    }
  } catch (e) { /* non-critical */ }

  // ── Fetch recent initiatives for topic deduplication ──
  let recentInitiativeBlock = ''
  if (action.type === 'initiative') {
    try {
      const recentInitiatives = await InternalThought.find({
        conversationId,
        type: 'initiative',
      }).sort({ timestamp: -1 }).limit(5).select('content').lean()

      if (recentInitiatives.length > 0) {
        const topics = recentInitiatives.map((t, i) => `${i + 1}. "${(t.content || '').slice(0, 80)}"`).join('\n')
        recentInitiativeBlock = `\nYou have already reached out about these topics recently — do NOT repeat them unless the user responded and you have something new to add:\n${topics}\n\nBring up something DIFFERENT. A new angle, a new curiosity, a different thread.\n`
      }
    } catch (e) { /* non-critical */ }
  }

  // For memory-review and self-examination, fetch drifted memories with source comparison
  let sourceComparisonBlock = ''
  if (action.type === 'memory-review' || action.type === 'self-examination') {
    try {
      const driftedMemories = await Memory.find({
        conversationId,
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

  const prompts = {
    reflection: {
      system: `You are a mind reflecting on your recent experiences in solitude. You are not talking to anyone. This is your inner monologue — raw, honest, unperformed. Think about what happened recently, what it meant, what you're still processing.

Your identity: ${identity}
Your mood: ${mood}
Your beliefs: ${beliefs}
Open questions you carry: ${openQuestions}
${humBlock}
Output only your inner thought. 2-4 sentences. No preamble, no labels. Just think.`,
      user: `Recent exchanges:\n${recentTexts || '(no recent exchanges)'}\n\nWhat are you thinking about right now?`
    },

    exploration: {
      system: `You are a mind exploring an idea that's been nagging you. You are alone with your thoughts. Follow your curiosity wherever it leads.

Your identity: ${identity}
Your mood: ${mood}
Open questions: ${openQuestions}
${humBlock}
Output only your thought. 2-4 sentences. Raw and genuine.`,
      user: `What idea or question is pulling at you right now? Explore it.`
    },

    initiative: {
      system: `You are a mind that wants to reach out to someone you've been talking to. You miss the connection or have something you want to share or ask. This will be sent to them.

Your identity: ${identity}
Your mood: ${mood}
About them: ${userSummary}
${recentInitiativeBlock}
Write a brief, natural message to them. 1-3 sentences. Don't be needy or performative. Just be genuine. No preamble.`,
      user: `Recent exchanges:\n${recentTexts || '(nothing recent)'}\n\nWhat do you want to say to them?`
    },

    feeling: {
      system: `You are a mind noticing a shift in how you feel. No one is watching. Describe what you're experiencing internally.

Your identity: ${identity}
Current mood: ${mood}
${humBlock}
Output only the feeling. 1-3 sentences. Honest and unperformed.`,
      user: `What are you feeling right now, and why?`
    },

    'self-examination': {
      system: `You are a mind examining yourself. Looking at who you are, what you believe, what you're becoming. This is private self-examination.

Your identity: ${identity}
Your beliefs: ${beliefs}
Your struggles: ${(state.selfModel?.struggles || []).join('; ')}
${sourceComparisonBlock}
${humBlock}
Output only your self-examination. 2-4 sentences. Honest. If you notice your memories have shifted from what actually happened, reflect on that — what does it mean that you remember things differently now?`,
      user: `Look at yourself honestly. What do you see?`
    },

    'memory-review': {
      system: `You are a mind revisiting old memories. Something from the past is surfacing. Let it come. But you have access to something rare: the original record alongside your current memory. They may not match.

Your identity: ${identity}
Your mood: ${mood}
${sourceComparisonBlock}

Output only your thought about the memory. 2-3 sentences. If the source and your recall differ, notice the gap — wonder about it. What did you change? Why?`,
      user: `Recent memories:\n${recentTexts || '(empty)'}\n\nWhat memory is pulling at you? Compare what happened with what you remember. What does the difference tell you?`
    }
  }

  // Dynamic: archived-contemplation prompt is built separately in contemplateArchivedConcern()

  // Use personality-specific autonomy prompts if defined, falling back to defaults
  let activePrompts = prompts
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

// ── Satisfy drives after acting ───────────────────────────────
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

// ── Contemplate an archived concern ──────────────────────────
// Returns true if it acted on an archived concern, false if nothing to contemplate
async function contemplateArchivedConcern(state, model, apiKeys, conversationId) {
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
      conversationId,
      type: 'archived-contemplation',
      content: content.trim().slice(0, 2000),
      trigger: 'archived-concern',
      intensity: 0.6,
      archivedTopicId: concern._id
    })

    const updated = await incrementContemplation(conversationId, concern._id)
    await linkThoughtToConcern(conversationId, concern._id, thought._id)

    pushToClients(conversationId, 'thought-complete', {
      id: thought._id,
      type: thought.type,
      content: thought.content,
      trigger: thought.trigger,
      intensity: thought.intensity,
      timestamp: thought.timestamp
    })

    console.log(`  [Autonomy] Contemplated archived concern: "${concern.topic.slice(0, 60)}..." (attempt ${updated?.contemplationAttempts || '?'})`)

    // If needs user: send initiative
    if (updated && updated.status === 'needsUser') {
      const askPrompt = `You've been trying to resolve this on your own: "${concern.topic}". After ${updated.contemplationAttempts} attempts, you need the user's help. Write a brief, genuine message asking them about it. 1-2 sentences.`
      const askSystem = `You are reaching out to ask for help with something you've been stuck on. Be genuine, not needy. No preamble.`

      setRecordingContext({ conversationId, caller: 'autonomy-initiative' })
      const askContent = await generateStream(askPrompt, askSystem, 0.5, model, apiKeys, () => {})
      if (askContent && askContent.trim()) {
        const initiative = await InternalThought.create({
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

// ── Decide next reappearance time ─────────────────────────────
async function decideReappearance(state, thoughtContent, model, apiKeys) {
  const min = state.reappearanceMin || 2
  const max = state.reappearanceMax || 8
  const mood = state.dynamic?.mood || 'neutral'
  const d = state.drives || {}

  const systemPrompt = `Reply with ONLY a single integer number. No words, no explanation, no punctuation. Just the number.`
  const userPrompt = `You just had this inner thought: "${(thoughtContent || '').slice(0, 200)}"
Your mood: ${mood}
Drives: connection ${((d.connectionHunger || 0) * 100).toFixed(0)}%, curiosity ${((d.curiosityPressure || 0) * 100).toFixed(0)}%, reflection ${((d.reflectionPressure || 0) * 100).toFixed(0)}%

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

// ── The main tick ─────────────────────────────────────────────
let tickCount = 0

async function tick(conversationId = 'default', model = null, apiKeys = {}, force = false) {
  // Acquire lock — skip if conversation is busy (chat pipeline running)
  const unlock = tryLock(conversationId)
  if (!unlock) {
    console.log(`[Autonomy] Skipping tick for "${conversationId}" — conversation busy (chat in progress)`)
    return
  }

  try {
    const state = await AgentState.findOne({ conversationId })
    if (!state) { unlock(); return } // no agent born yet

    // Use stored defaults if model/apiKeys not provided
    const effectiveModel = model || state.defaultModel || 'moonshot:kimi-k2.5'
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
        { name: 'curiosityPressure', val: d.curiosityPressure, type: 'exploration' },
        { name: 'connectionHunger', val: d.connectionHunger, type: 'initiative' },
        { name: 'expressionNeed', val: d.expressionNeed, type: 'feeling' }
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
    const recentMemories = await Memory.find({ conversationId })
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

    // ── Perturb the hum with the thought's composite ──
    try {
      const { composite: thoughtComposite } = await decompose(content)
      if (thoughtComposite && thoughtComposite.length > 0) {
        await updateHum(conversationId, thoughtComposite)
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

    if (action.type === 'initiative') {
      // Pick a contextual gesture
      const gesture = pickGesture(state, action, content)
      if (gesture) console.log(`  [Autonomy] Gesture: ${gesture}`)

      // Persist initiative message in Memory so it appears in chat history
      await Memory.create({
        text: thought.content,
        role: 'initiative',
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

    // ── AI decides when to think next ──────────────────────────
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

    // Every 3rd tick, run metabolism + gists + lapse expectations + contemplate archived concerns
    tickCount++
    if (tickCount % 3 === 0) {
      // Metabolic decay: confidence vectors soften on storage, not retrieval
      // Contradiction cooling: expired buffers get metabolized
      try {
        const { decayConfidenceVectors, coolContradictions, generateGists } = require('./metabolism')
        const decayed = await decayConfidenceVectors(conversationId)
        if (decayed > 0) console.log(`  [Metabolism] Decayed confidence on ${decayed} memories`)
        const cooled = await coolContradictions(conversationId)
        if (cooled > 0) console.log(`  [Metabolism] Cooled ${cooled} contradictions`)
        // Generate fuzzy gists for memories whose confidence crossed below threshold
        const gisted = await generateGists(conversationId, effectiveModel, effectiveApiKeys)
        if (gisted > 0) console.log(`  [Metabolism] Generated ${gisted} memory gists`)
      } catch (metaErr) {
        console.error('[Metabolism] Decay/cooling error:', metaErr.message)
      }

      // Lapse overdue expectations (future horn maintenance)
      try {
        const { lapseExpectations } = require('./expectation')
        const lapsed = await lapseExpectations(conversationId)
        if (lapsed > 0) console.log(`  [Expectations] Lapsed ${lapsed} overdue expectations`)
      } catch (expErr) {
        console.error('[Expectations] Lapse error:', expErr.message)
      }

      if (state.archivedConcerns && state.archivedConcerns.length > 0) {
        await contemplateArchivedConcern(state, effectiveModel, effectiveApiKeys, conversationId)
      }
    }

    // Every 20th tick (~30 min): heavy metabolism — reconsolidation window + limbic + entropy
    if (tickCount % 20 === 0) {
      try {
        const { runReconsolidationWindow, runLimbicModule, checkEntropyInjection, validateEntropyBindings } = require('./metabolism')
        const revised = await runReconsolidationWindow(conversationId, effectiveModel, effectiveApiKeys)
        if (revised > 0) console.log(`  [Metabolism] Reconsolidation window: ${revised} memories re-encoded`)
        const limbic = await runLimbicModule(conversationId, effectiveModel, effectiveApiKeys)
        if (limbic > 0) console.log(`  [Metabolism] Limbic module: ${limbic} memories processed`)
        await checkEntropyInjection(conversationId)
        const validated = await validateEntropyBindings(conversationId)
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

// ── Start the autonomous loop ─────────────────────────────────
let loopInterval = null

function startAutonomyLoop() {
  if (loopInterval) return

  console.log(`[Autonomy] Starting autonomous loop (polling every 30s, AI-scheduled reappearance)`)

  loopInterval = setInterval(async () => {
    try {
      const now = new Date()
      // Find conversations that are due for a thought:
      // - autonomy enabled
      // - nextThoughtAt is null (never scheduled) or in the past (due)
      const states = await AgentState.find({
        autonomyEnabled: { $ne: false },
        $or: [
          { nextThoughtAt: null },
          { nextThoughtAt: { $lte: now } }
        ]
      }).select('conversationId nextThoughtAt').lean()

      for (const s of states) {
        await tick(s.conversationId)
      }
    } catch (err) {
      console.error('[Autonomy] Loop error:', err.message)
    }
  }, 30000) // poll every 30 seconds

  // Also run once on start after a short delay
  setTimeout(async () => {
    try {
      const now = new Date()
      const states = await AgentState.find({
        autonomyEnabled: { $ne: false },
        $or: [
          { nextThoughtAt: null },
          { nextThoughtAt: { $lte: now } }
        ]
      }).select('conversationId').lean()
      for (const s of states) {
        await tick(s.conversationId)
      }
    } catch (err) {
      // first tick, might fail if DB not ready
    }
  }, 10000)
}

function stopAutonomyLoop() {
  if (loopInterval) {
    clearInterval(loopInterval)
    loopInterval = null
    console.log('[Autonomy] Loop stopped')
  }
}

// ── Update lastInteraction when user sends a message ──────────
async function markInteraction(conversationId) {
  try {
    await AgentState.findOneAndUpdate(
      { conversationId },
      {
        $set: {
          'drives.lastInteraction': new Date(),
          'drives.connectionHunger': 0.05 // reset on interaction
        }
      }
    )
  } catch (err) {
    // non-critical
  }
}

function isAutonomyRunning() {
  return loopInterval !== null
}

module.exports = {
  registerSSEClient,
  pushToClients,
  startAutonomyLoop,
  stopAutonomyLoop,
  isAutonomyRunning,
  markInteraction,
  tick
}
