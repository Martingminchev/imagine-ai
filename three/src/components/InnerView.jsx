import { useState } from 'react'

/**
 * InnerView — the "flipped" chat timeline.
 * Shows actual messages in chat layout with AI's inner thoughts
 * attached below each AI response in colorful detail.
 */

function formatTime(timestamp) {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function moodLabel(mood) {
  if (!mood) return null
  return mood.replace(/-/g, ' & ')
}

function trustWord(trust) {
  if (trust == null) return null
  if (trust < 0.2) return 'guarded'
  if (trust < 0.4) return 'warming up'
  if (trust < 0.6) return 'at ease'
  if (trust < 0.8) return 'open'
  return 'deeply connected'
}

/* ── Accent colors for thought categories ─────────────────── */

const THOUGHT_COLORS = {
  mood:         { border: 'rgba(230, 160, 94, 0.25)', bg: 'rgba(230, 160, 94, 0.06)', text: '#e6a05e' },
  trust:        { border: 'rgba(94, 196, 230, 0.25)', bg: 'rgba(94, 196, 230, 0.06)', text: '#5ec4e6' },
  memory:       { border: 'rgba(136, 136, 204, 0.25)', bg: 'rgba(136, 136, 204, 0.06)', text: '#8888cc' },
  expectation:  { border: 'rgba(122, 204, 136, 0.25)', bg: 'rgba(122, 204, 136, 0.06)', text: '#7acc88' },
  surprise:     { border: 'rgba(230, 94, 122, 0.25)', bg: 'rgba(230, 94, 122, 0.06)', text: '#e65e7a' },
  thought:      { border: 'rgba(204, 68, 255, 0.2)', bg: 'rgba(204, 68, 255, 0.04)', text: '#cc88ee' },
  prediction:   { border: 'rgba(94, 138, 230, 0.25)', bg: 'rgba(94, 138, 230, 0.06)', text: '#5e8ae6' },
}

/* ── User message bubble ──────────────────────────────────── */

function UserBubble({ text, timestamp }) {
  return (
    <div className="flex justify-end mb-3">
      <div
        className="max-w-[78%] sm:max-w-[65%] rounded-2xl rounded-br-md px-4 py-2.5"
        style={{
          background: 'rgba(40, 40, 70, 0.7)',
          color: 'var(--color-text)',
          opacity: 0.6,
        }}
      >
        <p className="text-body-sm whitespace-pre-wrap break-words" style={{ lineHeight: '1.5' }}>
          {text}
        </p>
        {timestamp && (
          <span className="text-caption block mt-1" style={{ color: 'var(--color-text-dim)', opacity: 0.4, fontSize: '0.6rem' }}>
            {formatTime(timestamp)}
          </span>
        )}
      </div>
    </div>
  )
}

/* ── AI message with thoughts attached ────────────────────── */

function AIBubbleWithThoughts({ text, insight, timestamp }) {
  const [showMemories, setShowMemories] = useState(false)

  const {
    mood, trust, memoryCount,
    expectationsConfirmed, expectationsSurprised,
    topMemories,
    unfinishedThought,
    expectations,
  } = insight || {}

  const trustText = trustWord(trust)
  const hasInsight = mood || trustText || memoryCount > 0 ||
    expectationsConfirmed > 0 || expectationsSurprised > 0 ||
    unfinishedThought || expectations?.length > 0 || topMemories?.length > 0

  return (
    <div className="flex justify-start mb-3">
      <div className="max-w-[82%] sm:max-w-[72%]">
        {/* AI response — dark bubble */}
        <div
          className="rounded-2xl rounded-bl-md px-4 py-2.5"
          style={{
            background: 'rgba(25, 25, 40, 0.8)',
            border: '1px solid rgba(255,255,255,0.04)',
            color: 'var(--color-text)',
            opacity: 0.65,
          }}
        >
          <p className="text-body-sm whitespace-pre-wrap break-words" style={{ lineHeight: '1.5' }}>
            {text}
          </p>
          {timestamp && (
            <span className="text-caption block mt-1" style={{ color: 'var(--color-text-dim)', opacity: 0.4, fontSize: '0.6rem' }}>
              {formatTime(timestamp)}
            </span>
          )}
        </div>

        {/* Inner thoughts — colorful cards attached below */}
        {hasInsight && (
          <div
            className="ml-2 mt-1 space-y-1"
            style={{ animation: 'fadeIn 0.3s ease-out' }}
          >
            {/* Mood + Trust row */}
            {(mood || trustText) && (
              <div className="flex flex-wrap gap-1.5">
                {mood && (
                  <ThoughtChip color={THOUGHT_COLORS.mood}>
                    Feeling {moodLabel(mood)}
                  </ThoughtChip>
                )}
                {trustText && (
                  <ThoughtChip color={THOUGHT_COLORS.trust}>
                    {trustText}
                  </ThoughtChip>
                )}
              </div>
            )}

            {/* Memory count */}
            {memoryCount > 0 && (
              <ThoughtChip
                color={THOUGHT_COLORS.memory}
                onClick={topMemories?.length > 0 ? () => setShowMemories(s => !s) : undefined}
              >
                Recalled {memoryCount} {memoryCount === 1 ? 'memory' : 'memories'}
                {topMemories?.length > 0 && (
                  <span style={{ opacity: 0.5, marginLeft: 4 }}>{showMemories ? '▾' : '▸'}</span>
                )}
              </ThoughtChip>
            )}

            {/* Expanded memories */}
            {showMemories && topMemories?.length > 0 && (
              <div
                className="rounded-lg px-3 py-2 space-y-1"
                style={{
                  background: THOUGHT_COLORS.memory.bg,
                  border: `1px solid ${THOUGHT_COLORS.memory.border}`,
                  animation: 'fadeIn 0.2s ease-out',
                }}
              >
                <span className="text-caption block mb-1" style={{ color: THOUGHT_COLORS.memory.text, opacity: 0.5, fontSize: '0.55rem' }}>
                  What came to mind
                </span>
                {topMemories.map((mem, i) => (
                  <p key={i} className="text-caption italic" style={{ color: THOUGHT_COLORS.memory.text, opacity: 0.7, lineHeight: '1.45', fontSize: '0.675rem' }}>
                    "{mem.length > 140 ? mem.slice(0, 140) + '…' : mem}"
                  </p>
                ))}
              </div>
            )}

            {/* Expectations confirmed / surprised */}
            {(expectationsConfirmed > 0 || expectationsSurprised > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {expectationsConfirmed > 0 && (
                  <ThoughtChip color={THOUGHT_COLORS.expectation}>
                    {expectationsConfirmed === 1 ? 'A hunch confirmed' : `${expectationsConfirmed} hunches confirmed`}
                  </ThoughtChip>
                )}
                {expectationsSurprised > 0 && (
                  <ThoughtChip color={THOUGHT_COLORS.surprise}>
                    {expectationsSurprised === 1 ? 'Caught off guard' : `Surprised ${expectationsSurprised} times`}
                  </ThoughtChip>
                )}
              </div>
            )}

            {/* Unfinished thought */}
            {unfinishedThought && (
              <div
                className="rounded-lg px-3 py-2"
                style={{
                  background: THOUGHT_COLORS.thought.bg,
                  border: `1px solid ${THOUGHT_COLORS.thought.border}`,
                }}
              >
                <span className="text-caption block mb-0.5" style={{ color: THOUGHT_COLORS.thought.text, opacity: 0.5, fontSize: '0.55rem' }}>
                  Still on its mind
                </span>
                <p className="text-caption italic" style={{ color: THOUGHT_COLORS.thought.text, opacity: 0.75, lineHeight: '1.45', fontSize: '0.675rem' }}>
                  "{unfinishedThought.length > 200 ? unfinishedThought.slice(0, 200) + '…' : unfinishedThought}"
                </p>
              </div>
            )}

            {/* Looking ahead — expectations */}
            {expectations?.length > 0 && (
              <div
                className="rounded-lg px-3 py-2"
                style={{
                  background: THOUGHT_COLORS.prediction.bg,
                  border: `1px solid ${THOUGHT_COLORS.prediction.border}`,
                }}
              >
                <span className="text-caption block mb-0.5" style={{ color: THOUGHT_COLORS.prediction.text, opacity: 0.5, fontSize: '0.55rem' }}>
                  Looking ahead
                </span>
                {expectations.map((exp, i) => (
                  <p key={i} className="text-caption" style={{ color: THOUGHT_COLORS.prediction.text, opacity: 0.7, lineHeight: '1.45', fontSize: '0.675rem' }}>
                    → {exp.length > 120 ? exp.slice(0, 120) + '…' : exp}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Reusable small chip ──────────────────────────────────── */

function ThoughtChip({ color, children, onClick }) {
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      className={`text-caption inline-flex items-center px-2.5 py-1 rounded-full ${onClick ? 'cursor-pointer' : ''}`}
      style={{
        background: color.bg,
        border: `1px solid ${color.border}`,
        color: color.text,
        opacity: 0.85,
        fontSize: '0.65rem',
        lineHeight: '1.3',
        transition: 'opacity 0.15s',
      }}
      onClick={onClick}
      onMouseEnter={e => { if (onClick) e.currentTarget.style.opacity = '1' }}
      onMouseLeave={e => { if (onClick) e.currentTarget.style.opacity = '0.85' }}
    >
      {children}
    </Tag>
  )
}

/* ── Main export ──────────────────────────────────────────── */

export default function InnerView({ messages }) {
  const hasAnyInsight = messages.some(m => m.role === 'ai' && m.insight)

  if (!hasAnyInsight) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-body-sm" style={{ color: 'var(--color-text-dim)', opacity: 0.5 }}>
          Nothing to show yet — insights appear after the AI responds.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1 pb-4">
      {messages.map((msg, i) => {
        if (msg.role === 'user') {
          return <UserBubble key={msg._id || i} text={msg.text} timestamp={msg.timestamp} />
        }
        if (msg.role === 'ai') {
          return (
            <AIBubbleWithThoughts
              key={msg._id || i}
              text={msg.text}
              insight={msg.insight}
              timestamp={msg.timestamp}
            />
          )
        }
        return null
      })}
    </div>
  )
}
