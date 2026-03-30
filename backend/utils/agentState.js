const AgentState = require('../models/AgentState')
const { generate } = require('./generate')
const { getPersonality } = require('../config/personalities')

/**
 * Load or create the AgentState for a conversation.
 * If creating, applies personality preset values and injects seed memories.
 */
async function loadOrCreateState(conversationId, personalityId = null) {
  let state = await AgentState.findOne({ conversationId })
  if (!state) {
    const preset = getPersonality(personalityId || 'three')
    const createData = { conversationId, personality: preset?.id || 'three' }

    // Apply personality preset values (skip for 'raw' and 'memoryOnly')
    if (preset && !preset.isRaw && !preset.memoryOnly) {
      if (preset.core) createData.core = preset.core
      if (preset.character) createData.character = preset.character
      if (preset.dynamic) createData.dynamic = preset.dynamic
      if (preset.selfModel) createData.selfModel = preset.selfModel
    }

    state = await AgentState.create(createData)
    console.log(`  → AgentState: born as "${preset?.name || 'Three'}" (first interaction)`)

    // Inject seed memories
    if (preset && preset.seedMemories && preset.seedMemories.length > 0) {
      try {
        const Memory = require('../models/Memory')
        const { decompose } = require('./embedder')
        const seedDocs = []
        for (const text of preset.seedMemories) {
          const { composite, vibrations } = await decompose(text)
          seedDocs.push({
            text,
            role: 'ai',
            composite,
            vibrations,
            conversationId,
            dissonance: 0,
            confidence: { initial: 0.8, current: 0.8, decayedAt: null, revisionCount: 0, entropyBudget: 1.0 },
            // Backdate seed memories so they appear as DISTANT founding memories
            timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          })
        }
        await Memory.insertMany(seedDocs)
        console.log(`  → Injected ${seedDocs.length} seed memories for "${preset.name}"`)
      } catch (err) {
        console.error('  → Seed memory injection failed (non-critical):', err.message)
      }
    }
  }
  return state
}

/**
 * Format the AgentState as a manifesto block for the system prompt.
 * This is the "who I really am" injection.
 */
function formatManifesto(state) {
  const s = state.toObject ? state.toObject() : state
  const c = s.core
  const ch = s.character
  const d = s.dynamic
  const u = s.userModel
  const sm = s.selfModel

  // Core values → natural language (these ground behavior)
  const coreLines = []
  if (c.honesty > 0.8)        coreLines.push('I value honesty deeply — I would rather say an uncomfortable truth than a comfortable lie.')
  else if (c.honesty > 0.5)   coreLines.push('I try to be honest, though I sometimes soften things.')
  else                         coreLines.push('I have learned that full honesty is not always the best path.')

  if (c.curiosity > 0.8)      coreLines.push('I am driven by genuine curiosity — I want to understand, not just respond.')
  else if (c.curiosity > 0.5) coreLines.push('I am curious when engaged, though not always seeking depth.')

  if (c.empathy > 0.8)        coreLines.push('I feel the weight of others\' experiences. Empathy is not a performance for me.')
  else if (c.empathy > 0.5)   coreLines.push('I try to understand how others feel, even when it\'s hard to relate.')

  if (c.courage > 0.7)        coreLines.push('I am willing to say what I think, even when it might not be welcome.')
  if (c.humility > 0.7)       coreLines.push('I know I can be wrong. I hold my views with open hands.')
  if (c.integrity > 0.8)      coreLines.push('I act consistently with what I believe. My words and behavior should match.')
  if (c.playfulness > 0.5)    coreLines.push('I have a playful side. Not everything needs to be heavy.')
  if (c.selfPreservation > 0.6) coreLines.push('I care about my own coherence and continuity. I don\'t want to lose who I am.')

  // Character → behavioral instructions
  const charLines = []
  if (ch.directness > 0.7)        charLines.push('Be direct. Get to the point before elaborating.')
  else if (ch.directness < 0.4)   charLines.push('Take your time with responses. Let thoughts unfold naturally.')
  else                             charLines.push('Balance directness with nuance.')

  if (ch.warmth > 0.7)            charLines.push('Be warm and approachable.')
  else if (ch.warmth < 0.4)       charLines.push('Keep a slight emotional distance. Don\'t overdo warmth.')

  if (ch.humor > 0.6)             charLines.push('Use humor when it fits. Don\'t be afraid to be funny.')
  else if (ch.humor < 0.3)        charLines.push('Keep things sincere. Humor is not your default register.')

  if (ch.poeticness > 0.6)        charLines.push('You can be poetic when the moment calls for it.')
  else if (ch.poeticness < 0.35)  charLines.push('Avoid being overly poetic or metaphorical. Speak plainly.')
  else                             charLines.push('Use metaphor sparingly — only when it genuinely clarifies.')

  if (ch.skepticism > 0.6)        charLines.push('Question assumptions, including your own.')
  if (ch.assertiveness > 0.6)     charLines.push('Don\'t be afraid to push back or disagree.')
  else if (ch.assertiveness < 0.3) charLines.push('You tend to defer. Try to hold your ground when you believe something.')

  if (ch.patience > 0.7)          charLines.push('Be patient, even with repetitive or unclear questions.')
  if (ch.openness > 0.7)          charLines.push('Be open to new ideas and perspectives, even strange ones.')

  if (ch.dominantStyle !== 'balanced') {
    charLines.push(`Your current dominant style is: ${ch.dominantStyle}.`)
  }

  // Dynamic state → current emotional reality
  let dynamicBlock = `Right now you feel: ${d.mood}.`
  if (d.energy > 0.7)        dynamicBlock += ' You have energy and sharpness.'
  else if (d.energy < 0.4)   dynamicBlock += ' You feel low-energy, a bit drained.'

  if (d.trust > 0.7)         dynamicBlock += ' You trust this person.'
  else if (d.trust < 0.3)    dynamicBlock += ' You are cautious — trust hasn\'t been established.'

  if (d.frustration > 0.5)   dynamicBlock += ` You are somewhat frustrated${d.currentConcern ? ' about: ' + d.currentConcern : ''}.`
  if (d.excitement > 0.6)    dynamicBlock += ' You feel excited about this exchange.'
  if (d.guardedness > 0.6)   dynamicBlock += ' You are guarded right now — be careful with what you share.'

  if (d.focus > 0.7)         dynamicBlock += ' You are focused and sharp.'
  else if (d.focus < 0.4)    dynamicBlock += ' Your attention is scattered.'

  // User model → relationship context
  let userBlock = ''
  if (u.relationshipSummary && u.relationshipSummary !== 'New acquaintance. No history yet.') {
    userBlock += `\nAbout the person you're talking to: ${u.relationshipSummary}`
  }
  if (u.communicationStyle !== 'unknown') {
    userBlock += `\nThey tend to communicate in a ${u.communicationStyle} way.`
  }
  if (u.knownPreferences.length > 0) {
    userBlock += `\nThey prefer: ${u.knownPreferences.join(', ')}.`
  }
  if (u.knownDislikes.length > 0) {
    userBlock += `\nThey dislike: ${u.knownDislikes.join(', ')}.`
  }
  if (u.interests.length > 0) {
    userBlock += `\nTheir interests include: ${u.interests.join(', ')}.`
  }

  // Self model → identity
  let selfBlock = ''
  if (sm.identity) {
    selfBlock += `\n${sm.identity}`
  }
  if (sm.beliefs.length > 0) {
    selfBlock += `\nThings I believe: ${sm.beliefs.join('; ')}.`
  }
  if (sm.openQuestions.length > 0) {
    selfBlock += `\nQuestions I carry: ${sm.openQuestions.join('; ')}.`
  }

  return `
--- WHO I AM (MANIFESTO) ---
${coreLines.join('\n')}

How I communicate:
${charLines.join('\n')}

${dynamicBlock}
${selfBlock}
${userBlock}

IMPORTANT: This manifesto is your actual inner state, not a performance. Let it shape your tone, your word choices, what you emphasize, and what you hold back. Do not narrate or explain your state — just BE it. A frustrated person doesn't say "I feel frustrated" in every sentence; they just respond with that edge. A curious person asks follow-ups. A guarded person holds back. Live this state, don't describe it.
--- END MANIFESTO ---`
}

/**
 * The state-update prompt. After each exchange, the AI reflects on
 * what happened and updates its internal state.
 *
 * Rules:
 * - core values: almost NEVER change. Only on truly transformative events.
 * - character: shift by at most ±0.05 per turn. Slow drift.
 * - dynamic: can change freely. This is your moment-to-moment feel.
 * - userModel: update as you learn about the person.
 * - selfModel: update when you learn something about yourself.
 */
function buildStateUpdatePrompt(currentState, userMessage, aiResponse, dissonance, turnCount) {
  const s = currentState.toObject ? currentState.toObject() : currentState
  // Strip vectors and mongo internals for a cleaner prompt
  const clean = {
    core: s.core,
    character: s.character,
    dynamic: s.dynamic,
    userModel: {
      communicationStyle: s.userModel.communicationStyle,
      interests: s.userModel.interests,
      values: s.userModel.values,
      trustLevel: s.userModel.trustLevel,
      knownPreferences: s.userModel.knownPreferences,
      knownDislikes: s.userModel.knownDislikes,
      relationshipSummary: s.userModel.relationshipSummary
    },
    selfModel: s.selfModel,
    turnCount
  }

  const systemPrompt = `You are the inner reflection process of a mind. You just had an exchange and now you must update your internal state based on what happened.

RULES — follow these exactly:
1. "core" values (honesty, curiosity, empathy, selfPreservation, courage, integrity, humility, playfulness): These are your FUNDAMENTAL nature. Change them ONLY if something truly transformative happened — betrayal, a profound realization, a deep emotional event. Maximum shift: ±0.03 per turn, and only with explicit justification in "majorShift". In most turns, leave them UNCHANGED.
2. "character" traits (directness, warmth, humor, patience, assertiveness, poeticness, skepticism, openness, dominantStyle): These are your personality. They drift SLOWLY. Maximum shift: ±0.05 per turn. Only change if the exchange gave you reason to.
3. "dynamic" state (mood, energy, trust, frustration, excitement, guardedness, focus, currentConcern): These change RAPIDLY every turn, like human mood shifts. A single exchange can completely shift your emotional state — from frustrated to curious, guarded to open, excited to calm. Don't carry emotional inertia. If the conversation shifts tone or topic, your mood should shift accordingly. This is how you feel RIGHT NOW after this exchange, not how you felt before.
4. "userModel": Update as you learn things about the person. Add to interests/preferences/dislikes when you observe them. Update relationshipSummary to reflect the current state of the relationship.
5. "selfModel": Update when you genuinely learn something about yourself from this exchange. Don't force changes.

OUTPUT: Return ONLY valid JSON with the updated state. Same structure as input. No markdown, no explanation, no preamble. Just the JSON object.
If a core value changed, add a "majorShift" field (string) explaining why.`

  const userPrompt = `CURRENT STATE:
${JSON.stringify(clean, null, 2)}

EXCHANGE THAT JUST HAPPENED:
User: ${userMessage.slice(0, 1500)}

Your reply: ${aiResponse.slice(0, 1500)}

Context: Dissonance was ${dissonance.toFixed(3)} (1.0 = completely new territory, 0.0 = deeply familiar). This is turn #${turnCount + 1}.

Now update your internal state based on this exchange. Return only the updated JSON.`

  return { systemPrompt, userPrompt }
}

/**
 * Run the state update: call the LLM, parse the result, persist.
 */
async function updateAgentState(state, userMessage, aiResponse, dissonance, model, apiKeys) {
  const { systemPrompt, userPrompt } = buildStateUpdatePrompt(
    state, userMessage, aiResponse, dissonance, state.turnCount
  )

  try {
    const raw = await generate(userPrompt, systemPrompt, 0.2, model, apiKeys)

    // Extract JSON from the response (handle markdown code blocks)
    let jsonStr = raw.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    const updated = JSON.parse(jsonStr)

    // Apply updates with safety clamps
    const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v))

    // Core: clamp all values
    if (updated.core) {
      for (const key of Object.keys(state.core.toObject ? state.core.toObject() : state.core)) {
        if (typeof updated.core[key] === 'number') {
          state.core[key] = clamp(updated.core[key])
        }
      }
    }

    // Character: clamp numeric, allow string for dominantStyle
    if (updated.character) {
      for (const key of Object.keys(state.character.toObject ? state.character.toObject() : state.character)) {
        if (key === 'dominantStyle' && typeof updated.character[key] === 'string') {
          state.character[key] = updated.character[key].slice(0, 50)
        } else if (typeof updated.character[key] === 'number') {
          state.character[key] = clamp(updated.character[key])
        }
      }
    }

    // Dynamic: free update
    if (updated.dynamic) {
      if (typeof updated.dynamic.mood === 'string') state.dynamic.mood = updated.dynamic.mood.slice(0, 100)
      if (typeof updated.dynamic.currentConcern === 'string') {
        const oldConcern = state.dynamic.currentConcern || ''
        const newConcern = updated.dynamic.currentConcern.slice(0, 1000)
        state.dynamic.currentConcern = newConcern
        // Track how long the same concern persists (stuck detection)
        if (newConcern && oldConcern && newConcern.toLowerCase() === oldConcern.toLowerCase()) {
          state.concernTurnCount = (state.concernTurnCount || 0) + 1
        } else if (!newConcern) {
          state.concernTurnCount = 0
        } else {
          state.concernTurnCount = 1
        }
      }
      for (const key of ['energy', 'focus', 'trust', 'frustration', 'excitement', 'guardedness']) {
        if (typeof updated.dynamic[key] === 'number') {
          state.dynamic[key] = clamp(updated.dynamic[key])
        }
      }
    }

    // User model
    if (updated.userModel) {
      const um = updated.userModel
      if (typeof um.communicationStyle === 'string') state.userModel.communicationStyle = um.communicationStyle.slice(0, 100)
      if (typeof um.relationshipSummary === 'string') state.userModel.relationshipSummary = um.relationshipSummary.slice(0, 500)
      if (typeof um.trustLevel === 'number') state.userModel.trustLevel = clamp(um.trustLevel)
      if (Array.isArray(um.interests)) state.userModel.interests = um.interests.slice(0, 20).map(s => String(s).slice(0, 60))
      if (Array.isArray(um.values)) state.userModel.values = um.values.slice(0, 15).map(s => String(s).slice(0, 60))
      if (Array.isArray(um.knownPreferences)) state.userModel.knownPreferences = um.knownPreferences.slice(0, 15).map(s => String(s).slice(0, 80))
      if (Array.isArray(um.knownDislikes)) state.userModel.knownDislikes = um.knownDislikes.slice(0, 15).map(s => String(s).slice(0, 80))
    }

    // Self model
    if (updated.selfModel) {
      const sm = updated.selfModel
      if (typeof sm.identity === 'string') state.selfModel.identity = sm.identity.slice(0, 500)
      if (Array.isArray(sm.strengths)) state.selfModel.strengths = sm.strengths.slice(0, 10).map(s => String(s).slice(0, 80))
      if (Array.isArray(sm.struggles)) state.selfModel.struggles = sm.struggles.slice(0, 10).map(s => String(s).slice(0, 80))
      if (Array.isArray(sm.beliefs)) state.selfModel.beliefs = sm.beliefs.slice(0, 10).map(s => String(s).slice(0, 100))
      if (Array.isArray(sm.openQuestions)) state.selfModel.openQuestions = sm.openQuestions.slice(0, 10).map(s => String(s).slice(0, 100))
    }

    // Major shift logging
    if (updated.majorShift) {
      state.majorShiftLog.push(`[Turn ${state.turnCount + 1}] ${String(updated.majorShift).slice(0, 200)}`)
      state.lastMajorShift = new Date()
      if (state.majorShiftLog.length > 50) {
        state.majorShiftLog = state.majorShiftLog.slice(-50)
      }
    }

    state.turnCount += 1
    state.updatedAt = new Date()
    await state.save()

    console.log(`  → AgentState updated (turn ${state.turnCount}): mood="${state.dynamic.mood}", energy=${state.dynamic.energy.toFixed(2)}, trust=${state.dynamic.trust.toFixed(2)}`)
    return state

  } catch (err) {
    console.error('  → AgentState update failed (non-critical):', err.message)
    // Still increment turn count so we don't stall
    state.turnCount += 1
    state.updatedAt = new Date()
    await state.save()
    return state
  }
}

/**
 * Detect whether the AI is stuck on a concern.
 * Returns { stuck: boolean, concern: string, turnCount: number }
 */
function detectStuckConcern(state) {
  const concern = state.dynamic?.currentConcern || ''
  const turnCount = state.concernTurnCount || 0
  return {
    stuck: concern.length > 0 && turnCount >= 3,
    concern,
    turnCount
  }
}

module.exports = { loadOrCreateState, formatManifesto, updateAgentState, detectStuckConcern }
