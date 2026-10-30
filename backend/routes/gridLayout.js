const express = require('express')
const router = express.Router()
const helpers = require('../helpers/gridLayout')

router.route('/')
    .get(helpers.getGridLayout)
    .post(helpers.addGridLayout)
    .put(helpers.updateGridLayout)
    .delete(helpers.deleteGridLayout)

router.route('/layoutContent')
    .get(helpers.getGridLayoutContent)
    .post(helpers.addGridLayoutContent)
    .put(helpers.updateGridLayoutContent)
    .delete(helpers.deleteGridLayoutContent)

router.route('/forSettings')
    .get(helpers.getGridLayoutForSettings)

router.route('/layoutContent/forSettings')
    .get(helpers.getGridLayoutContentForSettings)

module.exports = router