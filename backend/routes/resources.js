const express = require('express')
const router = express.Router()
const helpers = require('../helpers/resources')

router.route('/:id')
    .get(helpers.getResourceById)
    .delete(helpers.deleteResourceById)
    .put(helpers.updateResourceById)

router.route('/')
    .post(helpers.postResource)

router.route('/company/:id')
    .get(helpers.getResourcesByCompany)

module.exports = router