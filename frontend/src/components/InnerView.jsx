import { useState, useEffect, useRef } from 'react'
import { getThoughts, createSSEConnection, triggerThought, archiveConcern, contemplateArchived } from '../api/chat'

const TYPE_LABELS = {
  reflection: 'Reflection',
  question: 'Question',
  realization: 'Realization',
  feeling: 'Feeling',
  initiative: 'Reaching out',
  exploration: 'Exploring',
  'memory-review': 'Revisiting',
  'self-examination': 'Self-examination',
  'archived-contemplation': 'Contemplating'
}

const TYPE_COLORS = {
  reflection: '#6c6cff',
  question: '#44aaaa',
  realization: '#ffaa44',
  feeling: '#cc44ff',
  initiative: '#44cc88',
  exploration: '#4488ff',
  'memory-review': '#aa8844',
  'self-examination': '#ff6644',
  'archived-contemplation': '#cc8844'
}

const STEP_LABELS = {
  encode: 'Encode',
  resonate: 'Resonate',
  measure: 'Measure',
  continuity: 'Continuity',
  compose: 'Compose',
  generate: 'Generate',
  remember: 'Remember',
  reflect: 'Reflect',
  evolve: 'Evolve',
  done: 'Done'
}

function formatTime(ts) {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now - d
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMs / 3600000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

function DriveBar({ label, value, color }) {
  return (
    <div className="inner-drive">
      <div className="inner-drive-label">{label}</div>
      <div className="inner-drive-bar-bg">
        <div
          className="inner-drive-bar-fill"
          style={{ width: `${(value * 100).toFixed(0)}%`, background: color }}
        />
      </div>
      <div className="inner-drive-val">{(value * 100).toFixed(0)}%</div>
    </div>
  )
}

function ThoughtCard({ thought, onArchive }) {
  const color = TYPE_COLORS[thought.type] || '#6c6cff'
  const label = TYPE_LABELS[thought.type] || thought.type
  const [archiving, setArchiving] = useState(false)
  const [archived, setArchived] = useState(false)

  const canArchive = onArchive && !thought.streaming && !archived &&
    thought.type !== 'archived-contemplation' && thought.type !== 'initiative'

  async function handleArchive() {
    if (archiving || archived) return
    setArchiving(true)
    try {
      // Use the thought content as the topic (first 200 chars)
      await onArchive(thought.content.slice(0, 200), thought.id || thought._id)
      setArchived(true)
    } catch (err) {
      // silent
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className={`inner-thought ${thought.type === 'initiative' ? 'inner-thought-initiative' : ''} ${thought.streaming ? 'inner-thought-streaming' : ''}`}>
      <div className="inner-thought-header">
        <span className="inner-thought-type" style={{ color }}>
          {label}
        </span>
        <span className="inner-thought-time">
          {thought.streaming ? 'generating...' : formatTime(thought.timestamp)}
        </span>
      </div>
      <div className="inner-thought-content">
        {thought.content}
        {thought.streaming && <span className="message-cursor" />}
      </div>
      <div className="inner-thought-footer">
        {thought.intensity > 0.6 && !thought.streaming && (
          <span className="inner-thought-intensity" style={{ color }}>
            intensity: {(thought.intensity * 100).toFixed(0)}%
          </span>
        )}
        {canArchive && (
          <button
            type="button"
            className="inner-archive-btn"
            onClick={handleArchive}
            disabled={archiving}
            title="Archive this topic — let the AI contemplate it later"
          >
            {archiving ? 'Archiving...' : archived ? 'Archived' : 'Get over it'}
          </button>
        )}
      </div>
    </div>
  )
}

function PipelineCard({ step }) {
  return (
    <div className={`inner-pipeline-card ${step.step === 'done' ? 'inner-pipeline-done' : ''}`}>
      <div className="inner-pipeline-header">
        <span className="inner-pipeline-step">{STEP_LABELS[step.step] || step.step}</span>
        <span className="inner-pipeline-time">{formatTime(step.timestamp)}</span>
      </div>
      <div className="inner-pipeline-detail">{step.detail}</div>
    </div>
  )
}

function ThinkingCard({ text, timestamp }) {
  const [expanded, setExpanded] = useState(false)
  const preview = text.length > 120 ? text.slice(0, 120) + '...' : text

  return (
    <div className="inner-thinking-card">
      <div className="inner-thinking-header">
        <span className="inner-thinking-label">Model thinking</span>
        <span className="inner-pipeline-time">{formatTime(timestamp)}</span>
      </div>
      <div className="inner-thinking-content">
        {expanded ? text : preview}
      </div>
      {text.length > 120 && (
        <button
          type="button"
          className="inner-thinking-expand"
          onClick={() => setExpanded(p => !p)}
        >
          {expanded ? 'collapse' : 'expand'}
        </button>
      )}
    </div>
  )
}

function formatCountdown(nextThoughtAt) {
  if (!nextThoughtAt) return null
  const diff = new Date(nextThoughtAt).getTime() - Date.now()
  if (diff <= 0) return 'due now'
  const mins = Math.floor(diff / 60000)
  const secs = Math.floor((diff % 60000) / 1000)
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60)
    const remainMins = mins % 60
    return `${hrs}h ${remainMins}m`
  }
  if (mins > 0) return `${mins}m ${secs}s`
  return `${secs}s`
}

function InnerView({ conversationId = 'default', apiKeys = {}, selectedModel = '' }) {
  const [thoughts, setThoughts] = useState([])
  const [drives, setDrives] = useState(null)
  const [mood, setMood] = useState(null)
  const [currentConcern, setCurrentConcern] = useState('')
  const [isStuck, setIsStuck] = useState(false)
  const [archivedConcerns, setArchivedConcerns] = useState([])
  const [nextThoughtAt, setNextThoughtAt] = useState(null)
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)
  const [pipelineEvents, setPipelineEvents] = useState([])
  const [thinkingChunks, setThinkingChunks] = useState([])
  const [streamingThought, setStreamingThought] = useState(null)
  const [triggering, setTriggering] = useState(false)
  const [archivingConcern, setArchivingConcern] = useState(false)
  const [contemplatingId, setContemplatingId] = useState(null)
  const [countdownText, setCountdownText] = useState(null)
  const scrollRef = useRef(null)
  const sseRef = useRef(null)

  const apiOpts = {
    model: selectedModel || undefined,
    geminiApiKey: apiKeys.gemini || undefined,
    moonshotApiKey: apiKeys.moonshot || undefined
  }

  async function handleTriggerThought() {
    if (triggering) return
    setTriggering(true)
    try {
      await triggerThought(conversationId, apiOpts)
    } catch (err) {
      // silent
    } finally {
      setTriggering(false)
    }
  }

  async function handleArchiveTopic(topic, thoughtId) {
    try {
      const data = await archiveConcern(conversationId, topic, thoughtId)
      if (data.ok && data.concern) {
        setArchivedConcerns(prev => {
          const exists = prev.find(c => c.id === data.concern.id)
          if (exists) return prev.map(c => c.id === data.concern.id ? data.concern : c)
          return [...prev, data.concern]
        })
        // Clear current concern if it was archived
        setCurrentConcern('')
        setIsStuck(false)
      }
    } catch (err) {
      // silent
    }
  }

  async function handleArchiveCurrentConcern() {
    if (!currentConcern || archivingConcern) return
    setArchivingConcern(true)
    try {
      await handleArchiveTopic(currentConcern)
    } finally {
      setArchivingConcern(false)
    }
  }

  async function handleContemplate(concernId) {
    if (contemplatingId) return
    setContemplatingId(concernId)
    try {
      await contemplateArchived(conversationId, concernId, apiOpts)
      // Refresh data after contemplation
      await fetchThoughts()
    } catch (err) {
      // silent
    } finally {
      setContemplatingId(null)
    }
  }

  async function fetchThoughts() {
    try {
      const data = await getThoughts(conversationId)
      if (data.ok) {
        setThoughts(data.thoughts || [])
        setDrives(data.drives || null)
        setMood(data.mood || null)
        setCurrentConcern(data.currentConcern || '')
        setIsStuck(data.isStuck || false)
        setArchivedConcerns(data.archivedConcerns || [])
        setNextThoughtAt(data.nextThoughtAt || null)
      }
    } catch (err) {
      // silent
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchThoughts()

    const sse = createSSEConnection(conversationId)
    sseRef.current = sse

    sse.addEventListener('connected', () => {
      setConnected(true)
    })

    sse.addEventListener('thought', (e) => {
      try {
        const thought = JSON.parse(e.data)
        setStreamingThought(null)
        setThoughts(prev => [...prev, thought])
      } catch (err) {
        // ignore
      }
    })

    sse.addEventListener('initiative', (e) => {
      // Already in thought stream
    })

    // Pipeline step events from chat processing
    sse.addEventListener('pipeline', (e) => {
      try {
        const step = JSON.parse(e.data)
        step.timestamp = new Date().toISOString()
        if (step.step === 'done') {
          // Clear pipeline events after a short delay
          setPipelineEvents(prev => [...prev, step])
          setTimeout(() => setPipelineEvents([]), 5000)
        } else {
          setPipelineEvents(prev => [...prev, step])
        }
      } catch (err) { /* ignore */ }
    })

    // Thinking tokens from LLM during chat
    sse.addEventListener('pipeline-thinking', (e) => {
      try {
        const { text } = JSON.parse(e.data)
        setThinkingChunks(prev => {
          const last = prev[prev.length - 1]
          if (last && (Date.now() - new Date(last.timestamp).getTime()) < 30000) {
            // Append to current thinking block
            return [...prev.slice(0, -1), { ...last, text: last.text + text }]
          }
          // New thinking block
          return [...prev, { text, timestamp: new Date().toISOString() }]
        })
      } catch (err) { /* ignore */ }
    })

    // Streaming thought events
    sse.addEventListener('thought-start', (e) => {
      try {
        const data = JSON.parse(e.data)
        setStreamingThought({
          type: data.type,
          trigger: data.trigger,
          intensity: data.intensity,
          content: '',
          streaming: true,
          timestamp: new Date().toISOString()
        })
      } catch (err) { /* ignore */ }
    })

    sse.addEventListener('thought-chunk', (e) => {
      try {
        const { text } = JSON.parse(e.data)
        setStreamingThought(prev => prev ? { ...prev, content: prev.content + text } : null)
      } catch (err) { /* ignore */ }
    })

    sse.addEventListener('thought-complete', (e) => {
      try {
        const thought = JSON.parse(e.data)
        setStreamingThought(null)
        setThoughts(prev => [...prev, thought])
      } catch (err) { /* ignore */ }
    })

    sse.addEventListener('next-thought', (e) => {
      try {
        const { nextThoughtAt: nta } = JSON.parse(e.data)
        setNextThoughtAt(nta)
      } catch (err) { /* ignore */ }
    })

    sse.onerror = () => {
      setConnected(false)
    }

    return () => {
      sse.close()
      sseRef.current = null
    }
  }, [conversationId])

  // Countdown timer for next thought
  useEffect(() => {
    if (!nextThoughtAt) {
      setCountdownText(null)
      return
    }
    const update = () => setCountdownText(formatCountdown(nextThoughtAt))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [nextThoughtAt])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [thoughts, pipelineEvents, thinkingChunks, streamingThought])

  // Interleave timeline: thoughts + pipeline events + thinking
  const allItems = []

  for (const t of thoughts) {
    allItems.push({ type: 'thought', data: t, ts: new Date(t.timestamp).getTime() })
  }
  for (const p of pipelineEvents) {
    allItems.push({ type: 'pipeline', data: p, ts: new Date(p.timestamp).getTime() })
  }
  for (const tk of thinkingChunks) {
    allItems.push({ type: 'thinking', data: tk, ts: new Date(tk.timestamp).getTime() })
  }

  allItems.sort((a, b) => a.ts - b.ts)

  return (
    <div className="inner-view">
      <div className="inner-main" ref={scrollRef}>
        <div className="inner-stream-header">
          <span className="inner-stream-title">Inner World</span>
          <div className="inner-stream-header-right">
            <button
              type="button"
              className="inner-trigger-btn"
              onClick={handleTriggerThought}
              disabled={triggering || !!streamingThought}
              title="Trigger an inner thought now"
            >
              {triggering ? 'Thinking...' : 'Trigger thought'}
            </button>
            <span className={`inner-stream-status ${connected ? 'inner-connected' : ''}`}>
              {connected ? 'live' : 'connecting...'}
            </span>
          </div>
        </div>

        {loading && thoughts.length === 0 ? (
          <div className="inner-empty">Listening for thoughts...</div>
        ) : allItems.length === 0 && !streamingThought ? (
          <div className="inner-empty">
            <p>No autonomous thoughts yet.</p>
            <p className="inner-empty-sub">
              The mind is gathering itself. Thoughts will appear here as it reflects,
              explores, and reaches out on its own.
            </p>
          </div>
        ) : (
          <div className="inner-stream">
            {allItems.map((item, i) => {
              if (item.type === 'thought') {
                return <ThoughtCard key={item.data.id || item.data._id || `t-${i}`} thought={item.data} onArchive={handleArchiveTopic} />
              }
              if (item.type === 'pipeline') {
                return <PipelineCard key={`p-${i}`} step={item.data} />
              }
              if (item.type === 'thinking') {
                return <ThinkingCard key={`tk-${i}`} text={item.data.text} timestamp={item.data.timestamp} />
              }
              return null
            })}
            {streamingThought && (
              <ThoughtCard thought={streamingThought} />
            )}
          </div>
        )}
      </div>

      <div className="inner-sidebar">
        <div className="inner-sidebar-section">
          <div className="inner-sidebar-title">Drives</div>
          {drives ? (
            <>
              <DriveBar label="Connection" value={drives.connectionHunger || 0} color="#44cc88" />
              <DriveBar label="Curiosity" value={drives.curiosityPressure || 0} color="#4488ff" />
              <DriveBar label="Reflection" value={drives.reflectionPressure || 0} color="#6c6cff" />
              <DriveBar label="Expression" value={drives.expressionNeed || 0} color="#cc44ff" />
              <DriveBar label="World" value={drives.worldCuriosity || 0} color="#ffaa44" />
            </>
          ) : (
            <div className="inner-sidebar-empty">No drives yet</div>
          )}
        </div>

        {countdownText && (
          <div className="inner-sidebar-section">
            <div className="inner-sidebar-title">Next Thought</div>
            <div className="inner-next-thought">{countdownText}</div>
          </div>
        )}

        {mood && (
          <div className="inner-sidebar-section">
            <div className="inner-sidebar-title">Current Mood</div>
            <div className="inner-mood">{mood}</div>
          </div>
        )}

        {currentConcern && (
          <div className="inner-sidebar-section">
            <div className="inner-sidebar-title">
              Current Concern {isStuck && <span className="inner-stuck-badge">stuck</span>}
            </div>
            <div className="inner-concern-text">{currentConcern}</div>
            <button
              type="button"
              className="inner-archive-btn inner-archive-btn-sidebar"
              onClick={handleArchiveCurrentConcern}
              disabled={archivingConcern}
            >
              {archivingConcern ? 'Archiving...' : 'Get over it'}
            </button>
          </div>
        )}

        {archivedConcerns.length > 0 && (
          <div className="inner-sidebar-section">
            <div className="inner-sidebar-title">Archived Concerns</div>
            {archivedConcerns.filter(c => c.status !== 'resolved').map(c => (
              <div key={c.id} className="inner-archived-concern">
                <div className="inner-archived-topic">{c.topic.slice(0, 80)}{c.topic.length > 80 ? '...' : ''}</div>
                <div className="inner-archived-meta">
                  <span className={`inner-archived-status inner-archived-status-${c.status}`}>{c.status}</span>
                  <span className="inner-archived-attempts">{c.contemplationAttempts}x</span>
                </div>
                {(c.status === 'archived' || c.status === 'contemplating') && (
                  <button
                    type="button"
                    className="inner-contemplate-btn"
                    onClick={() => handleContemplate(c.id)}
                    disabled={contemplatingId === c.id}
                  >
                    {contemplatingId === c.id ? 'Thinking...' : 'Contemplate'}
                  </button>
                )}
                {c.status === 'needsUser' && (
                  <div className="inner-archived-needs-user">Needs your input</div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="inner-sidebar-section">
          <div className="inner-sidebar-title">Legend</div>
          {Object.entries(TYPE_LABELS).map(([key, label]) => (
            <div key={key} className="inner-legend-row">
              <span className="inner-legend-dot" style={{ background: TYPE_COLORS[key] }} />
              <span>{label}</span>
            </div>
          ))}
          <div className="inner-legend-row">
            <span className="inner-legend-dot" style={{ background: '#888' }} />
            <span>Pipeline step</span>
          </div>
          <div className="inner-legend-row">
            <span className="inner-legend-dot" style={{ background: '#44aaaa' }} />
            <span>Model thinking</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default InnerView
