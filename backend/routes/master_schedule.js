const express = require('express')
const router = express.Router()
const helpers = require('../helpers/master_schedule')

router.route('/:id')
    .get(helpers.getMasterScheduleById)
    .put(helpers.updateMasterSchedule)
    .delete(helpers.deleteMasterSchedule)

router.route('/')
    .post(helpers.postMasterSchedule)

router.route('/company/:id')
    .get(helpers.getMasterSchedulesByCompany)

router.route('/employee/:id')
    .get(helpers.getMasterSchedulesByEmployee)
    .post(helpers.assignEmployeeToMasterSchedule)
    .delete(helpers.removeEmployeeFromMasterSchedule)

router.route('/employee')
    .post(helpers.assignEmployeesToMasterSchedule)

router.route('/resource/:id')
    .get(helpers.getMasterSchedulesByResource)

router.route('/recurrence/:id')
    .post(helpers.postMasterScheduleRecurrence)

router.route('/mobile/:id')
    .get(helpers.getSchedulesForMobile)

module.exports = router
