const express  = require('express')
const app      = express()
require("dotenv").config()
const port     = process.env.PORT || 4444

app.use(express.urlencoded({ extended: true }))
app.use(express.json({ limit: '10mb' }))
app.use(require('cors')())

const { startAutonomyLoop } = require('./utils/autonomy')

async function connectingToDB() {
  try {
    await require("mongoose").connect(process.env.MONGO)
    console.log("Connected to the DB")
    // Start the autonomous thinking loop after DB is ready
    startAutonomyLoop(90000) // tick every 90 seconds
  } catch (error) {
    console.log("ERROR: Your DB is not running, start it up")
  }
}
connectingToDB()

//==========================================================================
app.use('/api', require('./routes/chatRoutes'))
app.use('/test', require('./routes/routes'))
//==========================================================================
app.listen(port, () => console.log("Horn AI listening on port: " + port))
