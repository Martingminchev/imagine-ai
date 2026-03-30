/**
 * Per-conversation mutex — prevents race conditions between
 * the chat pipeline and the autonomy tick.
 *
 * Chat uses acquireLock() — waits for any running operation to finish.
 * Autonomy uses tryLock() — returns null (skip) if the conversation is busy.
 * This means chat always proceeds (at most waiting for a tick to finish),
 * while autonomy gracefully yields when the user is chatting.
 */

const locks = new Map()

/**
 * Acquire the lock for a key, waiting if it's held.
 * Returns an unlock function. Always call unlock() when done (use try/finally).
 * @param {string} key - Lock identifier (typically conversationId or compound key)
 * @returns {Promise<Function>} Unlock function
 */
async function acquireLock(key) {
  while (locks.has(key)) {
    await locks.get(key).promise
  }
  let resolve
  const promise = new Promise(r => { resolve = r })
  locks.set(key, { promise, resolve })
  return function unlock() {
    locks.delete(key)
    resolve()
  }
}

/**
 * Try to acquire the lock without waiting.
 * Returns an unlock function if acquired, or null if the key is busy.
 * Autonomy calls this — if null, it skips this tick and tries again later.
 * @param {string} key - Lock identifier
 * @returns {Function|null} Unlock function, or null if busy
 */
function tryLock(key) {
  if (locks.has(key)) return null
  let resolve
  const promise = new Promise(r => { resolve = r })
  locks.set(key, { promise, resolve })
  return function unlock() {
    locks.delete(key)
    resolve()
  }
}

module.exports = { acquireLock, tryLock }
