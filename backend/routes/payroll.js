const express = require('express')
const router = express.Router()
const helpers = require('../helpers/payroll')

router.route('/')
  .get(helpers.getPayrollTables)
  .post(helpers.addPayroll)
  .put(helpers.updatePayroll)
  .delete(helpers.deletePayroll)

module.exports = router
