/**
 * InternalThought — log of autonomous thoughts generated between interactions.
 *
 * Each thought is triggered by a drive (curiosity, reflection, outreach) and
 * may be delivered to the user as an initiative. Thoughts that remain
 * undelivered persist in the log for later introspection or metabolism.
 *
 * Types:
 *   reflection          — self-directed musing
 *   question            — something the agent wants to ask
 *   realization         — a new connection or insight
 *   feeling             — affective state note
 *   initiative          — proactive user-facing message
 *   exploration         — a topic the agent is investigating
 *   memory-review       — revisiting old memories
 *   self-examination    — identity / value introspection
 *   archived-contemplation — revisiting an archived concern
 */

const mongoose = require('mongoose')

const InternalThoughtSchema = new mongoose.Schema({
  userId:         { type: String, default: 'anonymous' },
  conversationId: { type: String, default: 'default' },
  type: {
    type: String,
    enum: [
      'reflection',
      'question',
      'realization',
      'feeling',
      'initiative',
      'exploration',
      'memory-review',
      'self-examination',
      'archived-contemplation'
    ],
    default: 'reflection'
  },
  content:    { type: String, required: true },
  trigger:    { type: String, default: '' },
  intensity:  { type: Number, default: 0.5, min: 0, max: 1 },
  delivered:  { type: Boolean, default: false },
  archivedTopicId: { type: mongoose.Schema.Types.ObjectId, default: null },
  timestamp:  { type: Date, default: Date.now }
})

InternalThoughtSchema.index({ userId: 1, conversationId: 1, timestamp: -1 })
InternalThoughtSchema.index({ type: 1, delivered: 1 })

module.exports = mongoose.model('InternalThought', InternalThoughtSchema)
