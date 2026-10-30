const express = require('express')
const router = express.Router()
const helpers = require('../helpers/project_employee_assignment')

router.route('/')
  .get(helpers.getProjEmpAssn)
  .post(helpers.addProjectEmp)
  .put(helpers.updateProjectEmp)
  .delete(helpers.removeProjEmp)

module.exports = router
