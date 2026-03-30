function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0

  let dot  = 0
  let magA = 0
  let magB = 0

  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  if (denom === 0) return 0

  return dot / denom
}

function normalize(vector) {
  if (!vector || vector.length === 0) return vector

  let mag = 0
  for (let i = 0; i < vector.length; i++) {
    mag += vector[i] * vector[i]
  }
  mag = Math.sqrt(mag)

  if (mag === 0) return vector

  return vector.map(v => v / mag)
}

module.exports = { cosineSimilarity, normalize }
