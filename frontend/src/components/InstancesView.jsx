import { useState, useEffect } from 'react'
import {
  getConversations,
  patchConversation,
  deleteConversation,
  getAutonomyStatus,
  pauseAutonomy,
  resumeAutonomy
} from '../api/chat'

function formatTime(ts) {
  if (!ts) return '—'
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays < 7) return `${diffDays}d ago`

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function parseConversationLabel(id) {
  if (id.startsWith('duet-')) {
    const suffix = id.endsWith('-A') ? 'A' : id.endsWith('-B') ? 'B' : ''
    const session = id.replace(/-[AB]$/, '').replace('duet-', '')
    return { label: `Duet ${session.slice(0, 8)}`, suffix, isDuet: true }
  }
  if (id === 'default') return { label: 'Default', suffix: '', isDuet: false }
  const short = id.replace(/^c-/, '').slice(0, 10)
  return { label: `Chat ${short}`, suffix: '', isDuet: false }
}

function InstanceRow({ conv, onToggle, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [toggling, setToggling] = useState(false)
  const parsed = parseConversationLabel(conv.conversationId)

  async function handleToggle() {
    setToggling(true)
    try {
      await onToggle(conv.conversationId, !conv.autonomyEnabled)
    } finally {
      setToggling(false)
    }
  }

  function handleDelete() {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 3000)
      return
    }
    onDelete(conv.conversationId)
  }

  return (
    <div className="inst-row">
      <div className="inst-info">
        <div className="inst-name">
          <span className={`inst-badge ${parsed.isDuet ? 'inst-badge-duet' : 'inst-badge-chat'}`}>
            {conv.type}
          </span>
          <span className="inst-label">{parsed.label}</span>
          {parsed.suffix && <span className="inst-suffix">{parsed.suffix}</span>}
        </div>
        <div className="inst-meta">
          <span>{conv.memoryCount} memories</span>
          <span>{conv.turnCount} turns</span>
          <span>{formatTime(conv.lastActivity)}</span>
        </div>
      </div>
      <div className="inst-actions">
        <button
          type="button"
          className={`inst-toggle ${conv.autonomyEnabled ? 'inst-toggle-on' : 'inst-toggle-off'}`}
          onClick={handleToggle}
          disabled={toggling}
          title={conv.autonomyEnabled ? 'Autonomy on — click to disable' : 'Autonomy off — click to enable'}
        >
          {conv.autonomyEnabled ? 'Auto: ON' : 'Auto: OFF'}
        </button>
        <button
          type="button"
          className={`inst-delete ${confirming ? 'inst-delete-confirm' : ''}`}
          onClick={handleDelete}
        >
          {confirming ? 'Confirm?' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

function InstancesView({ onDelete }) {
  const [conversations, setConversations] = useState([])
  const [loading, setLoading] = useState(true)
  const [autonomyRunning, setAutonomyRunning] = useState(true)
  const [togglingGlobal, setTogglingGlobal] = useState(false)

  async function fetchData() {
    try {
      const [convData, statusData] = await Promise.all([
        getConversations(),
        getAutonomyStatus()
      ])
      if (convData.ok) setConversations(convData.conversations)
      if (statusData.ok) setAutonomyRunning(statusData.running)
    } catch (err) {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  async function handleGlobalToggle() {
    setTogglingGlobal(true)
    try {
      if (autonomyRunning) {
        const data = await pauseAutonomy()
        if (data.ok) setAutonomyRunning(false)
      } else {
        const data = await resumeAutonomy()
        if (data.ok) setAutonomyRunning(true)
      }
    } catch (err) {
      // silent
    } finally {
      setTogglingGlobal(false)
    }
  }

  async function handleToggle(conversationId, enabled) {
    try {
      const data = await patchConversation(conversationId, { autonomyEnabled: enabled })
      if (data.ok) {
        setConversations(prev =>
          prev.map(c =>
            c.conversationId === conversationId
              ? { ...c, autonomyEnabled: enabled }
              : c
          )
        )
      }
    } catch (err) {
      // silent
    }
  }

  async function handleDelete(conversationId) {
    try {
      const data = await deleteConversation(conversationId)
      if (data.ok) {
        setConversations(prev => prev.filter(c => c.conversationId !== conversationId))
        if (onDelete) onDelete(conversationId)
      }
    } catch (err) {
      // silent
    }
  }

  // Group duet pairs by session prefix
  const grouped = []
  const duetSessions = new Map()

  for (const conv of conversations) {
    if (conv.type === 'duet') {
      const prefix = conv.conversationId.replace(/-[AB]$/, '')
      if (!duetSessions.has(prefix)) duetSessions.set(prefix, [])
      duetSessions.get(prefix).push(conv)
    } else {
      grouped.push({ type: 'single', conv })
    }
  }

  for (const [prefix, members] of duetSessions) {
    grouped.push({ type: 'duet-group', prefix, members })
  }

  // Sort: most recent first
  grouped.sort((a, b) => {
    const lastA = a.type === 'single'
      ? (a.conv.lastActivity ? new Date(a.conv.lastActivity).getTime() : 0)
      : Math.max(...a.members.map(m => m.lastActivity ? new Date(m.lastActivity).getTime() : 0))
    const lastB = b.type === 'single'
      ? (b.conv.lastActivity ? new Date(b.conv.lastActivity).getTime() : 0)
      : Math.max(...b.members.map(m => m.lastActivity ? new Date(m.lastActivity).getTime() : 0))
    return lastB - lastA
  })

  return (
    <div className="instances-view">
      <div className="inst-header">
        <div className="inst-header-left">
          <span className="inst-title">Instances</span>
          <span className="inst-count">{conversations.length} total</span>
        </div>
        <div className="inst-header-right">
          <button
            type="button"
            className={`inst-global-toggle ${autonomyRunning ? 'inst-global-on' : 'inst-global-off'}`}
            onClick={handleGlobalToggle}
            disabled={togglingGlobal}
          >
            {autonomyRunning ? 'Autonomy: Running' : 'Autonomy: Paused'}
          </button>
          <button
            type="button"
            className="inst-refresh"
            onClick={() => { setLoading(true); fetchData() }}
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="inst-list">
        {loading && conversations.length === 0 && (
          <div className="inst-empty">Loading instances...</div>
        )}
        {!loading && conversations.length === 0 && (
          <div className="inst-empty">No instances found. Start a conversation to create one.</div>
        )}
        {grouped.map((item, idx) => {
          if (item.type === 'single') {
            return (
              <InstanceRow
                key={item.conv.conversationId}
                conv={item.conv}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            )
          }
          // Duet group
          return (
            <div key={item.prefix} className="inst-duet-group">
              <div className="inst-duet-group-header">
                <span className="inst-badge inst-badge-duet">duet session</span>
                <span className="inst-duet-session-id">{item.prefix.replace('duet-', '').slice(0, 10)}</span>
                <button
                  type="button"
                  className="inst-delete inst-delete-small"
                  onClick={() => {
                    for (const m of item.members) handleDelete(m.conversationId)
                  }}
                >
                  Delete session
                </button>
              </div>
              {item.members.map(m => (
                <InstanceRow
                  key={m.conversationId}
                  conv={m}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default InstancesView
