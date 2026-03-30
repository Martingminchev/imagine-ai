const express = require('express')
const path = require('path')
const cors = require('cors')
require('dotenv').config()

const { connectToDB } = require('./lib/db')
const apiRoutes = require('./routes/api')

const app = express()
const port = process.env.PORT || 4447

// ── Middleware ────────────────────────────────────────────────

app.use(cors())
app.use(express.json({ limit: '2mb' }))

// ── API Routes ───────────────────────────────────────────────

app.use('/api', apiRoutes)

// ── Serve frontend (production) ──────────────────────────────

const uiDist = path.join(__dirname, 'ui', 'dist')
app.use(express.static(uiDist))
app.get('*', (req, res) => {
  res.sendFile(path.join(uiDist, 'index.html'))
})

// ── Start ────────────────────────────────────────────────────

const server = app.listen(port, async () => {
  console.log('')
  console.log('  ╔══════════════════════════════════════════╗')
  console.log('  ║          ORCHESTRATOR v2.0               ║')
  console.log('  ║   Local AI Assistant with Living Memory  ║')
  console.log('  ╚══════════════════════════════════════════╝')
  console.log('')
  console.log(`  → Server:    http://localhost:${port}`)
  console.log(`  → LLM:       ${process.env.LLM_PROVIDER || 'ollama'} / ${process.env.OLLAMA_MODEL || 'default'}`)
  console.log(`  → Embedding: ${process.env.EMBED_PROVIDER || 'ollama'} / ${process.env.EMBED_MODEL || 'nomic-embed-text'}`)
  console.log('')

  // Connect to MongoDB
  await connectToDB()

  // One-time migration: consolidate per-conversation AgentState into global per-user
  try {
    const AgentState = require('./models/AgentState')
    const col = AgentState.collection
    const indexes = await col.indexes()
    const oldIdx = indexes.find(i => i.key?.conversationId === 1 && i.key?.userId === 1)
    if (oldIdx) {
      // Deduplicate: keep the document with the highest turnCount per user
      const pipeline = [
        { $sort: { turnCount: -1 } },
        { $group: { _id: '$userId', keepId: { $first: '$_id' } } }
      ]
      const keeps = await col.aggregate(pipeline).toArray()
      const keepIds = keeps.map(k => k.keepId)
      if (keepIds.length > 0) {
        await col.deleteMany({ _id: { $nin: keepIds } })
      }
      await col.dropIndex(oldIdx.name)
      console.log('  → Migration: consolidated AgentState to global-per-user')
    }
  } catch (err) {
    // Non-critical — index may already be correct
    if (!err.message.includes('index not found')) {
      console.log('  → Migration: AgentState already global (or first run)')
    }
  }

  // Start the autonomy loop (autonomous thoughts between interactions)
  try {
    const { startAutonomyLoop } = require('./lib/autonomy')
    startAutonomyLoop()
    console.log('  → Autonomy:  active (polling every 30s)')
  } catch (err) {
    console.error('  → Autonomy:  failed to start —', err.message)
  }

  // Start the meta-orchestrator (cross-project learning)
  try {
    const { startMetaLoop } = require('./lib/metaOrchestrator')
    startMetaLoop()
    const interval = Math.round(parseInt(process.env.META_TICK_INTERVAL || '300000', 10) / 1000)
    console.log(`  → Meta:      active (cross-project learning every ${interval}s)`)
  } catch (err) {
    console.error('  → Meta:      failed to start —', err.message)
  }

  console.log('')
})

// ── Graceful shutdown ────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n${signal} received — shutting down...`)

  // Stop background loops
  try {
    const { stopAutonomyLoop } = require('./lib/autonomy')
    stopAutonomyLoop()
    console.log('  → Autonomy loop stopped')
  } catch (e) { /* not started */ }

  try {
    const { stopMetaLoop } = require('./lib/metaOrchestrator')
    stopMetaLoop()
  } catch (e) { /* not started */ }

  const mongoose = require('mongoose')
  server.close(() => {
    mongoose.connection.close(false).then(() => {
      console.log('Goodbye.')
      process.exit(0)
    })
  })

  // Force exit after 10s
  setTimeout(() => process.exit(1), 10000)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
