var express = require('express')
var router = express.Router()
var helpers = require('../helpers/montlycontact')

router.route("/")
    .post(helpers.sendMontlyContactData)
    .put(helpers.updateMonthlyContact)

module.exports = router
