const axios = require('axios')

const OLLAMA_URL   = () => process.env.OLLAMA_URL   || 'http://localhost:11434'
const OLLAMA_MODEL = () => process.env.OLLAMA_MODEL || 'llama3'

async function generate(prompt, systemPrompt, temperature = 0.7, model = null, _apiKeys = {}) {
  if (model && (model.startsWith('moonshot:') || model.startsWith('gemini:'))) {
    throw new Error(
      'You selected a cloud provider (Gemini/Moonshot) but the request was routed to Ollama. ' +
      'Enter your API key in Keys (header) and ensure the backend was restarted after the multi-provider update.'
    )
  }

  const modelName = model || OLLAMA_MODEL()
  const url = OLLAMA_URL()
  const temp = Math.min(Math.max(temperature, 0.1), 2.0)

  try {
    const response = await axios.post(`${url}/api/chat`, {
      model: modelName,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      stream: false,
      options: { temperature: temp }
    }, { timeout: 900000 })

    return response.data.message?.content || ''
  } catch (chatError) {
    try {
      const response = await axios.post(`${url}/api/generate`, {
        model: modelName,
        prompt,
        system: systemPrompt,
        stream: false,
        options: { temperature: temp }
      }, { timeout: 900000 })

      return response.data.response || ''
    } catch (genError) {
      console.error('Ollama error:', genError.message)
      throw new Error('Failed to generate response from Ollama. Is it running with model ' + modelName + '?')
    }
  }
}

/**
 * Streaming generation via Ollama. Calls onChunk(type, text) for each token.
 * Returns the full accumulated text.
 */
async function generateStream(prompt, systemPrompt, temperature = 0.7, model = null, _apiKeys = {}, onChunk = () => {}) {
  if (model && (model.startsWith('moonshot:') || model.startsWith('gemini:'))) {
    throw new Error('Cloud provider routed to Ollama. Check API keys and model selection.')
  }

  const modelName = model || OLLAMA_MODEL()
  const url = OLLAMA_URL()
  const temp = Math.min(Math.max(temperature, 0.1), 2.0)

  const response = await axios.post(`${url}/api/chat`, {
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
    response.data.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() // keep incomplete line
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line)
          const token = parsed.message?.content || ''
          if (token) {
            full += token
            onChunk('text', token)
          }
        } catch (e) { /* skip malformed */ }
      }
    })
    response.data.on('end', () => {
      // process remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer)
          const token = parsed.message?.content || ''
          if (token) {
            full += token
            onChunk('text', token)
          }
        } catch (e) { /* skip */ }
      }
      resolve(full)
    })
    response.data.on('error', reject)
  })
}

module.exports = { generate, generateStream }
