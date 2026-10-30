const express = require('express');
const router = express.Router();
const helpers = require('../helpers/referralSettings');

router.get('/:company_id/active', helpers.getActive);
router.get('/:company_id/history', helpers.getHistory);
// Unified upsert endpoint (create initial, update active, or version)
router.post('/:company_id', helpers.upsertSettings);
router.put('/:company_id', helpers.upsertSettings);
router.delete('/:company_id/:setting_id', helpers.retireSetting);

// Company GUID related routes migrated here
router.get('/guid/:company_id', helpers.getCompanyGUID);
router.post('/guid/:company_id', helpers.generateCompanyGUID);
router.put('/guid/:company_id', helpers.updateCompanyGUID);
router.get('/guid/verify/:guid', helpers.verifyCompanyGUID);

// Company search constrained to companies with an active referral_setting GUID
router.get('/company/search', helpers.searchCompanies);

module.exports = router;
