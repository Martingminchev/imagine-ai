import { useState } from 'react'

const STORAGE_KEY = 'hornai_api_keys'

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { gemini: '', moonshot: '' }
    const parsed = JSON.parse(raw)
    return { gemini: parsed.gemini || '', moonshot: parsed.moonshot || '' }
  } catch {
    return { gemini: '', moonshot: '' }
  }
}

function saveToStorage(keys) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys))
  } catch {}
}

function ApiKeysPanel({ keys, onChange, onClose }) {
  const [gemini, setGemini] = useState(keys.gemini)
  const [moonshot, setMoonshot] = useState(keys.moonshot)

  function handleSave() {
    const next = { gemini: gemini.trim(), moonshot: moonshot.trim() }
    saveToStorage(next)
    onChange(next)
    onClose()
  }

  return (
    <div className="api-keys-overlay" onClick={onClose}>
      <div className="api-keys-panel" onClick={e => e.stopPropagation()}>
        <div className="api-keys-header">
          <h3>API Keys</h3>
          <button type="button" className="api-keys-close" onClick={onClose}>×</button>
        </div>
        <p className="api-keys-hint">Keys are saved in your browser. They override .env when provided.</p>
        <div className="api-keys-fields">
          <label>
            <span>Gemini (Google AI Studio)</span>
            <input
              type="password"
              value={gemini}
              onChange={e => setGemini(e.target.value)}
              placeholder="AIza..."
              autoComplete="off"
            />
          </label>
          <label>
            <span>Moonshot (Kimi)</span>
            <input
              type="password"
              value={moonshot}
              onChange={e => setMoonshot(e.target.value)}
              placeholder="sk-..."
              autoComplete="off"
            />
          </label>
        </div>
        <div className="api-keys-actions">
          <button type="button" className="api-keys-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="api-keys-save" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}

export { loadFromStorage, ApiKeysPanel }
