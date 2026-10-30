const express = require('express')
const router = express.Router()
const helpers = require('../helpers/update.js')

router.route('/:table')
  .put(helpers.UpdateOperation)

module.exports = router
