const express = require('express')
const router = express.Router()
const helpers = require('../helpers/customer_empl_need')

router.route('/:customer_id')
    .get(helpers.getEmploymentNeedByCustomerId)
    .delete(helpers.deleteEmploymentNeedByCustomerId)
    .put(helpers.updateEmploymentNeedByCustomerId)

router.route('/')
    .post(helpers.createEmploymentNeed)

module.exports = router
