const router = require('express').Router()
const controller = require('../controllers/chatController')

router.post('/chat', controller.chat)
router.post('/chat/stream', controller.chatStream)
router.post('/compare', controller.compare)
router.get('/history', controller.getHistory)
router.get('/status', controller.getStatus)
router.get('/memory-field', controller.getMemoryField)
router.get('/thoughts', controller.getThoughts)
router.get('/events', controller.sseEvents)
router.post('/trigger-thought', controller.triggerThought)

// Archived concerns
router.post('/archive-concern', controller.archiveConcernEndpoint)
router.get('/archived-concerns', controller.getArchivedConcernsEndpoint)
router.post('/contemplate-archived', controller.contemplateArchivedEndpoint)
router.post('/set-current-concern', controller.setCurrentConcernEndpoint)
router.post('/answer-concern', controller.answerConcernEndpoint)
router.post('/answer-initiative', controller.answerInitiativeEndpoint)

// Autonomy control
router.post('/autonomy/pause', controller.pauseAutonomy)
router.post('/autonomy/resume', controller.resumeAutonomy)
router.get('/autonomy/status', controller.getAutonomyStatus)
router.post('/autonomy/settings', controller.updateAutonomySettings)

// Conversations management
router.get('/conversations', controller.listConversations)
router.patch('/conversations/:id', controller.patchConversation)
router.delete('/conversations/:id', controller.deleteConversation)

// Personalities
router.get('/personalities', controller.listPersonalities)

// Gestation — biographical life generator
router.post('/gestate', controller.gestateEndpoint)

// Expectations (Double Horn — future projections)
router.get('/expectations', controller.getExpectations)

// Recordings (API call log)
router.get('/recordings', controller.getRecordings)
router.get('/recordings/stats', controller.getRecordingStats)
router.get('/recordings/:id', controller.getRecording)
router.delete('/recordings', controller.deleteRecordings)

module.exports = router
