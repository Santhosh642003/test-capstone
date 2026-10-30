const express = require('express')
const router = express.Router()
const helpers = require('../helpers/bulkupload')
const DDDSynchelper = require('../helpers/DDDSync')
const multer = require('multer')
const upload = multer().single('filecontent')

// Post rout multipart file
router.route('/')
  .post(upload, helpers.readAndDumpFileData)

router.route('/sync')
  .post(upload, DDDSynchelper.startSync)


module.exports = router
