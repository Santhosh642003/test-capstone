
const express = require('express')
const router = express.Router()
const helpers = require('../helpers/utility')
const { asyncHandler } = require('../asyncHandler')

router.route('/healthcheck')
  .get(asyncHandler(helpers.healthCheck))


router.route('/triggerCrash')
  .get(asyncHandler(helpers.triggerCrash))


router.route('/triggerDatabaseError')
  .get(asyncHandler(helpers.triggerDatabaseError))


router.route('/trigger500')
  .get(asyncHandler(helpers.trigger500))


router.route('/trigger400')
  .get(asyncHandler(helpers.trigger400))


router.route('/trigger300')
  .get(asyncHandler(helpers.trigger300))


router.route('/trigger200')
  .get(asyncHandler(helpers.trigger200))

module.exports = router
