const express = require('express');
const router = express.Router();
const helpers = require('../helpers/projects');
const helpersPEA = require('../helpers/project_employee_assignment');
const helpersPC = require('../helpers/project_contact');

router.route('/')
  .get(helpers.getProject)
  .post(helpers.addOneProject)
  .put(helpers.updateProj)
  .delete(helpers.delProj)
  .patch(helpers.patchProj);

// Merge
router.route('/v1')
  .get(helpers.getAProject);

router.route('/v1/count')
  .get(helpers.getProjectCount);


router.route('/associated')
  .get(helpers.getAssociatedProjects);

// Merge
// router.route("/OneProject")
//     .get(helpers.getOneProject)

// project emp employee assign
router.route('/UpdateProjEmp')
  .put(helpersPEA.addProjectEmp)
  .delete(helpersPEA.removeProjEmp);

// Lightweight, set-based API used by Settings > Customer Assignment.
router.route('/customer-assignments')
  .get(helpersPEA.getCustomerAssignments)
  .put(helpersPEA.updateCustomerAssignments);

// project contact
router.route('/updateProjContact')
  .put(helpersPC.addProjContact)
  .delete(helpersPC.delProjContact);

// Update Helpers & Merge
// router.route("/EmpProjects")
//     .get(helpers.getEmpProjects)

// Shift to task
router.route('/AllTask')
  .get(helpers.getTodaysTasks)
  .put(helpers.updateTaskStatus);

router.route('/BulkUpload')
  .get(helpers.getProjectListDDDID)
  .post(helpers.addOneProjectwithDefaults)
  .put(helpers.patchProject);

router.route('/projCont')
  .get(helpers.getProjContact);

router.route('/projTask')
  .get(helpers.getProjTask);

router.route('/intakeForm')
  .get(helpers.getIntakeForm);

module.exports = router;
