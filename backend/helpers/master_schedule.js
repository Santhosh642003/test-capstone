const e = require('express');
const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries');
const moment = require('moment-timezone');
var {SEGMENT_API_KEY} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })
const { createSessionsForSchedule, customerOverlapCheck } = require('./sessions');

const chunkArray = (arr, size) => {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
};

const overlapCheck = async (req) => {
    let scheduleOverlapCheckQuery = `
        SELECT * FROM master_schedule
        WHERE resource_id = ${req.body.resource_id ? req.body.resource_id : 0}
        AND schedule_id != ${req.params.id ? req.params.id : 0}
        AND date = '${req.body.date}'
        AND NOT (
            end_time <= '${req.body.start_time}' OR
            start_time >= '${req.body.end_time}'
        );
    `;

    let overlappingSchedules = await DBSendResponse(scheduleOverlapCheckQuery);

    if (!overlappingSchedules) {
        return null;
    }

    if (overlappingSchedules.length > 0) {
        return "Resource is already scheduled for this time";
    }

    if (!req.body.employee_ids || !req.body.employee_ids.length) {
        return null;
    }
    
    let employeeOverlapCheckQuery = `
        SELECT * FROM employee_schedule
        WHERE emp_id IN (${req.body.employee_ids.join(',')})
        AND schedule_id IN (
            SELECT schedule_id FROM master_schedule
            WHERE date = '${req.body.date}'
            AND NOT (
                end_time <= '${req.body.start_time}' OR
                start_time >= '${req.body.end_time}'
            )
        );
    `;    
    
    let employeeOverlappingSchedules = await DBSendResponse(employeeOverlapCheckQuery);

    if (employeeOverlappingSchedules.length > 0) {
        return "Employee is already scheduled for this time";
    }

    return null;
}

exports.getMasterScheduleById = async (req, res) => {
    try {
        const query = `
            SELECT ms.*, es.emp_id
            FROM master_schedule ms
            LEFT JOIN employee_schedule es ON ms.schedule_id = es.schedule_id
            WHERE ms.schedule_id = ${req.params.id};
        `;

        const results = await DBSendResponse(query);
        
        // Reduce results to single object with array of employee_ids
        const schedule = results.reduce((acc, curr) => {
            if (!acc.employee_ids) {
                acc = { ...curr, employee_ids: [] };
                delete acc.emp_id;
            }
            if (curr.emp_id) acc.employee_ids.push(curr.emp_id);
            return acc;
        }, {});

        res.status(200).json(schedule);
    } catch (error) {
        res.status(500).json(error);
    }
}

exports.getMasterSchedulesByCompany = async (req, res) => {
    try {
        // Extract optional date range filters
        const { startDate, endDate } = req.query;
        let dateFilter = '';
        if (startDate) dateFilter += ` AND ms.date >= '${startDate}'`;
        if (endDate) dateFilter += ` AND ms.date <= '${endDate}'`;

        const query = `
            SELECT 
                ms.*,
                COALESCE(STRING_AGG(CAST(es.emp_id AS VARCHAR), ','), '') AS employee_ids_str,
                COALESCE(STRING_AGG(CONCAT(e.emp_first_name, ' ', e.emp_last_name), ', '), '') AS employee_names_str
            FROM master_schedule ms
            LEFT JOIN employee_schedule es ON ms.schedule_id = es.schedule_id
            LEFT JOIN employee e ON es.emp_id = e.emp_id
            WHERE ms.company_id = ${req.params.id}${dateFilter}
            GROUP BY ms.schedule_id, ms.date, ms.start_time, ms.end_time, ms.resource_id, 
                     ms.max_capacity, ms.notes, ms.schedule_name, ms.task_type, 
                     ms.company_id, ms.created_by, ms.notification_sent;
        `;

        const results = await DBSendResponse(query);
        // Convert employee_ids_str to array and employee_names_str to string
        const schedules = results.map(schedule => ({
            ...schedule,
            employee_ids: schedule.employee_ids_str 
                ? schedule.employee_ids_str.split(',').map(id => parseInt(id, 10))
                : [],
            employee_names: schedule.employee_names_str || '',
            employee_ids_str: undefined,
            employee_names_str: undefined
        }));

        res.status(200).json(schedules);
    } catch (error) {
        res.status(500).json(error);
    }
}

exports.getMasterSchedulesByEmployee = async (req, res) => {
    try {
        const query = `
            SELECT ms.*, l.*, r.resource_name  
            FROM master_schedule ms
            JOIN employee_schedule es ON ms.schedule_id = es.schedule_id
            JOIN resources r ON ms.resource_id = r.resource_id
            JOIN location l ON r.location_id = l.loc_id
            WHERE es.emp_id = ${req.params.id};
        `;

        const master_schedules = await DBSendResponse(query);
        res.status(200).json(master_schedules);
    } catch (error) {
        res.status(500).json(error);
    }
}

exports.getMasterSchedulesByResource = async (req, res) => {
    try {
        const query = `
            SELECT ms.*
            FROM master_schedule ms
            WHERE ms.resource_id = ${req.params.id};
        `;

        const master_schedules = await DBSendResponse(query);
        res.status(200).json(master_schedules);
    } catch (error) {
        res.status(500).json(error);
    }
}

exports.postMasterSchedule = async (req, res) => {

    const start = performance.now();
    try {
        await postMasterSchedule(req,res);
        console.log(`/api/fieldworker/master_schedule POST TIMETAKEN: ${performance.now() - start} MS`)
    } catch (error) {
        console.log(`/api/fieldworker/master_schedule POST ERROR: ${error.message}`);
        console.log(`| ERROR | `, error);
        console.log(`/api/fieldworker/master_schedule POST TIMETAKEN: ${performance.now() - start} MS`)
        res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error })
    }

}

async function postMasterSchedule (req,res) {
    const transaction = new db.Transaction();
  
    let overlapError = await overlapCheck(req);
    if (overlapError) {
        return res.status(400).json({ message: overlapError });
    }

    const escapeApostrophes = (str) => str ? String(str).replace(/'/g, "''") : str;
    const safeScheduleName = escapeApostrophes(req.body.schedule_name);
    const safeNotes = escapeApostrophes(req.body.notes);
    const safeTaskType = escapeApostrophes(req.body.task_type);

    try {
        await transaction.begin(async err => {
            if (err) {
                req.log?.error({ err: err, body: req.body }, 'postMasterSchedule: transaction begin failed');
                return res.status(500).json("Error scheduling session");
            }
            const request = new db.Request(transaction);
            const insertQuery = `
                INSERT INTO master_schedule (date, start_time, end_time, resource_id, max_capacity, notes, schedule_name, task_type, company_id, created_by)
                VALUES ('${req.body.date}', '${req.body.start_time}', '${req.body.end_time}', ${req.body.resource_id}, ${req.body.max_capacity}, ${safeNotes ? `'${safeNotes}'` : 'NULL'}, '${safeScheduleName}', '${safeTaskType}', ${req.body.company_id}, ${req.body.created_by});
                SELECT SCOPE_IDENTITY() as schedule_id;
            `;
            request.query(insertQuery, async (err, result) => {
                if (err) {
                    try { await transaction.rollback(); } catch (e) {}
                    req.log?.error({ err: err, body: req.body }, 'postMasterSchedule: schedule insert failed');
                    res.status(500).json("Error scheduling session");
                } else {
                    const schedule_id = result.recordset[0].schedule_id;
                    if (req.body.employee_ids && req.body.employee_ids.length) {
                        const employeeInserts = req.body.employee_ids.map(emp_id => 
                            `(${schedule_id}, ${emp_id})`
                        ).join(',');
                        const linkQuery = `INSERT INTO employee_schedule (schedule_id, emp_id) VALUES ${employeeInserts};`;
                        request.query(linkQuery, async (err, result) => {
                            if (err) {
                                try { await transaction.rollback(); } catch (e) {}
                                req.log?.error({ err: err, body: req.body }, 'postMasterSchedule: employee_schedule insert failed');
                                res.status(500).json("Error scheduling session");
                            } else {
                                const finalize = async () => {
                                    if (req.body.customers && Array.isArray(req.body.customers) && req.body.customers.length) {
                                        // Run session-specific customer overlap check
                                        const customerOverlapMsg = await customerOverlapCheck(req);
                                        if (customerOverlapMsg) {
                                            try { await transaction.rollback(); } catch (e) {}
                                            return res.status(400).json({ type: 'overlap', message: customerOverlapMsg });
                                        }
                                        try {
                                            await createSessionsForSchedule(schedule_id, req.body.customers, req.body.session_notes || req.body.notes || null, request);
                                        } catch (e) {
                                            try { await transaction.rollback(); } catch (e) {}
                                            req.log?.error({ err: e, body: req.body }, 'postMasterSchedule: session creation failed');
                                            return res.status(500).json({ message: 'Schedule created but failed to create sessions', error: e.message });
                                        }
                                    }
                                        if (req.body.created_by && req.body.company_id && schedule_id && req.body.task_type) {
                                                analytics.track({
                                                    userId: String(req.body.created_by),
                                                    event: 'Session scheduled',
                                                    context: {
                                                        groupId: req.body.company_id,
                                                    },
                                                    properties: {
                                                        scheduleId: schedule_id,
                                                        resourceId: req.body.resource_id ? req.body.resource_id : 'no resource assigned',
                                                        taskType: req.body.task_type,
                                                        empIds: (req.body.employee_ids || []).join(),
                                                        customers: (req.body.customers || []).join()
                                                    }
                                                })
                                        }
                                        transaction.commit(async err => {
                                            if (err) {
                                                req.log?.error({ err: err, body: req.body }, 'postMasterSchedule: commit failed');
                                                try { await transaction.rollback(); } catch (e) {}
                                                return res.status(500).json({ message: 'Error saving schedule changes' });
                                            }
                                            res.status(200).json({ schedule_id: schedule_id });
                                        });
                                };
                                finalize().catch(async err => {
                                    req.log?.error({ err: err, body: req.body }, 'postMasterSchedule: finalize failed');
                                    try { await transaction.rollback(); } catch (e) {}
                                    if (!res.headersSent) res.status(500).json("Error scheduling session");
                                });
                            }
                        });
                    } else {
                        const finalizeNoEmployees = async () => {
                            if (req.body.customers && Array.isArray(req.body.customers) && req.body.customers.length) {
                                const customerOverlapMsg = await customerOverlapCheck(req);
                                if (customerOverlapMsg) {
                                    try { await transaction.rollback(); } catch (e) {}
                                    return res.status(400).json({ type: 'overlap', message: customerOverlapMsg });
                                }
                                try {
                                    await createSessionsForSchedule(schedule_id, req.body.customers, req.body.session_notes || req.body.notes || null, request);
                                } catch (e) {
                                    try { await transaction.rollback(); } catch (e) {}
                                    req.log?.error({ err: e, body: req.body }, 'postMasterSchedule: session creation failed');
                                    return res.status(500).json({ message: 'Schedule created but failed to create sessions', error: e.message });
                                }
                            }
                                if (req.body.created_by && req.body.company_id && schedule_id && req.body.resource_id && req.body.task_type) {
                                        analytics.track({
                                            userId: String(req.body.created_by),
                                            event: 'Session scheduled',
                                            context: {
                                                groupId: req.body.company_id,
                                            },
                                            properties: {
                                                scheduleId: schedule_id,
                                                resourceId: req.body.resource_id ? req.body.resource_id : 'no resource assigned',
                                                taskType: req.body.task_type,
                                                customers: (req.body.customers || []).join()
                                            }
                                        })
                                }
                                transaction.commit(async err => {
                                    if (err) {
                                        req.log?.error({ err: err, body: req.body }, 'postMasterSchedule: commit failed');
                                        try { await transaction.rollback(); } catch (e) {}
                                        return res.status(500).json({ message: 'Error saving schedule changes' });
                                    }
                                    res.status(200).json({ schedule_id: schedule_id });
                                });
                        };
                        finalizeNoEmployees().catch(async err => {
                            req.log?.error({ err: err, body: req.body }, 'postMasterSchedule: finalize failed');
                            try { await transaction.rollback(); } catch (e) {}
                            if (!res.headersSent) res.status(500).json("Error scheduling session");
                        });
                    }
                }
            });
        });
    } catch (error) {
        req.log?.error({ err: error, body: req.body }, 'postMasterSchedule: unexpected error');
        try { await transaction.rollback(); } catch (e) {}
        res.status(500).json(error);
    }
};

exports.updateMasterSchedule = async (req, res) => {
    try {
        let overlapError = await overlapCheck(req);

        if (overlapError) {
            return res.status(400).json({ message: overlapError });
        }

        // Escape apostrophes in schedule_name, notes, and task_type
        const escapeApostrophes = (str) => str ? String(str).replace(/'/g, "''") : str;
        const safeScheduleName = escapeApostrophes(req.body.schedule_name);
        const safeNotes = escapeApostrophes(req.body.notes);
        const safeTaskType = escapeApostrophes(req.body.task_type);

        let oldData;
        if(req.body.reccurence) {
            oldData = await DBSendResponse(`
                SELECT start_time, end_time, schedule_name, task_type, resource_id, company_id
                FROM master_schedule
                WHERE schedule_id = ${req.params.id};
            `);
        }

        const updateQuery = `
            UPDATE master_schedule 
            SET date = '${req.body.date}', start_time = '${req.body.start_time}', end_time = '${req.body.end_time}', resource_id = ${req.body.resource_id}, max_capacity = ${req.body.max_capacity}, notes = ${safeNotes ? `'${safeNotes}'` : 'NULL'}, schedule_name = '${safeScheduleName}', task_type = '${safeTaskType}'
            WHERE schedule_id = ${req.params.id};
        `;

        await DBUpdate(updateQuery); // Updates this schedule

        if(req.body.reccurence) {
            let r = oldData[0];
            const oldStart = moment.utc(r.start_time);
            const oldEnd = moment.utc(r.end_time);
            const newStart = moment.utc(req.body.start_time);
            const newEnd = moment.utc(req.body.end_time);
            const diffStart = newStart.diff(oldStart, 'minutes');
            const diffEnd = newEnd.diff(oldEnd, 'minutes');

            let updateFutureRecurrencesQuery = `
                UPDATE master_schedule
                SET resource_id = ${req.body.resource_id},
                    max_capacity = ${req.body.max_capacity},
                    notes = ${safeNotes ? "'" + safeNotes + "'" : 'NULL'},
                    schedule_name = '${safeScheduleName}',
                    task_type = '${safeTaskType}',
                    start_time = DATEADD(MINUTE, ${diffStart}, start_time),
                    end_time = DATEADD(MINUTE, ${diffEnd}, end_time),
                    date = CAST(start_time AS date)
                WHERE schedule_name = '${escapeApostrophes(r.schedule_name)}'
                    AND task_type = '${escapeApostrophes(r.task_type)}'
                    AND company_id = ${r.company_id}
                    AND resource_id = ${r.resource_id}
                    AND start_time > '${moment.utc(req.body.start_time).format('YYYY-MM-DD HH:mm:ss')}';
            `;
            await DBUpdate(updateFutureRecurrencesQuery);
        }

        res.status(200).json({ message: "Schedule updated successfully" });
    } catch (error) {
        console.log(error);
        res.status(500).json(error);
    }
};

exports.deleteMasterSchedule = async (req, res) => {
    const transaction = new db.Transaction();
    try {
        let criteriaJoin, criteriaMaster;
        if (req.body.reccurence) {
            const data = await DBSendResponse(`
                SELECT schedule_name, task_type, resource_id, company_id, start_time
                FROM master_schedule
                WHERE schedule_id = ${req.params.id};
            `);
            const r = data[0];
            if (!r) {
                return res.status(404).json({ message: "Schedule not found" });
            }
            const escapeApostrophes = (str) => str ? String(str).replace(/'/g, "''") : str;
            const startTime = moment.utc(r.start_time).format('YYYY-MM-DD HH:mm:ss');
            const baseCriteria = `schedule_name = '${escapeApostrophes(r.schedule_name)}' AND task_type = '${escapeApostrophes(r.task_type)}' AND company_id = ${r.company_id} AND resource_id = ${r.resource_id} AND start_time >= '${startTime}'`;
            criteriaJoin = `WHERE ms.${baseCriteria}`;
            criteriaMaster = `WHERE ${baseCriteria}`;
        } else {
            criteriaJoin = `WHERE ms.schedule_id = ${req.params.id}`;
            criteriaMaster = `WHERE schedule_id = ${req.params.id}`;
        }
        await transaction.begin(err => {
            if (err) {
                console.log(err);
                return res.status(500).json(err);
            }
            const request = new db.Request(transaction);
            const taskDeactivationQuery = `
                UPDATE t
                SET tas_is_active = 2
                FROM task t
                INNER JOIN sessions s ON s.task_id = t.tas_id
                INNER JOIN master_schedule ms ON s.schedule_id = ms.schedule_id
                ${criteriaJoin} AND s.task_id IS NOT NULL;
            `;
            request.query(taskDeactivationQuery, async (err) => {
                if (err) {
                    try { await transaction.rollback(); } catch (e) {}
                    return res.status(500).json(err);
                }
                request.query(`DELETE s FROM sessions s JOIN master_schedule ms ON s.schedule_id = ms.schedule_id ${criteriaJoin}`, async (err) => {
                    if (err) {
                        try { await transaction.rollback(); } catch (e) {}
                        return res.status(500).json(err);
                    }
                    request.query(`DELETE es FROM employee_schedule es JOIN master_schedule ms ON es.schedule_id = ms.schedule_id ${criteriaJoin}`, async (err) => {
                        if (err) {
                            try { await transaction.rollback(); } catch (e) {}
                            return res.status(500).json(err);
                        }
                        request.query(`DELETE FROM master_schedule ${criteriaMaster}`, async (err) => {
                            if (err) {
                                try { await transaction.rollback(); } catch (e) {}
                                return res.status(500).json(err);
                            }
                            transaction.commit(async err => {
                                if (err) {
                                    console.log(err);
                                    try { await transaction.rollback(); } catch (e) {}
                                    return res.status(500).json({ message: 'Error saving schedule changes' });
                                }
                                res.status(200).json({ message: "Schedule deleted successfully" });
                            });
                        });
                    });
                });
            });
        });
    } catch (error) {
        try { await transaction.rollback(); } catch (e) {}
        res.status(500).json(error);
    }
};

exports.assignEmployeeToMasterSchedule = async (req, res) => {
    try {
        // Insert for this schedule
        const query = `
            INSERT INTO employee_schedule (schedule_id, emp_id)
            VALUES (${req.body.schedule_id}, ${req.params.id});
        `;
        await DBSendResponse(query);

        if (req.body.reccurence) {
            let scheduleData = await DBSendResponse(`
                SELECT schedule_name, task_type, resource_id, company_id, start_time
                FROM master_schedule
                WHERE schedule_id = ${req.body.schedule_id};
            `);
            let s = scheduleData[0];
            let futureQuery = `
                INSERT INTO employee_schedule (schedule_id, emp_id)
                SELECT ms.schedule_id, ${req.params.id}
                FROM master_schedule ms
                WHERE ms.schedule_name = '${s.schedule_name.replaceAll("'", "''")}' 
                    AND ms.task_type = '${s.task_type}'
                    AND ms.resource_id = ${s.resource_id}
                    AND ms.company_id = ${s.company_id}
                    AND ms.start_time > '${moment.utc(s.start_time).format('YYYY-MM-DD HH:mm:ss')}';
            `;
            await DBSendResponse(futureQuery);
        }

        res.status(200).json({ message: "Employee assigned to schedule" });
    } catch (error) {
        res.status(500).json(error);
    }
};

exports.removeEmployeeFromMasterSchedule = async (req, res) => {
    try {
        // Remove from this schedule
        const query = `
            DELETE FROM employee_schedule
            WHERE schedule_id = ${req.body.schedule_id}
                AND emp_id = ${req.params.id};
        `;
        await DBSendResponse(query);

        if (req.body.reccurence) {
            let scheduleData = await DBSendResponse(`
                SELECT schedule_name, task_type, resource_id, company_id, start_time
                FROM master_schedule
                WHERE schedule_id = ${req.body.schedule_id};
            `);
            let s = scheduleData[0];
            let futureQuery = `
                DELETE es
                FROM employee_schedule es
                JOIN master_schedule ms ON es.schedule_id = ms.schedule_id
                WHERE ms.schedule_name = '${s.schedule_name.replaceAll("'", "''")}'
                    AND ms.task_type = '${s.task_type.replaceAll("'", "''")}'
                    AND ms.resource_id = ${s.resource_id}
                    AND ms.company_id = ${s.company_id}
                    AND ms.start_time > '${moment.utc(s.start_time).format('YYYY-MM-DD HH:mm:ss')}'
                    AND es.emp_id = ${req.params.id};
            `;
            await DBSendResponse(futureQuery);
        }

        res.status(200).json({ message: "Employee removed from schedule" });
    } catch (error) {        
        res.status(500).json(error);
    }
}

exports.assignEmployeesToMasterSchedule = async (req, res) => {
    const transaction = new db.Transaction();

    try {
        await transaction.begin();
        const request = new db.Request(transaction);

        // Check employee count with race condition protection when shift flag is passed
        if (req.body.shift) {
            const scheduleCheck = await new Promise((resolve, reject) => {
                request.query(`
                    SELECT COUNT(es.emp_id) as current_employee_count
                    FROM employee_schedule es
                    WHERE es.schedule_id = ${req.body.schedule_id};
                `, (err, result) => {
                    if (err) reject(err);
                    else resolve(result.recordset[0]);
                });
            });

            const totalEmployees = scheduleCheck.current_employee_count + req.body.employee_ids.length;
            if (totalEmployees > 1) {
                await transaction.rollback();
                return res.status(400).json({ message: "This shift is limited to a single employee only" });
            }
        }

        const employeeInserts = req.body.employee_ids.map(emp_id => 
            `(${req.body.schedule_id}, ${emp_id})`
        ).join(',');
        // Skip pairs that already exist (stale calendar / double submit) — (schedule_id, emp_id) is the PK.
        const linkQuery = `INSERT INTO employee_schedule (schedule_id, emp_id)
            SELECT v.schedule_id, v.emp_id FROM (VALUES ${employeeInserts}) v(schedule_id, emp_id)
            WHERE NOT EXISTS (SELECT 1 FROM employee_schedule es WHERE es.schedule_id = v.schedule_id AND es.emp_id = v.emp_id);`;
        
        await new Promise((resolve, reject) => {
            request.query(linkQuery, (err, result) => {
                if (err) reject(err);
                else resolve(result);
            });
        });

        if (req.body.reccurence) {
            // Also assign employees to future recurrences
            let scheduleData = await new Promise((resolve, reject) => {
                request.query(`
                    SELECT schedule_name, task_type, resource_id, company_id, start_time
                    FROM master_schedule
                    WHERE schedule_id = ${req.body.schedule_id};
                `, (err, result) => {
                    if (err) reject(err);
                    else resolve(result.recordset);
                });
            });
            let s = scheduleData[0];
            console.log(s);
            
            const futureInserts = req.body.employee_ids.map(emp_id => `
                INSERT INTO employee_schedule (schedule_id, emp_id)
                SELECT ms.schedule_id, ${emp_id}
                FROM master_schedule ms
                WHERE ms.schedule_name = '${s.schedule_name.replaceAll("'", "''")}'
                    AND ms.task_type = '${s.task_type}'
                    AND ms.resource_id = ${s.resource_id}
                    AND ms.company_id = ${s.company_id}
                    AND ms.start_time > '${moment.utc(s.start_time).format('YYYY-MM-DD HH:mm:ss')}'
                    AND NOT EXISTS (SELECT 1 FROM employee_schedule es WHERE es.schedule_id = ms.schedule_id AND es.emp_id = ${emp_id});
            `).join('');
            
            await new Promise((resolve, reject) => {
                request.query(futureInserts, (err, result) => {
                    if (err) reject(err);
                    else resolve(result);
                });
            });
            console.log(futureInserts);
            
        }

        await transaction.commit();
        res.status(200).json({ message: "Employees assigned to schedule" });
    } catch (error) {
        try { await transaction.rollback(); } catch (e) {}
        req.log?.error(error, 'assignEmployeesToMasterSchedule failed');
        res.status(500).json(error);
    }
}

exports.postMasterScheduleRecurrence = async (req, res) => {
    const transaction = new db.Transaction();

    try {
        const schedule = await DBSendResponse(`SELECT * FROM master_schedule WHERE schedule_id = ${req.body.schedule_id}`);
        const employee_ids = await DBSendResponse(`SELECT emp_id FROM employee_schedule WHERE schedule_id = ${req.body.schedule_id}`);
        const customer_ids = await DBSendResponse(`SELECT * FROM sessions WHERE schedule_id = ${req.body.schedule_id}`);
        
        const timeZone = req.body.timeZone || 'UTC';
        const escapeApostrophes = (str) => str ? String(str).replace(/'/g, "''") : str;

        const computeOccurrenceDateTime = (baseDateTime, targetMoment) => {
            const baseLocal = moment.utc(baseDateTime).tz(timeZone);
            const targetUtc = targetMoment.clone().utc();

            return baseLocal
                .clone()
                .set({
                    year: targetUtc.year(),
                    month: targetUtc.month(),
                    date: targetUtc.date(),
                })
                .utc()
                .format('YYYY-MM-DD HH:mm:ss');
        };

        const escSql = (v) => v == null ? '' : String(v).replaceAll("'", "''");

        let repeatQuery = `
            INSERT INTO master_schedule (date, start_time, end_time, resource_id, max_capacity, notes, schedule_name, task_type, company_id, created_by)
            OUTPUT INSERTED.schedule_id
            VALUES
        `;

        const repeatQueryBaseLength = repeatQuery.length;

        let overlapQuery = `
            SELECT * FROM master_schedule
            WHERE resource_id = ${req.body.resource_id}
            AND schedule_id != ${req.body.schedule_id}
        `;

        

        let employeeOverlapQuery = `
            SELECT * FROM employee_schedule
            WHERE emp_id IN (${employee_ids.map(emp => emp.emp_id).join(',')})
            AND schedule_id IN (
                SELECT schedule_id FROM master_schedule
                WHERE date IS NOT NULL
        `;

        let customerOverlapQuery = `
            SELECT * FROM sessions s INNER JOIN master_schedule ms ON s.schedule_id = ms.schedule_id INNER JOIN customer c ON s.customer_id = c.cus_id
            WHERE s.customer_id IN (${req.body.customer_ids.join(', ')})
        `

        const endMoment = req.body.endType === 'on'
            ? moment.utc(req.body.endDate, 'YYYY-MM-DD').endOf('day')
            : null;

        if (req.body.repeatType === "days" || req.body.repeatType === "months") {
            let currentDate = moment(schedule[0].date).utc()
            let count = 0;

            while(req.body.endType === "after" ? count < req.body.endAfter : moment(currentDate).isSameOrBefore(endMoment)) {
                let newDate = moment(currentDate).add(req.body.repeat, req.body.repeatType);
                if (endMoment && newDate.isAfter(endMoment)) {
                    break;
                }
                let newStart = computeOccurrenceDateTime(schedule[0].start_time, newDate);
                let newEnd = computeOccurrenceDateTime(schedule[0].end_time, newDate);

                repeatQuery += `('${newDate.format('YYYY-MM-DD')}', '${newStart}', '${newEnd}', ${schedule[0].resource_id}, ${schedule[0].max_capacity}, ${schedule[0].notes ? `'${escapeApostrophes(schedule[0].notes)}'` : 'NULL'}, '${escapeApostrophes(schedule[0].schedule_name)}', '${escapeApostrophes(schedule[0].task_type)}', ${schedule[0].company_id}, ${schedule[0].created_by}),`;
                overlapQuery += `${count > 0 ? ' OR NOT' : ' AND (NOT'} (
                    end_time <= '${newStart}' OR
                    start_time >= '${newEnd}'
                )`;
                employeeOverlapQuery += `${count > 0 ? ' OR NOT' : ' AND (NOT'} (
                    end_time <= '${newStart}' OR
                    start_time >= '${newEnd}'
                )`;
                customerOverlapQuery += `${count > 0 ? ' OR NOT' : ' AND (NOT'} (
                    ms.end_time <= '${newStart}' OR
                    ms.start_time >= '${newEnd}'
                )`;
                
                currentDate = newDate;
                count++;
            }
            console.log(repeatQuery);
        } else if (req.body.repeatType === "weeks") {
            let currentDate = moment(schedule[0].date).utc()
            let startDate = currentDate.clone();
            let count = 0;
            let index = 0;

            while(req.body.endType === "after" ? count <= req.body.endAfter : moment(currentDate).isSameOrBefore(endMoment)) {
                const weekStart = currentDate.clone().startOf('week');

                for (let day of req.body.daysOfWeek) {
                    let currentDay = weekStart.clone().day(day);
                    if (currentDay.isAfter(startDate) && (!endMoment || currentDay.isSameOrBefore(endMoment))) {
                        let newStart = computeOccurrenceDateTime(schedule[0].start_time, currentDay);
                        let newEnd = computeOccurrenceDateTime(schedule[0].end_time, currentDay);
                        repeatQuery += `('${currentDay.format('YYYY-MM-DD')}', '${newStart}', '${newEnd}', ${schedule[0].resource_id}, ${schedule[0].max_capacity}, ${schedule[0].notes ? `'${escapeApostrophes(schedule[0].notes)}'` : 'NULL'}, '${escapeApostrophes(schedule[0].schedule_name)}', '${escapeApostrophes(schedule[0].task_type)}', ${schedule[0].company_id}, ${schedule[0].created_by}),`;
                        overlapQuery += `${count > 0 && index > 0 ? ' OR NOT' : ' AND (NOT'} (
                            end_time <= '${newStart}' OR
                            start_time >= '${newEnd}'
                        )`;
                        employeeOverlapQuery += `${count > 0 && index > 0 ? ' OR NOT' : ' AND (NOT'} (
                            end_time <= '${newStart}' OR
                            start_time >= '${newEnd}'
                        )`;
                        customerOverlapQuery += `${count > 0 && index > 0 ? ' OR NOT' : ' AND (NOT'} (
                            ms.end_time <= '${newStart}' OR
                            ms.start_time >= '${newEnd}'
                        )`;
                        index++;
                        count++;
                    }
                }
                currentDate = weekStart.clone().add(req.body.repeat, 'weeks');
                console.log(currentDate.format('YYYY-MM-DD'));
            }
        }

        if (repeatQuery.length === repeatQueryBaseLength) {
            return res.status(400).json({ message: "No occurrences fall within the selected date range" });
        }

        if(overlapQuery.includes('AND (NOT')) {
            overlapQuery += ')';
        }

        employeeOverlapQuery += ')';
        if(employeeOverlapQuery.includes('AND (NOT')) {
            employeeOverlapQuery += ')';
        }

        if(customerOverlapQuery.includes('AND (NOT')) {
            customerOverlapQuery += ')';
        }

        if(!req.body.force) {
            let overlapSchedules = await DBSendResponse(overlapQuery);

            if (overlapSchedules.length > 0) {
                return res.status(400).json({ type: "overlap", message: "The Resource is already scheduled for one of the recurrence times" });
            }

            if(employee_ids.length > 0) {
                let employeeOverlapSchedules = await DBSendResponse(employeeOverlapQuery);

                console.log(employeeOverlapSchedules, employeeOverlapQuery);
                if (employeeOverlapSchedules.length > 0) {
                    return res.status(400).json({ type: "overlap", message: "An Employee is already scheduled for one of the recurrence times" });
                }
            }

            if(customer_ids.length > 0 && req.body.customer_ids.length > 0) {
                let customerOverlapSchedules = await DBSendResponse(customerOverlapQuery);

                if (customerOverlapSchedules.length > 0) {
                    // Gather distinct customer names (supports either cus_name or customer_name column naming)
                    const customerNames = [...new Set(customerOverlapSchedules.map(r => r.cus_name || r.customer_name).filter(Boolean))];
                    const plural = customerNames.length > 1;
                    const nameList = customerNames.join(', ');
                    return res.status(400).json({
                        type: "overlap",
                        customers: customerNames,
                        message: plural
                            ? `Customers ${nameList} are already scheduled for one of the recurrence times`
                            : `Customer ${nameList} is already scheduled for one of the recurrence times`
                    });
                }
            }
        }
    
        await transaction.begin(err => {
            if (err) {
                console.log(err);
                return res.status(500).json(err);
            }
            const request = new db.Request(transaction);
            request.query(repeatQuery.slice(0, -1), async (err, result) => {
                if (err) {
                    console.log(err);
                    try { await transaction.rollback(); } catch (e) {}
                    res.status(500).json(err);
                } else {
                    console.log(result)
                    const schedule_ids = result.recordset.map(record => record.schedule_id);
                    const allEmployeePairs = schedule_ids.flatMap(schedule_id =>
                        employee_ids.map(emp_id => `(${schedule_id}, ${emp_id.emp_id})`)
                    );
                    const linkQuery = chunkArray(allEmployeePairs, 1000)
                        .map(chunk => `INSERT INTO employee_schedule (schedule_id, emp_id) VALUES ${chunk.join(',')}`)
                        .join(';');
                    console.log(linkQuery);
                    request.query(linkQuery, async (err, result) => {
                        if (err) {
                            console.log(err);
                            try { await transaction.rollback(); } catch (e) {}
                            res.status(500).json(err);
                        } else {
                            const allSessionValues = schedule_ids.flatMap(schedule_id =>
                                customer_ids.map(cus_id => `(${schedule_id}, ${cus_id.customer_id}, ${cus_id.notes ? `'${escapeApostrophes(cus_id.notes)}'` : null})`)
                            );
                            const query = chunkArray(allSessionValues, 1000)
                                .map(chunk => `INSERT INTO sessions (schedule_id, customer_id, notes) VALUES ${chunk.join(',')}`)
                                .join(';') + '; SELECT SCOPE_IDENTITY();';
                            console.log(query);
                            if(customer_ids.length > 0) {
                                request.query(query, async (err, result) => {
                                    if (err) {
                                        console.log(err);
                                        try { await transaction.rollback(); } catch (e) {}
                                        res.status(500).json(err);
                                    } else {
                                        transaction.commit(async err => {
                                            if (err) {
                                                console.log(err);
                                                try { await transaction.rollback(); } catch (e) {}
                                                return res.status(500).json({ message: 'Error saving schedule changes' });
                                            }
                                            res.status(200).json({ message: "Recurrence created successfully" });
                                        });
                                    }
                                });
                            } else {
                                transaction.commit(async err => {
                                    if (err) {
                                        console.log(err);
                                        try { await transaction.rollback(); } catch (e) {}
                                        return res.status(500).json({ message: 'Error saving schedule changes' });
                                    }
                                    res.status(200).json({ message: "Recurrence created successfully" });
                                });
                            }
                        }
                    });
                }
            });
        }
        );
    }
    catch (error) {
        console.log(error);
        try { await transaction.rollback(); } catch (e) {}
        res.status(500).json(error);
    }
}

exports.getSchedulesForMobile = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        let dateFilter = '';
        if (startDate) dateFilter += ` AND ms.date >= '${startDate}'`;
        if (endDate) dateFilter += ` AND ms.date <= '${endDate}'`;

        const query = `
            SELECT *,
                (SELECT emp_id FROM employee_schedule es WHERE es.schedule_id = ms.schedule_id FOR JSON PATH) AS assigned_employees,
                (SELECT TOP 1 s.*, c.*, p.pro_id, t.*
                    FROM sessions s
                    JOIN customer c ON s.customer_id = c.cus_id
                    JOIN project p ON c.cus_id = p.pro_customer_id
                    LEFT JOIN task t ON s.task_id = t.tas_id
                    WHERE s.schedule_id = ms.schedule_id AND p.pro_is_active = 1
                    FOR JSON PATH
                ) AS sessionData
            FROM master_schedule ms
            LEFT JOIN resources r ON ms.resource_id = r.resource_id
            LEFT JOIN location l ON r.location_id = l.loc_id
            WHERE ms.company_id = ${req.params.id}${dateFilter}
        `;
        const results = await DBSendResponse(query);

        const schedules = results.map((res) => {
            res.assigned_employees = !res.assigned_employees ? [] : JSON.parse(res.assigned_employees);
            res.sessionData = !res.sessionData ? [] : JSON.parse(res.sessionData);
            return res;
        })

        return res.status(200).json(schedules);
    } catch (err) {
        console.log('QUERY FAILURE | getSchedulesForMobile Query Failed:')
        console.log(err)
        return res.status(400).json({
            message: 'An unexpected error occured',
        })
    }
};