const express = require('express')
const router = express.Router()
const helpers = require('../helpers/report_schedule')

router.route('/')
    .get(helpers.getReportSchedule)
    .post(helpers.addReportSchedule)
    .delete(helpers.deleteReportSchedule)

router.route('/schedulable')
    .get(helpers.getSchedulableReports)

module.exports = router