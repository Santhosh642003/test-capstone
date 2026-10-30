const express = require('express')
const router = express.Router()
const helpers = require('../helpers/medicaid')

router.route('/')
  .get(helpers.get837pSample)
  // .post(helpers.getEDIfromJsonData)

router.route('/edi')
  .get(helpers.getEDIfromJson)

router.route('/claimmd')
  .post(helpers.getJsonForClaimMD)

// router.route('/claimmdera')
//   .post(helpers.getRecentERAListFromClaimMD)

router.route('/edi/csv')
  .get(helpers.getEDIfromJsonCSV)


module.exports = router
