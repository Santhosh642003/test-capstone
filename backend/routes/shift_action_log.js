const express = require('express');
const router = express.Router();
const helpers = require('../helpers/shift_action_log');

router.route('/').post(helpers.insertShiftActionLog);

module.exports = router;
