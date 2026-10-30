const express = require('express');

const router = express.Router();
const helpers = require('../helpers/households');

// ============ HOUSEHOLD ROUTES ============

// Main household routes
router.route('/')
  .get(helpers.getHouseholds)
  .post(helpers.addNewHousehold)
  .put(helpers.updateHousehold)
  .delete(helpers.deleteHousehold);

// Get households by member (customer or contact) - MUST be before /:household_id
router.route('/by-member/search')
  .get(helpers.getHouseholdsByMember);

// ============ HOUSEHOLD MEMBER ROUTES ============
// Member routes MUST be before /:household_id to avoid route conflicts

// Main household member routes
router.route('/members')
  .get(helpers.getHouseholdMembers)
  .post(helpers.addHouseholdMember)
  .put(helpers.updateHouseholdMember)
  .delete(helpers.deleteHouseholdMember);

// Get single household member by ID
router.route('/members/:household_member_id')
  .get(helpers.getHouseholdMemberById);

// Get single household by ID - MUST be last to avoid matching specific routes
router.route('/:household_id')
  .get(helpers.getHouseholdById);

module.exports = router;
