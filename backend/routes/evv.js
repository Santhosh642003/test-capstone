var express = require('express');
var router = express.Router();
var helpers = require('../helpers/evv');
var evvLoghelpers = require('../helpers/evv_log');
var evvresendhelpers = require('../helpers/evv_resend');
var evvNJhelpers = require('../helpers/evv_nj');

router.route('/')
  .get(evvLoghelpers.getEvvLog)
  .post(helpers.sendEVVData);

router.route('/resend')
  .post(evvresendhelpers.sendEVVData);

router.route('/status')
  .get(helpers.getEVVStatusSummary);

router.route('/nj/sendEVV')
  .get(evvNJhelpers.getSendEVV)
  .put(evvNJhelpers.updateSendEVV);

router.route('/nj/summary')
  .get(evvNJhelpers.getEVVNJTaskSummary);

router.route('/nj/readiness')
  .get(evvNJhelpers.getNJEVVReadinessData);
    
module.exports = router;