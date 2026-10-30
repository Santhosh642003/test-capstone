const express = require('express');

const router = express.Router();
const helpers = require('../helpers/company');
const helpers2 = require('../helpers/company_v2');
const multer = require('multer');

const upload = multer().single('logo');

router.route('/')
  .get(helpers.getCompTables)
  .post(helpers.addOneCompany)
  .put(helpers.updateCompany)
  .delete(helpers.deleteCompany);

router.route('/v2/billinginfo')
  .get(helpers2.getCompany)
  .put(helpers2.updateCompanyBillingInfo);

router.route('/officeLocation')
  .get(helpers.getOfficeLocation)
  .post(helpers.addOfficeLocation)
  .put(helpers.updateOfficeLocation);

router.route('/provider')
  .get(helpers.getProvider)
  .post(helpers.addProvider)
  .put(helpers.updateProvider)
  .delete(helpers.deleteProvider);

router.route('/logo/:company_id')
  .get(helpers.getLogo)
  .post(upload, helpers.addLogo)
  .put(upload, helpers.updateLogo)
  .delete(helpers.deleteLogo);


router.route('/v2/search')
  .get(helpers2.searchCompanies);

router.route('/usage')
  .post(helpers.writeSingleCompanyUsage);

router.route('/usage/all')
  .post(helpers.writeAllCompaniesUsage);

module.exports = router;
