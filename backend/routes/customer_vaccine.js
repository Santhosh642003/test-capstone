const express = require('express');
const router = express.Router();
const helpers = require('../helpers/customer_vaccine');

router.route('/sync')
    .post(helpers.syncVaccines);

router.route('/suggestions')
    .get(helpers.getVaccineSuggestions);

router.route('/by_customer/:customer_id')
    .get(helpers.getVaccinesByCustomerId);

router.route('/:customer_vaccine_id')
    .put(helpers.updateVaccine)
    .delete(helpers.deleteVaccine);

router.route('/')
    .post(helpers.createVaccine);

module.exports = router;
