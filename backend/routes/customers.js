const express = require('express');

const router = express.Router();
const helpers = require('../helpers/customers');
const extensionHelpers = require('../helpers/customer_extension');

const multer = require('multer');

const upload = multer().single('file');

router.route('/customersForReportsCentre')
  .get(helpers.getCustomersForReportsCentre);

router.route('/getCustomersList')
  .get(helpers.getCustomersList);

router.route('/v2')
  .get(helpers.getCustomers);

router.route('/v2/associated')
  .get(helpers.getCustomersAssociated);

router.route('/scheduler')
  .get(helpers.getCustomersForScheduler);

router.route('/')
  .get(helpers.getCusTables)
  .post(helpers.addNewCustomers)
  .put(helpers.updateCustomers)
  .delete(helpers.delCustomers);

router.route('/assigned')
  .get(helpers.getAssignedCustomers);

router.route('/assignmentHistory')
  .get(helpers.getCustomerAssignmentHistory);

router.route('/sameAddress')
  .get(helpers.getCustomersAtSameAddress);

router.route('/AddCustomerWithProj')
  // .get(helpers.getAllCustomer)
  .post(helpers.addNewCustomersWithProj);

router.route('/BulkUpload')
  .get(helpers.getCustomerByDDD)
  .post(helpers.addOneCustomer);

router.route('/SCH')
  .get(helpers.getCustomerSCHData);

router.route('/CustomerTasks')
  .get(helpers.getCustomerTasks)
  .post(helpers.addToCustomerTask)
  .delete(helpers.deleteFromCustomerTask);

router.route('/detailsPDF')
  .get(helpers.getCustomerDetailsPDF);

router.route('/getAssociatedCustomersAndTaskTypes')
  .get(helpers.getAssociatedCustomersAndTaskTypes);

router.route('/getAssociatedCustomersAndTaskNotes')
  .get(helpers.getAssociatedCustomersAndTaskNotes);

router.route('/image')
  .get(helpers.getCustomerImage)
  .post(upload, helpers.addCustomerImage);

router.route('/email')
  .put(helpers.updateCustomerEmail);

router.route('/extension')
  .post(extensionHelpers.addCustomerExtension)
  .put(extensionHelpers.updateCustomerExtension)
  .get(extensionHelpers.getCustomerExtension)
  .delete(extensionHelpers.removeCustomerExtension);

router.route('/employeePreference')
  .post(helpers.addEmployeeCustomerPreference)
  .put(helpers.updateEmployeeCustomerPreference)
  .get(helpers.getEmployeeCustomerPreference)
  .delete(helpers.deleteEmployeeCustomerPreference);

module.exports = router;
