const express = require('express')
const router = express.Router()
const helpers = require('../helpers/customer_health_need')

router.route('/:customer_id')
    .get(helpers.getHealthNeedByCustomerId)
    .delete(helpers.deleteHealthNeedByCustomerId)
    .put(helpers.updateHealthNeedByCustomerId)

router.route('/')
    .post(helpers.createHealthNeed)

module.exports = router
