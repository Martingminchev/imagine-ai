import axios from 'axios'

const API = axios.create({
  baseURL: 'http://localhost:4447/api',
  timeout: 900000
})

export async function sendMessage(message, conversationId = 'default', options = {}) {
  const payload = { message, conversationId }
  if (options.model) payload.model = options.model
  if (options.geminiApiKey) payload.geminiApiKey = options.geminiApiKey
  if (options.moonshotApiKey) payload.moonshotApiKey = options.moonshotApiKey
  if (options.memorySettings) payload.memorySettings = options.memorySettings
  const response = await API.post('/chat', payload)
  return response.data
}

export async function compareMessage(message, conversationId = 'default', options = {}) {
  const payload = { message, conversationId }
  if (options.model) payload.model = options.model
  if (options.geminiApiKey) payload.geminiApiKey = options.geminiApiKey
  if (options.moonshotApiKey) payload.moonshotApiKey = options.moonshotApiKey
  if (options.memorySettings) payload.memorySettings = options.memorySettings
  const response = await API.post('/compare', payload)
  return response.data
}

export async function getHistory(conversationId = 'default', limit = 50, before = null) {
  const params = { conversationId, limit }
  if (before) params.before = before
  const response = await API.get('/history', { params })
  return response.data
}

export async function getStatus() {
  const response = await API.get('/status')
  return response.data
}

export async function getMemoryField(conversationId = 'default') {
  const response = await API.get('/memory-field', {
    params: { conversationId }
  })
  return response.data
}

export async function getThoughts(conversationId = 'default', limit = 100) {
  const response = await API.get('/thoughts', {
    params: { conversationId, limit }
  })
  return response.data
}

export function createSSEConnection(conversationId = 'default') {
  const url = `http://localhost:4447/api/events?conversationId=${encodeURIComponent(conversationId)}`
  return new EventSource(url)
}

export async function triggerThought(conversationId = 'default', options = {}) {
  const payload = { conversationId }
  if (options.model) payload.model = options.model
  if (options.geminiApiKey) payload.geminiApiKey = options.geminiApiKey
  if (options.moonshotApiKey) payload.moonshotApiKey = options.moonshotApiKey
  const response = await API.post('/trigger-thought', payload)
  return response.data
}

// ── Archived concerns ─────────────────────────────────────────

export async function archiveConcern(conversationId = 'default', topic, thoughtId = null) {
  const payload = { conversationId, topic }
  if (thoughtId) payload.thoughtId = thoughtId
  const response = await API.post('/archive-concern', payload)
  return response.data
}

export async function getArchivedConcerns(conversationId = 'default') {
  const response = await API.get('/archived-concerns', {
    params: { conversationId }
  })
  return response.data
}

export async function contemplateArchived(conversationId = 'default', concernId, options = {}) {
  const payload = { conversationId, concernId }
  if (options.model) payload.model = options.model
  if (options.geminiApiKey) payload.geminiApiKey = options.geminiApiKey
  if (options.moonshotApiKey) payload.moonshotApiKey = options.moonshotApiKey
  const response = await API.post('/contemplate-archived', payload)
  return response.data
}

export async function setCurrentConcern(conversationId = 'default', concern) {
  const response = await API.post('/set-current-concern', { conversationId, concern })
  return response.data
}

export async function answerConcern(conversationId = 'default', concernId = null, answer = '', action = 'resolve') {
  const response = await API.post('/answer-concern', { conversationId, concernId, answer, action })
  return response.data
}

export async function answerInitiative(conversationId = 'default', initiativeId, answer) {
  const response = await API.post('/answer-initiative', { conversationId, initiativeId, answer })
  return response.data
}

// ── Personalities ─────────────────────────────────────────────

export async function getPersonalities() {
  const response = await API.get('/personalities')
  return response.data
}

// ── Streaming chat ────────────────────────────────────────────

export async function sendMessageStream(message, conversationId = 'default', options = {}, onEvent = () => {}) {
  const payload = { message, conversationId }
  if (options.model) payload.model = options.model
  if (options.geminiApiKey) payload.geminiApiKey = options.geminiApiKey
  if (options.moonshotApiKey) payload.moonshotApiKey = options.moonshotApiKey
  if (options.memorySettings) payload.memorySettings = options.memorySettings
  if (options.personality) payload.personality = options.personality

  const response = await fetch('http://localhost:4447/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete line

    let currentEvent = null
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6))
          onEvent({ event: currentEvent, data })
        } catch (e) { /* skip malformed */ }
        currentEvent = null
      } else if (line.trim() === '') {
        currentEvent = null
      }
    }
  }
}

// ── Gestation (biographical generator) ────────────────────────

export async function gestateConversation(biography, options = {}, onProgress = () => {}) {
  const payload = { biography }
  if (options.model) payload.model = options.model
  if (options.geminiApiKey) payload.geminiApiKey = options.geminiApiKey
  if (options.moonshotApiKey) payload.moonshotApiKey = options.moonshotApiKey

  const response = await fetch('http://localhost:4447/api/gestate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop()

    let currentEvent = null
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6))
          if (currentEvent === 'done') {
            result = data
          } else if (currentEvent === 'error') {
            throw new Error(data.message || 'Gestation failed')
          }
          onProgress({ event: currentEvent, data })
        } catch (e) {
          if (e.message !== 'Gestation failed') { /* skip parse errors */ }
          else throw e
        }
        currentEvent = null
      } else if (line.trim() === '') {
        currentEvent = null
      }
    }
  }

  return result
}

// ── Conversations management ──────────────────────────────────

export async function getConversations() {
  const response = await API.get('/conversations')
  return response.data
}

export async function patchConversation(id, data) {
  const response = await API.patch(`/conversations/${encodeURIComponent(id)}`, data)
  return response.data
}

export async function deleteConversation(id) {
  const response = await API.delete(`/conversations/${encodeURIComponent(id)}`)
  return response.data
}

// ── Recordings ────────────────────────────────────────────────

export async function getRecordings(params = {}) {
  const response = await API.get('/recordings', { params })
  return response.data
}

export async function getRecording(id) {
  const response = await API.get(`/recordings/${encodeURIComponent(id)}`)
  return response.data
}

export async function getRecordingStats(conversationId = null) {
  const params = conversationId ? { conversationId } : {}
  const response = await API.get('/recordings/stats', { params })
  return response.data
}

export async function deleteRecordings(body = {}) {
  const response = await API.delete('/recordings', { data: body })
  return response.data
}

// ── Autonomy control ──────────────────────────────────────────

export async function getAutonomyStatus() {
  const response = await API.get('/autonomy/status')
  return response.data
}

export async function pauseAutonomy() {
  const response = await API.post('/autonomy/pause')
  return response.data
}

export async function resumeAutonomy() {
  const response = await API.post('/autonomy/resume')
  return response.data
}

export async function updateAutonomySettings(conversationId = 'default', settings = {}) {
  const response = await API.post('/autonomy/settings', { conversationId, ...settings })
  return response.data
}
