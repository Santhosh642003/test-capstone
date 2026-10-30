const express = require('express')
const router = express.Router()
const helpers = require('../helpers/claimCSV')
const multer = require('multer')
const upload = multer().single('filecontent')

router.route('/')
  .post(upload, helpers.addClaimCSV)

module.exports = router
