/**
 * Vector math utilities for embedding operations.
 */

/**
 * Compute cosine similarity between two vectors.
 * Returns a value in [-1, 1] where 1 means identical direction.
 * @param {number[]} a - First vector
 * @param {number[]} b - Second vector
 * @returns {number} Cosine similarity
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot  += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * Normalize a vector to unit length.
 * @param {number[]} vector - Input vector
 * @returns {number[]} Normalized vector
 */
function normalize(vector) {
  if (!vector || vector.length === 0) return vector || []
  let mag = 0
  for (let i = 0; i < vector.length; i++) {
    mag += vector[i] * vector[i]
  }
  mag = Math.sqrt(mag)
  if (mag === 0) return vector
  return vector.map(v => v / mag)
}

module.exports = { cosineSimilarity, normalize }
