const express = require('express')
const router = express.Router()
const helpers = require('../helpers/maps')

router.route('/')
  .get(helpers.queryAddress)

router.route('/details')
  .get(helpers.getPlaceDetails)

router.route('/location')
  .get(helpers.getMapsLocationInfo)

module.exports = router
