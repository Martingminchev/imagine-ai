import { useState, useEffect } from 'react'
import { getPersonalities } from '../api/chat'

function PersonalityPicker({ onSelect, onCancel, onCreateLife }) {
  const [personalities, setPersonalities] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPersonalities()
      .then(data => {
        if (data.ok) setPersonalities(data.personalities)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="api-keys-overlay" onClick={onCancel}>
        <div className="personality-picker" onClick={e => e.stopPropagation()}>
          <div className="personality-loading">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="api-keys-overlay" onClick={onCancel}>
      <div className="personality-picker" onClick={e => e.stopPropagation()}>
        <div className="personality-picker-header">
          <h3>Who do you want to talk to?</h3>
          <button className="api-keys-close" onClick={onCancel}>&times;</button>
        </div>
        <div className="personality-grid">
          {personalities.map(p => (
            <button
              key={p.id}
              className="personality-card"
              onClick={() => onSelect(p)}
              style={{ '--personality-color': p.color }}
            >
              <div className="personality-card-accent" />
              <div className="personality-card-name">{p.name}</div>
              <div className="personality-card-tagline">{p.tagline}</div>
              <div className="personality-card-desc">{p.description}</div>
            </button>
          ))}
          {onCreateLife && (
            <button
              className="personality-card personality-card-create-life"
              onClick={onCreateLife}
              style={{ '--personality-color': '#a78bfa' }}
            >
              <div className="personality-card-accent" />
              <div className="personality-card-name">Create a Life</div>
              <div className="personality-card-tagline">Biographical generator</div>
              <div className="personality-card-desc">
                Define a full life story. The system generates a lifetime of
                memories and births an AI with lived experience.
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default PersonalityPicker
