const express = require('express');
const router = express.Router();
const helpers = require('../helpers/contacts');

router.route('/')
  .get(helpers.getContacts)
  .post(helpers.addNewContact)
  .put(helpers.updateContact)
  .delete(helpers.delContact);

router.route('/AllContacts')
  .get(helpers.getAllContacts);

router.route('/email')
  .put(helpers.updateContactEmail);

module.exports = router;
