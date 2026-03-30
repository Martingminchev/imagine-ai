const axios = require('axios')

const MOONSHOT_API_KEY = () => process.env.MOONSHOT_API_KEY
const DEFAULT_MODEL = 'kimi-k2.5'

async function generate(prompt, systemPrompt, temperature = 0.7, model = null, apiKeys = {}) {
  const apiKey = apiKeys.moonshotApiKey || MOONSHOT_API_KEY()
  if (!apiKey) throw new Error('Moonshot API key required. Set MOONSHOT_API_KEY in .env.')

  const modelName = model || DEFAULT_MODEL

  const res = await axios.post('https://api.moonshot.ai/v1/chat/completions', {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    thinking: { type: 'disabled' }
  }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    timeout: 900000
  })

  const text = res.data?.choices?.[0]?.message?.content
  if (!text) throw new Error('Empty response from Moonshot')
  return text
}

async function generateStream(prompt, systemPrompt, temperature = 0.7, model = null, apiKeys = {}, onChunk = () => {}) {
  const apiKey = apiKeys.moonshotApiKey || MOONSHOT_API_KEY()
  if (!apiKey) throw new Error('Moonshot API key required.')

  const modelName = model || DEFAULT_MODEL

  const res = await axios.post('https://api.moonshot.ai/v1/chat/completions', {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    temperature: 0.6,
    thinking: { type: 'disabled' },
    stream: true
  }, {
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    timeout: 900000,
    responseType: 'stream'
  })

  let fullText = ''

  return new Promise((resolve, reject) => {
    let buffer = ''

    res.data.on('data', (chunk) => {
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
          const content = parsed.choices?.[0]?.delta?.content
          if (content) {
            fullText += content
            onChunk('text', content)
          }
        } catch (_) { /* skip malformed */ }
      }
    })

    res.data.on('end', () => resolve(fullText))
    res.data.on('error', reject)
  })
}

module.exports = { generate, generateStream }
