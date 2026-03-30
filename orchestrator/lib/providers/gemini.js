const axios = require('axios')

const GEMINI_API_KEY = () => process.env.GEMINI_API_KEY
const DEFAULT_MODEL = 'gemini-2.5-flash'

async function generate(prompt, systemPrompt, temperature = 0.7, model = null, apiKeys = {}) {
  const apiKey = apiKeys.geminiApiKey || GEMINI_API_KEY()
  if (!apiKey) throw new Error('Gemini API key required. Set GEMINI_API_KEY in .env.')

  const modelName = model || DEFAULT_MODEL
  const temp = Math.min(Math.max(temperature, 0.1), 2.0)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`

  const res = await axios.post(url, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: temp }
  }, {
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    timeout: 900000
  })

  const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text
  if (!text) throw new Error('Empty response from Gemini')
  return text
}

async function generateStream(prompt, systemPrompt, temperature = 0.7, model = null, apiKeys = {}, onChunk = () => {}) {
  const apiKey = apiKeys.geminiApiKey || GEMINI_API_KEY()
  if (!apiKey) throw new Error('Gemini API key required.')

  const modelName = model || DEFAULT_MODEL
  const temp = Math.min(Math.max(temperature, 0.1), 2.0)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:streamGenerateContent?alt=sse`

  const res = await axios.post(url, {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: temp }
  }, {
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
        if (!line.startsWith('data: ')) continue
        try {
          const parsed = JSON.parse(line.slice(6))
          const parts = parsed.candidates?.[0]?.content?.parts || []
          for (const part of parts) {
            if (part.text && !part.thought) {
              fullText += part.text
              onChunk('text', part.text)
            }
          }
        } catch (_) { /* skip malformed */ }
      }
    })

    res.data.on('end', () => resolve(fullText))
    res.data.on('error', reject)
  })
}

module.exports = { generate, generateStream }
