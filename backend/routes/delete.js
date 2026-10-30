const express = require('express')
const router = express.Router()
const helpers = require('../helpers/delete')

router.route('/:table')
  .put(helpers.deleteOne)

module.exports = router
