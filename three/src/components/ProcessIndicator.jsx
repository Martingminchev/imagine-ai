/**
 * Live pipeline step indicator — shows what the AI is doing right now.
 * Displays the latest translated step with a subtle pulse + fade.
 */
export default function ProcessIndicator({ steps }) {
  const latest = steps[steps.length - 1]
  if (!latest) return null

  return (
    <div
      key={steps.length}
      className="flex items-center gap-2 py-1.5 px-1"
      style={{ animation: 'fadeIn 0.3s ease-out' }}
    >
      <span
        className="w-1 h-1 rounded-full shrink-0"
        style={{
          background: 'var(--color-accent)',
          opacity: 0.6,
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      />
      <span className="text-caption" style={{ color: 'var(--color-text-dim)' }}>
        {latest}
      </span>
    </div>
  )
}
