const express = require('express')
const router = express.Router()
const helpers = require('../helpers/payer')

router.route('/')
  .get(helpers.getPayer)
  .post(helpers.addPayer)
  .put(helpers.updatePayer)
  .delete(helpers.delPayer)

module.exports = router
