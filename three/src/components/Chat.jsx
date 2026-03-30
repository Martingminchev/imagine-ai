import { useState, useRef, useEffect, useCallback } from 'react'
import Message from './Message'
import ProcessIndicator from './ProcessIndicator'
import InnerView from './InnerView'
import { answerInitiative } from '../api/chat'

const NUDGE_ACTIONS = [
  { id: 'poke',    emoji: '👉', label: 'Poke' },
  { id: 'wave',    emoji: '👋', label: 'Wave' },
  { id: 'whisper', emoji: '🤫', label: 'Whisper' },
  { id: 'stare',   emoji: '👀', label: 'Stare' },
  { id: 'hug',     emoji: '🤗', label: 'Hug' },
]

export default function Chat({ messages, onSend, onNudge, loading, streamingMsg, onLoadMore, hasMoreMessages, isLoadingOlderMessages, conversationId = 'default', pipelineSteps = [] }) {
  const [input, setInput] = useState('')
  const [flipped, setFlipped] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const containerRef = useRef(null)
  const isLoadingOlderRef = useRef(false)
  const prevMessagesLenRef = useRef(0)

  useEffect(() => {
    isLoadingOlderRef.current = isLoadingOlderMessages
  }, [isLoadingOlderMessages])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (messages.length > prevMessagesLenRef.current && prevMessagesLenRef.current > 0 && isLoadingOlderRef.current) {
      const addedCount = messages.length - prevMessagesLenRef.current
      const children = container.children
      let addedHeight = 0
      for (let i = 0; i < addedCount && i < children.length; i++) {
        addedHeight += children[i].offsetHeight
      }
      container.scrollTop += addedHeight
    } else if (!isLoadingOlderRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
    prevMessagesLenRef.current = messages.length
  }, [messages])

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

  async function handleAnswerInitiative(initiativeId, answer) {
    try {
      const data = await answerInitiative(conversationId, initiativeId, answer)
      if (data.ok && onSend) onSend(answer)
    } catch (e) { /* silent */ }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || loading) return
    onSend(trimmed)
    setInput('')
  }

  const regularMessages = messages.map(msg => ({
    ...msg,
    initiativeId: msg.role === 'initiative' ? (msg._id || msg.id) : null
  }))

  const showProcessIndicator = pipelineSteps.length > 0 && (loading || streamingMsg)

  const hasInsightData = regularMessages.some(m => m.role === 'ai' && m.insight)

  return (
    <div className="flex flex-col h-full relative">
      {/* Flip toggle — only when there's insight data to show */}
      {hasInsightData && (
        <button
          onClick={() => setFlipped(f => !f)}
          className="absolute top-3 right-5 sm:right-8 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg transition-all duration-200 cursor-pointer"
          style={{
            background: flipped ? 'rgba(110,110,255,0.08)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${flipped ? 'rgba(110,110,255,0.15)' : 'rgba(255,255,255,0.05)'}`,
            color: '#c4c4d4',
            opacity: flipped ? 0.9 : 0.55,
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={e => (e.currentTarget.style.opacity = flipped ? '0.9' : '0.55')}
          title={flipped ? 'Back to chat' : 'See what the AI was thinking'}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ transform: flipped ? 'rotateY(180deg)' : 'none', transition: 'transform 0.3s ease' }}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10" />
            <path d="M22 2L16 8" />
            <path d="M22 8V2h-6" />
          </svg>
          <span className="text-caption">{flipped ? 'chat' : 'inner'}</span>
        </button>
      )}

      {/* Messages / Inner view */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-5 sm:px-8 py-5 relative flex flex-col"
      >
        {/* Top fade */}
        <div
          className="sticky top-0 left-0 right-0 h-10 pointer-events-none z-10 -mb-10"
          style={{ background: 'linear-gradient(to bottom, var(--color-bg) 0%, transparent 100%)' }}
        />

        {flipped ? (
          /* ── Inner view ──────────────────────────────────── */
          <>
            <div style={{ height: 28 }} />
            <InnerView messages={regularMessages} />
            <div ref={messagesEndRef} />
          </>
        ) : (
          /* ── Normal chat view ────────────────────────────── */
          <>
            {/* Push content to bottom */}
            <div className="flex-1" />

            {isLoadingOlderMessages && (
              <div className="flex justify-center py-5">
                <div className="flex gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-text-dim)', animation: 'pulse 1.2s ease-in-out infinite' }} />
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-text-dim)', animation: 'pulse 1.2s ease-in-out 0.2s infinite' }} />
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-text-dim)', animation: 'pulse 1.2s ease-in-out 0.4s infinite' }} />
                </div>
              </div>
            )}

            {regularMessages.length === 0 && !streamingMsg && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-center" style={{ animation: 'scaleIn 0.5s ease-out' }}>
                <div className="relative mb-5">
                  <div
                    className="w-16 h-16 rounded-full"
                    style={{
                      background: 'conic-gradient(from 0deg, transparent 0%, rgba(110,110,255,0.13) 25%, transparent 50%, rgba(140,100,255,0.08) 75%, transparent 100%)',
                      animation: 'ring-spin 14s linear infinite',
                      maskImage: 'radial-gradient(circle, transparent 42%, black 44%, black 50%, transparent 52%)',
                      WebkitMaskImage: 'radial-gradient(circle, transparent 42%, black 44%, black 50%, transparent 52%)',
                    }}
                  />
                </div>
                <p
                  className="text-heading-1 mb-1.5"
                  style={{ color: 'var(--color-text)', opacity: 0.3, fontWeight: 400, textShadow: '0 0 32px rgba(110,110,255,0.12)' }}
                >
                  Three
                </p>
                <p className="text-body-sm" style={{ color: 'var(--color-text-dim)' }}>
                  Say something. It'll remember.
                </p>
              </div>
            )}

            {regularMessages.map((msg, i) => {
              // Find the last AI message index for the mood orb
              const isLastAI = msg.role === 'ai' && !regularMessages.slice(i + 1).some(m => m.role === 'ai')
              return (
                <Message
                  key={msg._id || i}
                  text={msg.text}
                  role={msg.role}
                  timestamp={msg.timestamp}
                  initiativeId={msg.initiativeId}
                  onAnswerInitiative={handleAnswerInitiative}
                  insight={msg.insight}
                  gesture={msg.gesture}
                  steps={msg.steps}
                  isLast={isLastAI}
                />
              )
            })}

            {/* Live pipeline indicator */}
            {showProcessIndicator && (
              <ProcessIndicator steps={pipelineSteps} />
            )}

            {/* Streaming message */}
            {streamingMsg && (
              <Message text={streamingMsg.text} role="ai" streaming />
            )}

            {/* Loading dots (before streaming starts, if no steps yet) */}
            {loading && !streamingMsg && pipelineSteps.length === 0 && (
              <div className="flex justify-start mb-4">
                <div
                  className="rounded-2xl rounded-bl-md px-4 py-3"
                  style={{
                    background: 'var(--color-glass-bg)',
                    border: '1px solid var(--color-glass-border)',
                    backdropFilter: 'blur(12px)',
                  }}
                >
                  <div className="flex gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)', opacity: 0.5, animation: 'pulse 1.2s ease-in-out infinite' }} />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)', opacity: 0.5, animation: 'pulse 1.2s ease-in-out 0.2s infinite' }} />
                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)', opacity: 0.5, animation: 'pulse 1.2s ease-in-out 0.4s infinite' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input bar */}
      <div
        className="px-5 sm:px-8 py-3.5"
        style={{
          background: 'var(--color-glass-bg)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid var(--color-glass-border)',
        }}
      >
        {/* Nudge actions — show when input is empty and not loading */}
        {!input.trim() && !loading && messages.length > 0 && (
          <div className="flex justify-center gap-2 mb-2.5 max-w-3xl mx-auto" style={{ animation: 'fadeIn 0.3s ease-out' }}>
            {NUDGE_ACTIONS.map(action => (
              <button
                key={action.id}
                onClick={() => onNudge?.(action.id)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full transition-all duration-150 cursor-pointer"
                style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                  color: '#b8b8cc',
                  fontSize: '0.7rem',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(110,110,255,0.08)'
                  e.currentTarget.style.borderColor = 'rgba(110,110,255,0.18)'
                  e.currentTarget.style.color = '#d4d4e8'
                  e.currentTarget.style.transform = 'scale(1.05)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                  e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
                  e.currentTarget.style.color = '#b8b8cc'
                  e.currentTarget.style.transform = 'scale(1)'
                }}
                title={`${action.label} the AI`}
              >
                <span style={{ fontSize: '0.85rem' }}>{action.emoji}</span>
                <span>{action.label}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-3 max-w-3xl mx-auto items-center">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Type a message..."
            disabled={loading}
            autoFocus
            className="text-body flex-1 rounded-xl px-4 py-2.5 outline-none transition-all duration-200"
            style={{
              background: 'rgba(255,255,255,0.03)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-glass-border)',
              lineHeight: '1.5',
            }}
            onFocus={e => {
              e.target.style.borderColor = 'rgba(110,110,255,0.28)'
              e.target.style.boxShadow = '0 0 0 3px rgba(110,110,255,0.06)'
            }}
            onBlur={e => {
              e.target.style.borderColor = 'var(--color-glass-border)'
              e.target.style.boxShadow = 'none'
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200 disabled:opacity-20 cursor-pointer hover:scale-105 shrink-0"
            style={{
              background: input.trim() ? 'var(--color-accent)' : 'rgba(110,110,255,0.12)',
              boxShadow: input.trim() ? '0 0 18px rgba(110,110,255,0.18)' : 'none',
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </form>
      </div>
    </div>
  )
}
