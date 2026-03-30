import { useState, useRef, useEffect, useCallback } from 'react'
import Message from './Message'
import { getArchivedConcerns, setCurrentConcern, answerConcern, answerInitiative } from '../api/chat'

function Chat({ messages, onSend, loading, streamingMsg, pipelineSteps, onLoadMore, hasMoreMessages, isLoadingOlderMessages, conversationId = 'default', onConcernUpdate }) {
  const [input, setInput] = useState('')
  const [concernInput, setConcernInput] = useState('')
  const [currentConcern, setCurrentConcernState] = useState('')
  const [isStuck, setIsStuck] = useState(false)
  const [archivedConcerns, setArchivedConcerns] = useState([])
  const [expandedConcerns, setExpandedConcerns] = useState(new Set())
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const containerRef = useRef(null)
  const isLoadingOlderRef = useRef(false)
  const prevMessagesLenRef = useRef(0)

  async function fetchConcerns() {
    try {
      const data = await getArchivedConcerns(conversationId)
      if (data.ok) {
        setCurrentConcernState(data.currentConcern || '')
        setIsStuck(data.isStuck || false)
        setArchivedConcerns(data.concerns || [])
      }
    } catch (err) {
      // silent
    }
  }

  useEffect(() => {
    fetchConcerns()
    const interval = setInterval(fetchConcerns, 5000) // Refresh every 5s
    return () => clearInterval(interval)
  }, [conversationId])

  async function handleSetConcern() {
    if (!concernInput.trim()) return
    try {
      const data = await setCurrentConcern(conversationId, concernInput.trim())
      if (data.ok) {
        setCurrentConcernState(data.currentConcern || '')
        setConcernInput('')
        if (onConcernUpdate) onConcernUpdate()
        await fetchConcerns()
      }
    } catch (err) {
      // silent
    }
  }

  async function handleAnswerConcern(concernId, answer, action) {
    try {
      const data = await answerConcern(conversationId, concernId, answer, action)
      if (data.ok) {
        await fetchConcerns()
        if (onConcernUpdate) onConcernUpdate()
        // If answered current concern with text, send it as a message
        if (!concernId && answer.trim() && action === 'resolve' && onSend) {
          onSend(answer.trim())
        }
      }
    } catch (err) {
      // silent
    }
  }

  async function handleAnswerInitiative(initiativeId, answer) {
    try {
      const data = await answerInitiative(conversationId, initiativeId, answer)
      if (data.ok && onSend) {
        // Send the answer as a normal message
        onSend(answer)
      }
    } catch (err) {
      // silent
    }
  }

  async function handleDismissConcern(concernId) {
    await handleAnswerConcern(concernId, '', 'dismiss')
  }

  // Track whether we're loading older messages to skip auto-scroll
  useEffect(() => {
    isLoadingOlderRef.current = isLoadingOlderMessages
  }, [isLoadingOlderMessages])

  // Preserve scroll position when older messages are prepended
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (messages.length > prevMessagesLenRef.current && prevMessagesLenRef.current > 0 && isLoadingOlderRef.current) {
      // Older messages were prepended — restore scroll position
      const addedCount = messages.length - prevMessagesLenRef.current
      const children = container.children
      let addedHeight = 0
      for (let i = 0; i < addedCount && i < children.length; i++) {
        addedHeight += children[i].offsetHeight
      }
      container.scrollTop += addedHeight
    } else if (!isLoadingOlderRef.current) {
      // Normal new message — scroll to bottom
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMessagesLenRef.current = messages.length
  }, [messages])

  // Auto-scroll on streaming
  useEffect(() => {
    if (streamingMsg && !isLoadingOlderRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [streamingMsg])

  useEffect(() => {
    if (!loading) inputRef.current?.focus()
  }, [loading])

  const handleScroll = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    if (container.scrollTop < 100 && hasMoreMessages && !isLoadingOlderMessages && onLoadMore) {
      onLoadMore()
    }
  }, [hasMoreMessages, isLoadingOlderMessages, onLoadMore])

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSend(trimmed)
    setInput('')
  }

  // Build message list: archived concerns + regular messages (current concern is sticky header)
  const archivedConcernMessages = archivedConcerns.filter(c => c.status !== 'resolved').map(c => ({
    _id: `archived-${c.id}`,
    text: c.topic,
    role: 'archived-concern',
    timestamp: c.archivedAt,
    concernId: c.id,
    status: c.status
  }))

  // Regular messages with initiative IDs
  const regularMessages = messages.map(msg => ({
    ...msg,
    initiativeId: msg.role === 'initiative' ? (msg._id || msg.id) : null
  }))

  // Combine: archived concerns first, then regular messages
  const allMessages = [...archivedConcernMessages, ...regularMessages]

  const currentConcernExpanded = expandedConcerns.has('current-concern')

  return (
    <div className="chat">
      {currentConcern && (
        <div className="chat-concern-header">
          <Message
            text={currentConcern}
            role="concern"
            timestamp={new Date().toISOString()}
            concernId={null}
            isStuck={isStuck}
            onAnswerConcern={handleAnswerConcern}
            onDismissConcern={handleDismissConcern}
            expanded={currentConcernExpanded}
            onToggleExpand={() => {
              setExpandedConcerns(prev => {
                const next = new Set(prev)
                if (next.has('current-concern')) next.delete('current-concern')
                else next.add('current-concern')
                return next
              })
            }}
          />
        </div>
      )}
      <div className="chat-messages" ref={containerRef} onScroll={handleScroll}>
        {isLoadingOlderMessages && (
          <div className="message message-ai" style={{ textAlign: 'center', opacity: 0.6 }}>
            <div className="message-bubble">
              <div className="message-loading">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}
        {(allMessages.length === 0 && !currentConcern) && !streamingMsg && (
          <div className="chat-empty">
            <p className="chat-empty-title">Horn AI</p>
            <p className="chat-empty-sub">Every message becomes a memory. The field grows with you.</p>
          </div>
        )}
        {allMessages.map((msg, i) => (
          <Message
            key={msg._id || i}
            text={msg.text}
            role={msg.role}
            timestamp={msg.timestamp}
            thinking={msg.thinking}
            concernId={msg.concernId}
            initiativeId={msg.initiativeId}
            isStuck={msg.isStuck}
            onAnswerConcern={handleAnswerConcern}
            onAnswerInitiative={handleAnswerInitiative}
            onDismissConcern={handleDismissConcern}
            expanded={expandedConcerns.has(msg._id)}
            onToggleExpand={(id) => {
              setExpandedConcerns(prev => {
                const next = new Set(prev)
                if (next.has(id)) next.delete(id)
                else next.add(id)
                return next
              })
            }}
          />
        ))}
        {streamingMsg && (
          <Message
            text={streamingMsg.text}
            role="ai"
            thinking={streamingMsg.thinking}
            streaming
          />
        )}
        {loading && !streamingMsg && (
          <div className="message message-ai">
            <div className="message-bubble">
              {pipelineSteps && pipelineSteps.length > 0 ? (
                <div className="message-pipeline-steps">
                  {pipelineSteps.map((s, i) => (
                    <div key={i} className="message-pipeline-step">
                      <span className="pipeline-step-name">{s.step}</span>
                      <span className="pipeline-step-detail">{s.detail}</span>
                    </div>
                  ))}
                  <div className="message-loading">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              ) : (
                <div className="message-loading">
                  <span></span><span></span><span></span>
                </div>
              )}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-concern-input-section">
        <div className="chat-concern-input-wrap">
          <input
            type="text"
            className="chat-concern-input"
            value={concernInput}
            onChange={(e) => setConcernInput(e.target.value)}
            placeholder="Set current concern..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSetConcern()
              }
            }}
          />
          <button
            type="button"
            className="chat-concern-set-btn"
            onClick={handleSetConcern}
            disabled={!concernInput.trim()}
          >
            Set
          </button>
        </div>
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
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

export default Chat
