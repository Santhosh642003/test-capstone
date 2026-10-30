const express = require('express');

const router = express.Router();
const helpers = require('../helpers/customer_assignment');

// Get all assignments, create one assignment, or bulk-update
// employee assignments for one customer.
router.route('/')
  .get(helpers.getAllAssignments)
  .post(helpers.createAssignment)
  .put(helpers.bulkUpdateAssignments);

// Bulk-update customer assignments for one employee.
router.route('/bulk/employee')
  .put(helpers.bulkUpdateAssignmentsByEmployee);

// Get assignments by employee ID.
router.route('/employee/:employee_id')
  .get(helpers.getAssignmentsByEmployeeId);

// Get assignments by customer ID.
router.route('/customer/:customer_id')
  .get(helpers.getAssignmentsByCustomerId);

// Get, update, or delete a specific assignment.
// Dynamic routes must remain after all named routes.
router.route('/:assignment_id')
  .get(helpers.getAssignmentById)
  .put(helpers.updateAssignment)
  .delete(helpers.deleteAssignment);

module.exports = router;