const express = require('express')
const router = express.Router()
const helpers = require('../helpers/dropdowns')

router.route('/')
  .get(helpers.getDropdowns)
  .post(helpers.addDropdowns)
  .put(helpers.updateDropdown)
  .delete(helpers.deleteDropdown)


router.route('/states')
  .get(helpers.getStates)

router.route('/states/v2')
  .get(helpers.getStatesv2)
 
router.route('/dropdownType/:type')
  .get(helpers.getDropdownsByType)
 
router.route('/company/config')
  .put(helpers.enhancedDeleteDD)


router.route('/bulkInsert')
// .get(helpers.getDropdowns)
  .post(helpers.bulkInsert)
// .put(helpers.updateDropdown)
// .delete(helpers.deleteDropdown)

router.route('/settings')
// .get(helpers.getDropdowns)
  .post(helpers.insertSettingsDropdown)
  .put(helpers.updateSettingsDropdown)
// .delete(helpers.deleteDropdown)

module.exports = router
