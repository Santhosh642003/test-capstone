const express = require('express');
const router = express.Router();
const complianceGaps = require('../helpers/complianceGaps');
const qaSweepJob = require('../helpers/qaSweepJob');
const { requireMsalIdentity } = require('../helpers/msalAuth');

// Compliance sweeps. These return a customer's billing exceptions -- the sweep
// names unbilled work, unapproved monitoring tools and unit discrepancies for
// one named client, so every route here is gated on the caller's identity.
router.route('/customer/:cus_id/claim-gaps')
    .get(requireMsalIdentity, complianceGaps.getClaimGaps);

router.route('/customer/:cus_id/prior-auth-gaps')
    .get(requireMsalIdentity, complianceGaps.getPriorAuthGaps);

// Nightly QA sweep history (helpers/qaSweepJob.js) for the Compliance
// dashboard -- company-wide, scoped to the caller's own company.
router.route('/history')
    .get(requireMsalIdentity, complianceGaps.getSweepHistory);

// TESTING ONLY -- runs the sweep for the caller's own company right now,
// instead of waiting for the nightly cron. Delete this route before merge
// (see helpers/qaSweepJob.js runSweepNowHandler and index.js).
router.route('/run-now')
    .post(requireMsalIdentity, qaSweepJob.runSweepNowHandler);

module.exports = router;
