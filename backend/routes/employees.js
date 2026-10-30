const express = require('express');
const router = express.Router();
const helpers = require('../helpers/employees');

router.route('/')
  .get(helpers.getEmpTables)
  .post(helpers.addEmployee)
  .put(helpers.updateEmployee)
  .delete(helpers.deleteEmployee);

router.route('/caregiverCount')
  .get(helpers.getCaregiverCount);

router.route('/v2/associated')
  .get(helpers.getAssociatedEmployees);

router.route('/hrstructure')
  .get(helpers.getHRstructure)
  .post(helpers.addToHRstructure)
  .put(helpers.updateHRstructure);

router.route('/recovery')
  .get(helpers.recoverEmployee);

router.route('/manager')
  .get(helpers.getEmpManagerRec);

router.route('/BulkUpload')
  .get(helpers.getOneEmployee);

router.route('/EmployeeTasks')
  .get(helpers.getEmployeeTasks)
  .post(helpers.addToEmployeeTask)
  .delete(helpers.deleteFromEmployeeTask);

router.route('/certifications')
  .post(helpers.addEmployeeCertification)
  .put(helpers.updateEmployeeCertification)
  .get(helpers.getEmployeeCertification)
  .delete(helpers.deleteEmployeeCertification);

module.exports = router;
