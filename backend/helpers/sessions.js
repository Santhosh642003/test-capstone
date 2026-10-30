const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries')
const moment = require('moment')
var {SEGMENT_API_KEY, CUSTOMERIO_API_KEY, IN_APP_MESSAGE_SHIFT_BROADCAST_ID} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })
const { APIClient, RegionUS } = require("customerio-node");
const api = new APIClient(CUSTOMERIO_API_KEY, { region: RegionUS });

// Helper to notify available employees via Customer.io broadcast
// Available employees = active employees of the company not scheduled for overlapping sessions
exports.notifyAvailableEmployees = async (req, res) => {
    try {
        const { schedule_id } = req.body;
        
        if (!schedule_id) {
            return res.status(400).json({ error: 'schedule_id is required' });
        }

        // Get schedule details
        const scheduleQuery = `SELECT * FROM master_schedule WHERE schedule_id = ${schedule_id}`;
        const scheduleResult = await DBSendResponse(scheduleQuery);
        
        if (!scheduleResult || scheduleResult.length === 0) {
            return res.status(404).json({ error: 'Schedule not found' });
        }
        
        const schedule = scheduleResult[0];
        const company_id = schedule.company_id;
        const schedule_start = schedule.start_time;
        const schedule_end = schedule.end_time;
        
        // Get all active employees for the company
        const activeEmployeesQuery = `
            SELECT emp_id, emp_first_name, emp_last_name, empEmail 
            FROM employee 
            WHERE emp_company_id = ${company_id} AND emp_is_active = 'true';
        `;
        const activeEmployees = await DBSendResponse(activeEmployeesQuery);
        console.log('Active employees for company:', company_id, activeEmployees);
        
        if (!activeEmployees || activeEmployees.length === 0) {
            return res.status(200).json({ message: 'No active employees found', notified: 0 });
        }
        
        // Get all employees scheduled for overlapping times using employee_schedule junction table
        const overlappingEmployeesQuery = `
            SELECT DISTINCT es.emp_id
            FROM employee_schedule es
            INNER JOIN master_schedule ms ON es.schedule_id = ms.schedule_id
            WHERE ms.company_id = ${company_id}
              AND NOT (
                ms.end_time <= '${moment(schedule_start).format('YYYY-MM-DD HH:mm:ss')}' OR
                ms.start_time >= '${moment(schedule_end).format('YYYY-MM-DD HH:mm:ss')}'
              );
        `;const overlappingEmployees = await DBSendResponse(overlappingEmployeesQuery);
        console.log('Overlapping employees query:', overlappingEmployeesQuery);
        console.log('Overlapping employees result:', overlappingEmployees);
        const scheduledEmployeeIds = overlappingEmployees.map(e => e.emp_id);
        
        // Filter to get available employees (not scheduled for overlapping times)
        const availableEmployees = activeEmployees.filter(emp => !scheduledEmployeeIds.includes(emp.emp_id));
        console.log('Available employees:', availableEmployees);
        
        if (availableEmployees.length === 0) {
            return res.status(200).json({ message: 'No available employees', notified: 0 });
        }
        
        // Send Customer.io broadcast to available employees (broadcast_id = 39)
        const broadcastData = {
            schedule_name: schedule.schedule_name,
            schedule_date: moment(schedule_start).format('YYYY-MM-DD'),
            schedule_time: `${moment(schedule_start).format('HH:mm')} - ${moment(schedule_end).format('HH:mm')}`
        };
        
        const employeeIds = availableEmployees.map(emp => String(emp.emp_id));
        
        console.log('Employee IDs to notify:', employeeIds);
        
        
        let rep = await api.triggerBroadcast(String(IN_APP_MESSAGE_SHIFT_BROADCAST_ID), broadcastData, { ids: employeeIds });

        console.log('Broadcast response:', rep);

        // Mark the schedule as notification sent
        try {
            await DBUpdate(`UPDATE master_schedule SET notification_sent = 1 WHERE schedule_id = ${schedule_id}`);
        } catch (updateErr) {
            console.error('Failed to update notification_sent flag:', updateErr);
        }
        
        res.status(200).json({ 
            message: 'Broadcast sent successfully', 
            notified: availableEmployees.length,
            availableEmployees: availableEmployees
        });
        
    } catch (error) {
        console.error('Error notifying available employees:', error);
        res.status(500).json({ error: 'Failed to send broadcast', details: error.message });
    }
};

// Helper to create sessions for a schedule (can be reused by master_schedule creation)
// If a transaction request is passed, it will use that request (and thus be atomic with caller).
// Otherwise falls back to standalone execution via DBSendResponse.
// Automatically filters out customers that already have a session for this schedule to prevent duplicates.
async function createSessionsForSchedule(schedule_id, customers, notes, requestInTransaction = null) {
    if (!Array.isArray(customers) || customers.length === 0) return [];
    
    // Check for existing sessions to prevent duplicates
    const existingQuery = `SELECT customer_id FROM sessions WHERE schedule_id = ${schedule_id} AND customer_id IN (${customers.join(',')});`;
    let existingCustomers = [];
    if (requestInTransaction) {
        const result = await new Promise((resolve, reject) => {
            requestInTransaction.query(existingQuery, (err, result) => {
                if (err) return reject(err);
                resolve(result.recordset || []);
            });
        });
        existingCustomers = result.map(r => r.customer_id);
    } else {
        const result = await DBSendResponse(existingQuery);
        existingCustomers = (result || []).map(r => r.customer_id);
    }
    
    // Filter out customers that already have a session
    const newCustomers = customers.filter(cus_id => !existingCustomers.includes(cus_id));
    if (newCustomers.length === 0) return [];
    
    const safeNotes = notes ? String(notes).replace(/'/g, "''") : null;
    const values = newCustomers.map(cus_id => `(${schedule_id}, ${cus_id}, ${safeNotes ? `'${safeNotes}'` : 'NULL'})`).join(', ');
    const query = `INSERT INTO sessions (schedule_id, customer_id, notes) VALUES ${values};`;
    if (requestInTransaction) {
        return new Promise((resolve, reject) => {
            requestInTransaction.query(query, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });
    } else {
        return DBSendResponse(query);
    }
}

exports.createSessionsForSchedule = createSessionsForSchedule;

const customerOverlapCheck = async (req) => {
    if (!Array.isArray(req.body.customers) || req.body.customers.length === 0) return null;

    const customerOverlapQuery = `
        SELECT s.*, ms.*, c.cus_name
        FROM sessions s
        INNER JOIN master_schedule ms ON s.schedule_id = ms.schedule_id
        INNER JOIN customer c ON s.customer_id = c.cus_id
        WHERE s.customer_id IN (${req.body.customers.join(', ')})
          AND ms.date = '${req.body.date}'
          AND NOT (
                ms.end_time <= '${req.body.start_time}' OR
                ms.start_time >= '${req.body.end_time}'
          )
          AND s.check_out_time IS NULL`;

    const customerOverlap = await DBSendResponse(customerOverlapQuery);

    if (customerOverlap.length > 0) {
        // Allow if the (first) overlapping session actually checked out before new start
        if (customerOverlap[0].check_out_time && moment(customerOverlap[0].check_out_time).isSameOrBefore(req.body.start_time)) {
            return null;
        }
        const names = [...new Set(customerOverlap.map(r => r.cus_name).filter(Boolean))];
        if (names.length === 0) return 'Customer is already scheduled for this time';
        const nameList = names.join(', ');
        return names.length === 1
            ? `Customer ${nameList} is already scheduled for this time`
            : `Customers ${nameList} are already scheduled for this time`;
    }
    return null;
}

// Export for reuse (e.g., master_schedule auto session creation)
exports.customerOverlapCheck = customerOverlapCheck;

exports.getSessionById = async (req, res) => {
    try {
        const query = `SELECT * FROM sessions WHERE session_id = ${req.params.id}`
        let session = await DBSendResponse(query)
        res.status(200).json(session)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.deleteSession = async (req, res) => {
    const transaction = new db.Transaction();
    try {
        await transaction.begin();
        const request = new db.Request(transaction);

        // Read schedule + task info first (used for recurrence and task deactivation)
        const readQuery = `
            SELECT s.task_id, ms.schedule_name, ms.task_type, ms.resource_id, ms.company_id, ms.start_time
            FROM sessions s
            JOIN master_schedule ms ON s.schedule_id = ms.schedule_id
            WHERE s.session_id = ${req.params.id};
        `;
        const readResult = await request.query(readQuery);
        const scheduleData = readResult.recordset || [];
        console.log("ZZZ", scheduleData);
        
        const s = scheduleData[0];

        // If this session has an associated task, set it inactive (2)
        if (s && s.task_id) {
            const deactivateTaskQuery = `UPDATE task SET tas_is_active = 2 WHERE tas_id = ${s.task_id};`;
            await request.query(deactivateTaskQuery);
        }

        // Delete the session itself
        const deleteQuery = `DELETE FROM sessions WHERE session_id = ${req.params.id};`;
        const deleteResult = await request.query(deleteQuery);

        // If recurrence flag, deactivate tasks and delete future sessions matching the same schedule pattern
        if (req.body.reccurence && s) {
            const escScheduleName = String(s.schedule_name).replace(/'/g, "''");
            const escTaskType = String(s.task_type).replace(/'/g, "''");

            // Deactivate tasks for future sessions before deleting them
            const deactivateFutureTasksQuery = `
                UPDATE t
                SET tas_is_active = 2
                FROM task t
                INNER JOIN sessions s ON s.task_id = t.tas_id
                INNER JOIN master_schedule ms ON s.schedule_id = ms.schedule_id
                WHERE ms.schedule_name = '${escScheduleName}'
                    AND ms.task_type = '${escTaskType}'
                    AND ms.resource_id = ${s.resource_id}
                    AND ms.company_id = ${s.company_id}
                    AND ms.start_time > '${moment(s.start_time).format('YYYY-MM-DD HH:mm:ss')}'
                    AND s.task_id IS NOT NULL;
            `;
            await request.query(deactivateFutureTasksQuery);

            const futureQuery = `
                DELETE s
                FROM sessions s
                JOIN master_schedule ms ON s.schedule_id = ms.schedule_id
                WHERE ms.schedule_name = '${escScheduleName}'
                    AND ms.task_type = '${escTaskType}'
                    AND ms.resource_id = ${s.resource_id}
                    AND ms.company_id = ${s.company_id}
                    AND ms.start_time > '${moment(s.start_time).format('YYYY-MM-DD HH:mm:ss')}';
            `;
            await request.query(futureQuery);
        }

        await transaction.commit();
        res.status(200).json(deleteResult.recordset || []);
    } catch (error) {
        try { await transaction.rollback(); } catch (e) {}
        console.log(error);
        res.status(500).json(error);
    }
}

exports.getSessionsByCompany = async (req, res) => {
    try {
        // Extract optional date range filters
        const { startDate, endDate } = req.query;
        let dateFilter = '';
        if (startDate) dateFilter += ` AND ms.date >= '${startDate}'`;
        if (endDate) dateFilter += ` AND ms.date <= '${endDate}'`;

        // Optimized query: filter by company/date first, then join customer
        const query = `
            SELECT s.*, c.cus_name, ms.date, ms.start_time, ms.end_time, ms.schedule_name, ms.task_type
            FROM master_schedule ms
            INNER JOIN sessions s ON s.schedule_id = ms.schedule_id
            INNER JOIN customer c ON c.cus_id = s.customer_id
            WHERE ms.company_id = ${req.params.id}${dateFilter}
        `;
        let sessions = await DBSendResponse(query)

        res.status(200).json(sessions)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.getSessionsBySchedule = async (req, res) => {
    try {
        const ids = req.body.scheduleIds;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'scheduleIds array is required' });
        }
        const query = `
            WITH RequiredForms AS (
                SELECT tf.form_id, dd.EntityValue as task_type, dd.CompanyID
                FROM task_form tf
                JOIN dropdowns dd ON dd.ddID = tf.taskType_id
            ),
            CompletedForms AS (
                SELECT s.session_id, COUNT(DISTINCT rf.form_id) as required_count,
                       COUNT(DISTINCT cf.form_type) as completed_count
                FROM sessions s
                INNER JOIN master_schedule ms ON s.schedule_id = ms.schedule_id
                LEFT JOIN RequiredForms rf ON rf.task_type = ms.task_type AND rf.CompanyID = ms.company_id
                LEFT JOIN customer_form cf ON cf.task_id = s.task_id AND cf.form_type = rf.form_id
                WHERE s.schedule_id IN (${ids.join(',')}) AND s.task_id IS NOT NULL
                GROUP BY s.session_id
            )
            SELECT 
                s.*, 
                c.cus_name,
                CASE 
                    WHEN s.task_id IS NULL THEN 0
                    WHEN cf.required_count IS NULL OR cf.required_count = 0 THEN 1
                    WHEN cf.completed_count >= cf.required_count THEN 1
                    ELSE 0
                END as is_complete
            FROM sessions s
            INNER JOIN customer c ON s.customer_id = c.cus_id
            INNER JOIN master_schedule ms ON s.schedule_id = ms.schedule_id
            LEFT JOIN CompletedForms cf ON cf.session_id = s.session_id
            WHERE s.schedule_id IN (${ids.join(',')})
        `;
        
        const sessions = await DBSendResponse(query);
        res.status(200).json(sessions);
    } catch (error) {
        res.status(500).json(error);
    }
};

// Lightweight version for dashboard use — no JOINs, only the fields needed for KPI/alert calculations
exports.getSessionsLiteBySchedule = async (req, res) => {
    try {
        const ids = req.body?.scheduleIds;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'scheduleIds array is required' });
        }
        const query = `
            SELECT s.session_id, s.schedule_id, s.customer_id, s.check_in_time, s.check_out_time,
                   c.cus_name
            FROM sessions s
            LEFT JOIN customer c ON s.customer_id = c.cus_id
            WHERE s.schedule_id IN (${ids.map(id => parseInt(id, 10)).join(',')})
        `;
        const sessions = await DBSendResponse(query);
        res.status(200).json(sessions);
    } catch (error) {
        res.status(500).json(error);
    }
};

exports.postSession = async (req, res) => {
    try {
        if (!Array.isArray(req.body.customers) || req.body.customers.length === 0) {
            return res.status(400).json({ error: "customers array is required" });
        }

        const customerOverlap = await customerOverlapCheck(req)

        if (customerOverlap) {
            return res.status(400).json({ message: customerOverlap })
        }

        // Check for existing sessions to prevent duplicates
        const existingQuery = `SELECT customer_id FROM sessions WHERE schedule_id = ${req.body.schedule_id} AND customer_id IN (${req.body.customers.join(',')});`;
        const existingResult = await DBSendResponse(existingQuery);
        const existingCustomers = (existingResult || []).map(r => r.customer_id);
        const newCustomers = req.body.customers.filter(cus_id => !existingCustomers.includes(cus_id));
        
        if (newCustomers.length === 0) {
            return res.status(200).json({ message: "All customers already have sessions for this schedule" });
        }

        const values = newCustomers.map(cus_id => 
            `(${req.body.schedule_id}, ${cus_id}, ${req.body.notes ? `'${req.body.notes}'` : null})`
        ).join(', ');

        const query = `INSERT INTO sessions (schedule_id, customer_id, notes) VALUES ${values}; SELECT SCOPE_IDENTITY();`;

        let sessions = await DBSendResponse(query);

        if (req.body.reccurence) {
            let scheduleData = await DBSendResponse(`
                SELECT schedule_name, task_type, resource_id, company_id, start_time
                FROM master_schedule
                WHERE schedule_id = ${req.body.schedule_id};
            `);
            let s = scheduleData[0];

            // Use NOT EXISTS to prevent duplicate sessions for recurrence
            let futureQuery = newCustomers.map(cus_id => `
                INSERT INTO sessions (schedule_id, customer_id, notes)
                SELECT ms.schedule_id, ${cus_id}, ${req.body.notes ? `'${String(req.body.notes).replaceAll("'", "''")}'` : 'NULL'}
                FROM master_schedule ms
                WHERE ms.schedule_name = '${s.schedule_name.replaceAll("'", "''")}'
                    AND ms.task_type = '${s.task_type.replaceAll("'", "''")}'
                    AND ms.resource_id = ${s.resource_id}
                    AND ms.company_id = ${s.company_id}
                    AND ms.start_time > '${moment(s.start_time).format('YYYY-MM-DD HH:mm:ss')}'
                    AND NOT EXISTS (
                        SELECT 1 FROM sessions ses 
                        WHERE ses.schedule_id = ms.schedule_id 
                        AND ses.customer_id = ${cus_id}
                    );
            `).join('');
            await DBSendResponse(futureQuery);
        }

        res.status(200).json(sessions);
    } catch (error) {
        console.log(error);
        res.status(500).json(error);
    }
};

exports.updateAttendance = async (req, res) => {
    const transaction = new db.Transaction();
    try {
        console.log(req.body);
        await transaction.begin();
        const request = new db.Request(transaction);

        if (req.body.tas_id) {
            const setParts = [];
            if (req.body.tas_is_active !== undefined) {
                setParts.push(`tas_is_active = ${req.body.tas_is_active ? 1 : 0}`);
            }
            if (req.body.tas_type !== undefined) {
                setParts.push(`tas_type = ${req.body.tas_type ? `'${String(req.body.tas_type).replace(/'/g, "''")}'` : 'NULL'}`);
            }
            if (req.body.tas_title !== undefined) {
                setParts.push(`tas_title = ${req.body.tas_title ? `'${String(req.body.tas_title).replace(/'/g, "''")}'` : 'NULL'}`);
            }
            if (req.body.tas_start_time !== undefined) {
                setParts.push(`tas_start_time = ${req.body.tas_start_time ? `'${req.body.tas_start_time}'` : 'NULL'}`);
            }
            if (req.body.tas_end_time !== undefined) {
                setParts.push(`tas_end_time = ${req.body.tas_end_time ? `'${req.body.tas_end_time}'` : 'NULL'}`);
            }

            if (setParts.length > 0) {
                const updateTaskQuery = `UPDATE task SET ${setParts.join(', ')} WHERE tas_id = ${req.body.tas_id};`;
                await request.query(updateTaskQuery);
            }
        }

        const updateSessionQuery = `
            UPDATE sessions
            SET check_in_time = ${req.body.check_in_time ? `'${req.body.check_in_time}'` : 'NULL'},
                check_out_time = ${req.body.check_out_time ? `'${req.body.check_out_time}'` : 'NULL'},
                task_id = ${req.body.task_id ? `${req.body.task_id}` : 'NULL'}
            WHERE session_id = ${req.params.id};
        `;
        await request.query(updateSessionQuery);

        if (req.body.task_id) {
            const empLocateSetParts = [
                `empLocdate = ${req.body.tas_start_time ? `'${req.body.tas_start_time}'` : 'NULL'}`,
                `checkoutEmpDate = ${req.body.tas_end_time ? `'${req.body.tas_end_time}'` : 'NULL'}`
            ];
            if (req.body.timesheet_status !== undefined && req.body.timesheet_status !== null) {
                empLocateSetParts.push(`timesheet_status = ${Number.isInteger(req.body.timesheet_status) ? req.body.timesheet_status : 0}`);
            }
            const updateEmpLocateQuery = `UPDATE empLocate SET ${empLocateSetParts.join(', ')} WHERE taskId = ${req.body.task_id};`;
            await request.query(updateEmpLocateQuery);
        }

        const selectQuery = `
            SELECT s.*, c.cus_name
            FROM sessions s
            INNER JOIN customer c ON s.customer_id = c.cus_id
            WHERE s.session_id = ${req.params.id};
        `;
        const result = await request.query(selectQuery);

        await transaction.commit();

        if (req.body.emp_id && req.body.company_id && req.params.id && req.body.cus_id && req.body.task_id) {
            analytics.track({
                userId: String(req.body.emp_id),
                event: req.body.check_in_time === null ? 'Attendance unmarked' : 'Attendance marked',
                context: { groupId: req.body.company_id },
                properties: { taskId: req.body.task_id, cusId: req.body.cus_id, sessionId: req.params.id }
            });
            console.log('logged to segment successfully');
        }

        res.status(200).json(result.recordset);
    } catch (error) {
        try { await transaction.rollback(); } catch (e) {}
        req.log?.error({ err: error, body: req.body }, 'updateAttendance failed');
        res.status(500).json(error);
    }
}

exports.createTaskAndTimesheet = async function (req, res) {
  // Reject unparseable datetimes (e.g. moment's "Invalid date") before they reach SQL Server
  const invalidDateFields = ['tStrtDate', 'tEndDate', 'tStartTime', 'tEndTime', 'start_time', 'end_time']
    .filter(field => !moment(req.body[field], moment.ISO_8601).isValid());
  if (invalidDateFields.length > 0) {
    return res.status(400).json({ error: `Invalid date/time for: ${invalidDateFields.join(', ')}` });
  }
  const transaction = new db.Transaction();
  try {
    await transaction.begin();
    const request = new db.Request(transaction);
    // Destructure all task-related fields
    const {
      company_id,
      tTitle,
      tDesc,
      tType,
      tStrtDate,
      tEndDate,
      tStartTime,
      tEndTime,
      tPriority,
      tIsBillable,
      tNotes,
      tProject,
      tLoc,
      tLoc1,
      tLoc2,
      tasMmId,
      tasRequiredSig,
      cusId,
      user_id,
      task_emp_timezone
    } = req.body;
    // Insert new task with all fields
    const insertTaskQuery = `
      INSERT INTO task (
        tas_title,
        tas_description,
        tas_type,
        tas_start_date,
        tas_end_date,
        tas_start_time,
        tas_end_time,
        tas_priority,
        tas_billable_by_default,
        tas_notes,
        tas_is_active,
        tas_created_at,
        tas_pro_id,
        tas_emp_id,
        tas_loc_id,
        tas_loc1_id,
        tas_loc2_id,
        tas_prequisites_task,
        tas_created_by,
        tas_com_id,
        tas_mm_id,
        tas_required_sig,
        tas_cus_id,
        task_emp_timezone
      ) VALUES (
        '${tTitle.replace(/'/g, "''")}',
        '${tDesc.replace(/'/g, "''")}',
        '${tType}',
        '${tStrtDate}',
        '${tEndDate}',
        '${tStartTime}',
        '${tEndTime}',
        '${tPriority}',
        '${tIsBillable}',
        '${tNotes.replace(/'/g, "''")}',
        1,
        CURRENT_TIMESTAMP,
        ${tProject},
        ${user_id},
        ${tLoc},
        ${tLoc1 || 'NULL'},
        ${tLoc2 || 'NULL'},
        NULL,
        ${user_id},
        ${company_id},
        ${tasMmId || 'NULL'},
        ${tasRequiredSig ? 1 : 0},
        ${cusId || 'NULL'},
        '${task_emp_timezone || 'NULL'}'
      );
      SELECT SCOPE_IDENTITY() AS id;
    `;
     const taskResult = await request.query(insertTaskQuery);
     const newTaskId = taskResult.recordset[0].id;
    // Insert timesheet entry with optional status
    const {
      projId,
      empId,
      locId,
      emploc_lat,
      emploc_lon,
      start_time,
      end_time,
      session_id,
      cus_id,
      timesheet_status,
      empLocate_timezone
    } = req.body;
    const insertTimesheetQuery = `
      INSERT INTO empLocate (
        projId,
        empId,
        taskId,
        locId,
        emploc_lat,
        emploc_lon,
        empLocdate,
        checkoutEmpDate,
        timesheet_status,
        empLocate_timezone
      ) VALUES (
        ${projId},
        ${empId || 'NULL'},
        ${newTaskId},
        ${locId},
        '${emploc_lat}',
        '${emploc_lon}',
        '${start_time}',
        '${end_time}',
        ${timesheet_status || 0},
        '${empLocate_timezone || 'NULL'}'
      );
    `;
    await request.query(insertTimesheetQuery);
     // Update session with task and times
    const updateSessionQuery = `
      UPDATE sessions
      SET task_id = ${newTaskId}, check_in_time = '${start_time}', check_out_time = '${end_time}'
      WHERE session_id = ${session_id};
    `;
     await request.query(updateSessionQuery);
     await transaction.commit();
     // Analytics tracking
    if (user_id && company_id && session_id && cus_id) {
       analytics.track({
         userId: String(user_id),
         event: 'Attendance marked',
         context: { groupId: company_id },
         properties: { taskId: newTaskId, cusId: cusId, sessionId: session_id }
       });
     }
     res.status(200).json({ code: 200, taskId: newTaskId });
   } catch (error) {
     try { await transaction.rollback(); } catch (rollbackError) {
       console.error('Rollback failed in createTaskAndTimesheet:', rollbackError);
     }
     console.error(error);
     res.status(500).json({ error: error.message });
   }
};

exports.mobileShiftCheckInOut = async function (req, res) {
    try {
        const updateSessionQuery = `
            UPDATE sessions
            SET 
                task_id = ${req.body.task_id}, 
                check_in_time = ${req.body.check_in_time ? `'${req.body.check_in_time}'` : 'NULL'},
                check_out_time = ${req.body.check_out_time ? `'${req.body.check_out_time}'` : 'NULL'}
            WHERE session_id = ${req.body.session_id}
        `;
        await DBSendResponse(updateSessionQuery);

        res.status(200).json({
            message: 'Session updated successfully'
        });
    } catch (err) {
        console.log('QUERY FAILURE | mobileShiftCheckInOut Query Failed:');
        console.log(err);
        res.status(400).json({
            message: 'An unexpected error occurred'
        });
    }
};
