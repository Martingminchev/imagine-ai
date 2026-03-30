const AgentState = require('../models/AgentState')
const InternalThought = require('../models/InternalThought')

const CONTEMPLATION_THRESHOLD = 5 // after this many attempts, mark as needsUser

/**
 * Archive a concern/topic. If a similar topic already exists, merge into it.
 * Clears currentConcern if it matches.
 */
async function archiveConcern(conversationId, topic, thoughtId = null) {
  const state = await AgentState.findOne({ conversationId })
  if (!state) throw new Error('Agent state not found')

  // Check for existing similar topic (case-insensitive substring match)
  const topicLower = topic.toLowerCase()
  const existing = state.archivedConcerns.find(c =>
    c.status !== 'resolved' && (
      c.topic.toLowerCase().includes(topicLower) ||
      topicLower.includes(c.topic.toLowerCase())
    )
  )

  let concern
  if (existing) {
    // Merge: update topic if the new one is longer/more specific
    if (topic.length > existing.topic.length) {
      existing.topic = topic.slice(0, 500)
    }
    if (thoughtId) {
      existing.relatedThoughtIds.addToSet(thoughtId)
    }
    concern = existing
  } else {
    const newConcern = {
      topic: topic.slice(0, 500),
      archivedAt: new Date(),
      contemplationAttempts: 0,
      lastContemplation: null,
      relatedThoughtIds: thoughtId ? [thoughtId] : [],
      status: 'archived',
      resolution: ''
    }
    state.archivedConcerns.push(newConcern)
    concern = state.archivedConcerns[state.archivedConcerns.length - 1]
  }

  // Clear currentConcern if it matches
  if (state.dynamic.currentConcern) {
    const concernLower = state.dynamic.currentConcern.toLowerCase()
    if (concernLower.includes(topicLower) || topicLower.includes(concernLower)) {
      state.dynamic.currentConcern = ''
      state.concernTurnCount = 0
    }
  }

  await state.save()

  return {
    id: concern._id,
    topic: concern.topic,
    status: concern.status,
    archivedAt: concern.archivedAt,
    contemplationAttempts: concern.contemplationAttempts
  }
}

/**
 * Get all archived concerns for a conversation.
 */
async function getArchivedConcerns(conversationId) {
  const state = await AgentState.findOne({ conversationId })
    .select('archivedConcerns dynamic.currentConcern concernTurnCount')
    .lean()
  if (!state) return { concerns: [], currentConcern: '', isStuck: false }

  return {
    concerns: (state.archivedConcerns || []).map(c => ({
      id: c._id,
      topic: c.topic,
      status: c.status,
      archivedAt: c.archivedAt,
      contemplationAttempts: c.contemplationAttempts,
      lastContemplation: c.lastContemplation,
      resolution: c.resolution
    })),
    currentConcern: state.dynamic?.currentConcern || '',
    isStuck: (state.concernTurnCount || 0) >= 3
  }
}

/**
 * Increment contemplation attempts for a concern.
 * Returns the updated concern, or null if not found.
 */
async function incrementContemplation(conversationId, concernId) {
  const state = await AgentState.findOne({ conversationId })
  if (!state) return null

  const concern = state.archivedConcerns.id(concernId)
  if (!concern) return null

  concern.contemplationAttempts += 1
  concern.lastContemplation = new Date()
  concern.status = 'contemplating'

  // If exceeded threshold, escalate to needsUser
  if (concern.contemplationAttempts >= CONTEMPLATION_THRESHOLD) {
    concern.status = 'needsUser'
  }

  await state.save()
  return {
    id: concern._id,
    topic: concern.topic,
    status: concern.status,
    contemplationAttempts: concern.contemplationAttempts
  }
}

/**
 * Link a thought to an archived concern.
 */
async function linkThoughtToConcern(conversationId, concernId, thoughtId) {
  await AgentState.findOneAndUpdate(
    { conversationId, 'archivedConcerns._id': concernId },
    { $addToSet: { 'archivedConcerns.$.relatedThoughtIds': thoughtId } }
  )
}

/**
 * Mark a concern as resolved (the AI figured it out, or user answered).
 */
async function resolveConcern(conversationId, concernId, resolution = '') {
  const state = await AgentState.findOne({ conversationId })
  if (!state) return null

  const concern = state.archivedConcerns.id(concernId)
  if (!concern) return null

  concern.status = 'resolved'
  concern.resolution = resolution.slice(0, 500)
  await state.save()
  return concern
}

/**
 * Pick the next archived concern that needs contemplation.
 * Prefers oldest unresolved concern that hasn't been contemplated recently.
 */
function pickConcernForContemplation(archivedConcerns) {
  const eligible = (archivedConcerns || []).filter(c =>
    c.status === 'archived' || c.status === 'contemplating'
  )
  if (eligible.length === 0) return null

  // Sort by: fewest attempts first, then oldest archived first
  eligible.sort((a, b) => {
    if (a.contemplationAttempts !== b.contemplationAttempts) {
      return a.contemplationAttempts - b.contemplationAttempts
    }
    return new Date(a.archivedAt) - new Date(b.archivedAt)
  })

  return eligible[0]
}

module.exports = {
  archiveConcern,
  getArchivedConcerns,
  incrementContemplation,
  linkThoughtToConcern,
  resolveConcern,
  pickConcernForContemplation,
  CONTEMPLATION_THRESHOLD
}
