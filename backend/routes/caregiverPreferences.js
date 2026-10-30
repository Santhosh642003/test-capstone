const express = require('express');
const router = express.Router();
const helpers = require('../helpers/caregiverPreferences');

router.route('/')
    .get(helpers.getCaregiverPreferences)
    .post(helpers.upsertCaregiverPreferences);

router.route('/company')
    .get(helpers.getCompanyCaregiverPreferences);

// Master Skills
router.route('/masterSkills')
    .get(helpers.getMasterSkills)
    .post(helpers.addMasterSkill);

router.route('/masterSkills/:id')
    .delete(helpers.removeMasterSkill);

// Master Preferences
router.route('/masterPreferences')
    .get(helpers.getMasterPreferences)
    .post(helpers.addMasterPreference);

router.route('/masterPreferences/:id')
    .delete(helpers.removeMasterPreference);

// Matchmaking
router.route('/matchmaking')
    .post(helpers.matchEmployees);

module.exports = router;
