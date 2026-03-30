import axios from 'axios'

const API = axios.create({
  baseURL: 'http://localhost:4447/api',
  timeout: 900000
})

const MODEL = 'moonshot:kimi-k2.5'

export async function getHistory(conversationId = 'default', limit = 50, before = null) {
  const params = { conversationId, limit }
  if (before) params.before = before
  const response = await API.get('/history', { params })
  return response.data
}

export async function getPersonalities() {
  const response = await API.get('/personalities')
  return response.data
}

export function createSSEConnection(conversationId = 'default') {
  const url = `http://localhost:4447/api/events?conversationId=${encodeURIComponent(conversationId)}`
  return new EventSource(url)
}

export async function answerInitiative(conversationId = 'default', initiativeId, answer) {
  const response = await API.post('/answer-initiative', { conversationId, initiativeId, answer })
  return response.data
}

export async function sendMessageStream(message, conversationId = 'default', options = {}, onEvent = () => {}) {
  const payload = {
    message,
    conversationId,
    model: MODEL
  }
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
    buffer = lines.pop()

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

export async function gestateConversation(biography, onProgress = () => {}) {
  const payload = { biography, model: MODEL }

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
            throw new Error(data.message || 'Creation failed')
          }
          onProgress({ event: currentEvent, data })
        } catch (e) {
          if (e.message !== 'Creation failed') { /* skip parse errors */ }
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

export async function updateAutonomySettings(conversationId, settings) {
  const response = await API.post('/autonomy/settings', { conversationId, ...settings })
  return response.data
}
