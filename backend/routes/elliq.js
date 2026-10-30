const express = require('express');
const router = express.Router();
const helpers = require('../helpers/elliq');

router.route('/chat')
    .post(helpers.chat);

router.route('/messages')
    .get(helpers.getMessages);

router.route('/customer/:cus_id/markdown')
    .get(helpers.getCustomerMarkdown);

router.route('/customer/:cus_id/projects/markdown')
    .get(helpers.generateCustomerProjectFiles);

router.route('/customer/:cus_id/tasks/markdown')
    .get(helpers.generateCustomerTaskFiles);

router.route('/customer/:cus_id/casenotes/markdown')
    .get(helpers.generateCustomerCaseNoteFiles);

router.route('/project/:pro_id/markdown')
    .get(helpers.getProjectMarkdown);

router.route('/casenote/:comment_id/markdown')
    .get(helpers.getCaseNoteMarkdown);

router.route('/task/:tas_id/markdown')
    .get(helpers.getTaskMarkdown);

router.route('/claim/:claim_id/markdown')
    .get(helpers.getClaimLineMarkdown);

router.route('/preauth/:preauth_id/markdown')
    .get(helpers.getPriorAuthMarkdown);

router.route('/customer/:cus_id/claims/markdown')
    .get(helpers.generateCustomerClaimFiles);

router.route('/customer/:cus_id/preauths/markdown')
    .get(helpers.generateCustomerPreAuthFiles);

module.exports = router;
