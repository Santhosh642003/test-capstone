const express = require('express')
const router = express.Router()
const helpers = require('../helpers/team')

router.route('/')
  .get(helpers.getAllEmp)
  .put(helpers.changeDesgBatch)

router.route('/remove')
  .put(helpers.removeBatch)

router.route('/Supervisor')
  .get(helpers.getAllEmpforSupervisor)

module.exports = router
