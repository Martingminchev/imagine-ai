/**
 * Contradiction — tracks held contradictions between memories.
 *
 * When two memories are semantically close but point in opposite directions,
 * the contradiction is held in a cooling buffer rather than resolved immediately.
 * Both memories get capped retrieval weight until the contradiction is metabolized.
 *
 * Lifecycle: cooling → active → metabolized
 */

const mongoose = require('mongoose')

const ContradictionSchema = new mongoose.Schema({
  memoryA:        { type: mongoose.Schema.Types.ObjectId, ref: 'Memory', required: true },
  memoryB:        { type: mongoose.Schema.Types.ObjectId, ref: 'Memory', required: true },
  tensionScore:   { type: Number, required: true },
  coolingExpires: { type: Date, required: true },
  status: {
    type: String,
    enum: ['active', 'cooling', 'metabolized'],
    default: 'cooling'
  },
  detectedAt:     { type: Date, default: Date.now },
  metabolizedAt:  { type: Date, default: null },
  userId:         { type: String, default: 'anonymous' },
  conversationId: { type: String, required: true }
})

ContradictionSchema.index({ userId: 1, conversationId: 1, status: 1 })
ContradictionSchema.index({ coolingExpires: 1 })

module.exports = mongoose.model('Contradiction', ContradictionSchema)
