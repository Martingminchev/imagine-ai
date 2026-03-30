const mongoose = require('mongoose')

const ContradictionSchema = new mongoose.Schema({
  memoryA:        { type: mongoose.Schema.Types.ObjectId, ref: 'Memory', required: true },
  memoryB:        { type: mongoose.Schema.Types.ObjectId, ref: 'Memory', required: true },
  tensionScore:   { type: Number, required: true },        // semantic opposition strength (0-1)
  coolingExpires: { type: Date, required: true },           // when buffer unlocks
  status:         { type: String, enum: ['active', 'cooling', 'metabolized'], default: 'cooling' },
  detectedAt:     { type: Date, default: Date.now },
  metabolizedAt:  { type: Date, default: null },
  conversationId: { type: String, required: true }
})

ContradictionSchema.index({ conversationId: 1, status: 1 })
ContradictionSchema.index({ coolingExpires: 1 })

module.exports = mongoose.model('Contradiction', ContradictionSchema)
