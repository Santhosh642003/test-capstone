const express = require('express')
const router = express.Router()
const helpers = require('../helpers/generateX12')

router.route('/')
  .post(helpers.addX12)

module.exports = router
