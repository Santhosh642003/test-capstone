const express = require('express')
const router = express.Router()
const helpers = require('../helpers/metabase')

router.route('/demographicsDashboard')
    .get(helpers.getDemographicsDashboard)

router.route('/operationsDashboard')
    .get(helpers.getOperationsDashboard)

router.route('/hrDashboard')
    .get(helpers.getHRDashboard)

router.route('/financialDashboard')
    .get(helpers.getFinancialDashboard)

router.route('/customerDashboard')
    .get(helpers.getCustomerDashboard)

router.route('/employeeDashboard')
    .get(helpers.getEmployeeDashboard)

router.route('/companyDashboard')
    .get(helpers.getCompanyDashboard)

router.route('/unitsDashboard')
    .get(helpers.getUnitsDashboard)

router.route('/evvDashboard')
    .get(helpers.getEVVDashboard)

module.exports = router