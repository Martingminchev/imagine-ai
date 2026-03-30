import { useState } from 'react'

export default function ConversationSidebar({ conversations, currentId, onSelect, onNew, onDelete, isOpen, onClose }) {
  const [hoveredId, setHoveredId] = useState(null)

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 lg:hidden transition-all duration-300"
          style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }}
          onClick={onClose}
        />
      )}

      <div
        className={`fixed lg:relative top-0 left-0 h-full z-50 lg:z-auto transition-transform duration-300 ease-in-out flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        style={{
          width: '272px',
          background: 'var(--color-bg-secondary)',
          borderRight: '1px solid var(--color-border)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 h-14 shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <span
            className="text-body-sm font-semibold"
            style={{
              color: 'var(--color-text)',
              letterSpacing: '-0.02em',
              textShadow: '0 0 28px rgba(110,110,255,0.1)',
            }}
          >
            Three
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={onNew}
              className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150 cursor-pointer"
              style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={e => {
                e.currentTarget.style.background = 'rgba(110,110,255,0.08)'
                e.currentTarget.style.color = 'var(--color-text)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = 'transparent'
                e.currentTarget.style.color = 'var(--color-text-secondary)'
              }}
              title="New conversation"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer lg:hidden"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {conversations.map(conv => {
            const isActive = conv.id === currentId
            const isHovered = hoveredId === conv.id
            const dotColor = conv.personalityColor || 'var(--color-accent)'

            return (
              <button
                key={conv.id}
                onClick={() => { onSelect(conv.id); onClose() }}
                onMouseEnter={() => setHoveredId(conv.id)}
                onMouseLeave={() => setHoveredId(null)}
                className="w-full text-left px-5 py-3 transition-all duration-150 relative cursor-pointer"
                style={{
                  background: isActive
                    ? 'rgba(110,110,255,0.05)'
                    : isHovered
                      ? 'rgba(255,255,255,0.02)'
                      : 'transparent',
                }}
              >
                {/* Active bar */}
                <div
                  className="absolute left-0 top-2.5 bottom-2.5 w-[2px] rounded-full transition-all duration-150"
                  style={{
                    background: isActive ? 'var(--color-accent)' : 'transparent',
                    boxShadow: isActive ? '0 0 6px rgba(110,110,255,0.35)' : 'none',
                    opacity: isActive ? 1 : 0,
                  }}
                />

                <div className="flex items-center gap-2.5 mb-0.5">
                  {conv.personalityColor && (
                    <span
                      className="w-2 h-2 rounded-full shrink-0 transition-shadow duration-200"
                      style={{
                        background: dotColor,
                        boxShadow: isHovered || isActive ? `0 0 5px ${dotColor}50` : 'none',
                      }}
                    />
                  )}
                  <span
                    className="text-body-sm font-medium truncate transition-colors duration-150"
                    style={{ color: isActive ? 'var(--color-text)' : 'var(--color-text-secondary)' }}
                  >
                    {conv.title || 'Untitled'}
                  </span>
                </div>

                {conv.personalityName && (
                  <div className="text-caption truncate ml-[18px]" style={{ color: 'var(--color-text-dim)' }}>
                    {conv.personalityName}
                  </div>
                )}
                {conv.preview && (
                  <div className="text-caption truncate mt-0.5 ml-[18px]" style={{ color: 'var(--color-text-dim)' }}>
                    {conv.preview}
                  </div>
                )}

                {/* Delete */}
                {isHovered && onDelete && (
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(conv.id) }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md transition-all duration-150 cursor-pointer"
                    style={{
                      color: 'var(--color-text-dim)',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid var(--color-glass-border)',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(255,70,70,0.08)'
                      e.currentTarget.style.borderColor = 'rgba(255,70,70,0.15)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'rgba(255,255,255,0.03)'
                      e.currentTarget.style.borderColor = 'var(--color-glass-border)'
                    }}
                    title="Delete"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </button>
            )
          })}

          {conversations.length === 0 && (
            <div className="px-5 py-10 text-center">
              <p className="text-body-sm" style={{ color: 'var(--color-text-dim)', animation: 'fadeIn 0.4s ease-out' }}>
                No conversations yet.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
