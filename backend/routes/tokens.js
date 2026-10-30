const express = require('express')
const router = express.Router()
const helpers = require('../helpers/tokens')

router.route('/')
    .get(helpers.getToken)
    .post(helpers.insertToken)
    .put(helpers.updateToken)

router.route('/email/:type')
    .post(helpers.sendEmail)

module.exports = router
