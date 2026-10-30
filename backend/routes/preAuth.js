const express = require('express')
const router = express.Router()
const helpers = require('../helpers/preAuth')
const multer = require('multer')
const upload = multer().single('filecontent')

router.route('/')
  .post(upload, helpers.addPreAuthCSV)
  .get(helpers.getpreAuth)

router.route('/addPA')
  .post(helpers.addPreAuth)

router.route('/taskType')
  .get(helpers.getPreAuthTaskType)

module.exports = router
