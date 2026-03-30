const mongoose = require('mongoose')

const InternalThoughtSchema = new mongoose.Schema({
  conversationId: { type: String, default: 'default' },

  // What kind of autonomous activity this was
  type: {
    type: String,
    enum: [
      'reflection',              // thinking about past conversations
      'question',                // a question it wants to ask the user
      'realization',             // something it figured out on its own
      'feeling',                 // an emotional/mood shift it noticed
      'initiative',              // a message it wants to send to the user
      'exploration',             // exploring an idea or topic
      'memory-review',           // revisiting old memories
      'self-examination',        // examining its own state
      'archived-contemplation'   // contemplating an archived concern
    ],
    default: 'reflection'
  },

  content:    { type: String, required: true },
  trigger:    { type: String, default: '' },  // what drive triggered this
  intensity:  { type: Number, default: 0.5, min: 0, max: 1 },
  delivered:  { type: Boolean, default: false }, // for initiative: was it pushed to user?
  archivedTopicId: { type: mongoose.Schema.Types.ObjectId, default: null }, // links to archivedConcerns subdoc
  timestamp:  { type: Date, default: Date.now }
})

InternalThoughtSchema.index({ conversationId: 1, timestamp: -1 })
InternalThoughtSchema.index({ type: 1, delivered: 1 })

module.exports = mongoose.model('InternalThought', InternalThoughtSchema)
