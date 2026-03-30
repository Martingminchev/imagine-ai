const axios = require('axios')

const OLLAMA_URL  = () => process.env.OLLAMA_URL  || 'http://localhost:11434'
const EMBED_MODEL = () => process.env.EMBED_MODEL || 'nomic-embed-text'

const STOPWORDS = new Set([
  'i','me','my','myself','we','our','ours','ourselves','you','your','yours',
  'yourself','yourselves','he','him','his','himself','she','her','hers',
  'herself','it','its','itself','they','them','their','theirs','themselves',
  'what','which','who','whom','this','that','these','those','am','is','are',
  'was','were','be','been','being','have','has','had','having','do','does',
  'did','doing','a','an','the','and','but','if','or','because','as','until',
  'while','of','at','by','for','with','about','against','between','through',
  'during','before','after','above','below','to','from','up','down','in',
  'out','on','off','over','under','again','further','then','once','here',
  'there','when','where','why','how','all','both','each','few','more','most',
  'other','some','such','no','nor','not','only','own','same','so','than',
  'too','very','s','t','can','will','just','don','should','now','d','ll',
  'm','o','re','ve','y','ain','aren','couldn','didn','doesn','hadn','hasn',
  'haven','isn','ma','mightn','mustn','needn','shan','shouldn','wasn',
  'weren','won','wouldn','also','would','could','might','shall','may',
  'yet','still','already','even','much','many','well','back','like','get',
  'got','go','going','went','come','came','make','made','take','took',
  'know','knew','think','thought','say','said','tell','told','let','put',
  'keep','kept','give','gave','want','wanted','seem','seemed','feel','felt',
  'try','tried','leave','left','call','called','need','needed','become',
  'became','really','quite','enough','always','never','sometimes','often',
  'usually','actually','probably','maybe','perhaps','right','thing','things',
  'way','ways','something','anything','everything','nothing','someone',
  'anyone','everyone','people','time','been','into','just','been','into',
  'been','very','that','have','been'
])

async function embedText(text) {
  try {
    const response = await axios.post(`${OLLAMA_URL()}/api/embed`, {
      model: EMBED_MODEL(),
      input: text
    }, { timeout: 30000 })

    if (response.data.embeddings && response.data.embeddings.length > 0) {
      return response.data.embeddings[0]
    }
    throw new Error('No embeddings returned')
  } catch (error) {
    console.error('Embed error:', error.message)
    throw new Error('Failed to generate embedding. Is Ollama running with ' + EMBED_MODEL() + '?')
  }
}

function extractMeaningfulWords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
    .filter((w, i, arr) => arr.indexOf(w) === i) // deduplicate
}

async function decompose(text) {
  const words = extractMeaningfulWords(text)

  if (words.length === 0) {
    const fullVector = await embedText(text)
    return {
      vibrations: [{ word: text.slice(0, 30), vector: fullVector }],
      composite: fullVector
    }
  }

  // Batch embed all words in a single call
  let vectors
  try {
    const response = await axios.post(`${OLLAMA_URL()}/api/embed`, {
      model: EMBED_MODEL(),
      input: words
    }, { timeout: 30000 })

    vectors = response.data.embeddings
  } catch (error) {
    console.error('Batch embed error, falling back to full text:', error.message)
    const fullVector = await embedText(text)
    return {
      vibrations: [{ word: text.slice(0, 30), vector: fullVector }],
      composite: fullVector
    }
  }

  // Build vibrations array
  const vibrations = words.map((word, i) => ({
    word,
    vector: vectors[i]
  }))

  // Composite = superposition (sum of all word vectors)
  const dims = vectors[0].length
  const composite = new Array(dims).fill(0)
  for (const vec of vectors) {
    for (let i = 0; i < dims; i++) {
      composite[i] += vec[i]
    }
  }

  return { vibrations, composite }
}

module.exports = { embedText, decompose, extractMeaningfulWords }
