const express = require('express')
const router = express.Router()
const helpers = require('../helpers/location')
const helpers2 = require('../helpers/location_v2')

router.route('/')
  .get(helpers.getLocTables)
  .post(helpers.addOnelocation)
  .put(helpers.updateLocation)
  .delete(helpers.deleteLocation)

router.route('/v2')
  .get(helpers2.getLocation)

router.route('/BulkUpload')
  .get(helpers.getLocationIdbyAddress)

module.exports = router
