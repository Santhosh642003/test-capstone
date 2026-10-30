const express = require('express');
const router = express.Router();
const helpers = require('../helpers/customer_incident');

router.route('/by_customer/:customer_id')
    .get(helpers.getIncidentsByCustomerId);

router.route('/:customer_incident_id')
    .put(helpers.updateIncidentIds)
    .delete(helpers.deleteIncident);

router.route('/')
    .post(helpers.createIncident);

module.exports = router;
