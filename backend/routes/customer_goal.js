const express = require('express')
const router = express.Router()
const helpers = require('../helpers/customer_goal.js')

router.route('/')
  .post(helpers.addCustomerGoal)
  .put(helpers.updateCustomerGoal)
  .get(helpers.getCustomerGoal)
  .delete(helpers.removeCustomerGoal)

router.route('/permitted_task')
  .post(helpers.addPermittedTask)
  .put(helpers.updatePermittedTask)
  .get(helpers.getPermittedTask)
  .delete(helpers.removePermittedTask)

router.route('/getCustomerGoalsByTaskType')
  .get(helpers.getCustomerGoalsByTaskType)

module.exports = router
