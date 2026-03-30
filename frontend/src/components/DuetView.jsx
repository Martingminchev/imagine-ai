import { useState, useRef, useEffect } from 'react'
import { sendMessage } from '../api/chat'

const MODEL_OPTIONS = [
  { value: '', label: 'Ollama (default)' },
  { value: 'gemini:gemini-3-pro-preview', label: 'Gemini 3 Pro' },
  { value: 'gemini:gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'gemini:gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini:gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini:gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
  { value: 'moonshot:kimi-k2.5', label: 'Kimi K2.5' }
]

function makeSessionId() {
  return `duet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function DuetView({ apiKeys, memorySettings }) {
  const [sessionId, setSessionId] = useState(() => makeSessionId())
  const [log, setLog] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [modelA, setModelA] = useState('')
  const [modelB, setModelB] = useState('gemini:gemini-2.5-flash')
  const [nextSpeaker, setNextSpeaker] = useState('A') // who speaks next: 'A' or 'B'
  const scrollRef = useRef(null)

  const conversationIdA = `${sessionId}-A`
  const conversationIdB = `${sessionId}-B`

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log, loading])

  function resetSession() {
    setSessionId(makeSessionId())
    setLog([])
    setNextSpeaker('A')
  }

  async function stepTurn() {
    if (loading) return

    const target = nextSpeaker
    const other = target === 'A' ? 'B' : 'A'

    const lastOther = [...log].reverse().find(
      m => m.speaker === other || m.speaker === 'user'
    )

    if (!lastOther) {
      // No message for the duet to respond to yet
      return
    }

    const prompt = lastOther.text
    const conversationId = target === 'A' ? conversationIdA : conversationIdB
    const model = target === 'A' ? modelA : modelB

    const opts = {
      model: model || undefined,
      geminiApiKey: apiKeys.gemini || undefined,
      moonshotApiKey: apiKeys.moonshot || undefined,
      memorySettings
    }

    setLoading(true)
    try {
      const data = await sendMessage(prompt, conversationId, opts)
      if (!data.ok) {
        setLog(prev => [
          ...prev,
          {
            speaker: target,
            text: data.message || 'Error from model',
            timestamp: new Date().toISOString(),
            error: true
          }
        ])
      } else {
        setLog(prev => [
          ...prev,
          {
            speaker: target,
            text: data.response,
            timestamp: new Date().toISOString()
          }
        ])
      }
      setNextSpeaker(other)
    } catch (err) {
      setLog(prev => [
        ...prev,
        {
          speaker: target,
          text: err.response?.data?.message || err.message || 'Failed to connect',
          timestamp: new Date().toISOString(),
          error: true
        }
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading) return

    const userMsg = {
      speaker: 'user',
      text: trimmed,
      timestamp: new Date().toISOString()
    }
    setLog(prev => [...prev, userMsg])
    setInput('')

    // Let the next speaker respond to the user
    await stepTurn()
  }

  return (
    <div className="duet">
      <div className="duet-header">
        <div className="duet-models">
          <div className="duet-model">
            <span className="duet-model-label">Model A</span>
            <select
              className="model-select"
              value={modelA}
              onChange={e => setModelA(e.target.value)}
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="duet-model">
            <span className="duet-model-label">Model B</span>
            <select
              className="model-select"
              value={modelB}
              onChange={e => setModelB(e.target.value)}
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="duet-controls">
          <span className="duet-next">
            Next: <strong>{nextSpeaker === 'A' ? 'Model A' : 'Model B'}</strong>
          </span>
          <button
            type="button"
            className="api-keys-btn"
            onClick={stepTurn}
            disabled={loading}
          >
            Next turn
          </button>
          <button
            type="button"
            className="api-keys-btn"
            onClick={resetSession}
            disabled={loading}
          >
            New duet
          </button>
        </div>
      </div>

      <div className="duet-log">
        {log.length === 0 && !loading && (
          <div className="duet-empty">
            Start with a message, then let Model A and B respond in turn.
          </div>
        )}
        {log.map((entry, idx) => (
          <div
            key={idx}
            className={
              'duet-message ' +
              (entry.speaker === 'user'
                ? 'duet-user'
                : entry.speaker === 'A'
                ? 'duet-a'
                : 'duet-b')
            }
          >
            <div className="duet-message-label">
              {entry.speaker === 'user'
                ? 'You'
                : entry.speaker === 'A'
                ? 'Model A'
                : 'Model B'}
            </div>
            <div className={'duet-message-bubble' + (entry.error ? ' duet-message-error' : '')}>
              {entry.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="duet-message duet-loading">
            <div className="duet-message-bubble">
              <div className="message-loading">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={scrollRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          type="text"
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Interrupt the duet with your own message..."
          disabled={loading}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={!input.trim() || loading}
        >
          Send
        </button>
      </form>
    </div>
  )
}

export default DuetView

