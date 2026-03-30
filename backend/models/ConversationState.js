const mongoose = require('mongoose')

const ConversationStateSchema = new mongoose.Schema({
  conversationId:    { type: String, required: true, unique: true },
  unfinishedThoughts: { type: String, default: '' },
  noteToSelf:        { type: String, default: '' },
  updatedAt:         { type: Date, default: Date.now }
})

ConversationStateSchema.index({ conversationId: 1 }, { unique: true })

module.exports = mongoose.model('ConversationState', ConversationStateSchema)
