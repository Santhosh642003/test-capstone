const express = require('express')
const router = express.Router()
const helpers = require('../helpers/project_location')

router.route('/')
  .get(helpers.getProjLocation)
  .post(helpers.addProjLocation)

module.exports = router
