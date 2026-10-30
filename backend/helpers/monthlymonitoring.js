const db = require('../models/indexSQL.js');
const path = require('path');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries');
const fs = require('fs');
const { getAssociatedEmployeesAPI, getEmployeeById } = require('./employees.js');
const moment = require('moment');
const e = require('express');
const { defaultLogger: log } = require('../logger');

exports.getData = async (req, res) => {
  if(req.params.id === undefined || req.params.id === null) {
    res.json();
    return;
  }


  const request = new db.Request();
  let data;
  try {
    const query = 'select * from monthlymonitoring where task_id=' +  req.params.id;
    const result = await request.query(query);
    data = Array.isArray(result.recordset) ? result.recordset : [];
  } catch (err) {
    console.log('/api/fieldworker/monthlymonitoring/:id GET ERROR: ', err);
    res.status(500).json({ code: 500, message: 'Error fetching Monthly Monitoring data' });
    return;
  }

  if(data.length === 0) {
    res.json([]);
    return;
  }

  return res.json(data);
};

exports.postData = async (req, res) => {
  req.log.info({ data: req.body.data }, 'Monthly Monitoring POST data');

  let query = `select m.created_on from monthlymonitoring m
		inner join task t on t.tas_id=m.task_id
		inner join project p on p.pro_id=t.tas_pro_id
		where p.pro_customer_id=${req.body.cus_id} and MONTH(m.created_on)=MONTH('${req.body.created_on}') and YEAR(m.created_on)=YEAR('${req.body.created_on}')
		and t.tas_is_active <> 2`;
  if(req.body.unique === true) {
    const data = await DBSendResponse(query);
    if(data?.length > 0) {
      console.log('Monthly Monitoring already exists for this customer');
      res.json({ message: 'Monthly Monitoring already exists for this customer', code: 400, data: data });
      return;
    } 
  }

  query = `select * from monthlymonitoring where task_id=${req.body.task_id}`;
  const data = await DBSendResponse(query);
  if(data?.length > 0) {
    console.log('Monthly Monitoring already exists for this task');
    res.json({ message: 'Monthly Monitoring already exists for this task', code: 400, data: data });
    return;
  }

  query = 'insert into monthlymonitoring(task_id, employee_id, data, status, submitted, approved, last_updated, mt_period, mt_type, comment, is_annual, loc16, submitted_on, initial_submission_date, created_on) values(' +
		'\'' + req.body.task_id + '\',' +
		'\'' + req.body.emp_id + '\',' +
    '\'' + req.body.data.replace(/'/g, '\'\'') + '\',' +
		'\'' + req.body.status + '\','  +
		'\'' + req.body.submitted + '\','  +
		'\'' + req.body.approved + '\','  +
		'CURRENT_TIMESTAMP,' + 
		'\'' + req.body.mt_period + '\','  +
		(req.body.mt_type ? '\'' + req.body.mt_type + '\'' : 'NULL') + ',' +
		'\'' + req.body.comment + '\','  +
    '\'' + req.body.is_annual + '\','  +
    '\'' + req.body.loc16 + '\','  +
	 (req.body.submitted_on ? '\'' + req.body.submitted_on + '\'' : 'NULL') + ',' +
	 (req.body.initial_submission_date ? '\'' + req.body.initial_submission_date + '\'' : 'NULL') + ',' +
		'' + (req.body.created_on ? '\'' + req.body.created_on + '\'' : 'CURRENT_TIMESTAMP') + ');SELECT SCOPE_IDENTITY();';

  const id = await DBinsertSendID(query);

  console.log(query);
  

  if (id) {
    res.json({ message: 'Add Artifact Success', mm_id: id, code: 200 });
  } else {
    res.json({ message: 'Add Artifact Failed', code: 500 });
  }
};

exports.putData = async (req, res) => {
  const start = performance.now();
  req.log.info({ data: req.body.data }, 'Monthly Monitoring PUT data');

  try {
    console.log(req.body);
    
    let submitted_on = req.body.submitted_on? '\'' + req.body.submitted_on + '\'' : req.body.submitted_on;
    let reviewed_on = req.body.reviewed_on? '\'' + req.body.reviewed_on + '\'' : req.body.reviewed_on;
    let initial_submission_date = req.body.initial_submission_date? '\'' + req.body.initial_submission_date + '\'' : req.body.initial_submission_date;

    const approvedInt = (req.body.approved === true || req.body.approved === 1 || req.body.approved === '1' || req.body.approved === 'true') ? 1 : 0;
    const submittedInt = (req.body.submitted === true || req.body.submitted === 1 || req.body.submitted === '1' || req.body.submitted === 'true') ? 1 : 0;
    const query = 'update monthlymonitoring set ' +
        'employee_id=\'' + req.body.emp_id + '\',' +
        'data=\'' + req.body.data.replace(/'/g, '\'\'')  + '\','  +
        'approved=CASE WHEN approved=1 THEN 1 ELSE ' + approvedInt + ' END,'  +
        'submitted=CASE WHEN submitted=1 THEN 1 ELSE ' + submittedInt + ' END,'  +
        'initial_submission_date=COALESCE(initial_submission_date,' + (initial_submission_date || 'NULL') + '),'  +
        'submitted_on=COALESCE(submitted_on,' + (submitted_on || 'NULL') + '),'  +
        'reviewed_on=' + reviewed_on + ','  +
        'comment=\'' + String(req.body.comment).replaceAll('\'','\'\'') + '\','  +
        'mt_type=' + (req.body.mt_type ? '\'' + req.body.mt_type + '\'' : 'NULL') + ',' +
        'is_annual=\'' + req.body.is_annual + '\','  +
        'loc16=\'' + req.body.loc16 + '\','  +
        'bulk_approved=\'' + (req.body.bulk_approved ? req.body.bulk_approved : false) + '\','  +
        'last_updated=CURRENT_TIMESTAMP where task_id=' + req.body.task_id + ';';

    // DBinsert(res, query);    
    const updatedArt = await DBUpdate(query);

    if (updatedArt) {
      res.json({ message: 'Update MT Success', code: 200 });
    } else {
      res.json({ message: 'Update MT Failed', code: 500 });
    }
    console.log(`/api/fieldworker/monthlymonitoring PUT TIMETAKEN: ${performance.now() - start} MS`);
  } catch (error) {
    console.log(`/api/fieldworker/monthlymonitoring PUT ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/monthlymonitoring PUT TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }

};

// Review (approve/reject) a Monthly Monitoring form.
// Updates the monthlymonitoring row (submitted/approved flags, comment, data, review dates)
// AND the linked task status in a SINGLE DB transaction so the two can never diverge.
// Previously these were done as two separate, non-atomic requests: if the second one failed
// the task could end up 'Approved' while the monthlymonitoring row stayed at its default
// submitted=0/approved=0 state.
exports.reviewMT = async (req, res) => {
  const start = performance.now();
  const sql = require('mssql');
  const transaction = new db.Transaction();

  try {
    const {
      task_id,
      emp_id,
      approved,
      submitted,
      comment,
      initial_submission_date,
      submitted_on,
      reviewed_on,
      mt_type,
      is_annual,
      loc16,
      bulk_approved,
      tas_mm_status,
    } = req.body;

    if (!task_id || !tas_mm_status) {
      return res.json({ code: 400, message: 'Missing required parameters: task_id and/or tas_mm_status' });
    }

    const approvedInt = (approved === true || approved === 1 || approved === '1' || approved === 'true') ? 1 : 0;
    const submittedInt = (submitted === true || submitted === 1 || submitted === '1' || submitted === 'true') ? 1 : 0;
    const submittedOnSql = submitted_on ? `'${submitted_on}'` : 'NULL';
    const reviewedOnSql = reviewed_on ? `'${reviewed_on}'` : 'NULL';
    const initialSubmissionDateSql = initial_submission_date ? `'${initial_submission_date}'` : 'NULL';
    const escapedComment = comment ? String(comment).replace(/'/g, "''") : '';

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = new db.Request(transaction);

    // -- 1. Update monthlymonitoring flags/content --
    // NOTE: intentionally does NOT touch the `data` column. The review dialog is a
    // read-only view of whatever the support coordinator already submitted; it must
    // never be able to overwrite the actual submitted content (a stale/empty `data`
    // value in the review dialog previously could silently wipe the real submission).
    const mmQuery = `
      UPDATE monthlymonitoring SET
        employee_id = '${emp_id}',
        approved = ${approvedInt},
        submitted = CASE WHEN submitted = 1 THEN 1 ELSE ${submittedInt} END,
        initial_submission_date = COALESCE(initial_submission_date, ${initialSubmissionDateSql}),
        submitted_on = COALESCE(submitted_on, ${submittedOnSql}),
        reviewed_on = ${reviewedOnSql},
        comment = '${escapedComment}',
        mt_type = ${mt_type ? `'${mt_type}'` : 'NULL'},
        is_annual = '${is_annual}',
        loc16 = '${loc16}',
        bulk_approved = '${bulk_approved || false}',
        last_updated = CURRENT_TIMESTAMP
      WHERE task_id = ${task_id};`;
    await request.query(mmQuery);

    // -- 2. Persist reviewer name/date entered by the manager (Section 11 Monthly / Section 16 Quarterly).
    // Uses JSON_MODIFY on just these two paths so the rest of the submitted `data` can never be overwritten.
    const { reviewer_name, reviewer_date } = req.body;
    if (reviewer_name || reviewer_date) {
      const section = mt_type === 'Quarterly' ? 'section_16' : 'section_11';
      const reviewerRequest = new db.Request(transaction);
      let dataExpr = 'data';
      if (reviewer_name) {
        reviewerRequest.input('reviewer_name', sql.NVarChar, String(reviewer_name));
        dataExpr = `JSON_MODIFY(${dataExpr}, '$.${section}.a.answer', @reviewer_name)`;
      }
      if (reviewer_date) {
        reviewerRequest.input('reviewer_date', sql.NVarChar, String(reviewer_date));
        dataExpr = `JSON_MODIFY(${dataExpr}, '$.${section}.b.answer', @reviewer_date)`;
      }
      reviewerRequest.input('reviewer_task_id', sql.Int, task_id);
      await reviewerRequest.query(`UPDATE monthlymonitoring SET data = ${dataExpr} WHERE task_id = @reviewer_task_id AND ISJSON(data) = 1;`);
    }

    // -- 3. Update the linked task status in the SAME transaction --
    const taskQuery = `UPDATE task SET tas_mm_status = '${tas_mm_status}' WHERE tas_id = ${task_id};`;
    await request.query(taskQuery);

    await transaction.commit();

    console.log(`/api/fieldworker/monthlymonitoring/review PUT TIMETAKEN: ${performance.now() - start} MS`);
    res.json({ code: 200, message: 'Review MT Success' });
  } catch (error) {
    try { await transaction.rollback(); } catch (_) { /* already rolled back */ }
    console.log(`/api/fieldworker/monthlymonitoring/review PUT ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    res.status(500).json({ code: 500, message: 'Error Reviewing MT', error: error.message });
  }
};

exports.saveWithTask = async (req, res) => {
  const start = performance.now();
  const transaction = new db.Transaction();

  req.log.info({ data: req.body.data }, 'Monthly Monitoring SAVE WITH TASK data');
  
  try {
    const { 
      task_id, 
      emp_id, 
      data, 
      submitted, 
      approved, 
      comment, 
      mt_period, 
      mt_type, 
      is_annual, 
      loc16,
      submitted_on,
      reviewed_on,
      initial_submission_date,
      bulk_approved,
      tas_mm_status,
      isNew, // flag to indicate if this is a new MT or update
      created_on,
      cus_id,
      unique
    } = req.body;

    const sql = require('mssql');

    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = new db.Request(transaction);

    let mm_id = null;
    
    // Escape data for SQL
    const escapedData = data.replace(/'/g, '\'\'');
    const escapedComment = comment ? String(comment).replace(/'/g, '\'\'') : '';
    
    if (isNew) {
      // Check if MT already exists for this task (primary check via task_id column)
      const existingCheck = await request.query(`SELECT * FROM monthlymonitoring WHERE task_id = ${task_id}`);
      if (existingCheck.recordset && existingCheck.recordset.length > 0) {
        await transaction.rollback();
        return res.json({ message: 'Monthly Monitoring already exists for this task', code: 400, data: existingCheck.recordset });
      }

      // Secondary safety check: look at the task's own tas_mm_id pointer.
      // This catches the case where an MM row exists for this task but its task_id column
      // is NULL or stale (e.g. created by an older code path), so the primary check above
      // returned zero rows. If the task already points to an approved (or submitted) MM via
      // tas_mm_id, we must not INSERT a new MM and silently re-link the task to a blank row —
      // that is exactly what caused the "approved task reset to default" bug.
      const taskLinkCheck = await request.query(`
        SELECT t.tas_mm_status, m.monthly_monitoring_id, m.task_id AS mm_task_id, m.submitted, m.approved
        FROM task t
        LEFT JOIN monthlymonitoring m ON t.tas_mm_id = m.monthly_monitoring_id
        WHERE t.tas_id = ${task_id}
      `);
      const linkedTask = taskLinkCheck.recordset[0];
      if (linkedTask?.monthly_monitoring_id) {
        // The task already has an MM row linked via tas_mm_id.
        if (linkedTask.tas_mm_status === 'Approved' || linkedTask.approved) {
          // Never replace an approved form with a blank INSERT.
          await transaction.rollback();
          return res.json({ message: 'Monthly Monitoring already exists for this task', code: 400, data: taskLinkCheck.recordset });
        }
        // The task points to an MM whose task_id column is wrong/null — repair it and
        // redirect the caller to use the UPDATE path instead.
        if (!linkedTask.mm_task_id || linkedTask.mm_task_id !== task_id) {
          await request.query(`UPDATE monthlymonitoring SET task_id = ${task_id} WHERE monthly_monitoring_id = ${linkedTask.monthly_monitoring_id}`);
        }
        await transaction.commit(); // commit the repair (if any) before returning the 400
        return res.json({ message: 'Monthly Monitoring already exists for this task', code: 400, data: taskLinkCheck.recordset });
      }

      // Check for unique constraint if requested
      if (unique && cus_id && created_on) {
        const uniqueCheck = await request.query(`
          SELECT m.created_on FROM monthlymonitoring m
          INNER JOIN task t ON t.tas_id = m.task_id
          INNER JOIN project p ON p.pro_id = t.tas_pro_id
          WHERE p.pro_customer_id = ${cus_id} 
          AND MONTH(m.created_on) = MONTH('${created_on}') 
          AND YEAR(m.created_on) = YEAR('${created_on}')
          AND t.tas_is_active <> 2
        `);
        if (uniqueCheck.recordset && uniqueCheck.recordset.length > 0) {
          await transaction.rollback();
          return res.json({ message: 'Monthly Monitoring already exists for this customer', code: 400, data: uniqueCheck.recordset });
        }
      }

      // Insert new monthlymonitoring record
      const insertQuery = `
        INSERT INTO monthlymonitoring(task_id, employee_id, data, status, submitted, approved, last_updated, mt_period, mt_type, comment, is_annual, loc16, submitted_on, initial_submission_date, created_on) 
        VALUES(
          ${task_id},
          '${emp_id}',
          '${escapedData}',
          'active',
          '${submitted}',
          '${approved}',
          CURRENT_TIMESTAMP,
          '${mt_period}',
          ${mt_type ? `'${mt_type}'` : 'NULL'},
          '${escapedComment}',
          '${is_annual}',
          '${loc16}',
          ${submitted_on ? `'${submitted_on}'` : 'NULL'},
          ${initial_submission_date ? `'${initial_submission_date}'` : 'NULL'},
          ${created_on ? `'${created_on}'` : 'CURRENT_TIMESTAMP'}
        );
        SELECT SCOPE_IDENTITY() AS mm_id;
      `;
      
      const insertResult = await request.query(insertQuery);
      mm_id = insertResult.recordset[0].mm_id;

      // Update task with new mm_id
      const updateTaskQuery = `UPDATE task SET tas_mm_id = ${mm_id} WHERE tas_id = ${task_id};`;
      await request.query(updateTaskQuery);

    } else {
      // Update existing monthlymonitoring record
      const submittedOnSql = submitted_on ? `'${submitted_on}'` : 'NULL';
      const reviewedOnSql = reviewed_on ? `'${reviewed_on}'` : 'NULL';
      const initialSubmissionDateSql = initial_submission_date ? `'${initial_submission_date}'` : 'NULL';
      const approvedInt = (approved === true || approved === 1 || approved === '1' || approved === 'true') ? 1 : 0;
      const submittedInt = (submitted === true || submitted === 1 || submitted === '1' || submitted === 'true') ? 1 : 0;

      const updateQuery = `
        UPDATE monthlymonitoring SET 
          employee_id = '${emp_id}',
          data = '${escapedData}',
          approved = CASE WHEN approved = 1 THEN 1 ELSE ${approvedInt} END,
          submitted = CASE WHEN submitted = 1 THEN 1 ELSE ${submittedInt} END,
          initial_submission_date = COALESCE(initial_submission_date, ${initialSubmissionDateSql}),
          submitted_on = COALESCE(submitted_on, ${submittedOnSql}),
          reviewed_on = ${reviewedOnSql},
          comment = '${escapedComment}',
          mt_type = ${mt_type ? `'${mt_type}'` : 'NULL'},
          is_annual = '${is_annual}',
          loc16 = '${loc16}',
          bulk_approved = '${bulk_approved || false}',
          last_updated = CURRENT_TIMESTAMP 
        WHERE task_id = ${task_id};
      `;
      
      await request.query(updateQuery);

      // Get the mm_id for the response
      const getMmIdQuery = `SELECT monthly_monitoring_id FROM monthlymonitoring WHERE task_id = ${task_id}`;
      const mmResult = await request.query(getMmIdQuery);
      mm_id = mmResult.recordset[0]?.monthly_monitoring_id;

      // Update task.tas_mm_id to ensure consistency
      if (mm_id) {
        const updateTaskMmIdQuery = `UPDATE task SET tas_mm_id = ${mm_id} WHERE tas_id = ${task_id};`;
        await request.query(updateTaskMmIdQuery);
      }
    }

    // Update task status if provided
    if (tas_mm_status) {
      const updateStatusQuery = `
        UPDATE task SET tas_mm_status = '${tas_mm_status}' 
        WHERE tas_id = ${task_id};
      `;
      await request.query(updateStatusQuery);
    }

    await transaction.commit();
    
    console.log(`/api/fieldworker/monthlymonitoring/save-with-task ${isNew ? 'POST' : 'PUT'} TIMETAKEN: ${performance.now() - start} MS`);
    
    res.json({ 
      message: isNew ? 'Add MT Success' : 'Update MT Success', 
      code: 200, 
      mm_id: mm_id 
    });

  } catch (error) {
    try { await transaction.rollback(); } catch (e) { /* ignore rollback errors */ }
    console.log(`/api/fieldworker/monthlymonitoring/save-with-task ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/monthlymonitoring/save-with-task TIMETAKEN: ${performance.now() - start} MS`);
    res.status(500).json({ error: 'Server error occurred', message: error.message, code: 500 });
  }
};

// get all mts from last x months
exports.prevMonthMT = async (req, res) => {
  const query = `select m.* from monthlymonitoring m INNER JOIN task t on t.tas_mm_id IS NOT NULL INNER JOIN project p on t.tas_pro_id=p.pro_id where 
  p.pro_customer_id=${req.query.cus_id} and m.task_id=t.tas_id and m.created_on >= DATEADD(month, -${req.query.months}, DATEADD(month, DATEDIFF(month, 0, '${req.query.created_on}'), 0))
  AND m.created_on < DATEADD(month, DATEDIFF(month, 0, '${req.query.created_on}'), 0) ORDER BY m.created_on DESC`;
  const response = await DBSendResponse(query);

  req.log.debug('prevMonthMT() Response: ' + response);
  
  res.json(response);
};

exports.prevQuarterlyAnnual = async (req, res) => {
  const query = `select top 1 m.* from monthlymonitoring m INNER JOIN task t on t.tas_mm_id IS NOT NULL INNER JOIN project p on t.tas_pro_id=p.pro_id 
  where p.pro_customer_id=${req.query.cus_id} and m.task_id=t.tas_id and created_on < DATEADD(DAY,1,EOMONTH('${req.query.created_on}',-1)) and m.mt_type='Quarterly' ORDER BY created_on DESC`;
  const response = await DBSendResponse(query);

  if(response.length === 0) {
    res.json();
    return;
  }
  res.json(response[0]);
};

exports.getFollowUpItems = async (req, res) => {
  const query = `select t.*, m.mt_period from task t
  INNER JOIN project p on t.tas_pro_id=p.pro_id
  INNER JOIN customer c on p.pro_customer_id=c.cus_id
  INNER JOIN monthlymonitoring m on t.tas_mm_id=m.monthly_monitoring_id
  where t.tas_mm_id is not null and t.tas_type='Checklist' and t.tas_is_active=1 and (t.checkin=0 or (t.checkin=1 and YEAR(m.created_on)=YEAR(DATEADD(month, -1, '${req.query.created_on}')) and MONTH(m.created_on)=MONTH(DATEADD(month, -1, '${req.query.created_on}'))))
  and c.cus_id=${req.params.id} and m.created_on < '${req.query.created_on}'`;
  let followUpItems = await DBSendResponse(query);

  res.json(followUpItems);
};

exports.deleteFollowUpItems = async (req, res) => {
  const query = `update task set tas_is_active=0 where tas_mm_id=${req.params.id} and tas_type='Checklist'`;

  const result = await DBUpdate(query);

  res.json({ code: 200, message: 'Delete Success' });
};

exports.postFollowUpItems = async (req, res) => {
  const transaction = new db.Transaction();

  console.log('Followup Debug Body:');
  console.log(JSON.stringify(req.body));
  


  
  
  try {
    await transaction.begin(err => {
      if (err) {
        console.log(err);
        return res.json({ code: 500, message: 'Error Failed to Create Follow up items' });
      }
      const request = new db.Request(transaction);
      request.query(`update task set tas_is_active=0 where tas_mm_id=${req.params.id} and tas_type='Checklist'`, async (err, result) => {
        if(err) {
          console.log(err);
          try { await transaction.rollback(); } catch (e) {}
          res.json({ code: 500, message: 'Error Failed to Delete Follow up items' });
        } else {
          let query = 'insert into task (tas_title, tas_description,tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time,tas_priority, ' +
          'tas_billable_by_default,tas_notes,tas_is_active,tas_created_at, tas_pro_id,tas_emp_id,tas_loc_id,tas_loc1_id,tas_loc2_id,tas_prequisites_task,tas_created_by,tas_com_id,tas_mm_id,tas_required_sig, task_emp_timezone, tas_cus_id) ' +
          'values(';
          req.body.items.forEach((item, index) => {
            console.log('Followup Debug Item:');
            console.log(JSON.stringify(item));
            query += '\'' + (item.tas_title?.replaceAll('\'', '\'\'') || 'NULL') + '\',' +
            '\'' + (item.tas_description?.replaceAll('\'', '\'\'') || 'NULL') + '\',' +
            '\'Checklist\',' +
            '\'' + item.tas_start_date + '\',' +
            '\'' + item.tas_end_date + '\',' +
            '\'' + item.tas_start_time + '\',' +
            '\'' + item.tas_end_time + '\',' +
            '\'Low\',' +
            '0,' +
            '\'' + item.tas_notes.replaceAll('\'', '\'\'') + '\',' +
            '1,' +
            'CURRENT_TIMESTAMP,' +
            item.tas_pro_id + ',' +
            item.emp_id + ',' +
            'NULL,' +
            'NULL,' +
            'NULL,' +
            'NULL,' +
            item.emp_id + ',' +
            item.comp_id + ',' +
            item.tas_mm_id + ',' +
            '0' + ',' +
            '\'' + (item.task_emp_timezone ? item.task_emp_timezone : 'NULL') + '\',' +
            (item.cus_id ? item.cus_id : 'NULL');
            if(index !== req.body.items.length - 1) {
              query += '),(';
            }
          });
          console.log(query);
          query += ');SELECT SCOPE_IDENTITY();';
          console.log(query);
          if(req.body.items.length === 0) {
            try { await transaction.rollback(); } catch (e) {}
            res.json({ code: 200, message: 'Create Success' });
          } else {
            request.query(query, async (err, result) => {
              if(err) {
                console.log(err);
                try { await transaction.rollback(); } catch (e) {}
                res.json({ code: 500, message: 'Error Failed to Create Follow up items' });
              } else {
                transaction.commit(async err => {
                    if (err) {
                        console.log(err);
                        try { await transaction.rollback(); } catch (e) {}
                        return res.json({ code: 500, message: 'Error Failed to Create Follow up items' });
                    }
                    res.json({ code: 200, message: 'Create Success' });
                });
              }
            });
          }
        }
      }
      );
    });
  } catch (err) {
    console.log(err);
    try { await transaction.rollback(); } catch (e) {}
    res.json({ code: 500, message: 'Error Failed to Create Follow up items' });
  }
};

exports.getTemplate = async (req, res) => {
  const start = performance.now();
  try {
    if(req.params.type === undefined || req.params.type === null) {
      res.json();
      return;
    }
  
    let filePath;
  
    if(req.params.type === 'monthly') {
      filePath = path.join(__dirname, '..', 'files', 'templates', 'SC-Monitoring-Tool-Monthly 0123.docx');
    } else if(req.params.type === 'quarterly') {
      filePath = path.join(__dirname, '..', 'files', 'templates', 'SC-Monitoring-Tool-Quarterly 0123.docx');
    } else {
      res.json();
      return;
    }
    console.log(`/api/fieldworker/monthlymonitoring/template GET TIMETAKEN: ${performance.now() - start} MS`);
    res.sendFile(filePath);
  } catch (error) {
    console.log(`/api/fieldworker/monthlymonitoring/template GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/monthlymonitoring/template GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};

exports.getManagerData = async (req, res) => {
  const start = performance.now();
  try {
    await getManagerDataLazy(req, res);
    console.log(`/api/fieldworker/monthlymonitoring/manager/data GET TIMETAKEN: ${performance.now() - start} MS`);
  } catch (error) {
    console.log(`/api/fieldworker/monthlymonitoring/manager/data GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/monthlymonitoring/manager/data GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};
  
async function getManagerDataLazy(req, res) {
  try {
    // Parse pagination parameters
    const paginationModel = req.query.paginationModel ? JSON.parse(req.query.paginationModel) : { page: 0, pageSize: 100 };
    const groupKeys = req.query.groupKeys ? JSON.parse(req.query.groupKeys) : [];
    const filterModel = req.query.filterModel ? JSON.parse(req.query.filterModel) : { items: [] };
    const sortModel = req.query.sortModel ? JSON.parse(req.query.sortModel) : [];

    const monthKey = typeof req.query.month === 'string' ? req.query.month : '';
    let monthFilterClause = '';
    const monthMatch = monthKey.match(/^month(\d{1,2})$/i);

    // Use client-provided 'end' date as the reference to avoid UTC vs local timezone mismatch
    // (e.g. user is EST at 9pm on March 31 → server UTC is already April 1)
    const refDate = req.query.end
      ? moment(req.query.end).startOf('month')
      : (req.query.start ? moment(req.query.start).add(2, 'months').startOf('month') : moment().startOf('month'));

    if (monthMatch) {
      const monthNumber = parseInt(monthMatch[1], 10);
      if (!Number.isNaN(monthNumber) && monthNumber >= 1 && monthNumber <= 12) {
        const offset = 12 - monthNumber;
        const targetMonth = refDate.clone().subtract(offset, 'months');
        const monthStart = targetMonth.clone().startOf('month').format('YYYY-MM-DD');
        const nextMonthStart = targetMonth.clone().add(1, 'month').startOf('month').format('YYYY-MM-DD');
        monthFilterClause = ` AND m2.created_on >= '${monthStart}' AND m2.created_on < '${nextMonthStart}'`;
      }
    }
    
    // Helper function to build filter conditions for WHERE clauses
    const buildFilterConditions = (filterModel, context = 'employee') => {
      if (!filterModel || !filterModel.items || filterModel.items.length === 0) {
        return '';
      }

      // Field mapping for filters - maps frontend column IDs to database expressions
      const getFieldExpression = (field, context) => {
        // Employee fields - available in employee context
        if (context === 'employee') {
          switch (field) {
          case 'emp_name':
          case 'name':
            return 'CONCAT(e.emp_first_name, \' \', e.emp_last_name)';
          case 'emp_first_name':
            return 'e.emp_first_name';
          case 'emp_last_name':
            return 'e.emp_last_name';
          case 'emp_email':
            return 'e.empEmail';
          case 'emp_phone':
            return 'e.emp_phone_number';
          case 'emp_id':
            return 'e.emp_id';
          case 'emp_status':
            return 'e.emp_status';
          case 'emp_join_date':
            return 'e.emp_join_date';
          case 'emp_type':
            return 'e.emp_type';
          case 'emp_level':
            return 'e.emp_level';
          case 'emp_designation':
            return 'e.emp_designation';
          case 'emp_company_id':
            return 'e.emp_company_id';
          case 'emp_manager_id':
            return 'e.emp_manager_id';
          case 'emp_local_id':
            return 'e.emp_local_id';
          default:
            return null;
          }
        }
        
        // Customer fields - available in customer context
        if (context === 'customer') {
          switch (field) {
          case 'customers':
          case 'cus_name':
            return 'c.cus_name';
          case 'cus_id':
            return 'c.cus_id';
          case 'ddd_id':
          case 'DDDID':
            return 'c.DDDID';
          case 'cus_first_name':
            return 'c.cus_first_name';
          case 'cus_last_name':
            return 'c.cus_last_name';
          case 'cus_email':
            return 'c.cus_email';
          case 'cus_phone':
            return 'c.cus_phone';
          case 'cus_address':
            return 'c.cus_address';
          case 'cus_acquired_date':
            return 'c.cus_acquired_date';
          case 'cus_status':
            return 'c.cus_status';
          case 'cus_type':
            return 'c.cus_type';
          case 'dob':
            return 'c.dob';
          case 'medicaid_id':
            return 'c.medicaid_id';
          case 'waiver_program':
            return 'c.waiver_program';
          case 'cus_age':
            return 'c.cus_age';
          case 'cus_local_id':
            return 'c.cus_local_id';
          case 'gender':
            return 'c.gender';
          case 'home_phone':
            return 'c.home_phone';
          case 'mobile':
            return 'c.mobile';
          case 'email':
            return 'c.email';
          case 'County':
            return 'c.County';
          case 'Race':
            return 'c.Race';
          case 'Ethnicity':
            return 'c.Ethnicity';
          case 'MedicaidEndDate':
            return 'c.MedicaidEndDate';
          case 'AgencyAssignDate':
            return 'c.AgencyAssignDate';
            // Project fields
          case 'service_plan':
          case 'active_plan_version':
            return 'p.active_plan_version';
          case 'program':
          case 'plan_program_name':
            return 'p.plan_program_name';
          case 'plan_approval_date':
            return 'p.plan_approval_date';
          case 'plan_start_date':
          case 'pro_starts_on':
            return 'p.pro_starts_on';
          case 'plan_end_date':
          case 'pro_ends_on':
            return 'p.pro_ends_on';
          case 'last_annual_visit':
          case 'LastAnnualVisitDate':
            return 'p.LastAnnualVisitDate';
          case 'last_mt_upload':
          case 'LastMMTUploadDate':
            return 'p.LastMMTUploadDate';
          case 'pro_id':
            return 'p.pro_id';
          case 'pro_title':
            return 'p.pro_title';
          case 'pro_customer_id':
            return 'p.pro_customer_id';
          case 'DDD_plan_id':
            return 'p.DDD_plan_id';
          case 'DDD_ID':
            return 'p.DDD_ID';
          case 'Program':
            return 'p.Program';
          case 'LastMCType':
            return 'p.LastMCType';
          case 'LastMCDate':
            return 'p.LastMCDate';
          case 'active_plan_startdate':
            return 'p.active_plan_startdate';
          case 'active_plan_duedate':
            return 'p.active_plan_duedate';
            // Special complex fields
          case 'mt_submission_date':
            return 'r.review_sort_date';
          case 'review_mt':
            return 'COALESCE(r.status_rank, 5)';
          case 'mt_period':
            return 'r.review_sort_date';
          case 'contact_details':
            return 'c.cus_phone';
          default:
            return null;
          }
        }
        
        return null;
      };

      // Determine which numeric fields need numeric comparison
      const isNumericField = (field) => {
        const numericFields = [
          'emp_id', 'cus_id', 'cus_age', 'emp_company_id', 'emp_manager_id', 'emp_local_id', 'cus_local_id',
          'pro_id', 'pro_customer_id', 'status_rank_for_sort'
        ];
        return numericFields.includes(field);
      };

      // Build filter conditions for each filter item
      const conditions = filterModel.items
        .map(item => {
          const { field, operator, value } = item;
                    
          // Get the database field expression
          const fieldExpr = getFieldExpression(field, context);
          if (!fieldExpr) {
            return null;
          }

          // Handle different operators
          let condition = null;
          const isNumeric = isNumericField(field);
          
          // Escape value to prevent SQL injection
          const escapeValue = (val) => {
            if (val === null || val === undefined) return 'NULL';
            if (isNumeric && !isNaN(parseFloat(val))) {
              return parseFloat(val);
            }
            return `'${String(val).replace(/'/g, '\'\'')}'`;
          };

          switch (operator) {
          case 'equals':
            condition = `${fieldExpr} = ${escapeValue(value)}`;
            break;
          case 'not':
            condition = `${fieldExpr} != ${escapeValue(value)}`;
            break;
          case 'contains':
            condition = `${fieldExpr} LIKE '%${String(value).replace(/'/g, '\'\'')}%'`;
            break;
          case 'startsWith':
            condition = `${fieldExpr} LIKE '${String(value).replace(/'/g, '\'\'')}%'`;
            break;
          case 'endsWith':
            condition = `${fieldExpr} LIKE '%${String(value).replace(/'/g, '\'\'')}'`;
            break;
          case 'isEmpty':
            condition = `(${fieldExpr} IS NULL OR ${fieldExpr} = '')`;
            break;
          case 'isNotEmpty':
            condition = `(${fieldExpr} IS NOT NULL AND ${fieldExpr} != '')`;
            break;
          case '>':
            if (isNumeric) {
              condition = `${fieldExpr} > ${escapeValue(value)}`;
            } else {
              condition = `${fieldExpr} > ${escapeValue(value)}`;
            }
            break;
          case '>=':
            if (isNumeric) {
              condition = `${fieldExpr} >= ${escapeValue(value)}`;
            } else {
              condition = `${fieldExpr} >= ${escapeValue(value)}`;
            }
            break;
          case '<':
            if (isNumeric) {
              condition = `${fieldExpr} < ${escapeValue(value)}`;
            } else {
              condition = `${fieldExpr} < ${escapeValue(value)}`;
            }
            break;
          case '<=':
            if (isNumeric) {
              condition = `${fieldExpr} <= ${escapeValue(value)}`;
            } else {
              condition = `${fieldExpr} <= ${escapeValue(value)}`;
            }
            break;
          default:
            return null;
          }
          
          return condition;
        })
        .filter(condition => condition !== null);

      // Combine conditions with AND/OR based on logicOperator (default to AND)
      const logicOperator = filterModel.logicOperator === 'or' ? 'OR' : 'AND';
      const result = conditions.length > 0 ? `AND (${conditions.join(` ${logicOperator} `)})` : '';
      
      //console.log(`Final filter conditions for ${context}:`, result);
      return result;
    };
    
    // Helper function to build ORDER BY clause
    const buildOrderByClause = (sortModel, context = 'employee') => {
      if (!sortModel || sortModel.length === 0) {
        return context === 'employee' ? 'ORDER BY e.emp_first_name, e.emp_last_name' : 'ORDER BY status_rank_for_sort ASC';
      }

      console.log('sortModel', sortModel);

      const orderClauses = [];

      sortModel.forEach(sort => {
        const { field, sort: direction } = sort;
        const sortDirection = direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        console.log('direction', direction);
        console.log('sortDirection', sortDirection);
        console.log('dbColumn1');

        // Map frontend field names to actual database columns
        let dbColumn;
        let secondaryClause = null;
        switch (field) {
        // Employee fields (from employee table) - available in both contexts
        case 'name':
        case 'emp_name':
          if (context === 'employee') {
            dbColumn = 'e.emp_first_name'; // For employee context, sort by employee name
          } else {
            dbColumn = 'c.cus_name'; // For customer context, sort by customer name
          }
          break;
        case 'emp_first_name':
          dbColumn = context === 'employee' ? 'e.emp_first_name' : null;
          break;
        case 'emp_last_name':
          dbColumn = context === 'employee' ? 'e.emp_last_name' : null;
          break;
        case 'emp_email':
          dbColumn = context === 'employee' ? 'e.empEmail' : null; // Only available in employee context with GROUP BY
          break;
        case 'emp_phone':
          dbColumn = context === 'employee' ? 'e.emp_phone_number' : null;
          break;
        case 'emp_id':
          dbColumn = context === 'employee' ? 'e.emp_id' : null;
          break;
        case 'emp_status':
          dbColumn = context === 'employee' ? 'e.emp_status' : null;
          break;
        case 'emp_join_date':
          dbColumn = context === 'employee' ? 'e.emp_join_date' : null;
          break;
        case 'emp_type':
          dbColumn = context === 'employee' ? 'e.emp_type' : null;
          break;
        case 'emp_level':
          dbColumn = context === 'employee' ? 'e.emp_level' : null;
          break;
        case 'emp_designation':
          dbColumn = context === 'employee' ? 'e.emp_designation' : null;
          break;
        case 'emp_company_id':
          dbColumn = context === 'employee' ? 'e.emp_company_id' : null;
          break;
        case 'emp_manager_id':
          dbColumn = context === 'employee' ? 'e.emp_manager_id' : null;
          break;
        case 'emp_local_id':
          dbColumn = context === 'employee' ? 'e.emp_local_id' : null;
          break;
            
          // Customer fields (from customer table) - only available in customer context
        case 'customers':
        case 'cus_name':
          dbColumn = context === 'customer' ? 'c.cus_name' : null;
          break;
        case 'cus_id':
          dbColumn = context === 'customer' ? 'c.cus_id' : null;
          break;
        case 'ddd_id':
        case 'DDDID':
          dbColumn = context === 'customer' ? 'c.DDDID' : null;
          break;
        case 'cus_first_name':
          dbColumn = context === 'customer' ? 'c.cus_first_name' : null;
          break;
        case 'cus_last_name':
          dbColumn = context === 'customer' ? 'c.cus_last_name' : null;
          break;
        case 'cus_email':
          dbColumn = context === 'customer' ? 'c.cus_email' : null;
          break;
        case 'cus_phone':
          dbColumn = context === 'customer' ? 'c.cus_phone' : null;
          break;
        case 'cus_address':
          dbColumn = context === 'customer' ? 'c.cus_address' : null;
          break;
        case 'cus_acquired_date':
          dbColumn = context === 'customer' ? 'c.cus_acquired_date' : null;
          break;
        case 'cus_status':
          dbColumn = context === 'customer' ? 'c.cus_status' : null;
          break;
        case 'cus_type':
          dbColumn = context === 'customer' ? 'c.cus_type' : null;
          break;
        case 'dob':
          dbColumn = context === 'customer' ? 'c.dob' : null;
          break;
        case 'medicaid_id':
          dbColumn = context === 'customer' ? 'c.medicaid_id' : null;
          break;
        case 'waiver_program':
          dbColumn = context === 'customer' ? 'c.waiver_program' : null;
          break;
        case 'cus_age':
          dbColumn = context === 'customer' ? 'c.cus_age' : null;
          break;
        case 'cus_local_id':
          dbColumn = context === 'customer' ? 'c.cus_local_id' : null;
          break;
        case 'gender':
          dbColumn = context === 'customer' ? 'c.gender' : null;
          break;
        case 'home_phone':
          dbColumn = context === 'customer' ? 'c.home_phone' : null;
          break;
        case 'mobile':
          dbColumn = context === 'customer' ? 'c.mobile' : null;
          break;
        case 'email':
          dbColumn = context === 'customer' ? 'c.email' : null;
          break;
        case 'County':
          dbColumn = context === 'customer' ? 'c.County' : null;
          break;
        case 'Race':
          dbColumn = context === 'customer' ? 'c.Race' : null;
          break;
        case 'Ethnicity':
          dbColumn = context === 'customer' ? 'c.Ethnicity' : null;
          break;
        case 'MedicaidEndDate':
          dbColumn = context === 'customer' ? 'c.MedicaidEndDate' : null;
          break;
        case 'AgencyAssignDate':
          dbColumn = context === 'customer' ? 'c.AgencyAssignDate' : null;
          break;
            
          // Project fields (from project table) - only available in customer context
        case 'service_plan':
        case 'active_plan_version':
          dbColumn = context === 'customer' ? 'p.active_plan_version' : null;
          break;
        case 'program':
        case 'plan_program_name':
          dbColumn = context === 'customer' ? 'p.plan_program_name' : null;
          break;
        case 'plan_approval_date':
          dbColumn = context === 'customer' ? 'p.plan_approval_date' : null;
          break;
        case 'plan_start_date':
        case 'pro_starts_on':
          dbColumn = context === 'customer' ? 'p.pro_starts_on' : null;
          break;
        case 'plan_end_date':
        case 'pro_ends_on':
          dbColumn = context === 'customer' ? 'p.pro_ends_on' : null;
          break;
        case 'last_annual_visit':
        case 'LastAnnualVisitDate':
          dbColumn = context === 'customer' ? 'p.LastAnnualVisitDate' : null;
          break;
        case 'last_mt_upload':
        case 'LastMMTUploadDate':
          dbColumn = context === 'customer' ? 'p.LastMMTUploadDate' : null;
          break;
        case 'pro_id':
          dbColumn = context === 'customer' ? 'p.pro_id' : null;
          break;
        case 'pro_title':
          dbColumn = context === 'customer' ? 'p.pro_title' : null;
          break;
        case 'pro_customer_id':
          dbColumn = context === 'customer' ? 'p.pro_customer_id' : null;
          break;
        case 'DDD_plan_id':
          dbColumn = context === 'customer' ? 'p.DDD_plan_id' : null;
          break;
        case 'DDD_ID':
          dbColumn = context === 'customer' ? 'p.DDD_ID' : null;
          break;
        case 'Program':
          dbColumn = context === 'customer' ? 'p.Program' : null;
          break;
        case 'LastMCType':
          dbColumn = context === 'customer' ? 'p.LastMCType' : null;
          break;
        case 'LastMCDate':
          dbColumn = context === 'customer' ? 'p.LastMCDate' : null;
          break;
        case 'active_plan_startdate':
          dbColumn = context === 'customer' ? 'p.active_plan_startdate' : null;
          break;
        case 'active_plan_duedate':
          dbColumn = context === 'customer' ? 'p.active_plan_duedate' : null;
          break;
          
          // Special complex fields - only available in customer context
        case 'mt_submission_date':
          // Sort using computed date from OUTER APPLY for consistency with review_mt
          dbColumn = context === 'customer' ? 'r.review_sort_date' : null;
          break;
        case 'review_mt':
          // Sort by most recent submission date regardless of review status
          if (context === 'customer') {
            dbColumn = 'status_rank_for_sort';
            secondaryClause = 'r.review_sort_date ASC';
          } else {
            dbColumn = null;
          }
          break;
        case 'mt_period':
          // Align mt_period sorting with review_mt chronological date
          dbColumn = context === 'customer' ? 'r.review_sort_date' : null;
          break;
        case 'contact_details':
          dbColumn = context === 'customer' ? 'c.cus_phone' : null;
          break;
            
          // Default fallback
        default:
          console.log(`Unknown sort field: ${field}, using default sort for context: ${context}`);
          return null;
        }
        
        // Handle special date formatting for SQL Server if needed
        if (dbColumn && (field.includes('date') || field.includes('Date') || 
            field === 'dob' || field === 'emp_join_date' || field === 'cus_acquired_date' ||
            field === 'MedicaidEndDate' || field === 'AgencyAssignDate' || field === 'LastMCDate' ||
            field === 'active_plan_startdate' || field === 'active_plan_duedate' || field === 'mt_submission_date' || field === 'review_mt' || field === 'mt_period')) {
          // Avoid wrapping with ISNULL for customer context to prevent DISTINCT ORDER BY errors
          if (context === 'employee') {
            dbColumn = `ISNULL(${dbColumn}, '1900-01-01')`;
          }
        }
        
        if (dbColumn) {
          orderClauses.push(`${dbColumn} ${sortDirection}`);
          if (secondaryClause) {
            orderClauses.push(secondaryClause);
          }
        }
      });
      
      return orderClauses.length > 0 ? `ORDER BY ${orderClauses.join(', ')}` : 
        (context === 'employee' ? 'ORDER BY e.emp_first_name, e.emp_last_name' : 'ORDER BY status_rank_for_sort ASC');
    };

    const parseJSONSafely = (value, fallback = []) => {
      if (value === null || value === undefined) {
        return Array.isArray(fallback) ? [...fallback] : fallback;
      }
      if (Array.isArray(value) || typeof value === 'object') {
        return value;
      }
      try {
        return JSON.parse(value);
      } catch (err) {
        return Array.isArray(fallback) ? [...fallback] : fallback;
      }
    };

    //console.log('buildOrderByClause(sortModel, \'employee\'):', buildOrderByClause(sortModel, 'employee'));

    // --- New: flat mode (ungrouped) ---
    if (req.query.mode === 'flat') {
      const page = paginationModel.page ?? 0;
      const pageSize = paginationModel.pageSize ?? 50;
      const offset = req.query.offset ? parseInt(req.query.offset) : page * pageSize;
      const limit = req.query.limit ? parseInt(req.query.limit) : pageSize;
      
      // Collect all managed employees (including self)
      let employees = await getAssociatedEmployeesAPI(req.query.emp_id);
      employees = employees.directlyManaged.concat(employees.hr_managed);
      const user = await getEmployeeById(req, res);
      if (employees.filter(emp => emp.emp_id === user[0]?.emp_id).length === 0) {
        employees.push(user[0]);
      }
      const validEmployees = employees.filter(emp => emp && emp.emp_id && typeof emp.emp_id === 'number');
      const employeeIds = validEmployees.map(emp => emp.emp_id).join(',');

      if (!employeeIds) {
        return res.json({ rows: [], rowCount: 0 });
      }

      // Count all distinct customers across these employees
      const filterConditions = buildFilterConditions(filterModel, 'customer');
      const totalCountQuery = `SELECT COUNT(DISTINCT c.cus_id) as total_count
        FROM projectEmployeeAssignment pea
        INNER JOIN project p ON pea.pea_pro_id = p.pro_id
        INNER JOIN customer c ON c.cus_id = p.pro_customer_id
        OUTER APPLY (
          SELECT TOP 1
            CASE
              WHEN t2.tas_mm_status = 'Waiting For Approval'  THEN 1
              WHEN t2.tas_mm_status = 'Approved' THEN 2
              WHEN t2.tas_mm_status = 'Rejected' THEN 3
              ELSE 4
            END AS status_rank
          FROM task t2
          INNER JOIN monthlymonitoring m2 ON t2.tas_id = m2.task_id
          WHERE t2.tas_pro_id = p.pro_id${monthFilterClause}
        ) r
        WHERE pea.pea_emp_id IN (${employeeIds})
          AND pea.pea_is_active = 1
          AND c.cus_is_active = 1
          AND (p.pro_is_active=1 OR ((p.pro_starts_on <= '1900-01-01' AND p.pro_ends_on = '1900-01-02') 
          OR (p.pro_starts_on IS NULL OR p.pro_ends_on IS NULL OR p.pro_starts_on <= '1900-01-01')))
          ${filterConditions}`;

      const totalResult = await DBSendResponse(totalCountQuery);
      const totalCount = totalResult[0]?.total_count || 0;

      // Fetch customers with computed review_sort_date and status rank for proper review_mt sorting
      const flatCustomersQuery = `SELECT DISTINCT c.cus_id, c.cus_name, c.DDDID, c.cus_first_name, c.cus_last_name, c.cus_email, c.cus_phone, c.dob, c.medicaid_id, c.waiver_program, c.cus_age,
        p.active_plan_version, p.LastAnnualVisitDate, p.LastMMTUploadDate, p.plan_program_name, p.plan_approval_date, p.pro_starts_on, p.pro_ends_on, p.pro_id,
        COALESCE(r.status_rank, 5) AS status_rank_for_sort, r.review_sort_date
        FROM projectEmployeeAssignment pea
        INNER JOIN project p ON pea.pea_pro_id = p.pro_id
        INNER JOIN customer c ON c.cus_id = p.pro_customer_id
        OUTER APPLY (
          SELECT TOP 1
            m2.submitted_on AS review_sort_date,
            CASE 
              WHEN t2.tas_mm_status = 'Waiting For Approval' THEN 1
              WHEN t2.tas_mm_status = 'Approved' THEN 2
              WHEN t2.tas_mm_status = 'Rejected' THEN 3
              ELSE 4
            END AS status_rank
          FROM task t2
          INNER JOIN monthlymonitoring m2 ON t2.tas_id = m2.task_id
          WHERE t2.tas_pro_id = p.pro_id${monthFilterClause}
        ) r
        WHERE pea.pea_emp_id IN (${employeeIds})
          AND pea.pea_is_active = 1
          AND c.cus_is_active = 1
          AND (p.pro_is_active=1 OR ((p.pro_starts_on <= '1900-01-01' AND p.pro_ends_on = '1900-01-02') 
          OR (p.pro_starts_on IS NULL OR p.pro_ends_on IS NULL OR p.pro_starts_on <= '1900-01-01')))
          ${filterConditions}
        ${buildOrderByClause(sortModel, 'customer')}
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

        

      const customers = await DBSendResponse(flatCustomersQuery);
      if (customers.length === 0) {
        return res.json({ rows: [], rowCount: totalCount });
      }

      // Fetch tasks for these customers across last 12 months
      const customerIds = customers.map(c => c.cus_id).join(',');
      const start12 = refDate.clone().subtract(11, 'months').format('YYYY-MM-DD');
      const endCurrent = refDate.clone().endOf('month').format('YYYY-MM-DDT23:59:59');

      const tasksQuery = `SELECT t.tas_id, tas_mm_status, t.tas_mm_id, tas_title, t.tas_type, e.empLocdaTe, e.checkoutEmpDate, m.submitted_on,
        l.loc_addr_line1 + ' ' + l.loc_addr_line2 + ', ' + l.loc_city + ', ' + l.loc_state + ' ' + l.loc_zip as address, m.initial_submission_date,
        c.cus_phone, p.pro_customer_id, m.employee_id, emp.emp_first_name + ' ' + emp.emp_last_name as emp_name, m.bulk_approved,
        COALESCE(mmAgg.monthlyMonitoring, '[]') AS monthlyMonitoring,
        COALESCE(locAgg.locInfo, '[]') AS locInfo
        FROM task t
        INNER JOIN project p on t.tas_pro_id=p.pro_id 
        LEFT JOIN monthlymonitoring m on t.tas_id=m.task_id 
        INNER JOIN empLocate e ON t.tas_id=e.taskId
        INNER JOIN location l on t.tas_loc_id=l.loc_id
        INNER JOIN customer c on p.pro_customer_id=c.cus_id
        INNER JOIN employee emp on emp.emp_id=e.empId
        OUTER APPLY (
          SELECT *
          FROM monthlymonitoring mm
          WHERE mm.task_id = t.tas_id
          FOR JSON PATH, INCLUDE_NULL_VALUES
        ) mmAgg(monthlyMonitoring)
        OUTER APPLY (
          SELECT *
          FROM location
          WHERE loc_id IN (t.tas_loc_id, t.tas_loc1_id, t.tas_loc2_id)
          FOR JSON PATH
        ) locAgg(locInfo)
        WHERE (e.checkoutEmpDate >= '${start12}' AND e.checkoutEmpDate <= '${endCurrent}')
          AND tas_type!='Checklist' AND emp.emp_company_id=${parseInt(req.query.comp_id)}
          AND t.tas_is_active <> 2 AND c.cus_is_active=1
          AND p.pro_customer_id IN (${customerIds})`;

      const allTasksRaw = await DBSendResponse(tasksQuery) || [];
      const allTasks = allTasksRaw.map(task => ({
        ...task,
        monthlyMonitoring: parseJSONSafely(task.monthlyMonitoring),
        locInfo: parseJSONSafely(task.locInfo)
      }));

      // Monthly monitoring records for future month computation (home/face-to-face visit cadence)
      // Use refDate instead of GETDATE() to avoid UTC vs local-timezone mismatch
      const futureRef1 = refDate.clone().subtract(10, 'months').format('YYYY-MM-DD');
      const futureRef2 = refDate.clone().subtract(9, 'months').format('YYYY-MM-DD');
      const futureRef3 = refDate.clone().subtract(8, 'months').format('YYYY-MM-DD');
      const monthlyMonitoringQuery = `select m.monthly_monitoring_id, m.data, created_on, p.pro_customer_id, p.LastAnnualVisitDate
        from monthlymonitoring m 
        inner join task t on t.tas_id=m.task_id 
        inner join project p on t.tas_pro_id=p.pro_id 
        where t.tas_mm_id IS NOT NULL and p.pro_customer_id in (${customerIds})
          AND (m.created_on >= '${futureRef1}' 
            OR m.created_on >= '${futureRef2}' 
            OR m.created_on >= '${futureRef3}')`;
      let allMonthlyMonitoring = await DBSendResponse(monthlyMonitoringQuery) || [];

      const rows = customers.map(customer => {
        const tasks = allTasks.filter(task => task.pro_customer_id === customer.cus_id);
        const filterTasksByMonth = (collection, m) => collection.filter(task => moment(task.checkoutEmpDate).isSame(refDate.clone().subtract(m, 'months'), 'month'));
        // Build 12 months
        const months = {};
        for (let i = 1; i <= 12; i++) {
          // month1 oldest (11 months ago) -> month12 current (0 months ago)
          months[`month${i}`] = filterTasksByMonth(tasks, 12 - i);
        }
        // Future month scheduling logic (mirrors customers SCH)
        let mts = allMonthlyMonitoring.filter(mt => mt.pro_customer_id === customer.cus_id);
        const filterMTSByType = (mtsArr, type) => mtsArr.filter(mt => { try { const data = JSON.parse(mt.data || '{}'); return data?.section_1?.m?.answer === type; } catch { return false; } });
        // Build future month visit expectations
        let futureMonth1, futureMonth2, futureMonth3 = [];
        if (customer.LastAnnualVisitDate !== null && customer.LastAnnualVisitDate !== undefined) {
          let monthsSinceLastHomeVisit = refDate.diff(moment(customer.LastAnnualVisitDate), 'months');
          if (monthsSinceLastHomeVisit < 11) futureMonth1 = ['Doesn\'t need a home visit']; else futureMonth1 = 'Home Visit';
          if (monthsSinceLastHomeVisit < 10) futureMonth2 = ['Doesn\'t need a home visit']; else futureMonth2 = 'Home Visit';
          if (monthsSinceLastHomeVisit < 9) futureMonth3 = ['Doesn\'t need a home visit']; else futureMonth3 = 'Home Visit';
        } else {
          futureMonth1 = 'Home Visit';
          futureMonth2 = 'Home Visit';
          futureMonth3 = 'Home Visit';
        }
        return {
          id: `cus_${customer.cus_id}`,
          cus_id: customer.cus_id,
          cus_name: customer.cus_name,
          DDDID: customer.DDDID,
          active_plan_version: customer.active_plan_version,
          LastAnnualVisitDate: customer.LastAnnualVisitDate,
          LastMMTUploadDate: customer.LastMMTUploadDate,
          plan_program_name: customer.plan_program_name,
          plan_approval_date: customer.plan_approval_date,
          pro_starts_on: customer.pro_starts_on,
          pro_ends_on: customer.pro_ends_on,
          pro_id: customer.pro_id,
          type: 'customer',
          ...months,
          futureMonth1,
          futureMonth2,
          futureMonth3
        };
      });


      

      return res.json({ rows, rowCount: totalCount });
    }

    let employees = await getAssociatedEmployeesAPI(req.query.emp_id);
    employees = employees.directlyManaged.concat(employees.hr_managed);

    const user = await getEmployeeById(req, res);
    if(employees.filter(emp => emp.emp_id === user[0]?.emp_id).length === 0) {
      employees.push(user[0]);
    }

    employees.sort((a, b) => {
      let nameA = a.emp_first_name.toUpperCase() + ' ' + a.emp_last_name.toUpperCase();
      let nameB = b.emp_first_name.toUpperCase() + ' ' + b.emp_last_name.toUpperCase();
      if (nameA < nameB) return -1;
      if (nameA > nameB) return 1;
      return 0;
    });

    // If no group keys, return root level (employees)
    if (groupKeys.length === 0) {
      const { page, pageSize } = paginationModel;
      const start = page * pageSize;
      
      // Get employees with their customer counts, only include those with customers, and filter only where emp_is_active == 1
      const validEmployees = employees.filter(emp => emp && emp.emp_id && typeof emp.emp_id === 'number' && emp.emp_is_active == 1);

      if (validEmployees.length === 0) {
        res.json({
          rows: [],
          rowCount: 0
        });
        return;
      }
      
      const employeeIds = validEmployees.map(emp => emp.emp_id).join(',');
      
      // Query to get only employees who have customers (more than 0 descendants)
      const employeeFilterConditions = buildFilterConditions(filterModel, 'employee');
      const customerCountQuery = `SELECT COUNT(DISTINCT c.cus_id) as customer_count, pea.pea_emp_id,
        e.emp_first_name, e.emp_last_name, e.empEmail, e.emp_phone_number, e.emp_company_id
        FROM projectEmployeeAssignment pea
        INNER JOIN project p ON pea.pea_pro_id = p.pro_id
        INNER JOIN customer c ON c.cus_id = p.pro_customer_id
        INNER JOIN employee e ON e.emp_id = pea.pea_emp_id
        WHERE pea.pea_emp_id IN (${employeeIds}) 
          AND pea.pea_is_active = 1 
          AND c.cus_is_active = 1
          AND (p.pro_is_active=1 OR ((p.pro_starts_on <= '1900-01-01' AND p.pro_ends_on = '1900-01-02') 
          OR (p.pro_starts_on IS NULL OR p.pro_ends_on IS NULL OR p.pro_starts_on <= '1900-01-01')))
          ${employeeFilterConditions}
        GROUP BY pea.pea_emp_id, e.emp_first_name, e.emp_last_name, e.empEmail, e.emp_phone_number, e.emp_company_id
        HAVING COUNT(DISTINCT c.cus_id) > 0
        ${buildOrderByClause(sortModel, 'employee')}`;

      const employeesWithCustomers = await DBSendResponse(customerCountQuery);
      
      // Apply pagination to the filtered employees
      const totalEmployees = employeesWithCustomers.length;
      const paginatedEmployees = employeesWithCustomers.slice(start, start + pageSize);

      const rows = paginatedEmployees.map(employeeData => {
        return {
          id: `emp_${employeeData.pea_emp_id}`,
          emp_id: employeeData.pea_emp_id,
          emp_first_name: employeeData.emp_first_name,
          emp_last_name: employeeData.emp_last_name,
          emp_name: `${employeeData.emp_first_name} ${employeeData.emp_last_name}`,
          type: 'employee',
          descendantCount: employeeData.customer_count,
          emp_email: employeeData.emp_email,
          emp_phone: employeeData.emp_phone,
          emp_company_id: employeeData.emp_company_id
        };
      });

      res.json({
        rows,
        rowCount: totalEmployees
      });
      return;
    }

    // If group keys exist, we're looking for customers under a specific employee
    if (groupKeys.length === 1) {
      const employeeKey = groupKeys[0];
      const employeeId = employeeKey.replace('emp_', '');
            
      // Validate employee ID
      if (!employeeId || isNaN(parseInt(employeeId))) {
        console.error('Invalid employee ID:', employeeId);
        return res.status(400).json({ error: 'Invalid employee ID' });
      }
      
      const { page, pageSize } = paginationModel;
      const start = page * pageSize;
      
      try {
        // Validate date parameters
        if (!req.query.start || !req.query.end) {
          console.error('Missing date parameters:', { start: req.query.start, end: req.query.end });
          return res.status(400).json({ error: 'Missing start or end date parameters' });
        }
        
        // First get the total count of customers for this employee
        const customerFilterConditions = buildFilterConditions(filterModel, 'customer');
        const countQuery = `SELECT COUNT(DISTINCT c.cus_id) as total_count
          FROM projectEmployeeAssignment pea
          INNER JOIN project p ON pea.pea_pro_id = p.pro_id
          INNER JOIN customer c ON c.cus_id = p.pro_customer_id
          INNER JOIN employee e ON e.emp_id = pea.pea_emp_id
          OUTER APPLY (
            SELECT TOP 1
              CASE 
                WHEN t2.tas_mm_status = 'Waiting For Approval' THEN 1
                WHEN t2.tas_mm_status = 'Approved' THEN 2
                WHEN t2.tas_mm_status = 'Rejected' THEN 3
                ELSE 4
              END AS status_rank
            FROM task t2
            INNER JOIN monthlymonitoring m2 ON t2.tas_id = m2.task_id
              WHERE t2.tas_pro_id = p.pro_id${monthFilterClause}
          ) r
          WHERE pea.pea_emp_id = ${parseInt(employeeId)} 
            AND pea.pea_is_active = 1 
            AND c.cus_is_active = 1
            AND (p.pro_is_active=1 OR ((p.pro_starts_on <= '1900-01-01' AND p.pro_ends_on = '1900-01-02') 
            OR (p.pro_starts_on IS NULL OR p.pro_ends_on IS NULL OR p.pro_starts_on <= '1900-01-01')))
            ${customerFilterConditions}`;

        const countResult = await DBSendResponse(countQuery);
        const totalCount = countResult[0]?.total_count || 0;

        // Get customers for this employee with pagination
        const query1 = `SELECT DISTINCT c.cus_id, c.cus_name, c.DDDID, c.cus_first_name, c.cus_last_name, c.cus_email, c.cus_phone, c.dob, c.medicaid_id, c.waiver_program, c.cus_age,
          p.active_plan_version, p.LastAnnualVisitDate, p.LastMMTUploadDate, p.plan_program_name, p.plan_approval_date, p.pro_starts_on, p.pro_ends_on, p.pro_id, 
          pea.pea_emp_id, e.emp_first_name, e.emp_last_name, e.empEmail, e.emp_phone_number, COALESCE(r.status_rank, 5) AS status_rank_for_sort, r.review_sort_date
          FROM projectEmployeeAssignment pea
          INNER JOIN project p ON pea.pea_pro_id = p.pro_id
          INNER JOIN customer c ON c.cus_id = p.pro_customer_id
          INNER JOIN employee e ON e.emp_id = pea.pea_emp_id
          OUTER APPLY (
            SELECT TOP 1
              m2.submitted_on AS review_sort_date,
              CASE 
                WHEN t2.tas_mm_status = 'Waiting For Approval' THEN 1
                WHEN t2.tas_mm_status = 'Approved' THEN 2
                WHEN t2.tas_mm_status = 'Rejected' THEN 3
                ELSE 4
              END AS status_rank
            FROM task t2
            INNER JOIN monthlymonitoring m2 ON t2.tas_id = m2.task_id
              WHERE t2.tas_pro_id = p.pro_id${monthFilterClause}
          ) r
          WHERE pea.pea_emp_id = ${parseInt(employeeId)} 
            AND pea.pea_is_active = 1 
            AND c.cus_is_active = 1
            AND (p.pro_is_active=1 OR ((p.pro_starts_on <= '1900-01-01' AND p.pro_ends_on = '1900-01-02') 
            OR (p.pro_starts_on IS NULL OR p.pro_ends_on IS NULL OR p.pro_starts_on <= '1900-01-01')))
            ${customerFilterConditions}
          ${buildOrderByClause(sortModel, 'customer')}
          OFFSET ${start} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;

        const customers = await DBSendResponse(query1);

        if (customers.length === 0) {
          res.json({
            rows: [],
            rowCount: 0
          });
          return;
        }

        // Get tasks for these customers
        const customerIds = customers.map(c => c.cus_id).join(',');
        
        if (!customerIds) {
          res.json({
            rows: customers.map(customer => ({
              id: `cus_${customer.cus_id}`,
              cus_id: customer.cus_id,
              cus_name: customer.cus_name,
              emp_name: `${customer.emp_first_name} ${customer.emp_last_name}`,
              DDDID: customer.DDDID,
              active_plan_version: customer.active_plan_version,
              LastAnnualVisitDate: customer.LastAnnualVisitDate,
              LastMMTUploadDate: customer.LastMMTUploadDate,
              plan_program_name: customer.plan_program_name,
              plan_approval_date: customer.plan_approval_date,
              pro_starts_on: customer.pro_starts_on,
              pro_ends_on: customer.pro_ends_on,
              pro_id: customer.pro_id,
              type: 'customer',
              month1: [],
              month2: [],
              month3: [],
              parent_id: employeeKey
            })),
            rowCount: totalCount
          });
          return;
        }
        
        const start12 = refDate.clone().subtract(11, 'months').format('YYYY-MM-DD');
        const endCurrent = refDate.clone().endOf('month').format('YYYY-MM-DDT23:59:59');
        const query2 = `SELECT t.tas_id, tas_mm_status, t.tas_mm_id, tas_title, t.tas_type, e.empLocdaTe, e.checkoutEmpDate, m.submitted_on, 
          l.loc_addr_line1 + ' ' + l.loc_addr_line2 + ', ' + l.loc_city + ', ' + l.loc_state + ' ' + l.loc_zip as address, m.initial_submission_date,
          c.cus_phone, p.pro_customer_id, m.employee_id, emp.emp_first_name + ' ' + emp.emp_last_name as emp_name, m.bulk_approved,
          COALESCE(mmAgg.monthlyMonitoring, '[]') AS monthlyMonitoring,
          COALESCE(locAgg.locInfo, '[]') AS locInfo
          FROM task t
            INNER JOIN project p on t.tas_pro_id=p.pro_id 
            LEFT JOIN monthlymonitoring m on t.tas_id=m.task_id 
            INNER JOIN empLocate e ON t.tas_id=e.taskId
            INNER JOIN location l on t.tas_loc_id=l.loc_id
            INNER JOIN customer c on p.pro_customer_id=c.cus_id
            INNER JOIN employee emp on emp.emp_id=e.empId
            OUTER APPLY (
              SELECT *
              FROM monthlymonitoring mm
              WHERE mm.task_id = t.tas_id
              FOR JSON PATH
            ) mmAgg(monthlyMonitoring)
            OUTER APPLY (
              SELECT *
              FROM location
              WHERE loc_id IN (t.tas_loc_id, t.tas_loc1_id, t.tas_loc2_id)
              FOR JSON PATH
            ) locAgg(locInfo)
          WHERE (e.checkoutEmpDate >= '${start12}' AND e.checkoutEmpDate <= '${endCurrent}') 
            AND tas_type!='Checklist' AND emp.emp_company_id=${parseInt(req.query.comp_id)} 
            AND t.tas_is_active <> 2 AND c.cus_is_active=1 
            AND p.pro_customer_id IN (${customerIds})`;

        const allTasksRaw = await DBSendResponse(query2) || [];
        const allTasks = allTasksRaw.map(task => ({
          ...task,
          monthlyMonitoring: parseJSONSafely(task.monthlyMonitoring),
          locInfo: parseJSONSafely(task.locInfo)
        }));

        // Use refDate instead of GETDATE() to avoid UTC vs local-timezone mismatch
        const futureRef1 = refDate.clone().subtract(10, 'months').format('YYYY-MM-DD');
        const futureRef2 = refDate.clone().subtract(9, 'months').format('YYYY-MM-DD');
        const futureRef3 = refDate.clone().subtract(8, 'months').format('YYYY-MM-DD');
        const monthlyMonitoringQuery = `select m.monthly_monitoring_id, m.data, created_on, p.pro_customer_id, p.LastAnnualVisitDate
          from monthlymonitoring m 
          inner join task t on t.tas_id=m.task_id 
          inner join project p on t.tas_pro_id=p.pro_id 
          where t.tas_mm_id IS NOT NULL and p.pro_customer_id in (${customerIds})
            AND (m.created_on >= '${futureRef1}' 
              OR m.created_on >= '${futureRef2}' 
              OR m.created_on >= '${futureRef3}')`;
        let allMonthlyMonitoring = await DBSendResponse(monthlyMonitoringQuery) || [];

        // Process customers with their tasks (12 months)
        const rows = customers.map(customer => {
          const tasks = allTasks.filter(task => task.pro_customer_id === customer.cus_id);
          const filterTasksByMonth = (collection, m) => collection.filter(task => moment(task.checkoutEmpDate).isSame(refDate.clone().subtract(m, 'months'), 'month'));
          const months = {};
          for (let i = 1; i <= 12; i++) {
            months[`month${i}`] = filterTasksByMonth(tasks, 12 - i);
          }
          // Future months (simplified – mirrors SCH logic for availability strings)
          let futureMonth1 = 'Home Visit';
          let futureMonth2 = 'Home Visit';
          let futureMonth3 = 'Home Visit';
          if (customer.LastAnnualVisitDate) {
            let monthsSinceLastHomeVisit = refDate.diff(moment(customer.LastAnnualVisitDate), 'months');
            if (monthsSinceLastHomeVisit < 11) futureMonth1 = ['Doesn\'t need a home visit']; else futureMonth1 = 'Home Visit';
            if (monthsSinceLastHomeVisit < 10) futureMonth2 = ['Doesn\'t need a home visit']; else futureMonth2 = 'Home Visit';
            if (monthsSinceLastHomeVisit < 9) futureMonth3 = ['Doesn\'t need a home visit']; else futureMonth3 = 'Home Visit';
          }
          return {
            id: `cus_${customer.cus_id}`,
            cus_id: customer.cus_id,
            cus_name: customer.cus_name,
            emp_name: `${customer.emp_first_name} ${customer.emp_last_name}`,
            DDDID: customer.DDDID,
            active_plan_version: customer.active_plan_version,
            LastAnnualVisitDate: customer.LastAnnualVisitDate,
            LastMMTUploadDate: customer.LastMMTUploadDate,
            plan_program_name: customer.plan_program_name,
            plan_approval_date: customer.plan_approval_date,
            pro_starts_on: customer.pro_starts_on,
            pro_ends_on: customer.pro_ends_on,
            pro_id: customer.pro_id,
            type: 'customer',
            parent_id: employeeKey,
            ...months,
            futureMonth1,
            futureMonth2,
            futureMonth3
          };
        });

        res.json({ rows, rowCount: totalCount });
        return;
        
      } catch (error) {
        console.error('Error in customer query:', error);
        throw error;
      }
    }

    // If we get here, return empty result
    res.json({
      rows: [],
      rowCount: 0
    });

  } catch (error) {
    console.log('Error in getManagerDataLazy:', error);
    res.status(500).json({ 
      error: 'Server error occurred while fetching data', 
      message: error.message,
      retryable: true // Indicates this request can be retried
    });
  }
  
  // [FILTERING IMPLEMENTATION COMPLETE]
  // Added comprehensive server-side filtering support to getManagerDataLazy function
  // 
  // Features implemented:
  // - buildFilterConditions helper function with context-aware field mapping
  // - Support for 12+ filter operators: equals, not, contains, startsWith, endsWith, isEmpty, isNotEmpty, >, >=, <, <=
  // - Field mapping for both employee and customer contexts with proper database column references
  // - Type-aware filtering (numeric vs string fields) with appropriate SQL generation
  // - SQL injection protection through value escaping and parameter validation
  // - Applied to all query types: flat mode customers, employee lists, and customer lists under employees
  // - Comprehensive logging for debugging filter application and performance monitoring
  // - Integration with existing sorting and pagination functionality
  //
  // Filter contexts supported:
  // - Employee context: emp_name, emp_first_name, emp_last_name, emp_email, emp_phone, emp_id, etc.
  // - Customer context: cus_name, cus_id, DDDID, plan fields, review_mt status, contact_details, etc.
  // - Special fields: review_mt (status-based), mt_submission_date, complex date fields
  //
  // Security features:
  // - Field whitelisting through getFieldExpression function
  // - SQL injection prevention via escapeValue function
  // - Input validation for numeric fields
  // - Safe parameter handling for all filter operations
}
      
exports.getAllCustomerMTs = async (req, res) => {
  const query = `SELECT m.monthly_monitoring_id, m.data, m.last_updated, m.mt_type, c.cus_name 
      FROM projectEmployeeAssignment pea
      INNER JOIN project p
          ON pea.pea_pro_id = p.pro_id
      INNER JOIN customer c
          ON c.cus_id = p.pro_customer_id
      INNER JOIN task t
          ON t.tas_pro_id = p.pro_id
      INNER JOIN monthlymonitoring m
          ON m.task_id = t.tas_id
        INNER JOIN employee e
          ON e.emp_id = pea.pea_emp_id
      WHERE pea.pea_emp_id = ${req.params.id} AND p.pro_is_active=1 AND c.cus_is_active=1 AND m.approved=1 AND e.emp_company_id = ${req.query.comp_id} AND pea.pea_is_active=1 AND t.tas_is_active <> 2 AND
      m.created_on >= '${req.query.created_on}' AND m.created_on < DATEADD(month, 1, '${req.query.created_on}')`;

  const mts = await DBSendResponse(query);

  res.json(mts);
};

exports.getAllManagerMTs = async (req, res) => {
  req.query.emp_id = req.params.id;

  let employees = await getAssociatedEmployeesAPI(req.query.emp_id);

  employees = employees.directlyManaged.concat(employees.hr_managed);

  const user = await getEmployeeById(req, res);

  if(employees.filter(emp => emp.emp_id === user[0]?.emp_id).length === 0) {
    employees.push(user[0]);
  }

  const query = `SELECT m.monthly_monitoring_id, m.data, m.last_updated, m.mt_type, c.cus_name 
    FROM projectEmployeeAssignment pea
    INNER JOIN project p
        ON pea.pea_pro_id = p.pro_id
    INNER JOIN customer c
        ON c.cus_id = p.pro_customer_id
    INNER JOIN task t
        ON t.tas_pro_id = p.pro_id
    INNER JOIN monthlymonitoring m
        ON m.task_id = t.tas_id
    INNER JOIN employee e
        ON e.emp_id = pea.pea_emp_id
    WHERE p.pro_is_active=1 and c.cus_is_active=1 AND m.approved=1 AND e.emp_company_id = ${req.query.comp_id} AND pea.pea_is_active=1 AND t.tas_is_active <> 2 AND
    m.created_on >= '${req.query.created_on}' AND m.created_on < DATEADD(month, 1, '${req.query.created_on}') AND pea.pea_emp_id IN (${employees.map(emp => emp.emp_id).join(',')})`;

  const mts = await DBSendResponse(query);

  res.json(mts);
};


exports.initiateMT = async (req, res) => {
  const sql = require('mssql');

  const transaction = new db.Transaction();
  console.log(req.body);

  try {
    // Use SERIALIZABLE isolation so two concurrent requests for the same
    // customer/month cannot both pass the duplicate check before either commits.
    await transaction.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);
    const request = new db.Request(transaction);

    // -- 1. Duplicate check FIRST (before creating any rows) --
    const dupeQuery = `select m.created_on from monthlymonitoring m
      inner join task t on t.tas_id=m.task_id
      inner join project p on p.pro_id=t.tas_pro_id
      where p.pro_customer_id=${req.body.cus_id} and MONTH(m.created_on)=MONTH('${req.body.created_on}') and YEAR(m.created_on)=YEAR('${req.body.created_on}')
      and t.tas_is_active <> 2`;

    const dupeResult = await request.query(dupeQuery);
    if (dupeResult.recordset.length > 0) {
      await transaction.rollback();
      return res.json({ code: 400, message: 'Monthly Monitoring already exists for this customer' });
    }

    // -- 2. Insert task --
    let taskQuery = 'insert into task (tas_title, tas_description,tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time,tas_priority, ' +
    'tas_billable_by_default,tas_notes,tas_is_active,tas_created_at, tas_pro_id,tas_emp_id,tas_loc_id,tas_loc1_id,tas_loc2_id,tas_prequisites_task,tas_created_by,tas_com_id,tas_mm_id,tas_required_sig, task_emp_timezone, tas_cus_id) ' +
    'values(';
    taskQuery += '\'' + req.body.tas_title + '\',' +
    '\'Time Sheet Entry\',' +
    '\'Phone Call\',' +
    '\'' + req.body.tas_start_date + '\',' +
    '\'' + req.body.tas_end_date + '\',' +
    '\'' + req.body.tas_start_time + '\',' +
    '\'' + req.body.tas_end_time + '\',' +
    '\'Low\',' +
    req.body.tas_billable_by_default + ',' +
    '\'N/A\',' +
    '1,' +
    'CURRENT_TIMESTAMP,' +
    req.body.tas_pro_id + ',' +
    req.body.emp_id + ',' +
    req.body.loc_id + ',' +
    'NULL,' +
    'NULL,' +
    'NULL,' +
    req.body.emp_id + ',' +
    req.body.comp_id + ',' +
    '0,' +
    '0' + ',' +
    (req.body.task_emp_timezone ? `'${req.body.task_emp_timezone}'` : 'NULL') + ',' +
    (req.body.cus_id ? req.body.cus_id : 'NULL');
    taskQuery += ');SELECT SCOPE_IDENTITY();';
    console.log(taskQuery);

    const taskResult = await request.query(taskQuery);
    const taskId = taskResult.recordset[0][''];

    // -- 3. Insert empLocate --
    const empLocQuery = 'INSERT INTO empLocate (projId, empId, taskId, locId, emploc_lat, emploc_lon, empLocdate, checkoutEmpDate, timesheet_status, empLocate_timezone) ' +
    'VALUES (' + req.body.tas_pro_id + ',' + req.body.emp_id + ',' + taskId + ',' + req.body.loc_id + ',' + req.body.emploc_lat + ',' + req.body.emploc_lon + ',' + '\'' + req.body.tas_start_time + '\',' + '\'' + req.body.tas_end_time + '\',1,' + '\'' + req.body.empLocate_timezone + '\'' + '); SELECT SCOPE_IDENTITY();';
    await request.query(empLocQuery);

    // -- 4. Insert monthlymonitoring --
    const mmQuery = 'insert into monthlymonitoring(task_id, employee_id, data, submitted, approved, last_updated, mt_period, mt_type, comment, is_annual, loc16, submitted_on, created_on) values (' +
    taskId + ',' +
    req.body.emp_id + ',' +
    '\'' + req.body.data.replace(/'/g, '\'\'') + '\',' +
    '0,' +
    '0,' +
    'CURRENT_TIMESTAMP,' +
    '\'' + req.body.mt_period + '\',' +
    '\'\',' +
    '\'\',' +
    '0,' +
    '0,' +
    'NULL,' +
    '\'' + req.body.created_on + '\'' + ');SELECT SCOPE_IDENTITY();';

    const mmResult = await request.query(mmQuery);
    const mmId = mmResult.recordset[0][''];

    // -- 5. Link task to monthlymonitoring --
    await request.query('update task set tas_mm_id=' + mmId + ' where tas_id=' + taskId + ';');

    await transaction.commit();
    res.json({ code: 200, message: 'Initiate MT Success', id: taskId });
  }
  catch(err) {
    console.log(err);
    try { await transaction.rollback(); } catch (_) { /* already rolled back */ }
    res.json({ code: 400, message: 'Error Initiating MT' });
  }
};
exports.downloaded = async (req, res) => {
  const query = `update monthlymonitoring set downloaded=1, last_download_date=CURRENT_TIMESTAMP where monthly_monitoring_id=${req.params.id}`;
  let result;
  try {
    result = await DBUpdate(query);
  } catch (err) {
    console.log(err);
    res.json({ code: 500, message: 'Error Updating Downloaded' });
  }

  if(result) {
    res.json({ code: 200, message: 'Update Success' });
  } else {
    res.json({ code: 500, message: 'Error Updating Downloaded' });
  }
};

exports.getAllForCustomer = async (req, res) => {
  if (!req.params.cus_id) {
    res.status(400).json({ error: 'cus_id parameter is required' });
    return;
  }
  const query = `
    SELECT m.*, t.*
    FROM monthlymonitoring m
    INNER JOIN task t ON m.task_id = t.tas_id
    INNER JOIN project p ON t.tas_pro_id = p.pro_id
    WHERE p.pro_customer_id = ${req.params.cus_id}
      AND p.pro_is_active = 1
    ORDER BY m.created_on DESC
  `;
  try {
    const records = await DBSendResponse(query);
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch records', details: err.message });
  }
};

exports.bulkUpdateData = async (req, res) => {
  try {
    const { task_ids } = req.body;
    if (!Array.isArray(task_ids) || task_ids.length === 0) {
      res.status(400).json({ message: 'No task_ids provided', code: 400 });
      return;
    }
    const ids = task_ids.join(',');
    const query = `update monthlymonitoring set approved = 1, submitted = 1, bulk_approved = 1, last_updated = CURRENT_TIMESTAMP, reviewed_on = CURRENT_TIMESTAMP where task_id in (${ids})`;
    const result = await DBUpdate(query);
    if (result) {
      res.json({ message: 'Bulk Update Success', code: 200 });
    } else {
      res.status(500).json({ message: 'Bulk Update Failed', code: 500 });
    }
  } catch (error) {
    console.error('Bulk Update Error:', error);
    res.status(500).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};
