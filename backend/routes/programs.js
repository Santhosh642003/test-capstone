const express = require('express');

const router = express.Router();
const helpers = require('../helpers/programs');

router.route('/')
  .post(helpers.addProgram)
  .put(helpers.updateProgram)
  .get(helpers.getPrograms)
  .delete(helpers.removeProgram);

router.route('/associations')
  .post(helpers.addProgramAssociation)
  .put(helpers.updateProgramAssociation)
  .get(helpers.getProgramAssociations)
  .delete(helpers.removeProgramAssociation);

module.exports = router;
