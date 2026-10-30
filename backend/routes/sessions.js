const express = require('express')
const router = express.Router()
const helpers = require('../helpers/sessions')

// Route to create task, timesheet, and update session in a single transaction
router.route('/mark')
  .post(helpers.createTaskAndTimesheet);

router.route('/:id')
    .get(helpers.getSessionById)
    .delete(helpers.deleteSession)

router.route('/')
    .post(helpers.postSession)

router.route('/company/:id')
    .get(helpers.getSessionsByCompany)

router.route('/schedule')
    .post(helpers.getSessionsBySchedule)

router.route('/scheduleLite')
    .post(helpers.getSessionsLiteBySchedule)

router.route('/attendance/:id')
    .put(helpers.updateAttendance)

router.route('/notify-available')
    .post(helpers.notifyAvailableEmployees)

router.route('/mobile/shiftCheckInOut')
    .put(helpers.mobileShiftCheckInOut)
    
module.exports = router