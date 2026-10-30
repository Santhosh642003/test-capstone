const express = require('express')
const router = express.Router()
const helpers = require('../helpers/claims')

router.route('/')
  .get(helpers.getClaims)
  .put(helpers.updateClaim)
  .post(helpers.addClaim)
  .delete(helpers.delClaims)

module.exports = router
