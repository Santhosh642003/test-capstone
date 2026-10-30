const express = require('express')
const router = express.Router()
const helpers = require('../helpers/customer_form')

router.route('/')
    .post(helpers.postForm)

router.route('/:id')
    .get(helpers.getForm)
    .put(helpers.updateForm)
    .delete(helpers.deleteForm)

router.route('/task/:id')
    .get(helpers.getFormsByTask)

router.route('/customer/:id')
    .get(helpers.getFormsByCustomer)

router.route('/formsWithData/:id')
    .get(helpers.getFormsWithData)

router.route('/formCount/:id')
    .get(helpers.getFormCount)

module.exports = router