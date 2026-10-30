const express = require('express');
const router = express.Router();
const helpers = require('../helpers/customer_assessment');

router.route('/by_customer/:customer_id')
    .get(helpers.getAssessmentsByCustomerId);

router.route('/:customer_assessment_id')
    .put(helpers.updateAssessment)
    .delete(helpers.deleteAssessment);

router.route('/')
    .post(helpers.createAssessment);

module.exports = router;
