function StatusBar({ meta }) {
  if (!meta) return null

  return (
    <div className="status-bar">
      <div className="status-item">
        <span className="status-label">memories</span>
        <span className="status-value">{meta.memoryDepth || 0}</span>
      </div>
      <div className="status-item">
        <span className="status-label">dissonance</span>
        <span className="status-value">{(meta.dissonance || 0).toFixed(2)}</span>
      </div>
      <div className="status-item">
        <span className="status-label">frequencies</span>
        <span className="status-value">{meta.frequenciesMatched || 0}</span>
      </div>
      {meta.spectrum && meta.spectrum.length > 0 && (
        <div className="status-item status-spectrum">
          <span className="status-label">spectrum</span>
          <span className="status-value">
            {meta.spectrum.map(s => s.word).join(' · ')}
          </span>
        </div>
      )}
    </div>
  )
}

export default StatusBar
