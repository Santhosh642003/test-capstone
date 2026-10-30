const express = require('express')
const router = express.Router()
const helpers = require('../helpers/time_sheet')
const helpers_v2 = require('../helpers/time_sheet_v2')


router.route('/')
  .get(helpers.getTimeSheetTables)
  .post(helpers.addTimeSheet)
  .put(helpers.updateTimeSheet)
  .delete(helpers.deleteTimeSheet)

router.route('/v2')
  .get(helpers_v2.getTimeSheet)
  /*.post(helpers_v2.createTimeSheet)
  .put(helpers_v2.updateTimeSheet)
  .delete(helpers_v2.deleteTimeSheet)*/

router.route('/v2/summary')
  .get(helpers_v2.getTimeSheetSummary)

router.route('/v2/tasks')
  .get(helpers_v2.getTimeSheetTasks)

module.exports = router
