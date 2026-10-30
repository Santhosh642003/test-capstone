const express = require("express");
const router = express.Router();
const helpers = require("../helpers/directories");

router.route("/")
    .post(helpers.createDirectory);

router.route("/:id")
    .get(helpers.getDirectory)
    .put(helpers.updateDirectory)
    .delete(helpers.deleteDirectory);

router.route("/all/:extID")
    .get(helpers.getAllFiles);

router.route("/initiate/:company_id")
    .post(helpers.initiateDirectories);

router.route("/virtual/:company_id")
    .get(helpers.getVirtualDirectories);

module.exports = router;