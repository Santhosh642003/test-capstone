const express = require('express')
const router = express.Router()
const helpers = require('../helpers/customer_support_need')

router.route('/:customer_id')
    .get(helpers.getSupportNeedByCustomerId)
    .delete(helpers.deleteSupportNeedByCustomerId)
    .put(helpers.updateSupportNeedByCustomerId)

router.route('/')
    .post(helpers.createSupportNeed)

module.exports = router
