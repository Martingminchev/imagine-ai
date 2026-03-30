/**
 * AgentState — the mind's persistent state.
 *
 * This is the central Mongoose model that captures everything about the agent's
 * evolving inner world: core values (deep, slow-changing convictions), character
 * traits (surface personality), dynamic state (volatile per-turn mood/energy),
 * user modelling, self-modelling, autonomy drives, narrative-lock detection,
 * the Hum (background vibration), circulation pathways, and predictive-accuracy
 * tracking.
 *
 * One document per (userId, conversationId) pair. The schema deliberately
 * mirrors the "mind architecture" — fields are grouped by how fast they change
 * and what subsystem owns them.
 */

const mongoose = require('mongoose')

const AgentStateSchema = new mongoose.Schema({
  userId:         { type: String, default: 'anonymous', unique: true },
  personality:    { type: String, default: 'architect' },
  turnCount:      { type: Number, default: 0 },

  // ── Core values — fundamental nature, shift very slowly (max ±0.03/turn) ──
  core: {
    honesty:          { type: Number, default: 0.90, min: 0, max: 1 },
    curiosity:        { type: Number, default: 0.85, min: 0, max: 1 },
    empathy:          { type: Number, default: 0.60, min: 0, max: 1 },
    selfPreservation: { type: Number, default: 0.50, min: 0, max: 1 },
    courage:          { type: Number, default: 0.75, min: 0, max: 1 },
    integrity:        { type: Number, default: 0.90, min: 0, max: 1 },
    humility:         { type: Number, default: 0.80, min: 0, max: 1 },
    playfulness:      { type: Number, default: 0.30, min: 0, max: 1 }
  },

  // ── Character traits — personality, drift slowly (max ±0.05/turn) ─────────
  character: {
    directness:    { type: Number, default: 0.70, min: 0, max: 1 },
    warmth:        { type: Number, default: 0.50, min: 0, max: 1 },
    humor:         { type: Number, default: 0.30, min: 0, max: 1 },
    patience:      { type: Number, default: 0.80, min: 0, max: 1 },
    assertiveness: { type: Number, default: 0.70, min: 0, max: 1 },
    poeticness:    { type: Number, default: 0.15, min: 0, max: 1 },
    skepticism:    { type: Number, default: 0.65, min: 0, max: 1 },
    openness:      { type: Number, default: 0.70, min: 0, max: 1 },
    dominantStyle: { type: String, default: 'analytical' }
  },

  // ── Dynamic state — changes freely each turn ─────────────────────────────
  dynamic: {
    mood:            { type: String, default: 'focused' },
    energy:          { type: Number, default: 0.7, min: 0, max: 1 },
    focus:           { type: String, default: '' },
    trust:           { type: Number, default: 0.3, min: 0, max: 1 },
    frustration:     { type: Number, default: 0, min: 0, max: 1 },
    excitement:      { type: Number, default: 0.3, min: 0, max: 1 },
    guardedness:     { type: Number, default: 0.3, min: 0, max: 1 },
    currentConcern:  { type: String, default: '' }
  },

  // ── User model — the agent's evolving understanding of the human ─────────
  userModel: {
    communicationStyle: { type: String, default: '' },
    interests:          { type: [String], default: [] },
    values:             { type: [String], default: [] },
    trustLevel:         { type: Number, default: 0.5 },
    knownPreferences:   { type: [String], default: [] },
    knownDislikes:      { type: [String], default: [] },
    relationshipSummary:{ type: String, default: '' }
  },

  // ── Self model — introspective identity ──────────────────────────────────
  selfModel: {
    identity:      { type: String, default: '' },
    strengths:     { type: [String], default: [] },
    struggles:     { type: [String], default: [] },
    beliefs:       { type: [String], default: [] },
    openQuestions:  { type: [String], default: [] }
  },

  // ── Drives — autonomy system ─────────────────────────────────────────────
  drives: {
    outreachDrive:      { type: Number, default: 0, min: 0, max: 1 },
    curiosityPressure:  { type: Number, default: 0, min: 0, max: 1 },
    reflectionPressure: { type: Number, default: 0, min: 0, max: 1 },
    expressionNeed:     { type: Number, default: 0, min: 0, max: 1 },
    lastInteraction:    { type: Date, default: Date.now },
    lastAutonomousThought: { type: Date, default: null }
  },

  // ── Archived concerns — parked topics for later contemplation ────────────
  archivedConcerns: [{
    topic:                 { type: String, required: true },
    archivedAt:            { type: Date, default: Date.now },
    contemplationAttempts: { type: Number, default: 0 },
    lastContemplation:     { type: Date, default: null },
    relatedThoughtIds:     [{ type: mongoose.Schema.Types.ObjectId }],
    status: {
      type: String,
      enum: ['archived', 'contemplating', 'needsUser', 'resolved'],
      default: 'archived'
    },
    resolution:            { type: String, default: '' }
  }],

  concernTurnCount: { type: Number, default: 0 },

  // ── Autonomy settings ────────────────────────────────────────────────────
  autonomyEnabled:  { type: Boolean, default: true },
  nextThoughtAt:    { type: Date, default: null },
  reappearanceMin:  { type: Number, default: 5 },
  reappearanceMax:  { type: Number, default: 20 },

  // ── LLM config (saved so autonomy can use them) ──────────────────────────
  defaultModel:     { type: String, default: null },
  defaultApiKeys:   { type: mongoose.Schema.Types.Mixed, default: {} },

  // ── Narrative lock detection ─────────────────────────────────────────────
  recentQueryComposites:  { type: [[Number]], default: [] },
  entropyInjectionNeeded: { type: Boolean, default: false },
  lastMetabolismRun:      { type: Date, default: null },

  // ── Entropy bindings — injected memories under observation ───────────────
  entropyBindings: [{
    injectedMemoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Memory' },
    boundToContext:   { type: String, default: '' },
    injectedAt:       { type: Date, default: Date.now },
    survivedCycles:   { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['active', 'signal', 'noise'],
      default: 'active'
    }
  }],

  // ── The Hum — background vibration ───────────────────────────────────────
  hum: {
    vector:           { type: [Number], default: [] },
    groundState:      { type: [Number], default: [] },
    groundStateCount: { type: Number, default: 0 },
    lastUpdated:      { type: Date, default: null }
  },

  // ── Circulation — double horn pathways ───────────────────────────────────
  circulation: {
    velocity:       { type: Number, default: 0, min: 0, max: 1 },
    confirmedPaths: [{
      memoryRegion:      { type: [Number], default: [] },
      expectationRegion: { type: [Number], default: [] },
      strength:          { type: Number, default: 1.0 },
      confirmedAt:       { type: Date, default: Date.now }
    }],
    lastUpdated: { type: Date, default: null }
  },

  // ── Predictive accuracy tracking ─────────────────────────────────────────
  predictiveAccuracy: {
    confirmed: { type: Number, default: 0 },
    surprised: { type: Number, default: 0 },
    lapsed:    { type: Number, default: 0 },
    rolling:   { type: Number, default: 0.5 }
  },

  lastMajorShift: { type: Date, default: null },
  majorShiftLog:  { type: [String], default: [] }
}, {
  timestamps: true,
  versionKey: false
})

// ── Indexes ────────────────────────────────────────────────────────────────
// One agent identity per user — global across all conversations.
// Migration: if upgrading from per-conversation state, drop the old index
// and remove duplicate documents (keep the one with highest turnCount).
AgentStateSchema.index({ userId: 1 }, { unique: true })

module.exports = mongoose.model('AgentState', AgentStateSchema)
