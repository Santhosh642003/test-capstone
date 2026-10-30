const express = require('express')
const router = express.Router()
const helpers = require('../helpers/accountsReceivable')

router.route('/')
    .get(helpers.getAccountsReceivable)

router.route('/updatePriorAuth')
    .put(helpers.updatePriorAuth)

router.route('/updateClaim')
    .put(helpers.updateClaim)

router.route('/billingNote')
    .post(helpers.addBillingNote)
    .put(helpers.updateBillingNote)

module.exports = router
