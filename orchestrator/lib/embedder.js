const axios = require('axios')

// ── Provider config (resolved at call time, not import time) ─

const EMBED_PROVIDER = () => process.env.EMBED_PROVIDER || 'ollama'
const OLLAMA_URL     = () => process.env.OLLAMA_URL     || 'http://localhost:11434'
const EMBED_MODEL    = () => process.env.EMBED_MODEL    || 'nomic-embed-text'
const OPENAI_API_KEY = () => process.env.OPENAI_API_KEY
const OPENAI_MODEL   = () => process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-large'
const OPENAI_DIMS    = () => parseInt(process.env.OPENAI_EMBED_DIMS || '1536', 10)

// ── Stopwords for word-level decomposition ───────────────────

const STOPWORDS = new Set([
  'i','me','my','myself','we','our','ours','you','your','yours','he','him',
  'his','she','her','it','its','they','them','their','what','which','who',
  'this','that','these','those','am','is','are','was','were','be','been',
  'being','have','has','had','do','does','did','a','an','the','and','but',
  'if','or','because','as','until','while','of','at','by','for','with',
  'about','against','between','through','during','before','after','to',
  'from','up','down','in','out','on','off','over','under','again','then',
  'once','here','there','when','where','why','how','all','both','each',
  'few','more','most','other','some','such','no','nor','not','only','own',
  'same','so','than','too','very','can','will','just','don','should','now',
  'also','would','could','might','shall','may','yet','still','already',
  'even','much','many','well','back','like','get','got','go','going',
  'went','come','came','make','made','take','took','know','knew','think',
  'thought','say','said','tell','told','let','put','keep','kept','give',
  'gave','want','wanted','need','needed','really','quite','enough','always',
  'never','sometimes','often','actually','probably','maybe','right','thing',
  'things','way','something','anything','everything','nothing','someone',
  'anyone','everyone','people','time','into','been','very','that','have'
])

// ── OpenAI embeddings ────────────────────────────────────────

async function embedTextOpenAI(text) {
  const key = OPENAI_API_KEY()
  if (!key) throw new Error('OPENAI_API_KEY required when EMBED_PROVIDER=openai')

  const res = await axios.post('https://api.openai.com/v1/embeddings', {
    model: OPENAI_MODEL(), input: text, dimensions: OPENAI_DIMS()
  }, {
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 30000
  })

  if (res.data?.data?.[0]?.embedding) return res.data.data[0].embedding
  throw new Error('No embedding returned from OpenAI')
}

async function embedBatchOpenAI(texts) {
  const key = OPENAI_API_KEY()
  if (!key) throw new Error('OPENAI_API_KEY required when EMBED_PROVIDER=openai')

  const res = await axios.post('https://api.openai.com/v1/embeddings', {
    model: OPENAI_MODEL(), input: texts, dimensions: OPENAI_DIMS()
  }, {
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    timeout: 60000
  })

  if (res.data?.data) {
    return res.data.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
  }
  throw new Error('No embeddings returned from OpenAI')
}

// ── Ollama embeddings ────────────────────────────────────────

async function embedTextOllama(text) {
  const res = await axios.post(`${OLLAMA_URL()}/api/embed`, {
    model: EMBED_MODEL(), input: text
  }, { timeout: 30000 })

  if (res.data.embeddings?.length > 0) return res.data.embeddings[0]
  throw new Error('No embeddings returned from Ollama')
}

async function embedBatchOllama(texts) {
  const res = await axios.post(`${OLLAMA_URL()}/api/embed`, {
    model: EMBED_MODEL(), input: texts
  }, { timeout: 60000 })

  return res.data.embeddings
}

// ── Unified interface ────────────────────────────────────────

async function embedText(text) {
  if (EMBED_PROVIDER() === 'openai') return embedTextOpenAI(text)
  return embedTextOllama(text)
}

async function embedBatch(texts) {
  if (EMBED_PROVIDER() === 'openai') return embedBatchOpenAI(texts)
  return embedBatchOllama(texts)
}

// ── Word extraction ──────────────────────────────────────────

function extractMeaningfulWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i)
}

// ── Decompose: full-text composite + word-level vibrations ───

async function decompose(text) {
  const words = extractMeaningfulWords(text)

  if (words.length === 0) {
    const fullVector = await embedText(text)
    return {
      vibrations: [{ word: text.slice(0, 30), vector: fullVector }],
      composite: fullVector
    }
  }

  let vectors
  try {
    vectors = await embedBatch(words)
  } catch (err) {
    const fullVector = await embedText(text)
    return {
      vibrations: [{ word: text.slice(0, 30), vector: fullVector }],
      composite: fullVector
    }
  }

  const vibrations = words.map((word, i) => ({ word, vector: vectors[i] }))

  const dims = vectors[0].length
  const composite = new Array(dims).fill(0)
  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) composite[i] += vec[i]
  }

  return { vibrations, composite }
}

module.exports = { embedText, embedBatch, decompose, extractMeaningfulWords }
