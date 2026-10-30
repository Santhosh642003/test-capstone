const express = require('express');
const router = express.Router();
const helpers = require('../helpers/customer_medication');

router.route('/suggestions')
    .get(helpers.getMedicationSuggestions);

router.route('/by_customer/:customer_id')
    .get(helpers.getMedicationsByCustomerId);

router.route('/:customer_medication_id')
    .put(helpers.updateMedication)
    .delete(helpers.deleteMedication);

router.route('/')
    .post(helpers.createMedication);

module.exports = router;
