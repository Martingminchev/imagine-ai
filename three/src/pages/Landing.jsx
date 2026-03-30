import { Link } from 'react-router-dom'

const FEATURES = [
  'It remembers what you\'ve talked about — and how it felt',
  'Different characters with different personalities, each one unique',
  'The longer you talk, the deeper it gets'
]

export default function Landing() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden px-6">
      {/* Background layers */}
      <div className="absolute inset-0" style={{ background: 'var(--color-bg)' }}>
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 65% 50% at 50% 42%, rgba(110,110,255,0.12) 0%, transparent 72%)',
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse 38% 32% at 28% 52%, rgba(110,110,255,0.06) 0%, transparent 60%), radial-gradient(ellipse 38% 32% at 72% 38%, rgba(140,100,255,0.04) 0%, transparent 60%)',
            animation: 'gradient-shift 20s ease-in-out infinite',
            backgroundSize: '200% 200%',
          }}
        />
      </div>

      {/* Rotating ring */}
      <div
        className="absolute pointer-events-none"
        style={{ width: '400px', height: '400px', top: '50%', left: '50%', transform: 'translate(-50%, -58%)' }}
      >
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: 'conic-gradient(from 0deg, transparent 0%, rgba(110,110,255,0.07) 25%, transparent 50%, rgba(140,100,255,0.05) 75%, transparent 100%)',
            animation: 'ring-spin 32s linear infinite',
            maskImage: 'radial-gradient(circle, transparent 56%, black 57%, black 61%, transparent 62%)',
            WebkitMaskImage: 'radial-gradient(circle, transparent 56%, black 57%, black 61%, transparent 62%)',
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 max-w-md w-full text-center">

        {/* Title */}
        <h1
          className="text-display mb-4"
          style={{
            animation: 'slideUp 0.6s ease-out both',
            textShadow: '0 0 60px rgba(110,110,255,0.18), 0 0 120px rgba(110,110,255,0.06)',
          }}
        >
          Three
        </h1>

        {/* Subtitle */}
        <p
          className="text-body mb-16"
          style={{
            color: 'var(--color-text-secondary)',
            fontSize: '1.125rem',
            lineHeight: '1.55',
            letterSpacing: '-0.014em',
            animation: 'slideUp 0.75s ease-out both',
          }}
        >
          AI that actually remembers your conversations.
        </p>

        {/* Features */}
        <div className="space-y-5 mb-14 text-left max-w-sm mx-auto">
          {FEATURES.map((text, i) => (
            <div
              key={i}
              className="flex items-start pl-5 relative"
              style={{ animation: `slideInRight ${0.7 + i * 0.1}s ease-out both` }}
            >
              {/* Left accent bar */}
              <div
                className="absolute left-0 top-0.5 bottom-0.5 w-[2px] rounded-full"
                style={{
                  background: 'linear-gradient(to bottom, rgba(110,110,255,0.45), rgba(110,110,255,0.08))',
                  boxShadow: '0 0 6px rgba(110,110,255,0.25)',
                }}
              />
              <p className="text-body-sm" style={{ color: 'var(--color-text-secondary)', lineHeight: '1.6' }}>
                {text}
              </p>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div
          className="mx-auto mb-7 h-px max-w-[140px]"
          style={{
            background: 'linear-gradient(to right, transparent, rgba(110,110,255,0.18), transparent)',
            animation: 'fadeIn 1s ease-out both',
          }}
        />

        {/* Tone setter */}
        <p
          className="text-body-sm mb-12 max-w-[300px] mx-auto italic"
          style={{
            color: 'var(--color-text-dim)',
            lineHeight: '1.7',
            animation: 'fadeIn 1s ease-out both',
          }}
        >
          This isn't a search engine. You're stepping into a conversation with something that listens, remembers, and evolves.
          Talk to it like it matters.
        </p>

        {/* CTA */}
        <div style={{ animation: 'slideUp 1.1s ease-out both' }}>
          <Link
            to="/chat"
            className="relative inline-flex items-center justify-center px-10 py-3.5 rounded-full text-body-sm font-medium transition-all duration-300 hover:scale-[1.03] no-underline overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, var(--color-accent) 0%, #8585ff 100%)',
              color: '#fff',
              boxShadow: '0 0 36px rgba(110,110,255,0.22), 0 4px 20px rgba(0,0,0,0.35)',
              letterSpacing: '-0.005em',
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = '0 0 52px rgba(110,110,255,0.3), 0 6px 28px rgba(0,0,0,0.35)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = '0 0 36px rgba(110,110,255,0.22), 0 4px 20px rgba(0,0,0,0.35)'}
          >
            <span
              className="absolute inset-0 pointer-events-none"
              style={{
                background: 'linear-gradient(105deg, transparent 42%, rgba(255,255,255,0.10) 50%, transparent 58%)',
                animation: 'shimmer 3.5s ease-in-out infinite',
              }}
            />
            <span className="relative z-10">Start talking</span>
          </Link>
        </div>

        {/* Early access pill */}
        <div className="mt-10" style={{ animation: 'fadeIn 1.4s ease-out both' }}>
          <span
            className="text-label inline-block px-4 py-1.5 rounded-full"
            style={{
              color: 'var(--color-text-dim)',
              border: '1px solid rgba(110,110,255,0.12)',
              background: 'rgba(110,110,255,0.03)',
              letterSpacing: '0.08em',
              fontSize: '0.625rem',
            }}
          >
            Early access — you're among the first
          </span>
        </div>
      </div>

      {/* Footer mark */}
      <div className="absolute bottom-5 text-center">
        <p className="text-caption" style={{ color: 'var(--color-text-dim)', opacity: 0.3, letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: '0.6rem' }}>
          Three
        </p>
      </div>
    </div>
  )
}
