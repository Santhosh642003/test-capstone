const express = require('express')
const router = express.Router()
const helpers = require('../helpers/creds')

router.route('/')
  .get(helpers.getCred)
  .post(helpers.addCred)
  .put(helpers.updateCred)
  .delete(helpers.delCred)

module.exports = router
