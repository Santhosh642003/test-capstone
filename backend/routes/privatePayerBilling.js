const express = require('express')
const router = express.Router()
const helpers = require('../helpers/privatePayerBilling')

router.route('/task')
    .get(helpers.getPrivatePayerTasks)

router.route('/invoice')
    .get(helpers.getPrivatePayerInvoices)
    .post(helpers.generateInvoices)

router.route('/invoices/send')
    .post(helpers.sendInvoices)

module.exports = router