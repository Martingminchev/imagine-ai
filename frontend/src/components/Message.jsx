import { useState } from 'react'

function Message({ text, role, timestamp, thinking, streaming, concernId, initiativeId, isStuck, onAnswerConcern, onAnswerInitiative, onDismissConcern, expanded: initialExpanded = false, onToggleExpand }) {
  const isUser = role === 'user'
  const isInitiative = role === 'initiative'
  const isConcern = role === 'concern' || role === 'archived-concern'
  const [showThinking, setShowThinking] = useState(false)
  const [expanded, setExpanded] = useState(initialExpanded)
  const [answerText, setAnswerText] = useState('')
  const [answering, setAnswering] = useState(false)

  function toggleExpanded() {
    const newExpanded = !expanded
    setExpanded(newExpanded)
    if (onToggleExpand && (concernId || initiativeId || isConcern || isInitiative)) {
      onToggleExpand(concernId || initiativeId || (isConcern ? `concern-${concernId || 'current'}` : `initiative-${initiativeId}`))
    }
  }
  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  const className = isUser ? 'message-user' : isInitiative ? 'message-initiative' : isConcern ? 'message-concern' : 'message-ai'

  async function handleAnswerConcern(action = 'resolve') {
    if (!answerText.trim() && action === 'resolve') return
    setAnswering(true)
    try {
      if (onAnswerConcern) {
        await onAnswerConcern(concernId, answerText.trim(), action)
        setAnswerText('')
        setExpanded(false)
      }
    } catch (err) {
      // silent
    } finally {
      setAnswering(false)
    }
  }

  async function handleAnswerInitiative() {
    if (!answerText.trim()) return
    setAnswering(true)
    try {
      if (onAnswerInitiative) {
        await onAnswerInitiative(initiativeId, answerText.trim())
        setAnswerText('')
        setExpanded(false)
      }
    } catch (err) {
      // silent
    } finally {
      setAnswering(false)
    }
  }

  async function handleDismiss() {
    if (onDismissConcern) {
      await onDismissConcern(concernId)
      setExpanded(false)
    }
  }

  async function handleGetOverIt() {
    setAnswering(true)
    try {
      if (onAnswerConcern) {
        await onAnswerConcern(concernId, '', 'archive')
        setExpanded(false)
      }
    } catch (err) {
      // silent
    } finally {
      setAnswering(false)
    }
  }

  return (
    <div className={`message ${className} ${expanded ? 'message-expanded' : ''}`}>
      <div className="message-bubble">
        {isInitiative && (
          <>
            <div className="message-initiative-label">
              reaching out
              <button
                type="button"
                className="message-expand-toggle"
                onClick={toggleExpanded}
              >
                {expanded ? '−' : '+'}
              </button>
            </div>
            {expanded && (
              <div className="message-answer-section">
                <textarea
                  className="message-answer-input"
                  value={answerText}
                  onChange={(e) => setAnswerText(e.target.value)}
                  placeholder="Type your response..."
                  rows={3}
                />
                <div className="message-answer-actions">
                  <button
                    type="button"
                    className="message-answer-btn"
                    onClick={handleAnswerInitiative}
                    disabled={!answerText.trim() || answering}
                  >
                    {answering ? 'Sending...' : 'Send'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        {isConcern && (
          <>
            <div className="message-concern-label">
              {role === 'concern' ? 'current concern' : 'archived concern'}
              {isStuck && <span className="message-stuck-badge">stuck</span>}
              <button
                type="button"
                className="message-expand-toggle"
                onClick={toggleExpanded}
              >
                {expanded ? '−' : '+'}
              </button>
            </div>
            {expanded && (
              <>
                <div className="message-text message-concern-text">
                  {text}
                </div>
                <div className="message-answer-section">
                  <textarea
                    className="message-answer-input"
                    value={answerText}
                    onChange={(e) => setAnswerText(e.target.value)}
                    placeholder="Answer the concern or leave empty to dismiss..."
                    rows={3}
                  />
                  <div className="message-answer-actions">
                    {answerText.trim() && (
                      <button
                        type="button"
                        className="message-answer-btn message-answer-btn-resolve"
                        onClick={() => handleAnswerConcern('resolve')}
                        disabled={answering}
                      >
                        {answering ? 'Resolving...' : 'Resolve'}
                      </button>
                    )}
                    <button
                      type="button"
                      className="message-answer-btn message-answer-btn-dismiss"
                      onClick={handleGetOverIt}
                      disabled={answering}
                    >
                      {answering ? 'Archiving...' : 'Get over it'}
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
        {!isConcern && thinking && (
          <div className="message-thinking-wrap">
            <button
              type="button"
              className="message-thinking-toggle"
              onClick={() => setShowThinking(prev => !prev)}
            >
              {showThinking ? 'Hide thinking' : 'Show thinking'}
              <span className="message-thinking-indicator" />
            </button>
            {showThinking && (
              <div className="message-thinking-content">{thinking}</div>
            )}
          </div>
        )}
        {!isConcern && (
          <div className="message-text">
            {text}
            {streaming && <span className="message-cursor" />}
          </div>
        )}
        {time && <div className="message-time">{time}</div>}
      </div>
    </div>
  )
}

export default Message
