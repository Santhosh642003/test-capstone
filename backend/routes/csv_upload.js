const express = require('express')
const router = express.Router()
const helpers = require('../helpers/csvupload')

const multer = require('multer')
const upload = multer().single('filecontent')

router.route('/')
  .post(upload, helpers.sendData)

module.exports = router
