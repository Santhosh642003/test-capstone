const express = require('express')
const router = express.Router()
const helpers = require('../helpers/datagrid')

router.route('/')
    .get(helpers.getDataGridSettings)
    .post(helpers.addDataGridSettings)
    .put(helpers.updateDataGridSettings)
    .delete(helpers.deleteDataGridSettings)

module.exports = router