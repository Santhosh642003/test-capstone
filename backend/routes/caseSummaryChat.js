const express = require('express');

const router = express.Router();
const helpers = require('../helpers/caseSummaryChat');
const { requireMsalIdentity } = require('../helpers/msalAuth');

/**
 * POST /api/fieldworker/case-summary-chat
 * Body: { userMessage: string, history?: {role: 'user'|'assistant', content: string}[], empId?: number,
 *         resolvedCustomers?: {customerId: number, name: string}[] }
 * resolvedCustomers echoes back the ids earlier turns resolved -- history keeps
 * only message text, so it is the sole carrier of that state. It is a hint, not
 * an access grant: every id is still checked against the caller's caseload.
 * Requires MSAL Authorization header. empId picks which of the caller's own
 * employee records to act as -- required to reach the right company when the
 * caller's email is an employee at more than one.
 */
router.route('/')
  .post(requireMsalIdentity, helpers.postChatMessage);

module.exports = router;
