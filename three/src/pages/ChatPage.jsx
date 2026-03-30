import { useState, useEffect, useRef } from 'react'
import Chat from '../components/Chat'
import ConversationSidebar from '../components/ConversationSidebar'
import PersonalityPicker from '../components/PersonalityPicker'
import CharacterCreator from '../components/CharacterCreator'
import Onboarding from '../components/Onboarding'
import {
  getHistory,
  sendMessageStream,
  createSSEConnection,
  deleteConversation,
  updateAutonomySettings
} from '../api/chat'

const CONVERSATIONS_KEY = 'three_conversations'

function loadConversationsFromStorage() {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch { return [] }
}

function saveConversationsToStorage(conversations) {
  localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations))
}

/* ─── Pipeline step → user-friendly text ─────────────────────── */

function translateStep(step, detail) {
  switch (step) {
    case 'encode':
      if (detail.includes('vibrations:')) {
        const words = detail.match(/vibrations: (.+)/)?.[1]
        if (words) return `Picking up on: ${words}`
      }
      return 'Listening...'

    case 'hum':
      if (detail.includes('Resonating with:')) {
        const words = detail.replace(/.*Resonating with:\s*/, '').trim()
        if (words && words !== 'stillness') return `Still echoing: ${words}`
      }
      return null

    case 'resonate':
      if (detail.includes('Memory field is empty')) return 'No memories yet — starting fresh'
      if (detail.includes('Reconsolidated')) {
        const n = detail.match(/(\d+)/)?.[1]
        return n > 0 ? `${n} memories shifted from the recall` : null
      }
      if (detail.includes('contradiction')) return 'Holding a contradiction...'
      const memMatch = detail.match(/^(\d+) memories/)
      if (memMatch) {
        const count = parseInt(memMatch[1])
        const vividMatch = detail.match(/(\d+) vivid/)
        const vivid = vividMatch ? parseInt(vividMatch[1]) : 0
        return count === 0
          ? 'Searching memories...'
          : `${count} memories surfaced${vivid > 0 ? `, ${vivid} still vivid` : ''}`
      }
      return 'Searching memories...'

    case 'anticipate':
      if (detail.includes('No active')) return null
      const parts = []
      const conf = detail.match(/(\d+) confirmed/)
      const surp = detail.match(/(\d+) surprised/)
      if (conf) parts.push(parseInt(conf[1]) === 1 ? 'A hunch confirmed' : `${conf[1]} hunches confirmed`)
      if (surp) parts.push(parseInt(surp[1]) === 1 ? 'Caught off guard' : `Caught off guard ${surp[1]} times`)
      return parts.length > 0 ? parts.join(' · ') : null

    case 'measure': return null
    case 'continuity': return null

    case 'compose':
      if (detail.includes('Entropy')) {
        const n = detail.match(/(\d+)/)?.[1]
        return n ? `Reaching for ${n} distant memories...` : 'Reaching into the past...'
      }
      return 'Gathering thoughts...'

    case 'generate': return null // tokens start — the response itself is the visual

    case 'remember':
      if (detail.includes('contradiction')) {
        const n = detail.match(/(\d+)/)?.[1]
        return n > 0 ? `${n} contradictions noticed` : 'Noticed something contradictory'
      }
      return 'Holding onto this...'

    case 'reflect': return 'Something stayed on its mind...'

    case 'project':
      if (detail.includes('No new')) return null
      const expMatch = detail.match(/(\d+) expectations/)
      if (expMatch) {
        const n = parseInt(expMatch[1])
        return n === 1 ? 'Forming an expectation...' : `Imagining ${n} possible futures...`
      }
      return 'Looking ahead...'

    case 'evolve': return 'Growing a little...'

    default: return null
  }
}

/* ─── Extract structured metadata from step events ───────────── */

function extractMeta(step, detail) {
  const meta = {}

  if (step === 'continuity') {
    const moodMatch = detail.match(/mood: ([\w-]+)/)
    const trustMatch = detail.match(/trust: ([\d.]+)/)
    if (moodMatch) meta.mood = moodMatch[1]
    if (trustMatch) meta.trust = parseFloat(trustMatch[1])
  }

  if (step === 'resonate') {
    const memMatch = detail.match(/^(\d+) memories/)
    if (memMatch) meta.memoryCount = parseInt(memMatch[1])
    const vividMatch = detail.match(/(\d+) vivid/)
    if (vividMatch) meta.vividCount = parseInt(vividMatch[1])
  }

  if (step === 'anticipate') {
    const conf = detail.match(/(\d+) confirmed/)
    const surp = detail.match(/(\d+) surprised/)
    if (conf) meta.expectationsConfirmed = parseInt(conf[1])
    if (surp) meta.expectationsSurprised = parseInt(surp[1])
  }

  return Object.keys(meta).length > 0 ? meta : null
}

/* ─── Main component ─────────────────────────────────────────── */

export default function ChatPage() {
  const [conversations, setConversations] = useState(() => loadConversationsFromStorage())
  const [currentConversationId, setCurrentConversationId] = useState(null)
  const [currentPersonality, setCurrentPersonality] = useState(null)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)
  const [streamingMsg, setStreamingMsg] = useState(null)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = useState(false)

  // Pipeline visibility
  const [pipelineSteps, setPipelineSteps] = useState([])
  const pipelineMetaRef = useRef({})
  const pipelineStepsRef = useRef([])

  // Modals & settings
  const [showPersonalityPicker, setShowPersonalityPicker] = useState(false)
  const [showCharacterCreator, setShowCharacterCreator] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [pendingNew, setPendingNew] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [autonomyOn, setAutonomyOn] = useState(true)

  const sseRef = useRef(null)

  useEffect(() => {
    if (conversations.length === 0) {
      setPendingNew(true)
      setShowPersonalityPicker(true)
    } else if (!currentConversationId) {
      setCurrentConversationId(conversations[0].id)
      setCurrentPersonality(conversations[0].personality || null)
    }
  }, [])

  useEffect(() => {
    if (!currentConversationId) return
    loadHistory(currentConversationId)
    connectSSE(currentConversationId)
    return () => { if (sseRef.current) sseRef.current.close() }
  }, [currentConversationId])

  useEffect(() => {
    saveConversationsToStorage(conversations)
  }, [conversations])

  async function loadHistory(convId) {
    try {
      const data = await getHistory(convId, 50)
      if (data.ok) {
        // Filter out hidden system triggers (greetings, nudges)
        const msgs = (data.messages || []).filter(m =>
          !(m.role === 'user' && m.text?.startsWith('[The user'))
        )
        setMessages(msgs)
        setHasMoreMessages(data.hasMore || false)
      }
    } catch { setMessages([]) }
  }

  async function loadMoreMessages() {
    if (!currentConversationId || !hasMoreMessages || isLoadingOlderMessages) return
    setIsLoadingOlderMessages(true)
    try {
      const oldest = messages[0]
      const data = await getHistory(currentConversationId, 30, oldest?.timestamp || null)
      if (data.ok && data.messages?.length > 0) {
        setMessages(prev => [...data.messages, ...prev])
        setHasMoreMessages(data.hasMore || false)
      } else {
        setHasMoreMessages(false)
      }
    } catch { /* silent */ }
    finally { setIsLoadingOlderMessages(false) }
  }

  function connectSSE(convId) {
    if (sseRef.current) sseRef.current.close()
    const sse = createSSEConnection(convId)

    sse.addEventListener('initiative', (e) => {
      try {
        const data = JSON.parse(e.data)
        setMessages(prev => [...prev, {
          _id: data.id || `initiative-${Date.now()}`,
          text: data.content || data.text,
          role: 'initiative',
          gesture: data.gesture || null,
          timestamp: new Date().toISOString()
        }])
      } catch { /* silent */ }
    })

    sseRef.current = sse
  }

  async function handleSend(text) {
    if (!currentConversationId || !text.trim()) return

    const userMsg = {
      _id: `user-${Date.now()}`,
      text,
      role: 'user',
      timestamp: new Date().toISOString()
    }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)
    setStreamingMsg({ text: '' })
    setPipelineSteps([])
    pipelineStepsRef.current = []
    pipelineMetaRef.current = {}

    let fullText = ''
    try {
      await sendMessageStream(
        text,
        currentConversationId,
        { personality: currentPersonality },
        ({ event, data }) => {
          if (event === 'token') {
            fullText += data.text || ''
            setStreamingMsg(prev => ({ ...prev, text: fullText }))

          } else if (event === 'step') {
            // Translate for display
            const translated = translateStep(data.step, data.detail)
            if (translated) {
              pipelineStepsRef.current = [...pipelineStepsRef.current, {
                label: translated,
                step: data.step,
                detail: data.detail || '',
              }]
              setPipelineSteps(prev => [...prev, translated])
            }
            // Extract structured meta
            const meta = extractMeta(data.step, data.detail)
            if (meta) {
              pipelineMetaRef.current = { ...pipelineMetaRef.current, ...meta }
            }

          } else if (event === 'thinking') {
            // Kimi thinking tokens (when thinking mode is enabled)
            pipelineMetaRef.current.thinkingText =
              (pipelineMetaRef.current.thinkingText || '') + (data.text || '')

          } else if (event === 'done') {
            // Build final insight from accumulated meta + done payload
            const insight = {
              ...pipelineMetaRef.current,
              topMemories: data.meta?.topMatches?.map(m => m.text).filter(Boolean) || [],
              memoryDepth: data.meta?.memoryDepth || 0,
              unfinishedThought: data.meta?.unfinishedThought || null,
              expectations: data.meta?.expectations || [],
            }
            // Only attach insight if there's something worth showing
            const hasInsight = insight.mood || insight.trust != null ||
              insight.memoryCount > 0 || insight.topMemories.length > 0 ||
              insight.expectationsConfirmed > 0 || insight.expectationsSurprised > 0 ||
              insight.unfinishedThought || insight.expectations.length > 0

            const steps = pipelineStepsRef.current.length > 0 ? [...pipelineStepsRef.current] : null

            setStreamingMsg(null)
            setPipelineSteps([])
            pipelineStepsRef.current = []
            setMessages(prev => [...prev, {
              _id: data.messageId || `ai-${Date.now()}`,
              text: data.text || fullText,
              role: 'ai',
              timestamp: new Date().toISOString(),
              ...(hasInsight ? { insight } : {}),
              ...(data.meta?.gesture ? { gesture: data.meta.gesture } : {}),
              ...(steps ? { steps } : {}),
            }])

            const preview = (data.text || fullText).slice(0, 80)
            setConversations(prev => prev.map(c =>
              c.id === currentConversationId ? { ...c, preview } : c
            ))

          } else if (event === 'error') {
            setStreamingMsg(null)
            setPipelineSteps([])
            setMessages(prev => [...prev, {
              _id: `err-${Date.now()}`,
              text: data.message || 'Something went wrong.',
              role: 'ai',
              timestamp: new Date().toISOString()
            }])
          }
        }
      )
    } catch (err) {
      setStreamingMsg(null)
      setPipelineSteps([])
      setMessages(prev => [...prev, {
        _id: `err-${Date.now()}`,
        text: 'Connection error. Please try again.',
        role: 'ai',
        timestamp: new Date().toISOString()
      }])
    } finally {
      setLoading(false)
    }
  }

  const NUDGE_PROMPTS = {
    poke:    '[The user poked you playfully. React naturally — be surprised, amused, or curious about why they poked you. Keep it brief and fun.]',
    wave:    '[The user waved at you. Wave back warmly and naturally start a conversation. Be inviting but not pushy.]',
    whisper: '[The user is whispering to you, creating an intimate moment. Respond softly, share something quiet or personal. Match their energy.]',
    stare:   '[The user is just staring at you silently. React to being watched — you could be curious, amused, slightly uncomfortable, or introspective. Be genuine.]',
    hug:     '[The user gave you a hug. Respond with warmth. You can be touched, grateful, or gently surprised. Be emotionally present.]',
  }

  async function handleNudge(actionId) {
    if (loading || !currentConversationId) return
    const prompt = NUDGE_PROMPTS[actionId]
    if (!prompt) return

    setLoading(true)
    setStreamingMsg({ text: '' })
    setPipelineSteps([])
    pipelineStepsRef.current = []
    pipelineMetaRef.current = {}

    let fullText = ''
    try {
      await sendMessageStream(
        prompt,
        currentConversationId,
        { personality: currentPersonality },
        ({ event, data }) => {
          if (event === 'token') {
            fullText += data.text || ''
            setStreamingMsg(prev => ({ ...prev, text: fullText }))
          } else if (event === 'step') {
            const translated = translateStep(data.step, data.detail)
            if (translated) {
              pipelineStepsRef.current = [...pipelineStepsRef.current, {
                label: translated, step: data.step, detail: data.detail || '',
              }]
              setPipelineSteps(prev => [...prev, translated])
            }
            const meta = extractMeta(data.step, data.detail)
            if (meta) pipelineMetaRef.current = { ...pipelineMetaRef.current, ...meta }
          } else if (event === 'thinking') {
            pipelineMetaRef.current.thinkingText =
              (pipelineMetaRef.current.thinkingText || '') + (data.text || '')
          } else if (event === 'done') {
            const insight = {
              ...pipelineMetaRef.current,
              topMemories: data.meta?.topMatches?.map(m => m.text).filter(Boolean) || [],
              memoryDepth: data.meta?.memoryDepth || 0,
              unfinishedThought: data.meta?.unfinishedThought || null,
              expectations: data.meta?.expectations || [],
            }
            const hasInsight = insight.mood || insight.trust != null ||
              insight.memoryCount > 0 || insight.topMemories.length > 0 ||
              insight.expectationsConfirmed > 0 || insight.expectationsSurprised > 0 ||
              insight.unfinishedThought || insight.expectations.length > 0

            const steps = pipelineStepsRef.current.length > 0 ? [...pipelineStepsRef.current] : null

            setStreamingMsg(null)
            setPipelineSteps([])
            pipelineStepsRef.current = []
            setMessages(prev => [...prev, {
              _id: data.messageId || `ai-${Date.now()}`,
              text: data.text || fullText,
              role: 'ai',
              timestamp: new Date().toISOString(),
              gesture: actionId, // show the nudge as a gesture
              ...(hasInsight ? { insight } : {}),
              ...(data.meta?.gesture ? { gesture: data.meta.gesture } : {}),
              ...(steps ? { steps } : {}),
            }])

            const preview = (data.text || fullText).slice(0, 80)
            setConversations(prev => prev.map(c =>
              c.id === currentConversationId ? { ...c, preview } : c
            ))
          } else if (event === 'error') {
            setStreamingMsg(null)
            setPipelineSteps([])
          }
        }
      )
    } catch (err) {
      setStreamingMsg(null)
      setPipelineSteps([])
    } finally {
      setLoading(false)
    }
  }

  function handleNewConversation() {
    setPendingNew(true)
    setShowPersonalityPicker(true)
  }

  function handleSelectPersonality(personality) {
    setShowPersonalityPicker(false)
    const id = `conv-${Date.now()}`
    const newConv = {
      id,
      title: `${personality.name}`,
      personality: personality.id,
      personalityName: personality.name,
      personalityColor: personality.color,
      preview: '',
      createdAt: new Date().toISOString()
    }
    setConversations(prev => [newConv, ...prev])
    setCurrentConversationId(id)
    setCurrentPersonality(personality.id)
    setMessages([])
    setPendingNew(false)

    // Ori opens the conversation — send a hidden greeting trigger
    if (personality.id === 'ori') {
      triggerGreeting(id, personality.id)
    }
  }

  async function triggerGreeting(convId, personalityId) {
    setLoading(true)
    setStreamingMsg({ text: '' })
    setPipelineSteps([])
    pipelineStepsRef.current = []
    pipelineMetaRef.current = {}

    let fullText = ''
    try {
      await sendMessageStream(
        '[The user just opened this conversation. Introduce yourself warmly. Be brief — one or two sentences. Don\'t ask too many questions yet, just say hi and let them know you\'re here.]',
        convId,
        { personality: personalityId },
        ({ event, data }) => {
          if (event === 'token') {
            fullText += data.text || ''
            setStreamingMsg(prev => ({ ...prev, text: fullText }))
          } else if (event === 'step') {
            const translated = translateStep(data.step, data.detail)
            if (translated) {
              pipelineStepsRef.current = [...pipelineStepsRef.current, {
                label: translated,
                step: data.step,
                detail: data.detail || '',
              }]
              setPipelineSteps(prev => [...prev, translated])
            }
            const meta = extractMeta(data.step, data.detail)
            if (meta) pipelineMetaRef.current = { ...pipelineMetaRef.current, ...meta }
          } else if (event === 'done') {
            const insight = {
              ...pipelineMetaRef.current,
              topMemories: data.meta?.topMatches?.map(m => m.text).filter(Boolean) || [],
              memoryDepth: data.meta?.memoryDepth || 0,
            }
            const hasInsight = insight.mood || insight.trust != null ||
              insight.memoryCount > 0 || insight.topMemories.length > 0

            const greetingSteps = pipelineStepsRef.current.length > 0 ? [...pipelineStepsRef.current] : null

            setStreamingMsg(null)
            setPipelineSteps([])
            pipelineStepsRef.current = []
            setMessages([{
              _id: data.messageId || `ai-${Date.now()}`,
              text: data.text || fullText,
              role: 'ai',
              timestamp: new Date().toISOString(),
              ...(hasInsight ? { insight } : {}),
              ...(greetingSteps ? { steps: greetingSteps } : {}),
            }])

            const preview = (data.text || fullText).slice(0, 80)
            setConversations(prev => prev.map(c =>
              c.id === convId ? { ...c, preview } : c
            ))
          } else if (event === 'error') {
            setStreamingMsg(null)
            setPipelineSteps([])
          }
        }
      )
    } catch {
      setStreamingMsg(null)
      setPipelineSteps([])
    } finally {
      setLoading(false)
    }
  }

  function handleCreateLife() {
    setShowPersonalityPicker(false)
    setShowCharacterCreator(true)
  }

  function handleCharacterComplete({ conversationId, name }) {
    setShowCharacterCreator(false)
    const newConv = {
      id: conversationId,
      title: name,
      personality: 'gestated',
      personalityName: name,
      personalityColor: '#a78bfa',
      preview: '',
      createdAt: new Date().toISOString()
    }
    setConversations(prev => [newConv, ...prev])
    setCurrentConversationId(conversationId)
    setCurrentPersonality('gestated')
    setMessages([])
    setPendingNew(false)
  }

  function handleCancelPicker() {
    setShowPersonalityPicker(false)
    if (pendingNew && conversations.length > 0) {
      setPendingNew(false)
    }
  }

  function handleSelectConversation(id) {
    const conv = conversations.find(c => c.id === id)
    setCurrentConversationId(id)
    setCurrentPersonality(conv?.personality || null)
  }

  async function handleDeleteConversation(id) {
    try { await deleteConversation(id) } catch { /* silent */ }
    setConversations(prev => prev.filter(c => c.id !== id))
    if (currentConversationId === id) {
      const remaining = conversations.filter(c => c.id !== id)
      if (remaining.length > 0) {
        setCurrentConversationId(remaining[0].id)
        setCurrentPersonality(remaining[0].personality || null)
      } else {
        setCurrentConversationId(null)
        setPendingNew(true)
        setShowPersonalityPicker(true)
      }
    }
  }

  async function handleToggleAutonomy() {
    const newVal = !autonomyOn
    setAutonomyOn(newVal)
    if (currentConversationId) {
      try { await updateAutonomySettings(currentConversationId, { autonomyEnabled: newVal }) } catch { /* silent */ }
    }
  }

  const currentConv = conversations.find(c => c.id === currentConversationId)

  return (
    <div className="flex" style={{ background: 'var(--color-bg)', height: '93.5dvh'}}>
      <Onboarding />
      <ConversationSidebar
        conversations={conversations}
        currentId={currentConversationId}
        onSelect={handleSelectConversation}
        onNew={handleNewConversation}
        onDelete={handleDeleteConversation}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <div
          className="flex items-center gap-3 px-5 h-14 shrink-0"
          style={{
            borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer"
            style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-tertiary)'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          </button>

          {currentConv?.personalityColor && (
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: currentConv.personalityColor }}
            />
          )}

          <span className="text-body-sm font-medium truncate flex-1" style={{ color: 'var(--color-text)' }}>
            {currentConv?.title || 'Three'}
          </span>

          {/* Settings */}
          {currentConversationId && (
            <div className="relative">
              <button
                onClick={() => setShowSettings(s => !s)}
                className="w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150 cursor-pointer"
                style={{ color: 'var(--color-text-dim)', opacity: showSettings ? 0.7 : 0.4 }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                onMouseLeave={e => (e.currentTarget.style.opacity = showSettings ? '0.7' : '0.4')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                </svg>
              </button>

              {showSettings && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowSettings(false)} />
                  <div
                    className="absolute right-0 top-10 z-40 w-56 rounded-xl p-3 space-y-3"
                    style={{
                      background: 'var(--color-glass-bg)',
                      border: '1px solid var(--color-glass-border)',
                      backdropFilter: 'blur(20px)',
                      boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                      animation: 'scaleIn 0.15s ease-out',
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-caption font-medium" style={{ color: 'var(--color-text)' }}>
                          Independent thought
                        </p>
                        <p className="text-caption" style={{ color: 'var(--color-text-dim)', fontSize: '0.6rem', marginTop: 2 }}>
                          AI thinks and reaches out on its own
                        </p>
                      </div>
                      <button
                        onClick={handleToggleAutonomy}
                        className="w-9 h-5 rounded-full transition-colors duration-200 cursor-pointer shrink-0 relative"
                        style={{
                          background: autonomyOn ? 'var(--color-accent)' : 'rgba(255,255,255,0.1)',
                        }}
                      >
                        <div
                          className="w-3.5 h-3.5 rounded-full bg-white absolute top-[3px] transition-all duration-200"
                          style={{ left: autonomyOn ? 18 : 3 }}
                        />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Chat or empty */}
        {currentConversationId ? (
          <Chat
            messages={messages}
            onSend={handleSend}
            onNudge={handleNudge}
            loading={loading}
            streamingMsg={streamingMsg}
            onLoadMore={loadMoreMessages}
            hasMoreMessages={hasMoreMessages}
            isLoadingOlderMessages={isLoadingOlderMessages}
            conversationId={currentConversationId}
            pipelineSteps={pipelineSteps}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center" style={{ animation: 'scaleIn 0.4s ease-out' }}>
              <p
                className="text-heading-1 mb-2"
                style={{ color: 'var(--color-text)', opacity: 0.35, fontWeight: 500 }}
              >
                Three
              </p>
              <p className="text-body-sm mb-6" style={{ color: 'var(--color-text-dim)' }}>
                Start a conversation.
              </p>
              <button
                onClick={handleNewConversation}
                className="text-body-sm font-medium px-6 py-2.5 rounded-xl transition-all cursor-pointer hover:scale-[1.03]"
                style={{
                  background: 'var(--color-accent)',
                  color: '#fff',
                  boxShadow: '0 0 20px rgba(110,110,255,0.15)',
                }}
              >
                New conversation
              </button>
            </div>
          </div>
        )}
      </div>

      {showPersonalityPicker && (
        <PersonalityPicker
          onSelect={handleSelectPersonality}
          onCancel={handleCancelPicker}
          onCreateLife={handleCreateLife}
        />
      )}
      {showCharacterCreator && (
        <CharacterCreator
          onComplete={handleCharacterComplete}
          onCancel={() => {
            setShowCharacterCreator(false)
            if (pendingNew) setShowPersonalityPicker(true)
          }}
        />
      )}
    </div>
  )
}
