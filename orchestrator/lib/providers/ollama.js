const axios = require('axios')

const OLLAMA_URL   = () => process.env.OLLAMA_URL   || 'http://localhost:11434'
const OLLAMA_MODEL = () => process.env.OLLAMA_MODEL || 'llama3'

async function generate(prompt, systemPrompt, temperature = 0.7, model = null) {
  const modelName = model || OLLAMA_MODEL()
  const url = OLLAMA_URL()
  const temp = Math.min(Math.max(temperature, 0.1), 2.0)

  try {
    const res = await axios.post(`${url}/api/chat`, {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      stream: false,
      options: { temperature: temp }
    }, { timeout: 900000 })

    return res.data.message?.content || ''
  } catch (chatErr) {
    // Fallback to /api/generate for older Ollama versions
    try {
      const res = await axios.post(`${url}/api/generate`, {
        model: modelName,
        prompt,
        system: systemPrompt,
        stream: false,
        options: { temperature: temp }
      }, { timeout: 900000 })

      return res.data.response || ''
    } catch (genErr) {
      throw new Error(`Ollama error: ${genErr.message}. Is it running with model ${modelName}?`)
    }
  }
}

async function generateStream(prompt, systemPrompt, temperature = 0.7, model = null, _apiKeys = {}, onChunk = () => {}) {
  const modelName = model || OLLAMA_MODEL()
  const url = OLLAMA_URL()
  const temp = Math.min(Math.max(temperature, 0.1), 2.0)

  const res = await axios.post(`${url}/api/chat`, {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ],
    stream: true,
    options: { temperature: temp }
  }, { timeout: 900000, responseType: 'stream' })

  let full = ''

  return new Promise((resolve, reject) => {
    let buffer = ''

    res.data.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop()

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          const token = parsed.message?.content || ''
          if (token) {
            full += token
            onChunk('text', token)
          }
        } catch (_) { /* skip malformed lines */ }
      }
    })

    res.data.on('end', () => {
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer)
          const token = parsed.message?.content || ''
          if (token) {
            full += token
            onChunk('text', token)
          }
        } catch (_) { /* skip */ }
      }
      resolve(full)
    })

    res.data.on('error', reject)
  })
}

module.exports = { generate, generateStream }
