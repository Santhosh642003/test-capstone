const express = require('express')
const router = express.Router()
const helpers = require('../helpers/home')

router.route('/')
  .get(helpers.getProjectPieData)

router.route('/empDashBoard')
  .get(helpers.getEmployeeAnalytics)

router.route('/empDashBoard/average_miles')
  .get(helpers.getEmployeeAnalyticsAverageMiles)

router.route('/empDashBoard/total_calls')
  .get(helpers.getEmployeeAnalyticsFaceToFaceCalls)
router.route('/empDashBoardv2')
  .get(helpers.getHomeDetails)

router.route('/billingSummary')
  .get(helpers.getBillingSummary)

module.exports = router
