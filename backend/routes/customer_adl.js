const express = require('express');
const router = express.Router();
const helpers = require('../helpers/customer_adl');

router.route('/:customer_id')
    .get(helpers.getADLByCustomerId)
    .put(helpers.updateADLByCustomerId);

router.route('/')
    .post(helpers.createADL);

module.exports = router;
