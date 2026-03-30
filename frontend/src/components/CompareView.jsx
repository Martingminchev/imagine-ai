import { useState, useRef, useEffect } from 'react'
import SystemPrompt from './SystemPrompt'

function CompareView({ pairs, onSend, loading }) {
  const [input, setInput] = useState('')
  const scrollRefLeft = useRef(null)
  const scrollRefRight = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    scrollRefLeft.current?.scrollIntoView({ behavior: 'smooth' })
    scrollRefRight.current?.scrollIntoView({ behavior: 'smooth' })
  }, [pairs])

  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSend(trimmed)
    setInput('')
  }

  const lastPair = pairs.length > 0 ? pairs[pairs.length - 1] : null

  return (
    <div className="compare">
      <div className="compare-panels">
        {/* ── LEFT: Vanilla ────────────────────────── */}
        <div className="compare-panel">
          <div className="compare-panel-header">
            <span className="compare-panel-title">Generic Model</span>
            <span className="compare-panel-tag vanilla-tag">no memory</span>
          </div>
          <SystemPrompt
            prompt={lastPair?.vanillaPrompt || 'You are a helpful assistant.'}
            label="System Prompt"
          />
          <div className="compare-messages">
            {pairs.length === 0 && !loading && (
              <div className="compare-empty">Send a message to compare</div>
            )}
            {pairs.map((pair, i) => (
              <div key={i} className="compare-pair">
                <div className="compare-msg compare-msg-user">
                  <div className="compare-msg-bubble user-bubble">{pair.userMessage}</div>
                </div>
                <div className="compare-msg compare-msg-ai">
                  <div className="compare-msg-bubble vanilla-bubble">{pair.vanillaResponse}</div>
                </div>
              </div>
            ))}
            {loading && (
              <div className="compare-msg compare-msg-ai">
                <div className="compare-msg-bubble vanilla-bubble">
                  <div className="message-loading"><span></span><span></span><span></span></div>
                </div>
              </div>
            )}
            <div ref={scrollRefLeft} />
          </div>
        </div>

        {/* ── RIGHT: Horn AI ───────────────────────── */}
        <div className="compare-panel">
          <div className="compare-panel-header">
            <span className="compare-panel-title">Horn AI</span>
            <span className="compare-panel-tag horn-tag">resonant memory</span>
          </div>
          <SystemPrompt
            prompt={lastPair?.hornPrompt}
            label="System Prompt + Resonance Data"
          />
          <div className="compare-messages">
            {pairs.length === 0 && !loading && (
              <div className="compare-empty">Send a message to compare</div>
            )}
            {pairs.map((pair, i) => (
              <div key={i} className="compare-pair">
                <div className="compare-msg compare-msg-user">
                  <div className="compare-msg-bubble user-bubble">{pair.userMessage}</div>
                </div>
                <div className="compare-msg compare-msg-ai">
                  <div className="compare-msg-bubble horn-bubble">{pair.hornResponse}</div>
                </div>
                {pair.meta && (
                  <div className="compare-meta">
                    <span>memories: {pair.meta.memoryDepth}</span>
                    <span>dissonance: {pair.meta.dissonance}</span>
                    <span>freq: {pair.meta.frequenciesMatched}</span>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="compare-msg compare-msg-ai">
                <div className="compare-msg-bubble horn-bubble">
                  <div className="message-loading"><span></span><span></span><span></span></div>
                </div>
              </div>
            )}
            <div ref={scrollRefRight} />
          </div>
        </div>
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message to compare both models..."
          disabled={loading}
          autoFocus
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

export default CompareView
