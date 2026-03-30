const axios = require('axios')

const MOONSHOT_API_KEY = () => process.env.MOONSHOT_API_KEY
const DEFAULT_MODEL = 'kimi-k2.5'

async function generate(prompt, systemPrompt, temperature = 0.7, model = null, apiKeys = {}) {
  const apiKey = apiKeys.moonshotApiKey || MOONSHOT_API_KEY()
  if (!apiKey) {
    throw new Error('Moonshot API key required. Add MOONSHOT_API_KEY to .env or enter it in Settings → Keys.')
  }

  const modelName = model || DEFAULT_MODEL
  // Kimi K2.5 non-thinking mode requires temperature=0.6
  const temp = 0.6

  try {
    const response = await axios.post('https://api.moonshot.ai/v1/chat/completions', {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      temperature: temp,
      thinking: { type: 'disabled' }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 900000
    })

    const text = response.data?.choices?.[0]?.message?.content
    if (!text) {
      throw new Error('Empty response from Moonshot')
    }
    return text
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message
    console.error('Moonshot error:', msg)
    throw new Error('Moonshot API error: ' + msg)
  }
}

/**
 * Streaming generation via Moonshot (OpenAI-compatible SSE).
 * Calls onChunk('text'|'thinking', text) for each token.
 * Returns the full accumulated text.
 */
async function generateStream(prompt, systemPrompt, temperature = 0.7, model = null, apiKeys = {}, onChunk = () => {}) {
  const apiKey = apiKeys.moonshotApiKey || MOONSHOT_API_KEY()
  if (!apiKey) {
    throw new Error('Moonshot API key required.')
  }

  const modelName = model || DEFAULT_MODEL
  const temp = 0.6

  const response = await axios.post('https://api.moonshot.ai/v1/chat/completions', {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: temp,
    thinking: { type: 'disabled' },
    stream: true
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    timeout: 900000,
    responseType: 'stream'
  })

  let fullText = ''
  return new Promise((resolve, reject) => {
    let buffer = ''
    response.data.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue
        const jsonStr = trimmed.slice(6)
        if (jsonStr === '[DONE]') continue
        try {
          const parsed = JSON.parse(jsonStr)
          const delta = parsed.choices?.[0]?.delta || {}
          if (delta.reasoning_content) {
            onChunk('thinking', delta.reasoning_content)
          }
          if (delta.content) {
            fullText += delta.content
            onChunk('text', delta.content)
          }
        } catch (e) { /* skip malformed */ }
      }
    })
    response.data.on('end', () => {
      if (buffer.trim().startsWith('data: ') && buffer.trim().slice(6) !== '[DONE]') {
        try {
          const parsed = JSON.parse(buffer.trim().slice(6))
          const delta = parsed.choices?.[0]?.delta || {}
          if (delta.reasoning_content) onChunk('thinking', delta.reasoning_content)
          if (delta.content) { fullText += delta.content; onChunk('text', delta.content) }
        } catch (e) { /* skip */ }
      }
      resolve(fullText)
    })
    response.data.on('error', reject)
  })
}

module.exports = { generate, generateStream }
