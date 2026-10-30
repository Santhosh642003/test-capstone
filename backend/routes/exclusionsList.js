const express = require("express");
const router = express.Router();
const helpers = require("../helpers/exclusionsList");

router.route("/").get(helpers.getCompanyReport);

module.exports = router;
