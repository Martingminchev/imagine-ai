const AgentState = require('../models/AgentState')

/**
 * Number of contemplation attempts before a concern is escalated to 'needsUser'.
 * Once this threshold is reached, the system signals that the AI cannot resolve
 * the concern on its own and needs the user's input.
 * @type {number}
 */
const CONTEMPLATION_THRESHOLD = 5

/**
 * Archive a concern/topic into the AgentState's archivedConcerns list.
 *
 * If an unresolved concern with a similar topic already exists (case-insensitive
 * substring match), the new topic is merged into it — keeping the longer/more
 * specific phrasing. If the concern matches the current dynamic concern, that
 * field is cleared and concernTurnCount is reset.
 *
 * @param {string} conversationId - The conversation identifier.
 * @param {string} topic          - The concern topic text.
 * @param {string|null} thoughtId - Optional InternalThought id to link.
 * @param {string} userId         - The user identifier (defaults to 'anonymous').
 * @returns {Promise<{ id: string, topic: string, status: string, archivedAt: Date, contemplationAttempts: number }>}
 * @throws {Error} If no AgentState exists for the conversation.
 */
async function archiveConcern(conversationId, topic, thoughtId = null, userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
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

  // Clear currentConcern if it matches the archived topic
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
 *
 * Returns a summary of each archived concern along with the current
 * dynamic concern and whether the agent is stuck (concernTurnCount >= 3).
 *
 * @param {string} conversationId - The conversation identifier.
 * @param {string} userId         - The user identifier (defaults to 'anonymous').
 * @returns {Promise<{ concerns: Array, currentConcern: string, isStuck: boolean }>}
 */
async function getArchivedConcerns(conversationId, userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
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
 * Increment contemplation attempts for an archived concern.
 *
 * Sets the concern status to 'contemplating'. If the attempts reach
 * CONTEMPLATION_THRESHOLD (5), escalates the status to 'needsUser'.
 *
 * @param {string} conversationId - The conversation identifier.
 * @param {string} concernId      - The _id of the archived concern subdocument.
 * @param {string} userId         - The user identifier (defaults to 'anonymous').
 * @returns {Promise<{ id: string, topic: string, status: string, contemplationAttempts: number }|null>}
 */
async function incrementContemplation(conversationId, concernId, userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
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
 * Link an InternalThought to an archived concern.
 *
 * Uses $addToSet to avoid duplicate thought references on the concern.
 *
 * @param {string} conversationId - The conversation identifier.
 * @param {string} concernId      - The _id of the archived concern subdocument.
 * @param {string} thoughtId      - The InternalThought _id to link.
 * @param {string} userId         - The user identifier (defaults to 'anonymous').
 * @returns {Promise<void>}
 */
async function linkThoughtToConcern(conversationId, concernId, thoughtId, userId = 'anonymous') {
  await AgentState.findOneAndUpdate(
    { userId, 'archivedConcerns._id': concernId },
    { $addToSet: { 'archivedConcerns.$.relatedThoughtIds': thoughtId } }
  )
}

/**
 * Mark an archived concern as resolved.
 *
 * Sets status to 'resolved' and stores the resolution text (how the
 * concern was addressed — either the AI figured it out, or the user answered).
 *
 * @param {string} conversationId - The conversation identifier.
 * @param {string} concernId      - The _id of the archived concern subdocument.
 * @param {string} resolution     - Resolution description (capped at 500 chars).
 * @param {string} userId         - The user identifier (defaults to 'anonymous').
 * @returns {Promise<Object|null>} The updated concern subdocument, or null if not found.
 */
async function resolveConcern(conversationId, concernId, resolution = '', userId = 'anonymous') {
  const state = await AgentState.findOne({ userId })
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
 *
 * Filters to concerns with status 'archived' or 'contemplating',
 * then sorts by fewest attempts first, then oldest archived first.
 * This ensures under-explored concerns get attention before well-trodden ones.
 *
 * @param {Array} archivedConcerns - The archivedConcerns array from AgentState.
 * @returns {Object|null} The next concern to contemplate, or null if none eligible.
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
