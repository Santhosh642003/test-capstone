const express = require('express');
const router = express.Router();
const helpers = require('../helpers/procedureCodes');

router.route('/')
  .get(helpers.getOneMappingForProcCode)
  .post(helpers.getProcs);

router.route('/handleMappingForTaskProcCode')
  .get(helpers.getProcCodeMappingsForCompany)
  .post(helpers.handleMappings)
  .put(helpers.updateProcCodeMapping);

//   .post(helpers.addProjContact)
//   .delete(helpers.delProjContact)

module.exports = router;
