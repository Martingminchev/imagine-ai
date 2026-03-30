/**
 * Per-conversation mutex to prevent race conditions between
 * the chat pipeline and the autonomy tick.
 *
 * Chat uses acquireLock() — waits for any running operation to finish.
 * Autonomy uses tryLock() — returns null (skip) if the conversation is busy.
 * This means chat always proceeds (at most waiting for a tick to finish),
 * while autonomy gracefully yields when the user is chatting.
 */

const locks = new Map() // conversationId → { promise, resolve }

/**
 * Acquire the lock for a conversation, waiting if it's held.
 * Returns an unlock function. Always call unlock() when done (use try/finally).
 */
async function acquireLock(conversationId) {
  while (locks.has(conversationId)) {
    await locks.get(conversationId).promise
  }
  let resolve
  const promise = new Promise(r => { resolve = r })
  locks.set(conversationId, { promise, resolve })
  return function unlock() {
    locks.delete(conversationId)
    resolve()
  }
}

/**
 * Try to acquire the lock without waiting.
 * Returns an unlock function if acquired, or null if the conversation is busy.
 * Autonomy calls this — if null, it skips this tick and tries again later.
 */
function tryLock(conversationId) {
  if (locks.has(conversationId)) return null
  let resolve
  const promise = new Promise(r => { resolve = r })
  locks.set(conversationId, { promise, resolve })
  return function unlock() {
    locks.delete(conversationId)
    resolve()
  }
}

module.exports = { acquireLock, tryLock }
