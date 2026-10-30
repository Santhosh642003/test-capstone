const express = require('express')
const router = express.Router()
const helpers = require('../helpers/signature')
const multer = require('multer')
const upload = multer().single('signature')

router.route('/')
  .get(helpers.getSignature)
  .post(upload,helpers.addSignature)

module.exports = router