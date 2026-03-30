import { useState } from 'react'

function SystemPrompt({ prompt, label }) {
  const [open, setOpen] = useState(false)

  if (!prompt) return null

  return (
    <div className="system-prompt">
      <button className="system-prompt-toggle" onClick={() => setOpen(!open)}>
        <span className={`system-prompt-arrow ${open ? 'open' : ''}`}>&#9654;</span>
        <span className="system-prompt-label">{label || 'System Prompt'}</span>
      </button>
      {open && (
        <pre className="system-prompt-content">{prompt}</pre>
      )}
    </div>
  )
}

export default SystemPrompt
