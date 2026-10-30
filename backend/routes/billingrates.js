const express = require('express')
const router = express.Router()
const helpers = require('../helpers/billingrates')

router.route('/')
  //.get(helpers.getBillingRates)

router.route('/mapped')
  .get(helpers.getMappedBillingRates)

module.exports = router
