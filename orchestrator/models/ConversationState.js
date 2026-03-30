/**
 * ConversationState — session-to-session continuity.
 *
 * Tracks unfinished thoughts and internal notes between interactions so the
 * agent can resume a line of reasoning across sessions. Keyed by
 * (userId, conversationId) with a unique compound index.
 */

const mongoose = require('mongoose')

const ConversationStateSchema = new mongoose.Schema({
  userId:            { type: String, default: 'anonymous' },
  conversationId:    { type: String, required: true },
  unfinishedThoughts: { type: String, default: '' },
  noteToSelf:        { type: String, default: '' },
  updatedAt:         { type: Date, default: Date.now }
})

ConversationStateSchema.index({ userId: 1, conversationId: 1 }, { unique: true })

module.exports = mongoose.model('ConversationState', ConversationStateSchema)
