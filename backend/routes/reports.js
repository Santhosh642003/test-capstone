const express = require('express');
const router = express.Router();
const helpers = require('../helpers/reports');
const customReportHelpers = require('../helpers/reports_custom');

router.route('/custom')
  .get(customReportHelpers.getCustomReports)
  .post(customReportHelpers.addCustomReport)
  .put(customReportHelpers.updateCustomReport);

router.route('/custom/:id')
  .get(customReportHelpers.getCustomReportById)
  .delete(customReportHelpers.deleteCustomReport);

router.route('/custom/:id/settings')
  .get(customReportHelpers.getCustomReportSettings);

router.route('/custom/settings')
  .post(customReportHelpers.saveCustomReportSettings);

router.route('/columns')
  .get(helpers.getReportColumns);

router.route('/manager')
  .get(helpers.getManagerReports);

router.route('/employee')
  .get(helpers.getEmpReports);

router.route('/getTimesheets')
  .get(helpers.getTimesheets);

router.route('/getActiveCustomers')
  .get(helpers.getActiveCustomers);

router.route('/getTasks')
  .get(helpers.getTasks);

router.route('/getPreAuth')
  .get(helpers.getPreAuth);

router.route('/getServiceAuth')
  .get(helpers.getServiceAuth);

router.route('/getLateMT')
  .get(helpers.getLateMT);

router.route('/getMTSummary')
  .get(helpers.getMTSummary);

router.route('/getSCVisits')
  .get(helpers.getSCVisits);

router.route('/getMTRejection')
  .get(helpers.getMTRejection);

router.route('/getCustomerSessions')
  .get(helpers.getCustomerSessions);

router.route('/getEmployeeSessions')
  .get(helpers.getEmployeeSessions);

router.route('/getSessionsByDate')
  .get(helpers.getSessionsByDate);

router.route('/getSessions')
  .get(helpers.getSessions);

router.route('/getTimeAndExpenses')
  .get(helpers.getTimeAndExpenses);

router.route('/getClientTermination')
  .get(helpers.getClientTermination);

router.route('/getClientStatus')
  .get(helpers.getClientStatus);

router.route('/getManagementReview')
  .get(helpers.getManagementReview);

router.route('/getMTCompletionDetail')
  .get(helpers.getMTCompletionDetail);

router.route('/getCustomerContacts')
  .get(helpers.getCustomerContacts);

router.route('/getPlanRenewalReport')
  .get(helpers.getPlanRenewalReport);

router.route('/getHomeVisitsReport')
  .get(helpers.getHomeVisitsReport);

router.route('/getShiftChangeLogsReport')
  .get(helpers.getShiftChangeLogsReport);

router.route('/getHistoricalVisitsSummaryReport')
  .get(helpers.getHistoricalVisitsSummaryReport);

router.route('/getIncompleteShiftsReport')
  .get(helpers.getIncompleteShiftsReport);

module.exports = router;
