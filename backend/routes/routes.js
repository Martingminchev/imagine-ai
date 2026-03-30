const router = require('express').Router()
     const controller = require('../controllers/controllers')

     router.get('/getTest',controller.getTest)
     router.post('/postTest',controller.postTest)

     module.exports = router