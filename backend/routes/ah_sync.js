const express = require('express')
const router = express.Router()
const helpers = require('../helpers/ah_sync')

router.route('/status/:customer_id')
    .get(helpers.getSyncStatusHandler)

module.exports = router
