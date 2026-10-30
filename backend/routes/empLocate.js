const express = require('express');
const router = express.Router();
const helpers = require('../helpers/empLocate.js');

router.route('/empLoc')
  .get(helpers.getEmpLoc)
  .post(helpers.insertEmpLoc)
  .put(helpers.updateTaskStatusToComplete);

router.route('/locatePage')
  .put(helpers.updateTaskStatusToCompleteWithOverlapCheck);

router.route('/TimeSpent')
  .get(helpers.getTimeSpent);

module.exports = router;
