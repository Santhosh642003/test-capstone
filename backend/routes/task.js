const express = require('express')
const router = express.Router()
const helpers = require('../helpers/task')
const helpers2 = require('../helpers/task_v2')

router.route('/')
  .get(helpers.getAllTask)
  .post(helpers.addNewTask)
  .put(helpers.updateTask)
  .delete(helpers.delTask)

router.route('/v2')
  .get(helpers2.getTasks)

router.route('/checkin')
  .put(helpers.updateCheckin)

router.route('/monthlymonitoring')
  .get(helpers.getMMTData)

router.route('/link')
  .put(helpers.updateLink)

router.route('/status')
  .put(helpers.updateStatus)

router.route('/mmid')
  .put(helpers.updateMMID)

router.route('/notes')
  .put(helpers.updateNotes)

router.route('/session')
  .get(helpers.getSessionTask)
  .put(helpers.updateSessionTask)

router.route('/recurringTask')
  .post(helpers.addRecurTask)

router.route('/time')
  .get(helpers.getTaskTime)
  .put(helpers.updateTaskTime)

router.route('/checklist')
  .get(helpers.getChecklistTasks)

router.route('/active')
  .put(helpers.updateActive)

router.route('/description')
  .put(helpers.updateDescription)

router.route('/mobile')
  .get(helpers.getMobileTasks)

module.exports = router
