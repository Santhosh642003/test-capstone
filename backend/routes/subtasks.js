var express = require('express')
var router = express.Router()
var helpers = require('../helpers/subtasks')

router.route("/")
    .get(helpers.getAllSubtasks)
    .post(helpers.sendSubtaskData)
    .put(helpers.updateOneSubtask)

module.exports = router