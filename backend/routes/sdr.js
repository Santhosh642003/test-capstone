const express = require('express');
const router = express.Router();
const helpers = require('../helpers/sdr');
const multer = require('multer')
const upload = multer().single('file')

router.route('/upload')
    .post(upload, helpers.postSdrUpload);

router.route('/uploads')
    .get(helpers.getServicePlanUploads)
    .post(helpers.postServicePlanUpload);

module.exports = router;