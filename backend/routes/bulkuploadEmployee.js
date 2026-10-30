const express = require('express')
const router = express.Router()
const helpers = require('../helpers/bulkuploadEmployee_v2')
const multer = require('multer')
const upload = multer().single('filecontent')

router.route('/')
    .post(upload, helpers.bulkImportEmployees)

module.exports = router