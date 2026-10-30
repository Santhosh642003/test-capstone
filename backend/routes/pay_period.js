const express = require('express')
const router = express.Router()
const helpers = require('../helpers/pay_period')

router.route('/')
  .get(helpers.getPayPeriodTables)
  .post(helpers.addPayPeriod)
  .put(helpers.updatePayPeriod)
  .delete(helpers.deletePayPeriod)

module.exports = router
