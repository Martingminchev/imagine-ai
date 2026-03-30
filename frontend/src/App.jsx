import { useState, useEffect } from 'react'
import Chat from './components/Chat'
import CompareView from './components/CompareView'
import StatusBar from './components/StatusBar'
import ConversationList from './components/ConversationList'
import DuetView from './components/DuetView'
import FieldView from './components/FieldView'
import InnerView from './components/InnerView'
import InstancesView from './components/InstancesView'
import RecordingsView from './components/RecordingsView'
import PersonalityPicker from './components/PersonalityPicker'
import CharacterCreator from './components/CharacterCreator'
import { ApiKeysPanel, loadFromStorage } from './components/ApiKeysPanel'
import { SettingsPanel, loadSettingsFromStorage } from './components/SettingsPanel'
import { sendMessage, sendMessageStream, compareMessage, getHistory, createSSEConnection } from './api/chat'
import './App.css'

const MODEL_OPTIONS = [
  { value: 'moonshot:kimi-k2.5', label: 'Kimi K2.5' },
  { value: '', label: 'Ollama (local)' },
  { value: 'gemini:gemini-3-pro-preview', label: 'Gemini 3 Pro' },
  { value: 'gemini:gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'gemini:gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { value: 'gemini:gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { value: 'gemini:gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite' },
]

const CONVERSATIONS_KEY = 'hornai_conversations'

function loadConversationsFromStorage() {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (!raw) {
      const first = {
        id: 'default',
        title: 'Conversation 1',
        createdAt: new Date().toISOString(),
        preview: ''
      }
      return [first]
    }
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
  } catch (e) {
    // ignore
  }
  const fallback = {
    id: 'default',
    title: 'Conversation 1',
    createdAt: new Date().toISOString(),
    preview: ''
  }
  return [fallback]
}

function saveConversationsToStorage(conversations) {
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations))
  } catch (e) {
    // ignore
  }
}

function App() {
  const [mode, setMode] = useState('compare') // 'chat' | 'compare' | 'duet' | 'field' | 'inner'
  const [messages, setMessages] = useState([])
  const [hasMoreMessages, setHasMoreMessages] = useState(true)
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false)
  const [comparePairs, setComparePairs] = useState([])
  const [loading, setLoading] = useState(false)
  const [meta, setMeta] = useState(null)
  const [error, setError] = useState(null)
  const [streamingMsg, setStreamingMsg] = useState(null)
  const [pipelineSteps, setPipelineSteps] = useState([])
  const [selectedModel, setSelectedModel] = useState('moonshot:kimi-k2.5')
  const [apiKeys, setApiKeys] = useState(() => loadFromStorage())
  const [showKeysPanel, setShowKeysPanel] = useState(false)
  const [memorySettings, setMemorySettings] = useState(() => loadSettingsFromStorage())
  const [showSettingsPanel, setShowSettingsPanel] = useState(false)
  const [showPersonalityPicker, setShowPersonalityPicker] = useState(false)
  const [showCharacterCreator, setShowCharacterCreator] = useState(false)
  const [conversations, setConversations] = useState(() => loadConversationsFromStorage())
  const [currentConversationId, setCurrentConversationId] = useState(
    () => loadConversationsFromStorage()[0]?.id || 'default'
  )

  useEffect(() => {
    loadHistory(currentConversationId)
  }, [currentConversationId])

  // Listen for initiative messages (AI reaching out) via SSE
  useEffect(() => {
    const sse = createSSEConnection(currentConversationId)

    sse.addEventListener('initiative', (e) => {
      try {
        const data = JSON.parse(e.data)
        const initiativeMsg = {
          _id: data.id || `init-${Date.now()}`,
          text: data.content,
          role: 'initiative',
          timestamp: data.timestamp || new Date().toISOString()
        }
        setMessages(prev => [...prev, initiativeMsg])
      } catch (err) { /* ignore malformed */ }
    })

    return () => sse.close()
  }, [currentConversationId])

  async function loadHistory(conversationId) {
    try {
      setHasMoreMessages(true)
      const data = await getHistory(conversationId)
      if (data.ok && data.messages) {
        setMessages(data.messages)
        setHasMoreMessages(data.hasMore ?? data.messages.length >= 50)
        // update preview for this conversation
        const last = data.messages[data.messages.length - 1]
        setConversations(prev => {
          const next = prev.map(conv => {
            if (conv.id !== conversationId) return conv
            return {
              ...conv,
              preview: last ? (last.text || '').slice(0, 60) : conv.preview
            }
          })
          saveConversationsToStorage(next)
          return next
        })
      }
    } catch (err) {
      // No history yet
    }
  }

  async function loadOlderMessages() {
    if (isLoadingOlderMessages || !hasMoreMessages || messages.length === 0) return
    setIsLoadingOlderMessages(true)
    try {
      const oldest = messages[0]
      const data = await getHistory(currentConversationId, 50, oldest.timestamp)
      if (data.ok && data.messages && data.messages.length > 0) {
        setMessages(prev => [...data.messages, ...prev])
        setHasMoreMessages(data.hasMore ?? data.messages.length >= 50)
      } else {
        setHasMoreMessages(false)
      }
    } catch (err) {
      // ignore
    } finally {
      setIsLoadingOlderMessages(false)
    }
  }

  function handleNewConversation() {
    setShowPersonalityPicker(true)
  }

  function handleGestationComplete({ conversationId, name, memoryCount }) {
    const conv = {
      id: conversationId,
      title: name || 'A Life',
      createdAt: new Date().toISOString(),
      preview: `Born with ${memoryCount} memories`,
      personality: 'gestated',
      personalityName: 'Gestated',
      personalityColor: '#a78bfa'
    }
    setConversations(prev => {
      const next = [conv, ...prev]
      saveConversationsToStorage(next)
      return next
    })
    setCurrentConversationId(conversationId)
    setMessages([])
    setMeta(null)
    setShowCharacterCreator(false)
    setShowPersonalityPicker(false)
  }

  function handlePersonalitySelected(personality) {
    const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const conv = {
      id,
      title: 'New conversation',
      createdAt: new Date().toISOString(),
      preview: '',
      personality: personality.id,
      personalityName: personality.name,
      personalityColor: personality.color
    }
    setConversations(prev => {
      const next = [conv, ...prev]
      saveConversationsToStorage(next)
      return next
    })
    setCurrentConversationId(id)
    setMessages([])
    setMeta(null)
    setShowPersonalityPicker(false)
  }

  function handleSelectConversation(id) {
    if (id === currentConversationId) return
    setCurrentConversationId(id)
    setMessages([])
    setMeta(null)
  }

  async function handleSend(text) {
    setError(null)
    setLoading(true)
    setPipelineSteps([])
    setStreamingMsg(null)

    const userMsg = { text, role: 'user', timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])

    // update title / preview for this conversation
    setConversations(prev => {
      const next = prev.map(conv => {
        if (conv.id !== currentConversationId) return conv
        const title =
          conv.title === 'New conversation' || !conv.title
            ? text.slice(0, 40)
            : conv.title
        return {
          ...conv,
          title,
          preview: text.slice(0, 60)
        }
      })
      saveConversationsToStorage(next)
      return next
    })

    try {
      const currentConv = conversations.find(c => c.id === currentConversationId)
      const opts = {
        model: selectedModel || undefined,
        geminiApiKey: apiKeys.gemini || undefined,
        moonshotApiKey: apiKeys.moonshot || undefined,
        memorySettings,
        personality: currentConv?.personality || undefined
      }

      let accText = ''
      let accThinking = ''
      let streamStarted = false

      await sendMessageStream(text, currentConversationId, opts, ({ event, data }) => {
        if (event === 'step') {
          setPipelineSteps(prev => [...prev, data])
        } else if (event === 'thinking') {
          accThinking += data.text
          if (!streamStarted) {
            streamStarted = true
            setStreamingMsg({ text: '', thinking: accThinking })
          } else {
            setStreamingMsg(prev => ({ ...prev, thinking: accThinking }))
          }
        } else if (event === 'token') {
          accText += data.text
          if (!streamStarted) {
            streamStarted = true
            setStreamingMsg({ text: accText, thinking: accThinking || undefined })
          } else {
            setStreamingMsg(prev => ({ ...prev, text: accText }))
          }
        } else if (event === 'done') {
          // Finalize: move streaming msg to messages array
          const aiMsg = {
            text: accText,
            role: 'ai',
            timestamp: new Date().toISOString(),
            thinking: accThinking || undefined
          }
          setMessages(prev => [...prev, aiMsg])
          setStreamingMsg(null)
          setPipelineSteps([])
          setMeta(data.meta)
        } else if (event === 'error') {
          setError(data.message || 'Stream error')
        }
      })
    } catch (err) {
      setError(err.message || 'Failed to connect')
      setStreamingMsg(null)
      setPipelineSteps([])
    } finally {
      setLoading(false)
    }
  }

  async function handleCompare(text) {
    setError(null)
    setLoading(true)

    try {
      const opts = {
        model: selectedModel || undefined,
        geminiApiKey: apiKeys.gemini || undefined,
        moonshotApiKey: apiKeys.moonshot || undefined,
        memorySettings
      }
      const data = await compareMessage(text, currentConversationId, opts)
      if (data.ok) {
        setComparePairs(prev => [...prev, {
          userMessage: text,
          vanillaResponse: data.vanilla.response,
          vanillaPrompt: data.vanilla.systemPrompt,
          hornResponse: data.horn.response,
          hornPrompt: data.horn.systemPrompt,
          meta: data.horn.meta
        }])
        setMeta(data.horn.meta)
      } else {
        setError(data.message || 'Something went wrong')
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Failed to connect')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`app ${(mode === 'compare' || mode === 'duet' || mode === 'field' || mode === 'inner' || mode === 'instances' || mode === 'recordings') ? 'app-wide' : ''}`}>
      <header className="app-header">
        <div className="app-header-top">
          <h1 className="app-title">Horn AI</h1>
          <div className="header-controls">
            <select
              className="model-select"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              {MODEL_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="api-keys-btn"
              onClick={() => setShowSettingsPanel(true)}
              title="Memory Settings"
            >
              Memory
            </button>
            <button
              type="button"
              className="api-keys-btn"
              onClick={() => setShowKeysPanel(true)}
              title="API Keys"
            >
              Keys
            </button>
            <div className="mode-toggle">
              <button
                className={`mode-btn ${mode === 'chat' ? 'active' : ''}`}
                onClick={() => setMode('chat')}
              >
                Chat
              </button>
              <button
                className={`mode-btn ${mode === 'compare' ? 'active' : ''}`}
                onClick={() => setMode('compare')}
              >
                Compare
              </button>
              <button
                className={`mode-btn ${mode === 'duet' ? 'active' : ''}`}
                onClick={() => setMode('duet')}
              >
                Duet
              </button>
              <button
                className={`mode-btn ${mode === 'field' ? 'active' : ''}`}
                onClick={() => setMode('field')}
              >
                Field
              </button>
              <button
                className={`mode-btn ${mode === 'inner' ? 'active' : ''}`}
                onClick={() => setMode('inner')}
              >
                Inner
              </button>
              <button
                className={`mode-btn ${mode === 'instances' ? 'active' : ''}`}
                onClick={() => setMode('instances')}
              >
                Instances
              </button>
              <button
                className={`mode-btn ${mode === 'recordings' ? 'active' : ''}`}
                onClick={() => setMode('recordings')}
              >
                Recordings
              </button>
            </div>
          </div>
        </div>
        {mode === 'chat' && <StatusBar meta={meta} />}
      </header>

      {mode === 'chat' && (
        <div className="chat-layout">
          <ConversationList
            conversations={conversations}
            currentId={currentConversationId}
            onSelect={handleSelectConversation}
            onNew={handleNewConversation}
          />
          <Chat 
            messages={messages} 
            onSend={handleSend} 
            loading={loading} 
            streamingMsg={streamingMsg} 
            pipelineSteps={pipelineSteps} 
            onLoadMore={loadOlderMessages} 
            hasMoreMessages={hasMoreMessages} 
            isLoadingOlderMessages={isLoadingOlderMessages}
            conversationId={currentConversationId}
            onConcernUpdate={() => {
              // Refresh messages when concerns are updated
              loadHistory(currentConversationId)
            }}
          />
        </div>
      )}

      {mode === 'compare' && (
        <CompareView pairs={comparePairs} onSend={handleCompare} loading={loading} />
      )}

      {mode === 'duet' && (
        <DuetView
          apiKeys={apiKeys}
          memorySettings={memorySettings}
        />
      )}

      {mode === 'field' && (
        <FieldView conversationId={currentConversationId} />
      )}

      {mode === 'inner' && (
        <InnerView conversationId={currentConversationId} apiKeys={apiKeys} selectedModel={selectedModel} />
      )}

      {mode === 'recordings' && (
        <RecordingsView conversationId={currentConversationId} />
      )}

      {mode === 'instances' && (
        <InstancesView
          onDelete={(deletedId) => {
            // Remove from localStorage conversations list if present
            setConversations(prev => {
              const next = prev.filter(c => c.id !== deletedId)
              if (next.length === 0) {
                const fallback = {
                  id: 'default',
                  title: 'Conversation 1',
                  createdAt: new Date().toISOString(),
                  preview: ''
                }
                saveConversationsToStorage([fallback])
                return [fallback]
              }
              saveConversationsToStorage(next)
              return next
            })
            // If deleted conversation is the current one, switch away
            if (deletedId === currentConversationId) {
              setConversations(prev => {
                const first = prev[0]
                if (first) setCurrentConversationId(first.id)
                return prev
              })
              setMessages([])
              setMeta(null)
            }
          }}
        />
      )}

      {showPersonalityPicker && !showCharacterCreator && (
        <PersonalityPicker
          onSelect={handlePersonalitySelected}
          onCancel={() => setShowPersonalityPicker(false)}
          onCreateLife={() => setShowCharacterCreator(true)}
        />
      )}

      {showCharacterCreator && (
        <CharacterCreator
          onComplete={handleGestationComplete}
          onCancel={() => { setShowCharacterCreator(false); setShowPersonalityPicker(false) }}
          apiKeys={apiKeys}
          selectedModel={selectedModel}
        />
      )}

      {showSettingsPanel && (
        <SettingsPanel
          settings={memorySettings}
          onChange={setMemorySettings}
          onClose={() => setShowSettingsPanel(false)}
          conversationId={currentConversationId}
        />
      )}

      {showKeysPanel && (
        <ApiKeysPanel
          keys={apiKeys}
          onChange={setApiKeys}
          onClose={() => setShowKeysPanel(false)}
        />
      )}

      {error && (
        <div className="app-error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>x</button>
        </div>
      )}
    </div>
  )
}

export default App
