const express = require('express')
const router = express.Router()
const helpers = require('../helpers/auth')

router.route('/')
  .get(helpers.getUserDetails)
// .post(upload, artifacts.addArtifact)

router.route('/customers')
  .get(helpers.getCustomerDetails)
// .post(upload, artifacts.addArtifact)

module.exports = router
