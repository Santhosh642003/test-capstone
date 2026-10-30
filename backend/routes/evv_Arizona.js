var express = require("express");
var router = express.Router();
var helpers = require("../helpers/evv_AZ");
var evvLoghelpers = require('../helpers/evv_AZ_log')

router.route("/")
    .get(evvLoghelpers.getEvvLog)

module.exports = router;