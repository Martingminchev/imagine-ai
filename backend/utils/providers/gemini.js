const axios = require('axios')

const GEMINI_API_KEY = () => process.env.GEMINI_API_KEY
const DEFAULT_MODEL = 'gemini-2.5-flash'

async function generate(prompt, systemPrompt, temperature = 0.7, model = null, apiKeys = {}) {
  const apiKey = apiKeys.geminiApiKey || GEMINI_API_KEY()
  if (!apiKey) {
    throw new Error('Gemini API key required. Add GEMINI_API_KEY to .env or enter it in Settings → Keys.')
  }

  const modelName = model || DEFAULT_MODEL
  const temp = Math.min(Math.max(temperature, 0.1), 2.0)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`

  try {
    const response = await axios.post(url, {
      system_instruction: {
        parts: [{ text: systemPrompt }]
      },
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: temp
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      timeout: 900000
    })

    const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      throw new Error('Empty response from Gemini')
    }
    return text
  } catch (error) {
    const msg = error.response?.data?.error?.message || error.message
    console.error('Gemini error:', msg)
    throw new Error('Gemini API error: ' + msg)
  }
}

/**
 * Streaming generation via Gemini with thinking support.
 * Calls onChunk('text'|'thinking', text) for each token.
 * Returns the full accumulated text.
 */
async function generateStream(prompt, systemPrompt, temperature = 0.7, model = null, apiKeys = {}, onChunk = () => {}) {
  const apiKey = apiKeys.geminiApiKey || GEMINI_API_KEY()
  if (!apiKey) {
    throw new Error('Gemini API key required.')
  }

  const modelName = model || DEFAULT_MODEL
  const temp = Math.min(Math.max(temperature, 0.1), 2.0)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse`

  const response = await axios.post(url, {
    system_instruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: temp,
      thinkingConfig: { thinkingBudget: 8192 }
    }
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    timeout: 900000,
    responseType: 'stream'
  })

  let fullText = ''
  return new Promise((resolve, reject) => {
    let buffer = ''
    response.data.on('data', (chunk) => {
      buffer += chunk.toString()
      // Gemini SSE: lines starting with "data: " followed by JSON
      const lines = buffer.split('\n')
      buffer = lines.pop()
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const jsonStr = line.slice(6)
        if (!jsonStr.trim()) continue
        try {
          const parsed = JSON.parse(jsonStr)
          const parts = parsed.candidates?.[0]?.content?.parts || []
          for (const part of parts) {
            if (part.thought && part.text) {
              onChunk('thinking', part.text)
            } else if (part.text) {
              fullText += part.text
              onChunk('text', part.text)
            }
          }
        } catch (e) { /* skip malformed */ }
      }
    })
    response.data.on('end', () => {
      // process remaining buffer
      if (buffer.trim() && buffer.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(buffer.slice(6))
          const parts = parsed.candidates?.[0]?.content?.parts || []
          for (const part of parts) {
            if (part.thought && part.text) {
              onChunk('thinking', part.text)
            } else if (part.text) {
              fullText += part.text
              onChunk('text', part.text)
            }
          }
        } catch (e) { /* skip */ }
      }
      resolve(fullText)
    })
    response.data.on('error', reject)
  })
}

module.exports = { generate, generateStream }
