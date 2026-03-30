const mongoose = require('mongoose')

const StepSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  prompt:      { type: String, default: '' },
  status:      { type: String, enum: ['pending', 'active', 'completed', 'failed'], default: 'pending' },
  output:      { type: String, default: '' },
  completedAt: { type: Date, default: null }
}, { _id: true })

const TaskSchema = new mongoose.Schema({
  description:    { type: String, required: true },
  conversationId: { type: String, default: 'default' },
  status:         { type: String, enum: ['pending', 'active', 'completed', 'failed'], default: 'pending' },
  steps:          { type: [StepSchema], default: [] },

  // Outcome reported by the user
  outcome:        { type: String, default: '' },
  success:        { type: Boolean, default: null },

  // Lessons extracted from this task's outcome
  lessonIds:      [{ type: mongoose.Schema.Types.ObjectId, ref: 'Memory' }],

  timestamp:      { type: Date, default: Date.now },
  completedAt:    { type: Date, default: null }
})

TaskSchema.index({ conversationId: 1, timestamp: -1 })
TaskSchema.index({ status: 1, timestamp: -1 })
TaskSchema.index({ timestamp: -1 })

module.exports = mongoose.model('Task', TaskSchema)
