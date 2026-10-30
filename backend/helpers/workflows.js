const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const axios = require("axios");
const moment = require('moment');
const schedule = require('node-schedule');
const crypto = require('crypto')
const os = require('os');

const { env, CUSTOMERIO_API_KEY, AH_CUSTOMERIO_PUSH_KEY, IN_APP_MESSAGE_APPROVAL_REJECTED_ID } = require('../config.js')
const { APIClient, RegionUS, SendEmailRequest, SendPushRequest } = require("customerio-node");
const client = new APIClient(CUSTOMERIO_API_KEY);
// Broadcasts need an explicit region, unlike the transactional email/push calls above.
const broadcastClient = new APIClient(CUSTOMERIO_API_KEY, { region: RegionUS });

// Workflow instance status
const INSTANCE_STATUS = {
    NOT_STARTED: 0,
    IN_PROGRESS: 1,
    COMPLETED: 2,
    PAUSED: 3,
    CLOSED: 4,
    BLOCKED: 5,
};

// Edge / node lifecycle status
const EDGE_STATUS = {
    COMPLETED: 0,
    ACTIVE: 1,
    BLOCKED: 2,
};

const NODE_STATUS = {
    COMPLETED: 0,
    ACTIVE: 1,
};

const RUN_HOST = process.env.WEBSITE_INSTANCE_ID || os.hostname() || 'unknown';

const ORCHESTRATOR_MAX_JITTER_MS = 60 * 1000;

exports.getWorkflow = async function (req, res) {
    try {
        const getWorkflows = `SELECT * FROM workflow WHERE wf_companyID = ${req.query.compID}`;
        const workflows = await DBSendResponse(getWorkflows);

        return res.status(200).json(workflows);
    } catch (err) {
        console.log('QUERY FAILURE | getWorkflow Query Failed:')
        console.log(err)
        return res.status(400).json({
            message: 'An unexpected error occured',
        })
    }
};

exports.addWorkflow = async function (req, res) {
    try {
        const data = {
            wf_version: generateSQLText(req.body.wf_version, 256, null),
            wf_title: generateSQLText(req.body.wf_title, 256, null),
            wf_description: generateSQLText(req.body.wf_description, 512, null),
            wf_nodes: generateSQLText(req.body.wf_nodes, 8000, null),
            wf_edges: generateSQLText(req.body.wf_edges, 8000, null),
            wf_status: isNaN(parseInt(req.body.wf_status)) ? null : parseInt(req.body.wf_status),
            wf_companyID: isNaN(parseInt(req.body.wf_companyID)) ? null : parseInt(req.body.wf_companyID),
            wf_createdBy: isNaN(parseInt(req.body.wf_createdBy)) ? null : parseInt(req.body.wf_createdBy),
            wf_createdAt: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateInsertSQL('workflow', data) + 'SELECT SCOPE_IDENTITY()'
        const newWorkflowId = await DBinsertSendID(query)

        res.status(200).json({
            id: newWorkflowId
        })
    } catch (err) {
        console.log('QUERY FAILURE | addWorkflow Query Failed:')
        console.log(err)
        res.status(400).json({
            message: 'An unexpected error occured'
        })
    }
};

exports.updateWorkflow = async function (req, res) {
    try {
        const data = {
            wf_version: generateSQLText(req.body.wf_version, 256, null),
            wf_title: generateSQLText(req.body.wf_title, 256, null),
            wf_description: generateSQLText(req.body.wf_description, 512, null),
            wf_nodes: generateSQLText(req.body.wf_nodes, 8000, null),
            wf_edges: generateSQLText(req.body.wf_edges, 8000, null),
            wf_status: isNaN(parseInt(req.body.wf_status)) ? null : parseInt(req.body.wf_status),
            wf_createdBy: isNaN(parseInt(req.body.wf_createdBy)) ? null : parseInt(req.body.wf_createdBy),
        };
        const query = generateUpdateSQL('workflow', data, `wf_id = ${parseInt(req.body.wf_id)}`);
        await DBSendResponse(query);

        res.status(200).json({
            message: 'Workflow updated successfully'
        });
    } catch (err) {
        console.log('QUERY FAILURE | updateWorkflow Query Failed:');
        console.log(err);
        res.status(400).json({
            message: 'An unexpected error occurred'
        });
    }
};

exports.getWorkflowInstance = async function (req, res) {
    try {
        let getWorkflows = `
            SELECT wf.*, wfi.*, c.cus_id, c.cus_name, e.emp_id, e.emp_first_name, e.emp_last_name,
                (SELECT wn.*, t.tas_id, t.tas_title, t.tas_start_time, t.tas_end_time
                    FROM workflowNode wn
                    LEFT JOIN task t ON t.tas_id = wn.node_taskID
                    WHERE wn.node_wf_instanceID = wfi.wf_instanceID
                for JSON PATH) as nodeData,
                (SELECT we.*, tSource.tas_id AS source_tas_id, tSource.tas_title AS source_tas_title, tSource.tas_start_time AS source_tas_start_time, tSource.tas_end_time AS source_tas_end_time, tTarget.tas_id AS target_tas_id, tTarget.tas_title AS target_tas_title, tTarget.tas_start_time AS target_tas_start_time, tTarget.tas_end_time AS target_tas_end_time
                    FROM workflowEdge we
                    LEFT JOIN task tSource ON tSource.tas_id = we.edge_sourceTaskID
                    LEFT JOIN task tTarget ON tTarget.tas_id = we.edge_targetTaskID
                    WHERE we.edge_wf_instanceID = wfi.wf_instanceID 
                for JSON PATH) as edgeData
            FROM workflow wf
            JOIN workflowInstance wfi ON wfi.wf_instanceWF_ID = wf.wf_id
            JOIN customer c ON c.cus_id = wfi.wf_instanceCustomer
            JOIN employee e ON e.emp_id = wfi.wf_instanceEmployee
            WHERE wf.wf_companyID = ${req.query.compID}
        `;

        if (req.query.workflowType) {
            if (req.query.workflowType === 'Active') {
                getWorkflows += ` AND wfi.wf_instanceStatus IN (${INSTANCE_STATUS.IN_PROGRESS}, ${INSTANCE_STATUS.BLOCKED})`;
            } else if (req.query.workflowType === 'Blocked') {
                getWorkflows += ` AND wfi.wf_instanceStatus = ${INSTANCE_STATUS.BLOCKED}`;
            }
        }
        if (req.query.program_id && req.query.program_id !== 'all') {
            const requestedProgramId = parseInt(req.query.program_id, 10);
            if (!isNaN(requestedProgramId)) {
                getWorkflows += ` AND EXISTS (
                    SELECT 1
                    FROM project p
                    WHERE p.pro_customer_id = c.cus_id
                      AND p.pro_program_id = ${requestedProgramId}
                )`;
            }
        }
        if (req.query.customerID) {
            getWorkflows += ` AND wfi.wf_instanceCustomer = ${req.query.customerID}`;
        }
        if (req.query.employeeID) {
            getWorkflows += ` AND wfi.wf_instanceEmployee = ${req.query.employeeID}`;
        }

        const workflows = await DBSendResponse(getWorkflows);

        const workflowInstances = workflows.map((wf) => {
            wf.nodeData = JSON.parse(wf.nodeData);
            wf.edgeData = JSON.parse(wf.edgeData);
            return wf;
        })

        return res.status(200).json(workflowInstances);
    } catch (err) {
        console.log('QUERY FAILURE | getWorkflowInstance Query Failed:')
        console.log(err)
        return res.status(400).json({
            message: 'An unexpected error occured',
        })
    }
};

exports.addWorkflowInstance = async function (req, res) {
    try {
        const data = {
            wf_instanceWF_ID: isNaN(parseInt(req.body.wf_instanceWF_ID)) ? null : parseInt(req.body.wf_instanceWF_ID),
            wf_instanceStatus: isNaN(parseInt(req.body.wf_instanceStatus)) ? null : parseInt(req.body.wf_instanceStatus),
            wf_instanceCustomer: isNaN(parseInt(req.body.wf_instanceCustomer)) ? null : parseInt(req.body.wf_instanceCustomer),
            wf_instanceEmployee: isNaN(parseInt(req.body.wf_instanceEmployee)) ? null : parseInt(req.body.wf_instanceEmployee),
            wf_instanceStartDate: req.body.wf_instanceStartDate,
            wf_instanceEndDate: req.body.wf_instanceEndDate,
            wf_instanceCreatedBy: isNaN(parseInt(req.body.wf_instanceCreatedBy)) ? null : parseInt(req.body.wf_instanceCreatedBy),
            wf_instanceCreatedAt: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateInsertSQL('workflowInstance', data) + 'SELECT SCOPE_IDENTITY()'
        const newWorkflowInstanceId = await DBinsertSendID(query)

        res.status(200).json({
            id: newWorkflowInstanceId
        })
    } catch (err) {
        console.log('QUERY FAILURE | addWorkflowInstance Query Failed:')
        console.log(err)
        res.status(400).json({
            message: 'An unexpected error occured'
        })
    }
};

exports.updateWorkflowInstance = async function (req, res) {
    try {
        const data = {
            wf_instanceStatus: isNaN(parseInt(req.body.wf_instanceStatus)) ? null : parseInt(req.body.wf_instanceStatus),
            wf_instanceEmployee: isNaN(parseInt(req.body.wf_instanceEmployee)) ? null : parseInt(req.body.wf_instanceEmployee),
            wf_instanceStartDate: req.body.wf_instanceStartDate,
            wf_instanceEndDate: req.body.wf_instanceEndDate,
            wf_instanceCreatedBy: isNaN(parseInt(req.body.wf_instanceCreatedBy)) ? null : parseInt(req.body.wf_instanceCreatedBy),
        };
        const query = generateUpdateSQL('workflowInstance', data, `wf_instanceID = ${parseInt(req.body.wf_instanceID)}`);
        await DBSendResponse(query);

        res.status(200).json({
            message: 'Workflow Instance updated successfully'
        });
    } catch (err) {
        console.log('QUERY FAILURE | updateWorkflowInstance Query Failed:');
        console.log(err);
        res.status(400).json({
            message: 'An unexpected error occurred'
        });
    }
};

exports.unblockWorkflowInstance = async function (req, res) {
    try {
        const instanceID = parseInt(req.body.wf_instanceID);

        if (isNaN(instanceID)) {
            return res.status(400).json({ message: 'wf_instanceID is required' });
        }

        const instances = await DBSendResponse(`SELECT wf_instanceStatus FROM workflowInstance WHERE wf_instanceID = ${instanceID}`);

        if (instances.length === 0) {
            return res.status(404).json({ message: 'Workflow instance not found' });
        }

        if (instances[0].wf_instanceStatus !== INSTANCE_STATUS.BLOCKED) {
            return res.status(400).json({ message: 'Only a blocked workflow instance can be unblocked' });
        }

        await DBSendResponse(`
            UPDATE workflowEdge
            SET edge_status = ${EDGE_STATUS.ACTIVE}, edge_failureReason = NULL
            WHERE edge_wf_instanceID = ${instanceID} AND edge_status = ${EDGE_STATUS.BLOCKED}
        `);

        await DBSendResponse(`
            UPDATE workflowInstance
            SET wf_instanceStatus = ${INSTANCE_STATUS.IN_PROGRESS}
            WHERE wf_instanceID = ${instanceID}
        `);

        return res.status(200).json({ message: 'Workflow instance unblocked successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | unblockWorkflowInstance Query Failed:');
        console.log(err);
        return res.status(400).json({
            message: 'An unexpected error occurred'
        });
    }
};

exports.updateWorkflowStatus = async function (req, res) {
    try {
        const data = {
            wf_status: isNaN(parseInt(req.body.wf_status)) ? null : parseInt(req.body.wf_status),
            wf_createdBy: isNaN(parseInt(req.body.wf_createdBy)) ? null : parseInt(req.body.wf_createdBy),
        };
        const query = generateUpdateSQL('workflow', data, `wf_id = ${parseInt(req.body.wf_id)}`);
        await DBSendResponse(query);

        res.status(200).json({
            message: 'Workflow updated successfully'
        });
    } catch (err) {
        console.log('QUERY FAILURE | updateWorkflowStatus Query Failed:');
        console.log(err);
        res.status(400).json({
            message: 'An unexpected error occurred'
        });
    }
};

exports.getDashboardMonitorDelays = async function (req, res) {
    try {
        const compID = parseInt(req.query.compID);
        if (isNaN(compID)) {
            return res.status(400).json({ message: 'compID is required' });
        }

        const query = `
            WITH openNodes AS (
                SELECT
                    wn.node_wf_instanceID,
                    wn.node_activatedAt,
                    ISNULL(t.tas_title, wn.node_type) AS state_title,
                    ROW_NUMBER() OVER (PARTITION BY wn.node_wf_instanceID ORDER BY wn.node_activatedAt DESC) AS rn
                FROM workflowNode wn
                LEFT JOIN task t ON t.tas_id = wn.node_taskID
                WHERE wn.node_activatedAt IS NOT NULL AND wn.node_completedAt IS NULL
            )
            SELECT
                wfi.wf_instanceID AS id,
                wf.wf_title AS workflow_name,
                c.cus_name AS customer,
                n.state_title AS current_state,
                DATEDIFF(DAY, wfi.wf_instanceEndDate, GETDATE()) AS delay_days,
                LTRIM(RTRIM(CONCAT(e.emp_first_name, ' ', e.emp_last_name))) AS assigned_to
            FROM workflowInstance wfi
            JOIN workflow wf ON wf.wf_id = wfi.wf_instanceWF_ID
            LEFT JOIN customer c ON c.cus_id = wfi.wf_instanceCustomer
            LEFT JOIN employee e ON e.emp_id = wfi.wf_instanceEmployee
            LEFT JOIN openNodes n ON n.node_wf_instanceID = wfi.wf_instanceID AND n.rn = 1
            WHERE wfi.wf_instanceStatus = 1
                AND wf.wf_companyID = ${compID}
                AND wfi.wf_instanceEndDate IS NOT NULL
                AND wfi.wf_instanceEndDate < CAST(GETDATE() AS DATE)
            ORDER BY delay_days DESC
        `;
        const rows = await DBSendResponse(query);
        return res.status(200).json(rows);
    } catch (err) {
        console.log('QUERY FAILURE | getDashboardMonitorDelays Query Failed:');
        console.log(err);
        return res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.getDashboardBottleneckTasks = async function (req, res) {
    try {
        const compID = parseInt(req.query.compID);
        if (isNaN(compID)) {
            return res.status(400).json({ message: 'compID is required' });
        }

        const query = `
            SELECT
                wn.node_id AS id,
                ISNULL(t.tas_title, wn.node_type) AS current_task,
                wf.wf_title AS workflow_name,
                c.cus_name AS customer,
                LTRIM(RTRIM(CONCAT(e.emp_first_name, ' ', e.emp_last_name))) AS assigned_to,
                DATEDIFF(DAY, wn.node_activatedAt, GETDATE()) AS days_open,
                DATEDIFF(HOUR, wn.node_activatedAt, GETDATE()) AS hours_open
            FROM workflowNode wn
            LEFT JOIN task t ON t.tas_id = wn.node_taskID
            JOIN workflowInstance wfi ON wfi.wf_instanceID = wn.node_wf_instanceID
            JOIN workflow wf ON wf.wf_id = wfi.wf_instanceWF_ID
            LEFT JOIN customer c ON c.cus_id = wfi.wf_instanceCustomer
            LEFT JOIN employee e ON e.emp_id = wfi.wf_instanceEmployee
            WHERE wn.node_activatedAt IS NOT NULL
                AND wn.node_completedAt IS NULL
                AND wfi.wf_instanceStatus = 1
                AND wf.wf_companyID = ${compID}
            ORDER BY wn.node_activatedAt ASC
        `;
        const rows = await DBSendResponse(query);
        return res.status(200).json(rows);
    } catch (err) {
        console.log('QUERY FAILURE | getDashboardBottleneckTasks Query Failed:');
        console.log(err);
        return res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.getDashboardEmployeeLoad = async function (req, res) {
    try {
        const compID = parseInt(req.query.compID);
        if (isNaN(compID)) {
            return res.status(400).json({ message: 'compID is required' });
        }

        const query = `
            SELECT
                e.emp_id AS id,
                LTRIM(RTRIM(CONCAT(e.emp_first_name, ' ', e.emp_last_name))) AS employee,
                COUNT(DISTINCT wfi.wf_instanceID) AS blocked_count
            FROM employee e
            JOIN workflowInstance wfi ON wfi.wf_instanceEmployee = e.emp_id
            JOIN workflowNode wn ON wn.node_wf_instanceID = wfi.wf_instanceID
            JOIN workflow wf ON wf.wf_id = wfi.wf_instanceWF_ID
            WHERE wfi.wf_instanceStatus = 1
                AND wn.node_completedAt IS NULL
                AND wn.node_activatedAt IS NOT NULL
                AND wf.wf_companyID = ${compID}
            GROUP BY e.emp_id, e.emp_first_name, e.emp_last_name
            ORDER BY blocked_count DESC
        `;
        const rows = await DBSendResponse(query);
        return res.status(200).json(rows);
    } catch (err) {
        console.log('QUERY FAILURE | getDashboardEmployeeLoad Query Failed:');
        console.log(err);
        return res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

// Approval tasks awaiting a decision from the given employee, each with the previous task in the
// workflow and that task's submitted forms (what the approver is being asked to review).
// The previous task is found through the edge that fed the approval node: its edge_targetTaskID is
// set to the approval task when the node is activated, and edge_sourceTaskID is the preceding task.
exports.getApprovalTasks = async function (req, res) {
    try {
        const empID = parseInt(req.query.emp_id);

        if (isNaN(empID)) {
            return res.status(400).json({ message: 'emp_id is required' });
        }

        const query = `
            SELECT
                t.tas_id, t.tas_title, t.tas_description, t.tas_start_date, t.tas_end_date,
                t.tas_form_approval_status, t.tas_cus_id,
                c.cus_name,
                wf.wf_title,
                wfi.wf_instanceID,
                prevTask.tas_id AS prev_tas_id,
                prevTask.tas_title AS prev_tas_title,
                prevTask.tas_type AS prev_tas_type,
                LTRIM(RTRIM(CONCAT(prevEmp.emp_first_name, ' ', prevEmp.emp_last_name))) AS prev_emp_name,
                (SELECT cf.*, f.form_name, f.json_schema, f.translated_json_schema
                    FROM customer_form cf
                    JOIN fw_forms f ON cf.form_type = f.form_id
                    WHERE cf.task_id = prevTask.tas_id
                    FOR JSON PATH) AS prevTaskForms
            FROM task t
            JOIN workflowNode wn ON wn.node_taskID = t.tas_id AND wn.node_type = 'approvalNode'
            JOIN workflowInstance wfi ON wfi.wf_instanceID = wn.node_wf_instanceID
            JOIN workflow wf ON wf.wf_id = wfi.wf_instanceWF_ID
            LEFT JOIN customer c ON c.cus_id = t.tas_cus_id
            LEFT JOIN workflowEdge we ON we.edge_targetTaskID = t.tas_id AND we.edge_wf_instanceID = wfi.wf_instanceID
            LEFT JOIN task prevTask ON prevTask.tas_id = we.edge_sourceTaskID
            LEFT JOIN employee prevEmp ON prevEmp.emp_id = prevTask.tas_emp_id
            WHERE t.tas_emp_id = ${empID}
                AND t.tas_form_approval_status IS NULL
            ORDER BY t.tas_start_date ASC
        `;

        const approvalTasks = await DBSendResponse(query);

        return res.status(200).json(approvalTasks.map((task) => ({
            ...task,
            prevTaskForms: JSON.parse(task.prevTaskForms || '[]'),
        })));
    } catch (err) {
        console.log('QUERY FAILURE | getApprovalTasks Query Failed:');
        console.log(err);
        return res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

// Records an approve/reject decision. The orchestrator polls tas_form_approval_status and branches
// the workflow on the next run: 1 -> Approve path, 0 -> Reject path.
exports.updateApprovalDecision = async function (req, res) {
    try {
        const taskID = parseInt(req.body.tas_id);
        const empID = parseInt(req.body.emp_id);
        const approved = req.body.approved;

        if (isNaN(taskID) || isNaN(empID) || typeof approved !== 'boolean') {
            return res.status(400).json({ message: 'tas_id, emp_id and approved (boolean) are required' });
        }

        // A rejection must say why: the reason is the only record of what the submitter needs to fix.
        // generateSQLText escapes quotes and caps the length, so free text is safe to interpolate.
        const reasonText = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
        const rejectionReason = approved ? null : generateSQLText(reasonText, 1000);

        if (!approved && !rejectionReason) {
            return res.status(400).json({ message: 'A reason is required when rejecting a task' });
        }

        // Guard on IS NULL so a decision is final: a double submit affects 0 rows instead of
        // silently overwriting an existing decision (and re-branching an advanced workflow).
        // Scoping to tas_emp_id keeps a task decidable only by its assigned approver.
        const query = `UPDATE task
            SET tas_form_approval_status = ${approved ? 1 : 0},
                tas_is_active = 1,
                ${rejectionReason ? `tas_notes = '${rejectionReason}',` : ''}
                tas_updated_at = '${moment().utc().format('YYYY-MM-DDTHH:mm:ss')}',
                tas_updated_by = ${empID}
            WHERE tas_id = ${taskID}
                AND tas_emp_id = ${empID}
                AND tas_form_approval_status IS NULL`;

        const rowsAffected = await DBUpdate(query);

        if (!rowsAffected) {
            return res.status(409).json({ message: 'Approval task not found, not assigned to you, or already decided' });
        }

        // Tell the submitter their work was rejected and why. The decision is already committed, so
        // any failure here is logged and swallowed — a broken in-app message must not surface as a
        // failed rejection and tempt the approver into re-submitting (which would 409).
        if (!approved) {
            try {
                // The previous task is found through the edge that fed the approval node:
                // edge_targetTaskID is the approval task, edge_sourceTaskID is what preceded it.
                const getPrevTask = `
                    SELECT TOP 1
                        prevTask.tas_emp_id AS prev_emp_id,
                        prevTask.tas_title AS prev_tas_title,
                        c.cus_name,
                        LTRIM(RTRIM(CONCAT(approver.emp_first_name, ' ', approver.emp_last_name))) AS approver_name
                    FROM task t
                    JOIN workflowNode wn ON wn.node_taskID = t.tas_id AND wn.node_type = 'approvalNode'
                    LEFT JOIN workflowEdge we ON we.edge_targetTaskID = t.tas_id AND we.edge_wf_instanceID = wn.node_wf_instanceID
                    LEFT JOIN task prevTask ON prevTask.tas_id = we.edge_sourceTaskID
                    LEFT JOIN customer c ON c.cus_id = t.tas_cus_id
                    LEFT JOIN employee approver ON approver.emp_id = t.tas_emp_id
                    WHERE t.tas_id = ${taskID}
                `;
                const prevTask = await DBSendResponse(getPrevTask);
                const submitterID = prevTask.length > 0 ? prevTask[0].prev_emp_id : null;

                if (submitterID) {
                    // reasonText, not rejectionReason — the latter has quotes doubled for SQL.
                    await broadcastClient.triggerBroadcast(IN_APP_MESSAGE_APPROVAL_REJECTED_ID, {
                        task_name: String(prevTask[0].prev_tas_title || ''),
                        approver_name: String(prevTask[0].approver_name || ''),
                        cus_name: String(prevTask[0].cus_name || ''),
                        reason: reasonText,
                    }, {
                        ids: [String(submitterID)]
                    });
                } else {
                    console.log(`updateApprovalDecision: no preceding task found for tas_id=${taskID}, skipping rejection broadcast`);
                }
            } catch (broadcastErr) {
                console.log('BROADCAST FAILURE | updateApprovalDecision rejection broadcast failed:');
                console.log(broadcastErr);
            }
        }

        return res.status(200).json({ message: `Task ${approved ? 'approved' : 'rejected'} successfully` });
    } catch (err) {
        console.log('QUERY FAILURE | updateApprovalDecision Query Failed:');
        console.log(err);
        return res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.workflowOrchestrator = async () => {
    const cronExpressionTest = '* * * * *'; // every minute for testing purposes
    const cronExpression = '0 * * * *';   // every hour in production

    schedule.scheduleJob(cronExpression, async function (fireDate) {
        // Stagger the two instances so they don't hit the claim insert in the same instant.
        await sleep(Math.floor(Math.random() * ORCHESTRATOR_MAX_JITTER_MS));

        // The bucket comes from the scheduled fire time rather than "now", so jitter that
        // spills past the hour boundary still maps both instances onto the same run.
        const runBucket = moment.utc(fireDate || new Date()).startOf('hour').format('YYYY-MM-DDTHH:mm:ss');

        const logID = await claimOrchestratorRun(runBucket);

        if (!logID) {
            console.log(`| WORKFLOW ORCHESTRATOR | Run ${runBucket} (UTC) already claimed by another instance. Exiting.`);
            return;
        }

        console.log(`| WORKFLOW ORCHESTRATOR | Running workflow orchestrator job at ${new Date()} | run ${runBucket} UTC | log ID ${logID}`);

        let noOfRecordsPicked = 0, noOfFailureRecords = 0;

        try {
            // Fetch all workflow instances that have either "Not Started" (0) or are "In Progress" (1) and start date is before or on the current date
            const getWorkflowInstances = `
                SELECT *,
                    (SELECT * FROM workflowNode wn WHERE wn.node_wf_instanceID = wfi.wf_instanceID FOR JSON PATH) AS nodeData,
                    (SELECT * FROM workflowEdge we WHERE we.edge_wf_instanceID = wfi.wf_instanceID FOR JSON PATH) AS edgeData
                FROM workflowInstance wfi
                    JOIN workflow wf ON wf.wf_id = wfi.wf_instanceWF_ID
                    JOIN employee e ON e.emp_id = wfi.wf_instanceEmployee
                WHERE wfi.wf_instanceStatus IN (${INSTANCE_STATUS.NOT_STARTED}, ${INSTANCE_STATUS.IN_PROGRESS}) AND wfi.wf_instanceStartDate <= CURRENT_DATE
            `;
            const workflowInstances = await DBSendResponse(getWorkflowInstances);

            if (workflowInstances.length === 0) {
                console.log('| WORKFLOW ORCHESTRATOR | No workflow instances to process');
                await completeOrchestratorRun(logID, noOfRecordsPicked, noOfFailureRecords, 'Completed', null);
                return;
            }

            console.log(`| WORKFLOW ORCHESTRATOR | Found ${workflowInstances.length} workflow instances to process`);

            for (const instance of workflowInstances) {
                noOfRecordsPicked += 1;

                console.log(`| WORKFLOW ORCHESTRATOR | Processing workflow instance ID: ${instance.wf_instanceID}`);

                try {
                    // Get company logo, customer, project, and task billable by default setting data
                    const getCustomerData = `
                        SELECT TOP 1 com.com_name, cl.logo, cl.type, c.*, p.*, s.feature_value AS taskBillableSetting, s1.feature_value AS taskCreationSetting,
                            (SELECT TOP 1 ploc_loc_id FROM projectLocation pl WHERE pl.ploc_pro_id = p.pro_id) AS projectLocation
                        FROM customer c
                            JOIN company com ON com.com_id = c.cus_company_id
                            LEFT JOIN  company_logo cl ON cl.com_id = c.cus_company_id
                            LEFT JOIN settings s ON s.company_id = c.cus_company_id AND s.feature_id = 56
                            LEFT JOIN settings s1 ON s1.company_id = c.cus_company_id AND s1.feature_id = 73
                            LEFT JOIN project p ON p.pro_customer_id = c.cus_id AND p.pro_is_active = 1
                        WHERE c.cus_id = ${instance.wf_instanceCustomer}
                    `;
                    const customerData = await DBSendResponse(getCustomerData);

                    if (customerData.length === 0) {
                        console.log(`| WORKFLOW ORCHESTRATOR | No customer data found for instance ID: ${instance.wf_instanceID}`);
                        console.log(`| WORKFLOW ORCHESTRATOR | Completed processing workflow instance ID: ${instance.wf_instanceID}`);
                        continue;
                    }

                    const companyName = customerData[0].com_name || '';
                    const companyLogo = customerData[0].logo ? `data:${customerData[0].type};base64,${Buffer.from(customerData[0].logo).toString('base64')}` : null;
                    const employeeName = `${instance.emp_first_name} ${instance.emp_last_name}` || '';
                    const customerName = customerData[0].cus_name || '';
                    const customerEmail = customerData[0].cus_email || '';
                    const customerPhone = customerData[0].cus_phone ? customerData[0].cus_phone.split(",")[0].replace(/\D/g, "").slice(-10) : '';
                    const projectID = customerData[0].pro_id || null;
                    const projectLocation = customerData[0].projectLocation || null;
                    const taskBillableByDefault = customerData[0].taskBillableSetting ? customerData[0].taskBillableSetting === 'true' ? 1 : 0 : 0;
                    const taskCreationDays = customerData[0].taskCreationSetting ? customerData[0].taskCreationSetting : 0;

                    const nodeSchema = JSON.parse(instance.wf_nodes);
                    const edgeSchema = JSON.parse(instance.wf_edges);
                    const nodeData = JSON.parse(instance.nodeData || '[]');
                    const edgeData = JSON.parse(instance.edgeData || '[]');

                    // Update workflow instance status to 'In Progress' (1) if it is currently 'Not Started' (0)
                    if (instance.wf_instanceStatus === 0) {
                        await updateWorkflowInstanceStatus(instance.wf_instanceID, 1);
                    }

                    async function blockInstance(edgeID, reason) {
                        console.log(`| WORKFLOW ORCHESTRATOR | [Instance ID: ${instance.wf_instanceID}] - BLOCKED on edge ID ${edgeID}: ${reason}`);
                        await failWorkflowEdge(edgeID, reason);
                        await updateWorkflowInstanceStatus(instance.wf_instanceID, INSTANCE_STATUS.BLOCKED);
                    };

                    async function addNodeAndUpdateEdge(edgeID, targetNode) {
                        if (!targetNode) {
                            await blockInstance(edgeID, 'Workflow design error: the edge points at a node that no longer exists in the workflow.');
                            return;
                        }
                        else {
                            // Activate target node if not outputNode (-1)(End)
                            if (targetNode.type !== 'outputNode') {
                                if (targetNode.type === 'decisionNode') {
                                    // Insert node record with status as active (1)
                                    await addWorkflowNode(instance.wf_instanceID, targetNode.id, 'null', targetNode.type, NODE_STATUS.ACTIVE);

                                    // Update edge with node task ID and status as active (1)
                                    await updateWorkflowEdge(edgeID, EDGE_STATUS.COMPLETED, 'null');
                                } else {
                                    // An approval task belongs to the approver picked on the node, not to the
                                    // workflow's employee. Fall back to the instance employee for approval nodes
                                    // built before the approver dropdown existed.
                                    const taskEmployeeID = (targetNode.type === 'approvalNode' && targetNode.data?.approverEmpId)
                                        ? targetNode.data.approverEmpId
                                        : instance.wf_instanceEmployee;

                                    // Insert node task
                                    const nodeTaskID = await addWorkflowTask(instance.wf_title, instance.wf_companyID, taskEmployeeID, instance.wf_instanceCustomer, customerName, targetNode.data, projectID, taskBillableByDefault, projectLocation, taskCreationDays, instance.wf_instanceStartDate);

                                    if (nodeTaskID) {
                                        // Insert node record with status as active (1)
                                        await addWorkflowNode(instance.wf_instanceID, targetNode.id, nodeTaskID, targetNode.type, NODE_STATUS.ACTIVE);

                                        // Update edge with node task ID and status as active (1)
                                        await updateWorkflowEdge(edgeID, EDGE_STATUS.COMPLETED, nodeTaskID);
                                    } else {
                                        await blockInstance(edgeID, `Could not create the "${targetNode.data?.label || targetNode.type}" task for this step.`);
                                    }
                                }
                            }
                            else {
                                // If target node is outputNode (-1)(End), update edge status to completed (0) and instance status to 'Completed' (2)
                                await updateWorkflowEdge(edgeID, EDGE_STATUS.COMPLETED, 'null');
                                await updateWorkflowInstanceStatus(instance.wf_instanceID, INSTANCE_STATUS.COMPLETED);
                            }
                        }
                    };

                    async function sendText(textMessage) {
                        try {
                            if (env === 'test') {
                                return { ok: true };
                            }

                            if (!customerEmail) {
                                console.log(`| WORKFLOW ORCHESTRATOR | No customer email — skipping Ability Hub push`);
                                return { ok: true };
                            }

                            const ah_user = await DBSendResponse(`SELECT * FROM ah_User WHERE UserAuth0Email = '${customerEmail}'`);

                            if (ah_user.length === 0) {
                                console.log(`| WORKFLOW ORCHESTRATOR | Customer not found on Ability Hub!`);
                            } else {
                                const pushClient = new APIClient(AH_CUSTOMERIO_PUSH_KEY);
                                const request = new SendPushRequest({
                                    transactional_message_id: "workflow_ah_push",
                                    message_data: {
                                        title: 'Ability Hub',
                                        body: `${textMessage}`
                                    },
                                    identifiers: {
                                        id: ah_user[0].UserID,
                                    },
                                });
                                try {
                                    const res = await pushClient.sendPush(request);
                                    console.log(res);
                                } catch (err) {
                                    console.log(err.statusCode, err.message);
                                    return { ok: false, reason: `Push notification to Ability Hub failed: ${err.message || 'unknown error'}.` };
                                }
                            }
                            // const message = await client.messages.create({
                            //     body: textMessage,
                            //     from: "",
                            //     to: customerPhone,
                            // });

                            // console.log(message.body);
                            return { ok: true };
                        } catch (err) {
                            console.log(err);
                            return { ok: false, reason: `Sending the text message failed: ${err.message || 'unknown error'}.` };
                        }
                    }

                    async function sendEmail(emailMessage) {
                        if (!customerEmail) {
                            return { ok: false, reason: `Cannot send the email: ${customerName || 'this client'} has no email address on file.` };
                        }

                        const request = new SendEmailRequest({
                            transactional_message_id: "workflow_email",
                            message_data: { emailMessage: emailMessage },
                            identifiers: {
                                id: instance.wf_instanceEmployee
                            },
                            to: customerEmail,
                            subject: `Workflow email test`,
                        });

                        try {
                            const res = await client.sendEmail(request);
                            console.log(res);
                            return { ok: true };
                        } catch (err) {
                            console.log(err.statusCode, err.message);
                            return { ok: false, reason: `Sending the email to ${customerEmail} failed: ${err.message || 'unknown error'}.` };
                        }
                    };

                    async function sendIntakeEmail(token, taskID, formIDs) {
                        const siteMap = {
                            prod: 'https://app.fieldworker.ai/form/',
                            test: 'https://test.fieldworker.ai/form/',
                            dev: 'https://dev.fieldworker.ai/form/',
                        }

                        const request = new SendEmailRequest({
                            transactional_message_id: "intake_form",
                            message_data: {
                                email: customerEmail,
                                token: token[0].token,
                                task_id: taskID,
                                form_ids: formIDs,
                                customer_id: instance.wf_instanceCustomer,
                                created_by: instance.wf_instanceEmployee,
                                employee_name: employeeName,
                                company_name: companyName,
                                company_logo: companyLogo,
                                site: siteMap[env] || 'http://localhost:3000/form/'
                            },
                            identifiers: {
                                id: instance.wf_instanceEmployee
                            },
                            to: customerEmail
                        });

                        try {
                            const res = await client.sendEmail(request);
                            console.log(res);
                            return { ok: true };
                        } catch (err) {
                            console.log(err.statusCode, err.message);
                            return { ok: false, reason: `Sending the intake form email to ${customerEmail} failed: ${err.message || 'unknown error'}.` };
                        }
                    };

                    async function sendIntakeForm(edgeID, existingTaskID) {
                        try {
                            if (!customerEmail) {
                                return { ok: false, reason: `Cannot send the intake form: ${customerName || 'this client'} has no email address on file. Add one to the client record, then unblock.` };
                            }

                            // Get associated forms for the Intake task type
                            const getIntakeAssociatedForms = `
                                SELECT tf.form_id
                                    FROM dropdowns d
                                    JOIN task_form tf ON tf.taskType_id = d.ddID
                                WHERE d.EntityName = 'taskType' AND d.EntityValue = 'Intake' AND d.CompanyID = ${instance.wf_companyID} AND d.is_Active in (0, 3)
                            `;
                            const intakeAssociatedForms = await DBSendResponse(getIntakeAssociatedForms);

                            if (intakeAssociatedForms.length === 0) {
                                console.log(`| WORKFLOW ORCHESTRATOR | [Instance ID: ${instance.wf_instanceID}] - No forms associated with Intake task type for company ID: ${instance.wf_companyID}`);
                                return { ok: false, reason: 'Cannot send the intake form: no forms are associated with the "Intake" task type. Associate at least one form under Settings, then unblock.' };
                            }

                            const intakeFormIDs = intakeAssociatedForms.map(form => form.form_id);

                            let intakeTaskID = existingTaskID || null;
                            let token = null;

                            if (intakeTaskID) {
                                console.log(`| WORKFLOW ORCHESTRATOR | [Instance ID: ${instance.wf_instanceID}] - Reusing existing intake task ID: ${intakeTaskID}`);

                                const getExistingToken = `
                                    SELECT TOP 1 * FROM tokens
                                    WHERE entity_type = 'form' AND used = 0 AND expires_at > GETDATE()
                                        AND JSON_VALUE(entity_data, '$.task_id') = ${parseInt(intakeTaskID)}
                                    ORDER BY token_id DESC
                                `;
                                const existingTokens = await DBSendResponse(getExistingToken);

                                if (existingTokens.length > 0) {
                                    token = existingTokens;
                                }
                            } else {
                                let intakeProjectID = projectID;
                                if (!intakeProjectID) {
                                    // Create a new project for the intake form
                                    intakeProjectID = await addIntakeProject(instance.wf_companyID, instance.wf_instanceCustomer, customerName, instance.wf_instanceEndDate);

                                    if (!intakeProjectID) {
                                        console.log(`| WORKFLOW ORCHESTRATOR | [Instance ID: ${instance.wf_instanceID}] - Failed to create intake form project`);
                                        return { ok: false, reason: 'Cannot send the intake form: creating the intake project failed.' };
                                    }
                                }

                                // Create a new task for the intake form
                                intakeTaskID = await addIntakeTask(instance.wf_companyID, instance.wf_instanceEmployee, instance.wf_instanceCustomer, customerName, intakeProjectID, instance.wf_instanceEndDate);

                                if (!intakeTaskID) {
                                    console.log(`| WORKFLOW ORCHESTRATOR | [Instance ID: ${instance.wf_instanceID}] - Failed to create intake form task`);
                                    return { ok: false, reason: 'Cannot send the intake form: creating the intake task failed.' };
                                }

                                await setWorkflowEdgeTaskID(edgeID, intakeTaskID);
                            }

                            if (!token) {
                                // Insert token for the intake form
                                token = await addToken(instance.wf_companyID, companyName, instance.wf_instanceEmployee, instance.wf_instanceCustomer, customerName, instance.wf_instanceEndDate, intakeTaskID, intakeFormIDs);

                                if (!token || token.length === 0) {
                                    console.log(`| WORKFLOW ORCHESTRATOR | [Instance ID: ${instance.wf_instanceID}] - Failed to create intake form token`);
                                    return { ok: false, reason: 'Cannot send the intake form: creating the secure form link failed.' };
                                }
                            }

                            return await sendIntakeEmail(token, intakeTaskID, intakeFormIDs);
                        } catch (err) {
                            console.log(err.statusCode, err.message);
                            return { ok: false, reason: `Sending the intake form failed: ${err.message || 'unknown error'}.` };
                        }
                    };

                    async function processEdgeAction({ edgeID, schemaEdge, targetNode, activatedAt = null, existingTaskID = null }) {
                        const action = schemaEdge.data?.action;

                        if (!action) {
                            await addNodeAndUpdateEdge(edgeID, targetNode);
                            return;
                        }

                        const actionType = action.split(':')[0];
                        const actionValue = action.split(':')[1];

                        if (actionType === 'Elapse Time (Days)') {
                            // A freshly created edge has not waited at all yet.
                            if (!activatedAt) {
                                return;
                            }

                            const days = parseInt(actionValue);

                            if (isNaN(days)) {
                                await blockInstance(edgeID, `Workflow design error: "${action}" is not a valid number of days.`);
                                return;
                            }

                            // Only advance once the configured number of days has elapsed
                            if (moment().diff(moment(activatedAt), 'days') >= days) {
                                await addNodeAndUpdateEdge(edgeID, targetNode);
                            }
                            return;
                        }

                        let result;

                        if (actionType === 'Send A Text Message') {
                            result = await sendText(actionValue);
                        }
                        else if (actionType === 'Send An Email') {
                            result = await sendEmail(actionValue);
                        }
                        else if (action === 'Send a form') {
                            result = await sendIntakeForm(edgeID, existingTaskID);
                        }
                        else {
                            // 'Manual Completion' and anything else with no side effect
                            console.log(`| WORKFLOW ORCHESTRATOR | [Instance ID: ${instance.wf_instanceID}] - No actions needed for edge action: ${action}`);
                            result = { ok: true };
                        }

                        if (result.ok) {
                            await addNodeAndUpdateEdge(edgeID, targetNode);
                        } else {
                            await blockInstance(edgeID, result.reason);
                        }
                    };

                    // If no nodes and no edges exist yet — Start from inputNode (0)(Start)
                    if (edgeData.length === 0 && nodeData.length === 0) {
                        // Find outgoing edges from inputNode (0)(Start)
                        const startEdges = edgeSchema.filter(e => e.source === '0');

                        for (const edge of startEdges) {
                            // Insert edge record
                            const edgeID = await addWorkflowEdge(instance.wf_instanceID, edge.source, edge.target, 'null', 'null', 'null', edge.type, EDGE_STATUS.ACTIVE);

                            if (!edgeID) {
                                console.log(`| WORKFLOW ORCHESTRATOR | [Instance ID: ${instance.wf_instanceID}] - Failed to create the starting edge record`);
                                await updateWorkflowInstanceStatus(instance.wf_instanceID, INSTANCE_STATUS.BLOCKED);
                                continue;
                            }

                            // Find target node for the edge
                            const targetNode = nodeSchema.find(n => n.id === edge.target);

                            await processEdgeAction({ edgeID, schemaEdge: edge, targetNode });
                        }
                        console.log(`| WORKFLOW ORCHESTRATOR | Completed processing workflow instance ID: ${instance.wf_instanceID}`);
                        continue;
                    }

                    // Get active edges (Status: 1)
                    const activeEdges = edgeData.filter(n => n.edge_status === EDGE_STATUS.ACTIVE);

                    if (activeEdges.length > 0) {
                        for (const edge of activeEdges) {
                            // Find the edge in the schema
                            const existingEdge = edgeSchema.find(es =>
                                es.source === edge.edge_wf_sourceID &&
                                es.target === edge.edge_wf_targetID
                            );

                            if (!existingEdge) {
                                await blockInstance(edge.edge_id, 'Workflow design error: this step no longer exists in the workflow definition.');
                                continue;
                            }

                            // Find the target node for the edge
                            const targetNode = nodeSchema.find(n => n.id === existingEdge.target);

                            await processEdgeAction({
                                edgeID: edge.edge_id,
                                schemaEdge: existingEdge,
                                targetNode,
                                activatedAt: edge.edge_activatedAt,
                                existingTaskID: edge.edge_targetTaskID,
                            });
                        }
                        console.log(`| WORKFLOW ORCHESTRATOR | Completed processing workflow instance ID: ${instance.wf_instanceID}`);
                        continue;
                    }

                    // Get active nodes (Status: 1)
                    const activeNodes = nodeData.filter(n => n.node_status === NODE_STATUS.ACTIVE);

                    if (activeNodes.length > 0) {
                        for (const node of activeNodes) {
                            if (node.node_type === 'decisionNode') {
                                const decisionNode = nodeSchema.find(n => n.id === node.node_wf_nodeID);

                                const attribute = customerData[0][`${decisionNode?.data?.attributeName}`];
                                const operator = decisionNode?.data?.operator;
                                const conditionValue = decisionNode?.data?.conditionValue;

                                let expressionResult = false;

                                // Try to parse as date if both look like dates.
                                // DB date columns arrive as JS Date objects at UTC midnight — parse as UTC
                                // so the calendar date doesn't shift back a day in local time.
                                const isDate = (val) => val instanceof Date || moment(val, ['MM/DD/YYYY', 'YYYY-MM-DD'], true).isValid();
                                const parseDate = (val) => val instanceof Date ? moment.utc(val) : moment.utc(val, ['MM/DD/YYYY', 'YYYY-MM-DD'], true);

                                let attrVal = attribute;
                                let condVal = conditionValue;

                                if (isDate(attrVal) && isDate(condVal)) {
                                    attrVal = parseDate(attrVal);
                                    condVal = parseDate(condVal);
                                }

                                switch (operator) {
                                    case 'is':
                                        if (moment.isMoment(attrVal) && moment.isMoment(condVal)) {
                                            expressionResult = attrVal.isSame(condVal, 'day');
                                        } else {
                                            expressionResult = attrVal === condVal;
                                        }
                                        break;
                                    case 'is not':
                                        if (moment.isMoment(attrVal) && moment.isMoment(condVal)) {
                                            expressionResult = !attrVal.isSame(condVal, 'day');
                                        } else {
                                            expressionResult = attrVal !== condVal;
                                        }
                                        break;
                                    case 'greater than':
                                        if (moment.isMoment(attrVal) && moment.isMoment(condVal)) {
                                            expressionResult = attrVal.isAfter(condVal);
                                        } else {
                                            expressionResult = attrVal >= condVal;
                                        }
                                        break;
                                    case 'less than':
                                        if (moment.isMoment(attrVal) && moment.isMoment(condVal)) {
                                            expressionResult = attrVal.isBefore(condVal);
                                        } else {
                                            expressionResult = attrVal <= condVal;
                                        }
                                        break;
                                    default:
                                        expressionResult = false;
                                }

                                if (expressionResult) {
                                    // Update node status to completed (0)
                                    await updateWorkflowNode(node.node_id, NODE_STATUS.COMPLETED);

                                    // Find outgoing edges from the node
                                    const outgoingEdges = edgeSchema.filter(e => e.source === node.node_wf_nodeID && e.sourceHandle === 'two');

                                    for (const edge of outgoingEdges) {
                                        // Insert edge record
                                        await addWorkflowEdge(instance.wf_instanceID, edge.source, edge.target, 'null', 'null', 'null', edge.type, EDGE_STATUS.ACTIVE);
                                    }
                                } else {
                                    // Update node status to completed (0)
                                    await updateWorkflowNode(node.node_id, NODE_STATUS.COMPLETED);

                                    // Find outgoing edges from the node
                                    const outgoingEdges = edgeSchema.filter(e => e.source === node.node_wf_nodeID && e.sourceHandle === 'one');

                                    for (const edge of outgoingEdges) {
                                        // Insert edge record
                                        await addWorkflowEdge(instance.wf_instanceID, edge.source, edge.target, 'null', 'null', 'null', edge.type, EDGE_STATUS.ACTIVE);
                                    }
                                }
                            } else if (node.node_type === 'approvalNode') {
                                // Get the approval decision from the approval task.
                                // tas_form_approval_status: NULL = pending, 1 = Approved, 0 = Rejected
                                const getApprovalTask = `SELECT tas_form_approval_status FROM task WHERE tas_id = ${node.node_taskID}`;
                                const approvalTask = await DBSendResponse(getApprovalTask);

                                if (approvalTask.length > 0) {
                                    const decision = approvalTask[0].tas_form_approval_status;

                                    // Only advance once the approver has decided (status is not NULL).
                                    if (decision !== null && decision !== undefined) {
                                        // Update node status to completed (0)
                                        await updateWorkflowNode(node.node_id, NODE_STATUS.COMPLETED);

                                        // Approved (1) -> 'Approve' path (sourceHandle 'two'),
                                        // Rejected (0) -> 'Reject' path (sourceHandle 'one'). Mirrors decisionNode handles.
                                        const approved = decision === true || decision === 1;
                                        const branchHandle = approved ? 'two' : 'one';

                                        // Find outgoing edges from the node for the chosen branch
                                        const outgoingEdges = edgeSchema.filter(e => e.source === node.node_wf_nodeID && e.sourceHandle === branchHandle);

                                        for (const edge of outgoingEdges) {
                                            // Insert edge record
                                            await addWorkflowEdge(instance.wf_instanceID, edge.source, edge.target, node.node_taskID, 'null', 'null', edge.type, EDGE_STATUS.ACTIVE);
                                        }
                                    }
                                }
                            } else {
                                // Get tas_is_active status from task table for the node's taskID
                                const getNodeTask = `SELECT tas_is_active FROM task WHERE tas_id = ${node.node_taskID}`;
                                const nodeTask = await DBSendResponse(getNodeTask);

                                if (nodeTask.length > 0) {
                                    // Check if task is completed
                                    if (nodeTask[0].tas_is_active === 1) {
                                        // Update node status to completed (0)
                                        await updateWorkflowNode(node.node_id, NODE_STATUS.COMPLETED);

                                        // Find outgoing edges from the node
                                        const outgoingEdges = edgeSchema.filter(e => e.source === node.node_wf_nodeID);

                                        for (const edge of outgoingEdges) {
                                            // Insert edge record
                                            await addWorkflowEdge(instance.wf_instanceID, edge.source, edge.target, node.node_taskID, 'null', 'null', edge.type, EDGE_STATUS.ACTIVE);
                                        }
                                    }
                                }
                            }
                        }
                        console.log(`| WORKFLOW ORCHESTRATOR | Completed processing workflow instance ID: ${instance.wf_instanceID}`);
                        continue;
                    }
                } catch (err) {
                    noOfFailureRecords += 1;
                    console.error(`| WORKFLOW ORCHESTRATOR | Error processing workflow instance ID ${instance.wf_instanceID}:`, err);
                }
            }
        } catch (err) {
            console.error(`| WORKFLOW ORCHESTRATOR | Error fetching workflow instances:`, err);
            await completeOrchestratorRun(logID, noOfRecordsPicked, noOfFailureRecords, 'Failed', err.message);
            return;
        };

        await completeOrchestratorRun(logID, noOfRecordsPicked, noOfFailureRecords, 'Completed', null);
    });
};

/**
 * Claims the hourly run for this instance. The unique index on runBucket is the single point
 * of coordination between the prod instances: exactly one INSERT survives, and the loser gets
 * back null. Returns the new log row ID, or null if another instance already owns this run.
 */
async function claimOrchestratorRun(runBucket) {
    try {
        const claimRun = `
            INSERT INTO workflow_orchestrator_log (runBucket, invocationTimestamp, runHost, runStatus)
            SELECT '${runBucket}', GETUTCDATE(), '${generateSQLText(RUN_HOST, 128, 'unknown')}', 'Running'
            WHERE NOT EXISTS (SELECT 1 FROM workflow_orchestrator_log WHERE runBucket = '${runBucket}');
            SELECT CAST(SCOPE_IDENTITY() AS INT) AS logID;
        `;
        const claim = await DBSendResponse(claimRun);

        // A null logID means the NOT EXISTS check blocked the insert; an empty result means the
        // insert itself was rejected by the unique index (both instances raced past NOT EXISTS).
        return claim.length > 0 && claim[0].logID ? claim[0].logID : null;
    } catch (err) {
        console.log('QUERY FAILURE | claimOrchestratorRun Query Failed:');
        console.log(err);
        return null;
    }
};

async function completeOrchestratorRun(logID, noOfRecordsPicked, noOfFailureRecords, runStatus, errorMessage) {
    try {
        const picked = isNaN(parseInt(noOfRecordsPicked)) ? 0 : parseInt(noOfRecordsPicked);
        const failed = isNaN(parseInt(noOfFailureRecords)) ? 0 : parseInt(noOfFailureRecords);
        const error = generateSQLText(String(errorMessage || '').replace(/'/g, ''), 1000, null);

        const updateRun = `
            UPDATE workflow_orchestrator_log
            SET completionTimestamp = GETUTCDATE(),
                noOfRecordsPicked = ${picked},
                noOfSuccessRecords = ${picked - failed},
                noOfFailureRecords = ${failed},
                runStatus = '${runStatus}',
                errorMessage = ${error ? `'${error}'` : 'NULL'}
            WHERE workflow_orchestrator_log_id = ${parseInt(logID)}
        `;
        await DBUpdate(updateRun);

        console.log(`| WORKFLOW ORCHESTRATOR | Run finished (${runStatus}) | picked ${picked} | succeeded ${picked - failed} | failed ${failed}`);
    } catch (err) {
        console.log('QUERY FAILURE | completeOrchestratorRun Query Failed:');
        console.log(err);
    }
};

function sleep(ms) {
    console.log(`| WORKFLOW ORCHESTRATOR | Sleeping for ${ms / 1000} seconds`);
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
};

async function updateWorkflowInstanceStatus(wf_instanceID, wf_instanceStatus) {
    try {
        const data = {
            wf_instanceStatus: isNaN(parseInt(wf_instanceStatus)) ? null : parseInt(wf_instanceStatus),
        };

        const query = generateUpdateSQL('workflowInstance', data, `wf_instanceID = ${parseInt(wf_instanceID)}`);
        await DBSendResponse(query);
    } catch (err) {
        console.log('QUERY FAILURE | updateWorkflowInstanceStatus Query Failed:');
        console.log(err);
    }
};

async function addWorkflowNode(node_wf_instanceID, node_wf_nodeID, node_taskID, node_type, node_status) {
    try {
        const data = {
            node_wf_instanceID: isNaN(parseInt(node_wf_instanceID)) ? null : parseInt(node_wf_instanceID),
            node_wf_nodeID: generateSQLText(node_wf_nodeID, 256, null),
            node_taskID: isNaN(parseInt(node_taskID)) ? null : parseInt(node_taskID),
            node_type: generateSQLText(node_type, 512, null),
            node_status: isNaN(parseInt(node_status)) ? null : parseInt(node_status),
            node_activatedAt: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
            node_completedAt: node_status === 0 ? `${moment().format('YYYY-MM-DDTHH:mm:ss')}` : null,
        };

        const query = generateInsertSQL('workflowNode', data) + 'SELECT SCOPE_IDENTITY()';
        const newWorkflowNodeId = await DBinsertSendID(query);

        return newWorkflowNodeId;
    } catch (err) {
        console.log('QUERY FAILURE | addWorkflowNode Query Failed:');
        console.log(err);
        return null;
    }
};

async function updateWorkflowNode(node_id, node_status) {
    try {
        const data = {
            node_status: isNaN(parseInt(node_status)) ? null : parseInt(node_status),
            node_completedAt: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateUpdateSQL('workflowNode', data, `node_id = ${parseInt(node_id)}`);
        await DBSendResponse(query);
    } catch (err) {
        console.log('QUERY FAILURE | updateWorkflowNode Query Failed:');
        console.log(err);
    }
};

async function addWorkflowEdge(edge_wf_instanceID, edge_wf_sourceID, edge_wf_targetID, edge_sourceTaskID, edge_targetTaskID, edge_formID, edge_type, edge_status) {
    try {
        const data = {
            edge_wf_instanceID: isNaN(parseInt(edge_wf_instanceID)) ? null : parseInt(edge_wf_instanceID),
            edge_wf_sourceID: generateSQLText(edge_wf_sourceID, 256, null),
            edge_wf_targetID: generateSQLText(edge_wf_targetID, 256, null),
            edge_sourceTaskID: isNaN(parseInt(edge_sourceTaskID)) ? null : parseInt(edge_sourceTaskID),
            edge_targetTaskID: isNaN(parseInt(edge_targetTaskID)) ? null : parseInt(edge_targetTaskID),
            edge_formID: isNaN(parseInt(edge_formID)) ? null : parseInt(edge_formID),
            edge_type: generateSQLText(edge_type, 512, null),
            edge_status: isNaN(parseInt(edge_status)) ? null : parseInt(edge_status),
            edge_activatedAt: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
            edge_completedAt: edge_status === 0 ? `${moment().format('YYYY-MM-DDTHH:mm:ss')}` : null,
        };

        const query = generateInsertSQL('workflowEdge', data) + 'SELECT SCOPE_IDENTITY()';
        const newWorkflowEdgeId = await DBinsertSendID(query);

        return newWorkflowEdgeId;
    } catch (err) {
        console.log('QUERY FAILURE | addWorkflowEdge Query Failed:');
        console.log(err);
        return null;
    }
};

async function updateWorkflowEdge(edge_id, edge_status, edge_targetTaskID) {
    try {
        const data = {
            edge_status: isNaN(parseInt(edge_status)) ? null : parseInt(edge_status),
            edge_targetTaskID: isNaN(parseInt(edge_targetTaskID)) ? null : parseInt(edge_targetTaskID),
            edge_completedAt: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateUpdateSQL('workflowEdge', data, `edge_id = ${parseInt(edge_id)}`);
        await DBSendResponse(query);
    } catch (err) {
        console.log('QUERY FAILURE | updateWorkflowEdge Query Failed:');
        console.log(err);
    }
};

async function failWorkflowEdge(edge_id, reason) {
    try {
        const data = {
            edge_status: EDGE_STATUS.BLOCKED,
            edge_failureReason: generateSQLText(String(reason || '').slice(0, 250), 512, null),
        };

        const query = generateUpdateSQL('workflowEdge', data, `edge_id = ${parseInt(edge_id)}`);
        await DBSendResponse(query);
    } catch (err) {
        console.log('QUERY FAILURE | failWorkflowEdge Query Failed:');
        console.log(err);
    }
};

async function setWorkflowEdgeTaskID(edge_id, edge_targetTaskID) {
    try {
        const data = {
            edge_targetTaskID: isNaN(parseInt(edge_targetTaskID)) ? null : parseInt(edge_targetTaskID),
        };

        const query = generateUpdateSQL('workflowEdge', data, `edge_id = ${parseInt(edge_id)}`);
        await DBSendResponse(query);
    } catch (err) {
        console.log('QUERY FAILURE | setWorkflowEdgeTaskID Query Failed:');
        console.log(err);
    }
};

async function addWorkflowTask(wf_title, wf_com_id, wf_emp_id, wf_cus_id, wf_cus_name, nodeDetails, wf_pro_id, wf_task_billable_by_default, projectLocation, taskCreationDays, wf_instanceStartDate) {
    try {
        let startDate, endDate;

        // Check if completeInDays is a valid integer
        if (!isNaN(parseInt(nodeDetails.completeInDays))) {
            // wf_instanceStartDate is a DATE column returned as a JS Date at UTC midnight —
            // parse as UTC so the calendar date doesn't shift back a day in local time
            startDate = moment.utc(wf_instanceStartDate);
            endDate = moment.utc(wf_instanceStartDate).add(parseInt(nodeDetails.completeInDays), 'days');
        }
        // Check if expectedStartDate and expectedEndDate are valid dates
        else if (
            nodeDetails.expectedStartDate &&
            nodeDetails.expectedEndDate &&
            moment(nodeDetails.expectedStartDate, 'MM-DD-YYYY', true).isValid() &&
            moment(nodeDetails.expectedEndDate, 'MM-DD-YYYY', true).isValid()
        ) {
            // taskCreationDays should be an integer
            const creationDays = isNaN(parseInt(taskCreationDays)) ? 0 : parseInt(taskCreationDays);
            startDate = moment(nodeDetails.expectedStartDate, 'MM-DD-YYYY').subtract(creationDays, 'days');
            endDate = moment(nodeDetails.expectedEndDate, 'MM-DD-YYYY');
        }
        // Default to current date
        else {
            startDate = moment();
            endDate = moment();
        }

        const data = {
            tas_title: `${wf_title}_${wf_cus_name}_${moment().utc().format('MM/DD/YYYY')}`,
            tas_description: `Workflow Orchestrator Task`,
            tas_type: generateSQLText(nodeDetails.label, 50, null),
            tas_start_date: `${startDate.format('YYYY-MM-DD')}`,
            tas_end_date: `${endDate.format('YYYY-MM-DD')}`,
            tas_start_time: `${startDate.format('YYYY-MM-DDTHH:mm:ss')}`,
            tas_end_time: `${endDate.clone().add(1, 'hours').format('YYYY-MM-DDTHH:mm:ss')}`,
            tas_billable_by_default: isNaN(parseInt(wf_task_billable_by_default)) ? 0 : parseInt(wf_task_billable_by_default),
            tas_created_at: `${moment().utc().format('YYYY-MM-DDTHH:mm:ss')}`,
            tas_pro_id: isNaN(parseInt(wf_pro_id)) ? null : parseInt(wf_pro_id),
            tas_emp_id: isNaN(parseInt(wf_emp_id)) ? null : parseInt(wf_emp_id),
            tas_loc_id: isNaN(parseInt(projectLocation)) ? null : parseInt(projectLocation),
            tas_com_id: isNaN(parseInt(wf_com_id)) ? null : parseInt(wf_com_id),
            tas_is_active: 0,
            tas_created_by: isNaN(parseInt(wf_emp_id)) ? null : parseInt(wf_emp_id),
            tas_cus_id: isNaN(parseInt(wf_cus_id)) ? null : parseInt(wf_cus_id),
        };

        const query = generateInsertSQL('task', data) + 'SELECT SCOPE_IDENTITY()';
        const newWorkflowTaskId = await DBinsertSendID(query);

        return newWorkflowTaskId;
    } catch (err) {
        console.log('QUERY FAILURE | addWorkflowTask Query Failed:');
        console.log(err);
        return null;
    }
};

async function addIntakeProject(wf_com_id, wf_cus_id, wf_cus_name, wf_instanceEndDate) {
    try {
        const data = {
            pro_title: `Intake Form Project - ${wf_cus_name}`,
            pro_description: `Default Project for Prospects`,
            pro_starts_on: `${moment().format('YYYY-MM-DD')}`,
            pro_ends_on: `${moment.utc(wf_instanceEndDate).format('YYYY-MM-DD')}`,
            pro_is_active: 1,
            pro_created_at: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
            pro_customer_id: isNaN(parseInt(wf_cus_id)) ? null : parseInt(wf_cus_id),
            pro_com_id: isNaN(parseInt(wf_com_id)) ? null : parseInt(wf_com_id),
            pro_self_pay: 0,
        };

        const query = generateInsertSQL('project', data) + 'SELECT SCOPE_IDENTITY()';
        const newIntakeProjectId = await DBinsertSendID(query);

        return newIntakeProjectId;
    } catch (err) {
        console.log('QUERY FAILURE | addIntakeProject Query Failed:');
        console.log(err);
        return null;
    }
};

async function addIntakeTask(wf_com_id, wf_emp_id, wf_cus_id, wf_cus_name, intake_pro_id, wf_instanceEndDate) {
    try {
        const data = {
            tas_title: `Intake Form Task - ${wf_cus_name}`,
            tas_description: `Please fill and submit your details`,
            tas_type: `Intake`,
            tas_start_date: `${moment().format('YYYY-MM-DD')}`,
            tas_end_date: `${moment.utc(wf_instanceEndDate).format('YYYY-MM-DD')}`,
            tas_start_time: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
            tas_end_time: `${moment.utc(wf_instanceEndDate).format('YYYY-MM-DDTHH:mm:ss')}`,
            tas_billable_by_default: 0,
            tas_notes: `Workflow Orchestrator Intake Form Task`,
            tas_created_at: `${moment().utc().format('YYYY-MM-DDTHH:mm:ss')}`,
            tas_pro_id: isNaN(parseInt(intake_pro_id)) ? null : parseInt(intake_pro_id),
            tas_emp_id: isNaN(parseInt(wf_emp_id)) ? null : parseInt(wf_emp_id),
            tas_com_id: isNaN(parseInt(wf_com_id)) ? null : parseInt(wf_com_id),
            tas_is_active: 0,
            tas_created_by: isNaN(parseInt(wf_emp_id)) ? null : parseInt(wf_emp_id),
            tas_cus_id: isNaN(parseInt(wf_cus_id)) ? null : parseInt(wf_cus_id),
            tas_required_sig: 0,
        };

        const query = generateInsertSQL('task', data) + 'SELECT SCOPE_IDENTITY()';
        const newIntakeTaskId = await DBinsertSendID(query);

        return newIntakeTaskId;
    } catch (err) {
        console.log('QUERY FAILURE | addIntakeTask Query Failed:');
        console.log(err);
        return null;
    }
};

async function addToken(wf_com_id, companyName, wf_emp_id, wf_cus_id, wf_cus_name, wf_instanceEndDate, intakeTaskID, intakeFormIDs) {
    try {
        const entity_data = JSON.stringify({
            form_ids: intakeFormIDs,
            task_id: intakeTaskID,
            customer_id: wf_cus_id,
            signature_required: false,
            customer_name: wf_cus_name,
            company_id: wf_com_id,
            company_name: companyName
        });

        const query = `
            INSERT INTO tokens (token, expires_at, entity_data, entity_type, created_by, created_on) OUTPUT INSERTED.*
            VALUES (
                '${crypto.randomBytes(32).toString('hex')}',
                '${moment.utc(wf_instanceEndDate).format('YYYY-MM-DD HH:mm:ss')}',
                '${entity_data}',
                'form',
                ${wf_emp_id},
                '${moment().format('YYYY-MM-DD HH:mm:ss')}')
        `;
        const token = await DBinsertSendResponse(query)

        return token;
    } catch (err) {
        console.log('QUERY FAILURE | addToken Query Failed:');
        console.log(err);
        return null;
    }
};