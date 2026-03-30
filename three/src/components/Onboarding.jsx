import { useState, useEffect } from 'react'

const STORAGE_KEY = 'three-onboarding-seen'

const SLIDES = [
  {
    icon: '◉',
    title: 'This AI remembers',
    body: 'Unlike other chatbots, conversations here grow over time. Memories fade, shift, and reconsolidate — just like yours.',
    accent: '#6c6cff',
  },
  {
    icon: '↻',
    title: 'Peek behind the curtain',
    body: 'After the AI responds, look for the small flip icon next to the timestamp. Tap it to see what the AI was doing — which memories surfaced, what surprised it, how it was feeling.',
    accent: '#5ec4e6',
  },
  {
    icon: '◐',
    title: 'It has a mood',
    body: 'The small glowing dot next to the AI\'s latest message reflects its emotional state. It shifts as the conversation deepens.',
    accent: '#e6a05e',
  },
  {
    icon: '👉',
    title: 'You can poke it',
    body: 'When the text field is empty, you\'ll see actions like Poke, Wave, or Whisper. Use them to provoke a reaction from the AI without typing a message.',
    accent: '#7acc88',
  },
]

export default function Onboarding() {
  const [visible, setVisible] = useState(false)
  const [current, setCurrent] = useState(0)
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        // Small delay so the page loads first
        const t = setTimeout(() => setVisible(true), 800)
        return () => clearTimeout(t)
      }
    } catch { /* localStorage blocked */ }
  }, [])

  function dismiss() {
    setExiting(true)
    setTimeout(() => {
      setVisible(false)
      try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    }, 300)
  }

  function next() {
    if (current < SLIDES.length - 1) {
      setCurrent(c => c + 1)
    } else {
      dismiss()
    }
  }

  if (!visible) return null

  const slide = SLIDES[current]
  const isLast = current === SLIDES.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-5"
      style={{
        background: 'rgba(8, 8, 16, 0.85)',
        backdropFilter: 'blur(8px)',
        animation: exiting ? 'fadeOut 0.3s ease-out forwards' : 'fadeIn 0.4s ease-out',
      }}
      onClick={dismiss}
    >
      <div
        className="relative max-w-md w-full rounded-2xl px-8 py-8"
        style={{
          background: 'rgba(18, 18, 30, 0.95)',
          border: '1px solid rgba(255,255,255,0.06)',
          boxShadow: `0 0 60px ${slide.accent}10, 0 4px 40px rgba(0,0,0,0.5)`,
          animation: exiting ? 'none' : 'scaleIn 0.35s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Icon */}
        <div
          className="text-center mb-5"
          key={current}
          style={{ animation: 'fadeIn 0.3s ease-out' }}
        >
          <span
            style={{
              fontSize: '2.2rem',
              display: 'inline-block',
              filter: `drop-shadow(0 0 12px ${slide.accent}60)`,
            }}
          >
            {slide.icon}
          </span>
        </div>

        {/* Content */}
        <div key={`content-${current}`} style={{ animation: 'fadeIn 0.3s ease-out 0.05s both' }}>
          <h2
            className="text-heading-2 text-center mb-3"
            style={{ color: '#e8e8f0', fontWeight: 600 }}
          >
            {slide.title}
          </h2>
          <p
            className="text-body-sm text-center mb-6"
            style={{ color: '#b0b0c4', lineHeight: '1.6' }}
          >
            {slide.body}
          </p>
        </div>

        {/* Progress dots + buttons */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className="rounded-full transition-all duration-200"
                style={{
                  width: i === current ? 16 : 5,
                  height: 5,
                  background: i === current ? slide.accent : 'rgba(255,255,255,0.12)',
                }}
              />
            ))}
          </div>

          <div className="flex items-center gap-3">
            {!isLast && (
              <button
                onClick={dismiss}
                className="text-caption px-3 py-1.5 rounded-lg cursor-pointer transition-opacity duration-150"
                style={{ color: '#888', opacity: 0.7 }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '0.7')}
              >
                Skip
              </button>
            )}
            <button
              onClick={next}
              className="text-body-sm font-medium px-5 py-2 rounded-xl cursor-pointer transition-all duration-200 hover:scale-[1.03]"
              style={{
                background: slide.accent,
                color: '#fff',
                boxShadow: `0 0 20px ${slide.accent}30`,
              }}
            >
              {isLast ? 'Got it' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
