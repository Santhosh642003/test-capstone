const express = require('express');
const router = express.Router();
const helpers = require('../helpers/messages');

// GET  /api/fieldworker/messages?comp_id=        — list active messages for a company (Settings view)
// POST /api/fieldworker/messages                  — create a new message (with fan-out)
router.route('/')
    .get(helpers.getCompanyMessages)
    .post(helpers.createMessage);

// GET  /api/fieldworker/messages/pending?emp_id=&comp_id=&role=  — pending messages for a user
router.route('/pending')
    .get(helpers.getPendingMessages);

// PUT  /api/fieldworker/messages/delivery/:delivery_id  — dismiss (close) one delivery record
router.route('/delivery/:delivery_id')
    .put(helpers.dismissMessage);

// PUT  /api/fieldworker/messages/:msg_id/deactivate  — soft-delete a message
router.route('/:msg_id/deactivate')
    .put(helpers.deactivateMessage);

module.exports = router;
