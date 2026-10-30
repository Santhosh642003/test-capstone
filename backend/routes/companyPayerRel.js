const express = require('express')
const router = express.Router()
const helpers = require('../helpers/companyPayerRel')

router.route('/')
    .get(helpers.getCompanyPayerRels)
    .put(helpers.updateCompanyPayerRels)
    .post(helpers.addCompanyPayerRels)
    .delete(helpers.deleteCompanyPayerRels)

module.exports = router