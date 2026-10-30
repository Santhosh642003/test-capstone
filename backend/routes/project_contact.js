const express = require('express')
const router = express.Router()
const helpers = require('../helpers/project_contact')

router.route('/')
  .get(helpers.getProjContact)
  .post(helpers.addProjContact)
  .delete(helpers.delProjContact)

module.exports = router
