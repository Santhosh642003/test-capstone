const express = require('express')
const router = express.Router()
const helpers = require('../helpers/calls')

router.route('/')
  .get(helpers.getCalls)
  .post(helpers.addCall)

module.exports = router
