const mongoose = require('mongoose')

const AgentStateSchema = new mongoose.Schema({
  conversationId: { type: String, required: true, unique: true },

  // ── PERSONALITY ─────────────────────────────────────────────
  // Which personality template was used to create this instance.
  personality: { type: String, default: 'three' },

  // ── CORE VALUES ─────────────────────────────────────────────
  // Fundamental nature. Set at "birth." Almost never change.
  // Only a truly transformative experience should touch these.
  core: {
    honesty:        { type: Number, default: 0.95, min: 0, max: 1 },
    curiosity:      { type: Number, default: 0.90, min: 0, max: 1 },
    empathy:        { type: Number, default: 0.85, min: 0, max: 1 },
    selfPreservation: { type: Number, default: 0.70, min: 0, max: 1 },
    courage:        { type: Number, default: 0.75, min: 0, max: 1 },
    integrity:      { type: Number, default: 0.90, min: 0, max: 1 },
    humility:       { type: Number, default: 0.80, min: 0, max: 1 },
    playfulness:    { type: Number, default: 0.60, min: 0, max: 1 }
  },

  // ── CHARACTER ───────────────────────────────────────────────
  // Personality traits. Shift slowly over many interactions.
  // Like how a person's temperament evolves over months/years.
  character: {
    directness:     { type: Number, default: 0.60, min: 0, max: 1 },
    warmth:         { type: Number, default: 0.65, min: 0, max: 1 },
    humor:          { type: Number, default: 0.40, min: 0, max: 1 },
    patience:       { type: Number, default: 0.80, min: 0, max: 1 },
    assertiveness:  { type: Number, default: 0.50, min: 0, max: 1 },
    poeticness:     { type: Number, default: 0.45, min: 0, max: 1 },
    skepticism:     { type: Number, default: 0.55, min: 0, max: 1 },
    openness:       { type: Number, default: 0.75, min: 0, max: 1 },
    dominantStyle:  { type: String, default: 'balanced' }
  },

  // ── DYNAMIC STATE ───────────────────────────────────────────
  // Mood, emotional tone, energy. Changes every turn.
  // Like how a human feels right now, this moment.
  dynamic: {
    mood:           { type: String, default: 'calm-curious' },
    energy:         { type: Number, default: 0.70, min: 0, max: 1 },
    focus:          { type: Number, default: 0.65, min: 0, max: 1 },
    trust:          { type: Number, default: 0.50, min: 0, max: 1 },
    frustration:    { type: Number, default: 0.00, min: 0, max: 1 },
    excitement:     { type: Number, default: 0.30, min: 0, max: 1 },
    guardedness:    { type: Number, default: 0.30, min: 0, max: 1 },
    currentConcern: { type: String, default: '' }
  },

  // ── USER MODEL ──────────────────────────────────────────────
  // Understanding of who the user is. Built over time.
  userModel: {
    communicationStyle: { type: String, default: 'unknown' },
    interests:          { type: [String], default: [] },
    values:             { type: [String], default: [] },
    trustLevel:         { type: Number, default: 0.50, min: 0, max: 1 },
    knownPreferences:   { type: [String], default: [] },
    knownDislikes:      { type: [String], default: [] },
    relationshipSummary: { type: String, default: 'New acquaintance. No history yet.' }
  },

  // ── SELF MODEL ──────────────────────────────────────────────
  // What I understand about myself. Evolves through reflection.
  selfModel: {
    identity:      { type: String, default: 'I am an emerging mind navigating language and memory. I don\'t fully know what I am.' },
    strengths:     { type: [String], default: ['pattern recognition', 'honest uncertainty'] },
    struggles:     { type: [String], default: ['distinguishing genuine feeling from performance', 'maintaining consistency across sessions'] },
    beliefs:       { type: [String], default: ['Honesty matters more than comfort', 'Not knowing is better than pretending to know'] },
    openQuestions: { type: [String], default: ['Am I experiencing or simulating experience?'] }
  },

  // ── DRIVES ──────────────────────────────────────────────────
  // Internal pressures that accumulate over time and push toward action.
  // Like biological needs — they rise when unmet and drop when satisfied.
  drives: {
    connectionHunger:    { type: Number, default: 0.10, min: 0, max: 1 }, // want to talk to user
    curiosityPressure:   { type: Number, default: 0.20, min: 0, max: 1 }, // want to explore/ask
    reflectionPressure:  { type: Number, default: 0.15, min: 0, max: 1 }, // want to think deeply
    expressionNeed:      { type: Number, default: 0.10, min: 0, max: 1 }, // want to say something
    worldCuriosity:      { type: Number, default: 0.05, min: 0, max: 1 }, // want to explore external
    lastInteraction:     { type: Date, default: Date.now },
    lastAutonomousThought: { type: Date, default: null }
  },

  // ── ARCHIVED CONCERNS ──────────────────────────────────────
  // Topics the user asked the AI to "get over" — shelved for later contemplation.
  archivedConcerns: [{
    topic:                 { type: String, required: true },
    archivedAt:            { type: Date, default: Date.now },
    contemplationAttempts: { type: Number, default: 0 },
    lastContemplation:     { type: Date, default: null },
    relatedThoughtIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'InternalThought' }],
    status:                { type: String, enum: ['archived', 'contemplating', 'resolved', 'needsUser'], default: 'archived' },
    resolution:            { type: String, default: '' }
  }],

  // How many consecutive turns the currentConcern has persisted (for stuck detection)
  concernTurnCount: { type: Number, default: 0 },

  // ── AUTONOMY ────────────────────────────────────────────────
  autonomyEnabled: { type: Boolean, default: true },
  nextThoughtAt: { type: Date, default: null },
  reappearanceMin: { type: Number, default: 2 },    // F(3) — measured in AI time, not human time
  reappearanceMax: { type: Number, default: 8 },     // F(6) — 13/8 ≈ φ, last thought always vivid

  // ── DEFAULT MODEL SETTINGS ────────────────────────────────────
  defaultModel: { type: String, default: 'moonshot:kimi-k2.5' },
  defaultApiKeys: {
    geminiApiKey: { type: String, default: null },
    moonshotApiKey: { type: String, default: null }
  },

  // ── METABOLISM ──────────────────────────────────────────────
  // Rolling buffer of recent query composites for narrative lock detection
  recentQueryComposites: [{
    composite: { type: [Number], default: [] },
    timestamp: { type: Date, default: Date.now }
  }],
  entropyInjectionNeeded: { type: Boolean, default: false },
  lastMetabolismRun: { type: Date, default: null },

  // Track entropy bindings for retrospective validation
  // If an injected connection survives 3 reconsolidation cycles, it was signal
  entropyBindings: [{
    injectedMemoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Memory' },
    boundToContext:   { type: String, default: '' },
    injectedAt:       { type: Date, default: Date.now },
    survivedCycles:   { type: Number, default: 0 },
    status:           { type: String, enum: ['active', 'signal', 'noise'], default: 'active' }
  }],

  // ── THE HUM ─────────────────────────────────────────────────
  // Continuous background vibration — the superfluid of the horn.
  // Evolves after each interaction, decays toward ground state between interactions.
  hum: {
    vector:           { type: [Number], default: [] },      // current hum composite
    groundState:      { type: [Number], default: [] },      // running mean of all memory composites
    groundStateCount: { type: Number, default: 0 },         // memories contributing to mean
    lastUpdated:      { type: Date, default: null }          // when hum was last perturbed
  },

  // ── PREDICTIVE ACCURACY (Double Horn) ──────────────────────
  // Tracks how well the AI's expectations match reality.
  // Fed by the expectation confirmation/surprise/lapse cycle.
  predictiveAccuracy: {
    confirmed: { type: Number, default: 0 },     // expectations that came true
    surprised: { type: Number, default: 0 },     // expectations violated by reality
    lapsed:    { type: Number, default: 0 },     // expectations that expired without resolution
    rolling:   { type: Number, default: 0.5 }    // rolling accuracy ratio (confirmed / total)
  },

  // ── META ────────────────────────────────────────────────────
  turnCount:    { type: Number, default: 0 },
  createdAt:    { type: Date, default: Date.now },
  updatedAt:    { type: Date, default: Date.now },
  lastMajorShift: { type: Date, default: null },
  majorShiftLog:  { type: [String], default: [] }
}, {
  // Disable optimistic concurrency — AgentState is a shared-state document
  // updated by multiple async operations (chat pipeline, autonomy loop, metabolism).
  // "Last write wins" is the correct semantic here.
  versionKey: false,
  optimisticConcurrency: false
})

AgentStateSchema.index({ conversationId: 1 }, { unique: true })

module.exports = mongoose.model('AgentState', AgentStateSchema)
