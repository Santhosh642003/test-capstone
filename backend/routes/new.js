const express = require('express')
const router = express.Router()
const helpers = require('../helpers/new.js')

router.route('/')
  .get(helpers.getAllTables)

router.route('/:table')
  .post(helpers.postTables)

module.exports = router
