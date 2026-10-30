const express = require('express')
const router = express.Router()
const helpers = require('../helpers/timesheets')

router.route('/')
  .get(helpers.getTimeSheets)
  .post(helpers.insertTimeSheet)
  .put(helpers.updateTimeSheet)

router.route('/v2')
  .get(helpers.getTimeSheetData)
  .put(helpers.updateTimeSheetData)

module.exports = router
