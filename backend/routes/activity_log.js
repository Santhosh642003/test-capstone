const express = require('express');
const router = express.Router();
const axios = require('axios');
const helpers = require('../helpers/activity_log');


router.route('/')
  .get(helpers.getEmpInviteLog)
  .post(helpers.insertLog);
// .post(upload, artifacts.addArtifact)

router.route('/action')
  .get(helpers.getFilteredLogs);

router.route('/DDDSync')
  .get(helpers.getRecentDDDSyncLogs);


module.exports = router;
