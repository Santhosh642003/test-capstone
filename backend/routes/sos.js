const express = require('express')
const router = express.Router()
const helpers = require('../helpers/sos')

router.route('/')
    .post(helpers.sendPush)
    
module.exports = router