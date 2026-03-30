const mongoose = require('mongoose')

let ready = false

async function connectToDB(retries = 5) {
  const uri = process.env.MONGO || 'mongodb://localhost:27017/orchestrator'

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`MongoDB connection attempt ${attempt}/${retries}...`)
      await mongoose.connect(uri, { maxPoolSize: 10, minPoolSize: 2 })
      ready = true
      console.log('Connected to MongoDB')
      return
    } catch (err) {
      console.error(`Attempt ${attempt} failed: ${err.message}`)
      if (attempt < retries) {
        const wait = attempt * 2000
        console.log(`Retrying in ${wait / 1000}s...`)
        await new Promise(r => setTimeout(r, wait))
      }
    }
  }

  console.error('FATAL: Could not connect to MongoDB')
  process.exit(1)
}

function isReady() {
  return ready
}

module.exports = { connectToDB, isReady }
