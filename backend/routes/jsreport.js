const express = require("express");
const router = express.Router();
const axios = require("axios");
const client = require('@jsreport/nodejs-client')("https://fieldworker.jsreportonline.net", process.env.JSREPORT_USER, process.env.JSREPORT_PW);
const helpers = require('../helpers/jsreport');

router.route('/timesheet')
    .get(helpers.getPayrollReport)

router.route('/debarment')
    .get(helpers.getDebarmentReport)

router.route('/debarmentV2')
    .get(helpers.getDebarmentReportV2)

router.route('/consolidatedDebarment')
    .get(helpers.getConsolidatedDebarmentReport)

router.route('/consolidatedDebarmentV2')
    .get(helpers.getConsolidatedDebarmentReportV2)

router.route('/invoice')
    .get(helpers.getInvoiceReport)

router.route('/cm_invoice')
    .get(helpers.getCM_InvoiceReport)

router.route('/billingTrans')
    .get(helpers.getBillingTransReport)

router.route('/claimCollect')
    .get(helpers.getClaimCollectReport)

router.route('/claimBalance')
    .get(helpers.getClaimBalanceReport)

router.route('/outstandingBalance')
    .get(helpers.getOutstandingBalanceReport)

router.route('/PA_Utilization')
    .get(helpers.getPA_UtilizationReport)

router.route('/privatePayerInvoice')
    .get(helpers.getPrivatePayerInvoice)

router.route('/getFavorites').get(helpers.getFavorites)
router.route('/getAllReports').get(helpers.getAllReports)
router.route('/markFavorite').put(helpers.markFavorite)

module.exports = router;