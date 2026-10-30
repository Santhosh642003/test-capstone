const express = require('express')
const router = express.Router()
const helpers = require('../helpers/invoice')

router.route('/')
  .get(helpers.getInvoices)
  .post(helpers.addInvoice)
  .put(helpers.updateInvoice)
  .delete(helpers.delInvoice)

module.exports = router