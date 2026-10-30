const express = require('express')
const router = express.Router()
const helpers = require('../helpers/forms')

router.route('/')
  .get(helpers.getForm)
  .post(helpers.addForm)
  .put(helpers.updateForm)

router.route('/response')
  //.get(helpers.getFormResponse)
  .post(helpers.addFormResponse)
  //.put(helpers.updateFormResponse)

router.route('/bridge')
  .get(helpers.getFormBridge)
  //.post(helpers.addFormBridge)
  //.put(helpers.updateFormBridge)

router.route('/form_report')
  .get(helpers.getForm_report)
  .post(helpers.addForm_report)
  .put(helpers.updateForm_report)

module.exports = router
