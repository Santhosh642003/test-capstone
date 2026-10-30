const express = require("express");
const router = express.Router();
const axios = require("axios");
const helpers = require('../helpers/system');


// router.route('/')
//   .get(helpers.getEmpInviteLog)

router.route('/whatsnew')
  .get(helpers.getLatestVersions)

router.route('/whatsnewcount')
  .get(helpers.getLatestVersionsCount)


module.exports = router;
