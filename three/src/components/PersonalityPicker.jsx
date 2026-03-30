import { useState, useEffect } from 'react'
import { getPersonalities } from '../api/chat'

const HIDDEN = new Set(['bare', 'raw', 'tabula'])

const TAGLINE_OVERRIDES = {
  ori: 'Curious, warm, and excited to meet you',
  three: 'Thoughtful, honest, and curious',
  kael: 'Direct and cuts through the noise',
  noor: 'Warm listener who asks the right questions',
  vex: 'Creative, playful, full of surprises',
  sage: 'Patient, precise, and deeply thoughtful',
}

const AVATARS = {
  ori: 'https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=Ori&backgroundColor=b6e3f4',
  three: 'https://api.dicebear.com/9.x/bottts-neutral/svg?seed=Three&backgroundColor=c0aede',
  kael: 'https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=Kael&backgroundColor=ffdfbf',
  noor: 'https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=Noor&backgroundColor=d1f4d1',
  vex: 'https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=Vex&backgroundColor=f0d1ff',
  sage: 'https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=Sage&backgroundColor=bfdfff',
}

function Avatar({ id, size = 48 }) {
  const url = AVATARS[id]
  if (!url) return null
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className="rounded-full shrink-0"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    />
  )
}

export default function PersonalityPicker({ onSelect, onCancel, onCreateLife }) {
  const [personalities, setPersonalities] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('start')
  const [hoveredId, setHoveredId] = useState(null)

  useEffect(() => {
    getPersonalities()
      .then(data => {
        if (data.ok) {
          setPersonalities(
            data.personalities
              .filter(p => !HIDDEN.has(p.id))
              .map(p => ({ ...p, tagline: TAGLINE_OVERRIDES[p.id] || p.tagline }))
          )
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const ori = personalities.find(p => p.id === 'ori')
  const three = personalities.find(p => p.id === 'three')

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }} onClick={onCancel}>
        <div className="flex gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)', animation: 'pulse 1.2s ease-in-out infinite' }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)', animation: 'pulse 1.2s ease-in-out 0.15s infinite' }} />
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-accent)', animation: 'pulse 1.2s ease-in-out 0.3s infinite' }} />
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)' }}
      onClick={onCancel}
    >
      <div
        className="w-full max-w-lg rounded-2xl p-6 sm:p-7 relative overflow-hidden"
        style={{
          background: 'var(--color-glass-bg)',
          border: '1px solid var(--color-glass-border)',
          backdropFilter: 'blur(24px)',
          boxShadow: '0 0 50px rgba(0,0,0,0.35), 0 0 100px rgba(110,110,255,0.04)',
          animation: 'scaleIn 0.2s ease-out',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Top highlight */}
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(to right, transparent, rgba(255,255,255,0.05), transparent)' }} />

        {view === 'start' ? (
          <StartView
            ori={ori}
            three={three}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            onSelect={onSelect}
            onCancel={onCancel}
            onCreateLife={onCreateLife}
            onSeeAll={() => setView('all')}
          />
        ) : (
          <AllView
            personalities={personalities}
            hoveredId={hoveredId}
            setHoveredId={setHoveredId}
            onSelect={onSelect}
            onCancel={onCancel}
            onCreateLife={onCreateLife}
            onBack={() => setView('start')}
          />
        )}
      </div>
    </div>
  )
}

/* ── Start View ──────────────────────────────────────────────── */

function StartView({ ori, three, hoveredId, setHoveredId, onSelect, onCancel, onCreateLife, onSeeAll }) {
  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-heading-2" style={{ color: 'var(--color-text)' }}>
          Who do you want to talk to?
        </h2>
        <CloseButton onClick={onCancel} />
      </div>

      <div className="space-y-2.5">
        {/* Ori — recommended */}
        {ori && (
          <button
            onClick={() => onSelect(ori)}
            onMouseEnter={() => setHoveredId('ori')}
            onMouseLeave={() => setHoveredId(null)}
            className="w-full text-left rounded-xl p-5 transition-all duration-200 cursor-pointer relative overflow-hidden group"
            style={{
              background: hoveredId === 'ori' ? 'rgba(94,196,230,0.04)' : 'rgba(255,255,255,0.015)',
              border: `1px solid ${hoveredId === 'ori' ? 'rgba(94,196,230,0.25)' : 'var(--color-glass-border)'}`,
              boxShadow: hoveredId === 'ori' ? '0 0 30px rgba(94,196,230,0.06), 0 4px 16px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            <div className="flex items-start gap-4">
              <Avatar id="ori" size={56} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 mb-1">
                  <span className="text-body-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                    {ori.name}
                  </span>
                  <span
                    className="text-label px-2 py-0.5 rounded-full"
                    style={{
                      background: 'rgba(94,196,230,0.10)',
                      color: '#5ec4e6',
                      border: '1px solid rgba(94,196,230,0.15)',
                      fontSize: '0.6rem',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                    }}
                  >
                    Recommended
                  </span>
                </div>
                <p className="text-body-sm mb-1.5" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
                  First time? Start here.
                </p>
                <p className="text-caption" style={{ color: 'var(--color-text-dim)', lineHeight: '1.5' }}>
                  {ori.tagline}
                </p>
              </div>
            </div>
          </button>
        )}

        {/* Three — the original */}
        {three && (
          <button
            onClick={() => onSelect(three)}
            onMouseEnter={() => setHoveredId('three')}
            onMouseLeave={() => setHoveredId(null)}
            className="w-full text-left rounded-xl p-5 transition-all duration-200 cursor-pointer relative overflow-hidden group"
            style={{
              background: hoveredId === 'three' ? 'rgba(108,108,255,0.04)' : 'rgba(255,255,255,0.015)',
              border: `1px solid ${hoveredId === 'three' ? 'rgba(108,108,255,0.25)' : 'var(--color-glass-border)'}`,
              boxShadow: hoveredId === 'three' ? '0 0 30px rgba(108,108,255,0.06), 0 4px 16px rgba(0,0,0,0.12)' : 'none',
            }}
          >
            <div className="flex items-start gap-4">
              <Avatar id="three" size={56} />
              <div className="min-w-0 flex-1">
                <span className="text-body-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Three
                </span>
                <p className="text-body-sm mt-1 mb-1.5" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
                  The original. Where it all started.
                </p>
                <p className="text-caption flex items-center gap-1.5" style={{ color: 'var(--color-text-dim)', lineHeight: '1.5' }}>
                  <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>⚠</span>
                  Experimental — the first of its kind
                </p>
              </div>
            </div>
          </button>
        )}

        {/* Create a Life */}
        {onCreateLife && (
          <button
            onClick={onCreateLife}
            onMouseEnter={() => setHoveredId('__create__')}
            onMouseLeave={() => setHoveredId(null)}
            className="w-full text-left rounded-xl p-5 transition-all duration-200 cursor-pointer relative overflow-hidden"
            style={{
              background: hoveredId === '__create__' ? 'rgba(167,139,250,0.03)' : 'rgba(255,255,255,0.015)',
            }}
          >
            <div
              className="absolute inset-0 rounded-xl pointer-events-none"
              style={{
                border: '1px dashed',
                borderColor: hoveredId === '__create__' ? 'rgba(167,139,250,0.35)' : 'var(--color-glass-border)',
                transition: 'border-color 0.2s',
              }}
            />
            {hoveredId === '__create__' && (
              <div className="absolute inset-0 rounded-xl pointer-events-none" style={{ boxShadow: '0 0 24px rgba(167,139,250,0.06)' }} />
            )}
            <div className="flex items-center gap-4 relative z-10">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: 'rgba(167,139,250,0.06)',
                  border: '1px solid rgba(167,139,250,0.12)',
                }}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <div>
                <span className="text-body-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  Create a Life
                </span>
                <p className="text-caption mt-0.5" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
                  Design your own character with a full history
                </p>
              </div>
            </div>
          </button>
        )}
      </div>

      {/* See all link */}
      <button
        onClick={onSeeAll}
        className="mt-4 w-full text-center py-2 transition-opacity duration-150 cursor-pointer"
        style={{ color: 'var(--color-text-dim)', opacity: 0.6 }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
      >
        <span className="text-caption">See all characters →</span>
      </button>
    </>
  )
}

/* ── All View ────────────────────────────────────────────────── */

function AllView({ personalities, hoveredId, setHoveredId, onSelect, onCancel, onCreateLife, onBack }) {
  return (
    <>
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-caption transition-opacity duration-150 cursor-pointer"
            style={{ color: 'var(--color-text-dim)', opacity: 0.6 }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '0.6')}
          >
            ← Back
          </button>
          <h2 className="text-heading-2" style={{ color: 'var(--color-text)' }}>
            All characters
          </h2>
        </div>
        <CloseButton onClick={onCancel} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {personalities.map((p, i) => {
          const isHovered = hoveredId === p.id
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              onMouseEnter={() => setHoveredId(p.id)}
              onMouseLeave={() => setHoveredId(null)}
              className="text-left rounded-xl p-4 transition-all duration-150 cursor-pointer hover:scale-[1.02] relative overflow-hidden"
              style={{
                background: isHovered ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)',
                border: `1px solid ${isHovered ? (p.color + '35') : 'var(--color-glass-border)'}`,
                boxShadow: isHovered ? `0 0 20px ${p.color}10, 0 2px 12px rgba(0,0,0,0.15)` : 'none',
                animation: `scaleIn ${0.18 + i * 0.035}s ease-out both`,
              }}
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <Avatar id={p.id} size={28} />
                <span className="text-body-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                  {p.name}
                </span>
              </div>
              <p className="text-caption" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
                {p.tagline}
              </p>
            </button>
          )
        })}

        {/* Create a Life */}
        {onCreateLife && (
          <button
            onClick={onCreateLife}
            onMouseEnter={() => setHoveredId('__create__')}
            onMouseLeave={() => setHoveredId(null)}
            className="text-left rounded-xl p-4 transition-all duration-150 cursor-pointer hover:scale-[1.02] relative overflow-hidden"
            style={{
              background: hoveredId === '__create__' ? 'rgba(167,139,250,0.03)' : 'rgba(255,255,255,0.015)',
              animation: `scaleIn ${0.18 + personalities.length * 0.035}s ease-out both`,
            }}
          >
            <div
              className="absolute inset-0 rounded-xl pointer-events-none"
              style={{
                border: '1px dashed',
                borderColor: hoveredId === '__create__' ? 'rgba(167,139,250,0.4)' : 'var(--color-glass-border)',
                transition: 'border-color 0.15s',
              }}
            />
            <div className="flex items-center gap-2.5 mb-1.5 relative z-10">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: 'rgba(167,139,250,0.06)',
                  border: '1px solid rgba(167,139,250,0.12)',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </div>
              <span className="text-body-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Create a Life
              </span>
            </div>
            <p className="text-caption relative z-10" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.5' }}>
              Design a character with a full history
            </p>
          </button>
        )}
      </div>
    </>
  )
}

/* ── Shared ───────────────────────────────────────────────────── */

function CloseButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150 cursor-pointer"
      style={{ color: 'var(--color-text-dim)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  )
}
