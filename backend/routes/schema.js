const express = require('express')
const router = express.Router()
const helpers = require('../helpers/schema')

router.route('/:id')
    .get(helpers.getSchemaById)
    .delete(helpers.deleteSchemaById)
    .put(helpers.updateSchemaById)

router.route('/table/:tableName')
    .get(helpers.getSchemaByTableAndCompany)

router.route('/table-default/:tableName')
    .get(helpers.getDefaultSchemaByTableStateType)

router.route('/')
    .post(helpers.postSchema)
    .get(helpers.getAllSchemas)

module.exports = router
