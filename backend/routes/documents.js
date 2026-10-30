const express = require("express");
const router = express.Router();
const helpers = require("../helpers/documents");

router
  .route("/")
  .post(helpers.uploadFile)
  .delete(helpers.deleteFile)
  .get(helpers.getFile);

router.route("/list").get(helpers.getUserFiles);

module.exports = router;
