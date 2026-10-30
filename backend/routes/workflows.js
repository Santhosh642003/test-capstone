const express = require('express')
const router = express.Router()
const helpers = require('../helpers/workflows')

router.route('/')
    .get(helpers.getWorkflow)
    .put(helpers.updateWorkflow)
    .post(helpers.addWorkflow)

router.route('/instance')
    .get(helpers.getWorkflowInstance)
    .put(helpers.updateWorkflowInstance)
    .post(helpers.addWorkflowInstance)

router.route('/instance/unblock')
    .put(helpers.unblockWorkflowInstance)

router.route('/status')
    .put(helpers.updateWorkflowStatus)

router.route('/approvals')
    .get(helpers.getApprovalTasks)

router.route('/approvals/decision')
    .put(helpers.updateApprovalDecision)

router.route('/dashboard/monitor-delays')
    .get(helpers.getDashboardMonitorDelays)

router.route('/dashboard/bottleneck-tasks')
    .get(helpers.getDashboardBottleneckTasks)

router.route('/dashboard/employee-load')
    .get(helpers.getDashboardEmployeeLoad)

module.exports = router