import React from 'react'

function ConversationList({ conversations, currentId, onSelect, onNew }) {
  return (
    <div className="conversation-sidebar">
      <div className="conversation-header">
        <span className="conversation-title">Conversations</span>
        <button
          type="button"
          className="conversation-new"
          onClick={onNew}
          title="Start a new conversation"
        >
          +
        </button>
      </div>
      <div className="conversation-list">
        {conversations.map(conv => (
          <button
            key={conv.id}
            type="button"
            className={
              'conversation-item' +
              (conv.id === currentId ? ' conversation-item-active' : '')
            }
            onClick={() => onSelect(conv.id)}
          >
            <div className="conversation-item-title">
              {conv.personalityName && (
                <span
                  className="conversation-personality-dot"
                  style={{ background: conv.personalityColor || '#6c6cff' }}
                  title={conv.personalityName}
                />
              )}
              {conv.title || 'Untitled'}
            </div>
            {conv.personalityName && (
              <div className="conversation-item-personality">
                {conv.personalityName}
              </div>
            )}
            {conv.preview && (
              <div className="conversation-item-preview">
                {conv.preview}
              </div>
            )}
          </button>
        ))}
        {conversations.length === 0 && (
          <div className="conversation-empty">
            No conversations yet.
          </div>
        )}
      </div>
    </div>
  )
}

export default ConversationList

