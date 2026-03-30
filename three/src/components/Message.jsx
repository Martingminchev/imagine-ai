import { useState, useRef } from 'react'
import MessageInsight from './MessageInsight'

/* ── Mood → color map ──────────────────────────────────────── */

const MOOD_COLORS = {
  warm:       '#e6a05e',
  curious:    '#5ec4e6',
  calm:       '#6c8ccc',
  sharp:      '#ff6644',
  restless:   '#e65e7a',
  gentle:     '#7acc88',
  attentive:  '#5ec4e6',
  electric:   '#cc44ff',
  scattered:  '#e6c95e',
  still:      '#8899bb',
  watchful:   '#7a99cc',
  alert:      '#e6a05e',
  uncertain:  '#aa88cc',
  reflective: '#8888cc',
  anxious:    '#cc6677',
  playful:    '#e6c95e',
  focused:    '#5e8ae6',
  open:       '#7acc88',
  guarded:    '#8a7a6a',
  excited:    '#e6875e',
}

const FALLBACK_COLOR = '#6c6cff'

function parseMoodColors(mood) {
  if (!mood) return [FALLBACK_COLOR, FALLBACK_COLOR]
  const parts = mood.split('-').map(p => p.toLowerCase().trim()).filter(Boolean)
  const c1 = MOOD_COLORS[parts[0]] || FALLBACK_COLOR
  const c2 = parts[1] ? (MOOD_COLORS[parts[1]] || FALLBACK_COLOR) : c1
  return [c1, c2]
}

function MoodOrb({ mood }) {
  const [c1, c2] = parseMoodColors(mood)
  const same = c1 === c2

  return (
    <div
      className="shrink-0 rounded-full"
      title={mood ? mood.replace('-', ' · ') : undefined}
      style={{
        width: 10,
        height: 10,
        background: same
          ? c1
          : `linear-gradient(135deg, ${c1} 0%, ${c1} 45%, ${c2} 55%, ${c2} 100%)`,
        boxShadow: `0 0 6px ${c1}40, 0 0 6px ${c2}40`,
        opacity: 0.7,
        transition: 'all 0.6s ease',
      }}
    />
  )
}

/* ── Gesture labels & animations ───────────────────────────── */

const GESTURE_CONFIG = {
  wave:       { emoji: '👋', label: 'waved at you',          anim: 'wave' },
  nudge:      { emoji: '👉', label: 'nudged you',            anim: 'nudge' },
  nod:        { emoji: '😌', label: 'nodded',                anim: 'nod' },
  handshake:  { emoji: '🤝', label: 'offered a handshake',   anim: 'handshake' },
  hug:        { emoji: '🤗', label: 'gave you a hug',        anim: 'hug' },
  'head-tilt':{ emoji: '🤔', label: 'tilted their head',     anim: 'headtilt' },
}

function GestureTag({ gesture }) {
  const cfg = GESTURE_CONFIG[gesture]
  if (!cfg) return null

  return (
    <span
      className="text-caption inline-flex items-center gap-1 px-2 py-0.5 rounded-full"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.06)',
        color: 'var(--color-text-dim)',
        opacity: 0.6,
        animation: 'fadeIn 0.5s ease-out 0.8s both',
        fontSize: '0.65rem',
      }}
    >
      <span style={{ fontSize: '0.75rem' }}>{cfg.emoji}</span>
      <span>{cfg.label}</span>
    </span>
  )
}

/* ── Detailed hover descriptions for pipeline steps ────────── */

function describeStep(step, detail) {
  switch (step) {
    case 'encode':
      if (detail.includes('vibrations:')) {
        const words = detail.match(/vibrations: (.+)/)?.[1]
        return words
          ? `Your words carried these undertones: ${words}. This is how the AI first senses the emotional texture of what you said.`
          : 'The AI read your message and felt its tone and weight.'
      }
      return 'The AI is reading your message, picking up on its meaning, emotion, and subtleties.'

    case 'hum':
      if (detail.includes('Resonating with:')) {
        const words = detail.replace(/.*Resonating with:\s*/, '').trim()
        if (words && words !== 'stillness')
          return `Echoes from the last conversation are still ringing: "${words}". The AI carries forward emotional residue from what came before.`
      }
      return 'The AI is checking if anything from the previous exchange is still resonating.'

    case 'resonate':
      if (detail.includes('Memory field is empty'))
        return 'This is a fresh start — no memories exist yet. Everything from here will be the first.'
      if (detail.includes('Reconsolidated')) {
        const n = detail.match(/(\d+)/)?.[1]
        return n > 0
          ? `${n} memories were reshaped by this recall. Remembering changes memories — just like in humans.`
          : 'Some memories were touched by this interaction and subtly changed.'
      }
      if (detail.includes('contradiction'))
        return 'The AI noticed something that contradicts what it remembers. It\'s holding both truths at once rather than discarding either.'
      const memMatch = detail.match(/^(\d+) memories/)
      if (memMatch) {
        const count = parseInt(memMatch[1])
        const vividMatch = detail.match(/(\d+) vivid/)
        const vivid = vividMatch ? parseInt(vividMatch[1]) : 0
        if (count === 0) return 'The AI searched its memory but nothing matched this moment.'
        return `${count} memories resonated with what you said${vivid > 0 ? `. ${vivid} of them are still vivid and clear` : ', some fading'}. The strongest matches shaped the response.`
      }
      return 'The AI searched through its memories for anything that connects to this moment.'

    case 'anticipate':
      if (detail.includes('No active'))
        return 'The AI had no expectations going into this — it\'s staying open to wherever this goes.'
      const parts = []
      const conf = detail.match(/(\d+) confirmed/)
      const surp = detail.match(/(\d+) surprised/)
      if (conf) parts.push(`${conf[1]} of its predictions about the conversation turned out to be right`)
      if (surp) parts.push(`${surp[1]} things happened that it didn't expect`)
      return parts.length > 0
        ? `${parts.join(', and ')}. The AI constantly forms expectations and checks them against reality.`
        : 'The AI checked its predictions against what actually happened.'

    case 'compose':
      if (detail.includes('Entropy')) {
        const n = detail.match(/(\d+)/)?.[1]
        return n
          ? `The AI deliberately reached for ${n} older, hazier memories to add depth. This is like suddenly recalling something you haven't thought about in a long time.`
          : 'The AI is reaching into distant, half-forgotten memories to bring unexpected depth to its response.'
      }
      return 'The AI is assembling everything — memories, mood, expectations — into the shape of a response.'

    case 'remember':
      if (detail.includes('contradiction')) {
        const n = detail.match(/(\d+)/)?.[1]
        return n > 0
          ? `The AI noticed ${n} contradictions while storing this exchange. It doesn't resolve them — it holds them, the way real memory works.`
          : 'A contradiction was noticed and held alongside the memory, without forcing a resolution.'
      }
      return 'This exchange is being committed to memory. Over time, it will fade, shift, and become part of the AI\'s evolving understanding.'

    case 'reflect':
      return 'After responding, the AI paused to reflect — an unfinished thought lingered. Something about this conversation stayed with it.'

    case 'project':
      if (detail.includes('No new')) return 'No new expectations formed — the AI is staying present rather than looking ahead.'
      const expMatch = detail.match(/(\d+) expectations/)
      if (expMatch) {
        const n = parseInt(expMatch[1])
        return `The AI formed ${n} new expectation${n > 1 ? 's' : ''} about where this conversation might go. These shape how it\'ll approach your next message.`
      }
      return 'The AI is imagining what might come next — forming expectations that will color future interactions.'

    case 'evolve':
      return 'The AI grew a little from this exchange. Its personality, trust level, and emotional state shifted based on what happened here.'

    default:
      return null
  }
}

/* ── Step row with hover tooltip ───────────────────────────── */

function StepRow({ entry, index, total }) {
  const [hovered, setHovered] = useState(false)
  const rowRef = useRef(null)

  // Support both old format (plain string) and new format (object)
  const label = typeof entry === 'string' ? entry : entry.label
  const description = typeof entry === 'string' ? null : describeStep(entry.step, entry.detail)

  // Progress-based accent opacity
  const progress = total > 1 ? index / (total - 1) : 0
  const dotOpacity = 0.35 + progress * 0.4

  return (
    <div
      ref={rowRef}
      className="relative group py-1"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-2 cursor-default">
        <span
          className="w-1 h-1 rounded-full shrink-0 mt-1.5 transition-all duration-200"
          style={{
            background: 'var(--color-accent)',
            opacity: hovered ? 0.9 : dotOpacity,
            transform: hovered ? 'scale(1.5)' : 'scale(1)',
          }}
        />
        <span
          className="text-caption transition-opacity duration-150"
          style={{
            color: '#c4c4d4',
            lineHeight: '1.5',
            opacity: hovered ? 1 : 0.75,
          }}
        >
          {label}
        </span>
      </div>

      {/* Hover tooltip */}
      {hovered && description && (
        <div
          className="mt-1 ml-3 px-3 py-2 rounded-lg"
          style={{
            background: 'rgba(20, 20, 35, 0.92)',
            border: '1px solid rgba(255,255,255,0.06)',
            backdropFilter: 'blur(8px)',
            animation: 'fadeIn 0.15s ease-out',
            maxWidth: '320px',
          }}
        >
          <p
            className="text-caption"
            style={{
              color: '#c4c4d4',
              lineHeight: '1.55',
              opacity: 0.9,
              fontSize: '0.675rem',
            }}
          >
            {description}
          </p>
        </div>
      )}
    </div>
  )
}

export default function Message({ text, role, timestamp, streaming, initiativeId, onAnswerInitiative, insight, gesture, steps, isLast }) {
  const isUser = role === 'user'
  const isInitiative = role === 'initiative'
  const isAI = !isUser && !isInitiative
  const [answerText, setAnswerText] = useState('')
  const [answering, setAnswering] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [flipped, setFlipped] = useState(false)

  const canFlip = isAI && !streaming && steps?.length > 0

  const time = timestamp
    ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''

  async function handleAnswer() {
    if (!answerText.trim()) return
    setAnswering(true)
    try {
      if (onAnswerInitiative) {
        await onAnswerInitiative(initiativeId, answerText.trim())
        setAnswerText('')
        setExpanded(false)
      }
    } catch (e) { /* silent */ }
    finally { setAnswering(false) }
  }

  const userBubbleStyle = {
    background: 'linear-gradient(135deg, var(--color-user-bubble) 0%, rgba(55,55,100,0.85) 100%)',
    color: 'var(--color-text)',
    boxShadow: '0 1px 8px rgba(0,0,0,0.2)',
  }

  const aiBubbleStyle = {
    background: 'var(--color-glass-bg)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-glass-border)',
    borderTop: '1px solid rgba(255,255,255,0.04)',
    backdropFilter: 'blur(12px)',
    boxShadow: '0 1px 10px rgba(0,0,0,0.12)',
  }

  const initiativeBubbleStyle = {
    background: 'var(--color-initiative)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-initiative-border)',
    boxShadow: '0 0 16px rgba(68, 200, 130, 0.06), 0 1px 8px rgba(0,0,0,0.12)',
  }

  const bubbleStyle = isUser
    ? userBubbleStyle
    : isInitiative
      ? initiativeBubbleStyle
      : aiBubbleStyle

  const showOrb = isAI && isLast && !streaming && insight?.mood

  // ── Back side: pipeline steps summary ──
  const backContent = canFlip && flipped ? (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-label" style={{ color: '#b0b0c0', fontSize: '0.55rem', opacity: 0.8 }}>
          What happened behind the scenes
        </span>
        <button
          onClick={() => setFlipped(false)}
          className="text-caption px-1.5 py-0.5 rounded transition-opacity duration-150 cursor-pointer"
          style={{ color: '#c4c4d4', opacity: 0.7 }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
        >
          ← back
        </button>
      </div>
      {steps.map((entry, i) => (
        <StepRow key={i} entry={entry} index={i} total={steps.length} />
      ))}
    </div>
  ) : null

  return (
    <div
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}
      style={{ animation: 'fadeIn 0.25s ease-out' }}
    >
      {/* Mood orb — left of bubble on last AI message */}
      {showOrb && (
        <div className="flex items-end pb-3 pr-1.5" style={{ animation: 'fadeIn 0.5s ease-out 0.3s both' }}>
          <MoodOrb mood={insight.mood} />
        </div>
      )}
      <div
        className={`max-w-[82%] sm:max-w-[68%] rounded-2xl px-4 py-3 ${
          isUser ? 'rounded-br-md' : 'rounded-bl-md'
        }`}
        style={{
          ...bubbleStyle,
          transition: 'all 0.3s ease',
        }}
      >
        {flipped && backContent ? (
          /* ── Flipped: show pipeline summary ── */
          backContent
        ) : (
          /* ── Front: normal message ── */
          <>
            {isInitiative && (
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-label"
                  style={{
                    color: 'rgba(68, 200, 130, 0.75)',
                    textShadow: '0 0 10px rgba(68, 200, 130, 0.2)',
                    fontSize: '0.6rem',
                  }}
                >
                  Reaching out
                </span>
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="text-caption px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                  style={{ color: 'var(--color-text-dim)' }}
                >
                  {expanded ? '\u2212' : 'reply'}
                </button>
              </div>
            )}

            <div
              className="text-body whitespace-pre-wrap break-words"
              style={{ lineHeight: '1.55' }}
            >
              {text}
              {streaming && (
                <span
                  className="inline-block w-[2.5px] h-[1em] ml-0.5 align-text-bottom rounded-full"
                  style={{
                    background: 'var(--color-accent)',
                    animation: 'cursor-blink 0.8s step-end infinite',
                    boxShadow: '0 0 6px rgba(110,110,255,0.4)',
                  }}
                />
              )}
            </div>

            {isInitiative && expanded && (
              <div className="mt-3 space-y-2">
                <textarea
                  className="text-body-sm w-full rounded-lg px-3 py-2 resize-none outline-none transition-all duration-200"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    color: 'var(--color-text)',
                    border: '1px solid var(--color-glass-border)',
                    lineHeight: '1.55',
                  }}
                  value={answerText}
                  onChange={e => setAnswerText(e.target.value)}
                  placeholder="Type your response..."
                  rows={2}
                  onFocus={e => {
                    e.target.style.borderColor = 'rgba(68,200,130,0.28)'
                    e.target.style.boxShadow = '0 0 0 3px rgba(68,200,130,0.06)'
                  }}
                  onBlur={e => {
                    e.target.style.borderColor = 'var(--color-glass-border)'
                    e.target.style.boxShadow = 'none'
                  }}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAnswer() } }}
                />
                <button
                  onClick={handleAnswer}
                  disabled={!answerText.trim() || answering}
                  className="text-body-sm font-medium px-4 py-1.5 rounded-lg transition-all duration-200 disabled:opacity-35 cursor-pointer hover:scale-[1.03]"
                  style={{
                    background: 'rgba(68,200,130,0.75)',
                    color: '#fff',
                    boxShadow: '0 0 10px rgba(68,200,130,0.12)',
                  }}
                >
                  {answering ? 'Sending...' : 'Send'}
                </button>
              </div>
            )}

            {/* Gesture tag */}
            {gesture && !streaming && (
              <div className="mt-1.5">
                <GestureTag gesture={gesture} />
              </div>
            )}

            {/* Flip hint + timestamp */}
            {!streaming && (
              <div className="flex items-center gap-2 mt-2">
                {time && (
                  <span
                    className="text-caption"
                    style={{
                      color: '#a0a0b4',
                      opacity: 0.75,
                      animation: 'timestamp-fade 0.6s ease-out 0.4s both',
                    }}
                  >
                    {time}
                  </span>
                )}
                {canFlip && (
                  <button
                    onClick={() => setFlipped(true)}
                    className="text-caption inline-flex items-center gap-1 transition-opacity duration-150 cursor-pointer ml-auto"
                    style={{ color: '#c4c4d4', opacity: 0.5 }}
                    onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                    onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
                    title="See what the AI was doing"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10" />
                      <path d="M22 2L16 8" />
                      <path d="M22 8V2h-6" />
                    </svg>
                  </button>
                )}
              </div>
            )}

            {/* Insight panel for AI messages */}
            {isAI && !streaming && insight && (
              <MessageInsight insight={insight} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
