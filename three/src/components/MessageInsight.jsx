import { useState, useEffect } from 'react'

function trustWord(trust) {
  if (trust == null) return null
  if (trust < 0.2) return 'Guarded'
  if (trust < 0.4) return 'Warming up to you'
  if (trust < 0.6) return 'At ease with you'
  if (trust < 0.8) return 'Open with you'
  return 'Deeply connected'
}

function moodLabel(mood) {
  if (!mood) return null
  return mood.replace(/-/g, ' & ')
}

function Chip({ children }) {
  return (
    <span
      className="text-caption inline-flex items-center px-2 py-0.5 rounded-full"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid var(--color-glass-border)',
        color: 'var(--color-text-dim)',
        lineHeight: '1.4',
      }}
    >
      {children}
    </span>
  )
}

/**
 * Subtle insight layer for AI messages.
 *
 * - A quiet "whisper" line fades in after a short delay (unfinished thought or expectation)
 * - A ✦ toggle opens the full insight panel on demand
 */
export default function MessageInsight({ insight }) {
  const [expanded, setExpanded] = useState(false)
  const [whisperVisible, setWhisperVisible] = useState(false)

  const {
    mood, trust, memoryCount,
    expectationsConfirmed, expectationsSurprised,
    topMemories,
    unfinishedThought,
    expectations,
  } = insight || {}

  const trustText = trustWord(trust)

  // Pick one whisper line — prioritize unfinished thought, then first expectation
  const whisper = unfinishedThought
    || (expectations?.length > 0 ? expectations[0] : null)

  // Fade the whisper in after a brief pause so it doesn't compete with the message
  useEffect(() => {
    if (!whisper) return
    const t = setTimeout(() => setWhisperVisible(true), 1200)
    return () => clearTimeout(t)
  }, [whisper])

  const hasChips = mood || trustText || memoryCount > 0 ||
    expectationsConfirmed > 0 || expectationsSurprised > 0
  const hasMemories = topMemories?.length > 0
  const hasExpectations = expectations?.length > 0
  const hasExpandable = hasChips || hasMemories || unfinishedThought || hasExpectations

  if (!hasExpandable && !whisper) return null

  return (
    <div className="mt-2 space-y-1.5">
      {/* Whisper — a quiet, delayed hint of what the AI is thinking */}
      {whisper && (
        <p
          className="text-caption italic"
          style={{
            color: 'var(--color-text-dim)',
            opacity: whisperVisible ? 0.4 : 0,
            transition: 'opacity 1.2s ease-in',
            lineHeight: '1.5',
          }}
        >
          {unfinishedThought ? `"${whisper}"` : `→ ${whisper}`}
        </p>
      )}

      {/* Toggle for deeper insight */}
      {hasExpandable && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-caption inline-flex items-center gap-1 transition-opacity duration-150 cursor-pointer"
          style={{ color: 'var(--color-text-dim)', opacity: expanded ? 0.6 : 0.3 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.6')}
          onMouseLeave={e => (e.currentTarget.style.opacity = expanded ? '0.6' : '0.3')}
        >
          <span style={{ fontSize: '0.55rem' }}>✦</span>
          <span>{expanded ? 'close' : 'peek inside'}</span>
        </button>
      )}

      {/* Expanded panel */}
      {expanded && (
        <div
          className="rounded-lg px-3 py-2.5 space-y-2.5"
          style={{
            background: 'rgba(255,255,255,0.015)',
            border: '1px solid var(--color-glass-border)',
            animation: 'fadeIn 0.2s ease-out',
          }}
        >
          {/* Info chips */}
          {hasChips && (
            <div className="flex flex-wrap gap-1.5">
              {mood && <Chip>Feeling {moodLabel(mood)}</Chip>}
              {trustText && <Chip>{trustText}</Chip>}
              {memoryCount > 0 && (
                <Chip>
                  {memoryCount} {memoryCount === 1 ? 'memory' : 'memories'} surfaced
                </Chip>
              )}
              {expectationsConfirmed > 0 && (
                <Chip>
                  {expectationsConfirmed === 1 ? 'Saw this coming' : `${expectationsConfirmed} hunches confirmed`}
                </Chip>
              )}
              {expectationsSurprised > 0 && (
                <Chip>
                  {expectationsSurprised === 1 ? 'Caught off guard' : `Surprised ${expectationsSurprised} times`}
                </Chip>
              )}
            </div>
          )}

          {/* Unfinished thought */}
          {unfinishedThought && (
            <div>
              <p className="text-label mb-1" style={{ color: 'var(--color-text-dim)', fontSize: '0.575rem' }}>
                Still on its mind
              </p>
              <p
                className="text-caption italic"
                style={{ color: 'var(--color-text-secondary)', lineHeight: '1.5', opacity: 0.75 }}
              >
                "{unfinishedThought}"
              </p>
            </div>
          )}

          {/* Expectations — what the AI thinks might happen */}
          {hasExpectations && (
            <div>
              <p className="text-label mb-1" style={{ color: 'var(--color-text-dim)', fontSize: '0.575rem' }}>
                Looking ahead
              </p>
              <div className="space-y-0.5">
                {expectations.map((text, i) => (
                  <p
                    key={i}
                    className="text-caption"
                    style={{ color: 'var(--color-text-secondary)', lineHeight: '1.5', opacity: 0.65 }}
                  >
                    → {text}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Top memory matches */}
          {hasMemories && (
            <div>
              <p className="text-label mb-1" style={{ color: 'var(--color-text-dim)', fontSize: '0.575rem' }}>
                What came to mind
              </p>
              <div className="space-y-1">
                {topMemories.map((text, i) => (
                  <p
                    key={i}
                    className="text-caption italic"
                    style={{ color: 'var(--color-text-secondary)', lineHeight: '1.5', opacity: 0.75 }}
                  >
                    "{text}"
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
