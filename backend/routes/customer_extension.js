const express = require('express')
const router = express.Router()
const helpers = require('../helpers/customer_extension')

router.route('/')
    .get(helpers.getCustomerExtension)
    .post(helpers.addCustomerExtension)
    .put(helpers.updateCustomerExtension)
    .delete(helpers.removeCustomerExtension)

router.route('/with_customer')
    .get(helpers.getCustomerWithExtension)

module.exports = router
