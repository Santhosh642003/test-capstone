const express = require('express');
const router = express.Router();
const helpers = require('../helpers/referral');

// CRUD for referrals
router.route('/')
  .get(helpers.getAllReferrals)
  .post(helpers.addReferral)
  .put(helpers.updateReferral);

// External referral creation (with external_referral_company integration)
router.route('/external')
  .post(helpers.addExternalReferral);

router.route('/partners')
  .get(helpers.getReferralPartners);

router.route('/:id/status')
  .put(helpers.updateReferralStatus);

router.route('/:id')
  .get(helpers.getReferralById)
  .delete(helpers.deleteReferral);

// Create a follow-up task for a given referral (inbound)
router.route('/:id/task')
  .post(helpers.createInboundReferralTask);

// Create an outbound referral task for initiating company (project_id + customer_id required)
router.route('/outboundTask')
  .post(helpers.createOutboundReferralTask);

module.exports = router;
