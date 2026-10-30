const express = require('express')
const router = express.Router()
const helpers = require('../helpers/calendar-link')

router.route('/')
  .get(helpers.getAllTask)
  // .post(helpers.addNewTask)
  // .put(helpers.updateTask)
  // .delete(helpers.delTask)

router.route('/help')
  .post(helpers.sendHelpEmail)

module.exports = router
