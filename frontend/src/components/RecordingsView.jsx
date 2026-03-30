import { useState, useEffect } from 'react'
import { getRecordings, getRecording, getRecordingStats, deleteRecordings } from '../api/chat'

const CALLER_COLORS = {
  'chat': '#6c6cff',
  'chat-stream': '#6c6cff',
  'compare-vanilla': '#888',
  'compare-horn': '#ffaa44',
  'contemplation': '#cc44ff',
  'initiative': '#44cc88',
  'autonomy-reflection': '#4488ff',
  'autonomy-question': '#44aaaa',
  'autonomy-realization': '#ffaa44',
  'autonomy-feeling': '#cc44ff',
  'autonomy-exploration': '#4488ff',
  'autonomy-memory-review': '#aa8844',
  'autonomy-self-examination': '#ff6644',
  'autonomy-contemplation': '#cc8844',
  'autonomy-initiative': '#44cc88'
}

const PROVIDER_COLORS = {
  gemini: '#4488ff',
  moonshot: '#cc44ff',
  ollama: '#44cc88'
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

function formatMs(ms) {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatChars(n) {
  if (n < 1000) return `${n}`
  return `${(n / 1000).toFixed(1)}k`
}

function StatCard({ label, value, sub }) {
  return (
    <div className="rec-stat-card">
      <div className="rec-stat-value">{value}</div>
      <div className="rec-stat-label">{label}</div>
      {sub && <div className="rec-stat-sub">{sub}</div>}
    </div>
  )
}

function RecordingRow({ rec, onSelect, isSelected }) {
  const callerColor = CALLER_COLORS[rec.caller] || '#888'
  const providerColor = PROVIDER_COLORS[rec.provider] || '#888'
  const callerLabel = rec.caller.replace('autonomy-', '')

  return (
    <button
      type="button"
      className={`rec-row ${isSelected ? 'rec-row-selected' : ''} ${rec.error ? 'rec-row-error' : ''}`}
      onClick={() => onSelect(rec._id)}
    >
      <div className="rec-row-top">
        <div className="rec-row-tags">
          <span className="rec-tag" style={{ color: callerColor, borderColor: callerColor }}>{callerLabel}</span>
          <span className="rec-tag" style={{ color: providerColor, borderColor: providerColor }}>{rec.provider}</span>
          {rec.streaming && <span className="rec-tag rec-tag-stream">stream</span>}
          {rec.error && <span className="rec-tag rec-tag-err">error</span>}
        </div>
        <span className="rec-row-time">{formatTime(rec.timestamp)}</span>
      </div>
      <div className="rec-row-preview">
        {rec.prompt.slice(0, 120)}{rec.prompt.length > 120 ? '...' : ''}
      </div>
      <div className="rec-row-meta">
        <span>{rec.model}</span>
        <span>{formatMs(rec.latencyMs)}</span>
        <span>{formatChars(rec.responseLength)} chars</span>
      </div>
    </button>
  )
}

function RecordingDetail({ id, onClose }) {
  const [rec, setRec] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedSection, setExpandedSection] = useState(null)

  useEffect(() => {
    setLoading(true)
    getRecording(id).then(data => {
      if (data.ok) setRec(data.recording)
    }).finally(() => setLoading(false))
  }, [id])

  if (loading) return <div className="rec-detail-loading">Loading...</div>
  if (!rec) return <div className="rec-detail-loading">Recording not found</div>

  const sections = [
    { key: 'system', label: 'System Prompt', content: rec.systemPrompt, length: rec.systemLength, color: '#cc44ff' },
    { key: 'prompt', label: 'Prompt', content: rec.prompt, length: rec.promptLength, color: '#ffaa44' },
    { key: 'thinking', label: 'Thinking', content: rec.thinking, length: (rec.thinking || '').length, color: '#44aaaa' },
    { key: 'response', label: 'Response', content: rec.response, length: rec.responseLength, color: '#44cc88' },
  ].filter(s => s.content && s.content.trim())

  return (
    <div className="rec-detail">
      <div className="rec-detail-header">
        <div className="rec-detail-title-row">
          <span className="rec-detail-caller" style={{ color: CALLER_COLORS[rec.caller] || '#888' }}>
            {rec.caller}
          </span>
          <span className="rec-detail-provider" style={{ color: PROVIDER_COLORS[rec.provider] || '#888' }}>
            {rec.provider} / {rec.model}
          </span>
          <button type="button" className="rec-detail-close" onClick={onClose}>x</button>
        </div>
        <div className="rec-detail-meta">
          <span>{formatTime(rec.timestamp)}</span>
          <span>{formatMs(rec.latencyMs)}</span>
          <span>temp: {rec.temperature}</span>
          <span>{rec.streaming ? 'streaming' : 'non-streaming'}</span>
          <span>conv: {rec.conversationId}</span>
        </div>
        {rec.error && <div className="rec-detail-error">Error: {rec.error}</div>}
      </div>

      <div className="rec-detail-sections">
        {sections.map(s => (
          <div key={s.key} className="rec-detail-section">
            <button
              type="button"
              className="rec-detail-section-toggle"
              onClick={() => setExpandedSection(expandedSection === s.key ? null : s.key)}
            >
              <span className="rec-detail-section-dot" style={{ background: s.color }} />
              <span className="rec-detail-section-label">{s.label}</span>
              <span className="rec-detail-section-len">{formatChars(s.length)} chars</span>
              <span className="rec-detail-section-arrow">{expandedSection === s.key ? '-' : '+'}</span>
            </button>
            {expandedSection === s.key && (
              <pre className="rec-detail-section-content">{s.content}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function RecordingsView({ conversationId }) {
  const [recordings, setRecordings] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState(null)
  const [filterCaller, setFilterCaller] = useState('')
  const [filterProvider, setFilterProvider] = useState('')
  const [filterConv, setFilterConv] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [confirmClear, setConfirmClear] = useState(false)

  async function fetchRecordings(append = false) {
    setLoading(true)
    try {
      const params = { limit: 50 }
      if (filterCaller) params.caller = filterCaller
      if (filterProvider) params.provider = filterProvider
      if (filterConv) params.conversationId = filterConv
      if (append && recordings.length > 0) {
        params.before = recordings[recordings.length - 1].timestamp
      }

      const data = await getRecordings(params)
      if (data.ok) {
        setRecordings(prev => append ? [...prev, ...data.recordings] : data.recordings)
        setHasMore(data.hasMore)
        setTotal(data.total)
      }
    } catch (err) {
      // silent
    } finally {
      setLoading(false)
    }
  }

  async function fetchStats() {
    try {
      const data = await getRecordingStats()
      if (data.ok) setStats(data.stats)
    } catch (err) {
      // silent
    }
  }

  useEffect(() => {
    fetchRecordings()
    fetchStats()
  }, [filterCaller, filterProvider, filterConv])

  async function handleClear() {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    try {
      await deleteRecordings({ all: true })
      setRecordings([])
      setTotal(0)
      setSelectedId(null)
      setConfirmClear(false)
      fetchStats()
    } catch (err) {
      // silent
    }
  }

  const callerOptions = stats?.byCaller ? Object.keys(stats.byCaller).sort() : []
  const providerOptions = stats?.byProvider ? Object.keys(stats.byProvider).sort() : []

  return (
    <div className="rec-view">
      <div className="rec-list-panel">
        <div className="rec-header">
          <div className="rec-header-left">
            <span className="rec-title">Recordings</span>
            <span className="rec-count">{total} calls logged</span>
          </div>
          <div className="rec-header-right">
            <button
              type="button"
              className="rec-refresh-btn"
              onClick={() => { fetchRecordings(); fetchStats() }}
              disabled={loading}
            >
              Refresh
            </button>
            <button
              type="button"
              className={`rec-clear-btn ${confirmClear ? 'rec-clear-confirm' : ''}`}
              onClick={handleClear}
            >
              {confirmClear ? 'Confirm clear' : 'Clear all'}
            </button>
          </div>
        </div>

        {stats && (
          <div className="rec-stats-row">
            <StatCard label="Total" value={stats.total} />
            <StatCard label="Errors" value={stats.errors} />
            <StatCard label="Avg latency" value={formatMs(Math.round(stats.avgLatencyMs))} />
            <StatCard label="Total output" value={formatChars(stats.totalResponseChars)} sub="chars" />
          </div>
        )}

        <div className="rec-filters">
          <select
            className="rec-filter-select"
            value={filterCaller}
            onChange={e => { setFilterCaller(e.target.value); setSelectedId(null) }}
          >
            <option value="">All callers</option>
            {callerOptions.map(c => (
              <option key={c} value={c}>{c} ({stats.byCaller[c]})</option>
            ))}
          </select>
          <select
            className="rec-filter-select"
            value={filterProvider}
            onChange={e => { setFilterProvider(e.target.value); setSelectedId(null) }}
          >
            <option value="">All providers</option>
            {providerOptions.map(p => (
              <option key={p} value={p}>{p} ({stats.byProvider[p].count})</option>
            ))}
          </select>
          <input
            type="text"
            className="rec-filter-input"
            placeholder="Filter by conversation ID..."
            value={filterConv}
            onChange={e => { setFilterConv(e.target.value); setSelectedId(null) }}
          />
        </div>

        <div className="rec-list">
          {loading && recordings.length === 0 ? (
            <div className="rec-empty">Loading recordings...</div>
          ) : recordings.length === 0 ? (
            <div className="rec-empty">
              <p>No recordings yet.</p>
              <p className="rec-empty-sub">API calls will appear here as the AI thinks, chats, and reflects.</p>
            </div>
          ) : (
            <>
              {recordings.map(rec => (
                <RecordingRow
                  key={rec._id}
                  rec={rec}
                  onSelect={setSelectedId}
                  isSelected={selectedId === rec._id}
                />
              ))}
              {hasMore && (
                <button
                  type="button"
                  className="rec-load-more"
                  onClick={() => fetchRecordings(true)}
                  disabled={loading}
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="rec-detail-panel">
        {selectedId ? (
          <RecordingDetail id={selectedId} onClose={() => setSelectedId(null)} />
        ) : (
          <div className="rec-detail-empty">
            <p>Select a recording to inspect</p>
            <p className="rec-detail-empty-sub">
              Every API call is recorded: the system prompt, the user prompt, the AI's response, thinking tokens, latency, and which part of the system triggered it.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default RecordingsView
