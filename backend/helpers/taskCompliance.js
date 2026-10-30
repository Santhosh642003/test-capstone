// ---------------------------------------------------------------------------
// Task-level compliance facts (Scenario 3 -- missing actions / compliance gaps).
//
// Answers one question for a set of tasks: "is this task justified?", where the
// rule depends on the company's primary business type --
//
//   Support Coordination (101) : an approved MT (monthlymonitoring) for the task.
//   Everyone else              : every form mandated for the task's type
//                                (task_form) has a submission (customer_form).
//
// It also carries the unit arithmetic, because "the narrative justifies the
// units billed" is only checkable once somebody has computed the units. That
// maths must never be left to the model, and it must not be written a third
// time: the SQL copy lives in helpers/preAuth.js:312-347 and the JS copy at
// :652, and unitsForTasks below is the shared version those describe.
//
// Used by helpers/elliq.js (to render the facts into markdown) and by
// helpers/complianceGaps.js (to decide, deterministically, what is a gap).
// Both callers share this module so a verdict cannot drift between what the
// index says and what the API says.
// ---------------------------------------------------------------------------

const { DBSendResponseParam } = require('../queries/commonQueries');

// settings.feature_id when settings.feature_value = 'primaryBusinessType'.
// 101 Support Coordination, 102 Service Provider, 103 Home Healthcare,
// 104 Case Management, 105 Day Care (helpers/preAuth.js:421-423).
const SUPPORT_COORDINATION = 101;

// The two rules the ticket defines.
const RULE_APPROVED_MT = 'approved_mt';
const RULE_FORMS_SUBMITTED = 'forms_submitted';

// procedure_code.procUnitOfService values that bill by elapsed time, keyed by
// their normalized form (see normalizeUnitOfService). Anything not listed --
// 'Per Diem', 'Per Visit', '', NULL -- bills per visit.
//
// The list is long because the column is free text with no constraint, and the
// live data carries nine spellings of four concepts:
//
//   "15 Minutes" x29  "Per 15 Minutes" x28  "Each 15 Minutes" x9  "15 minutes" x6
//   "Per Hour" x8     "1 Hour" x3           "Per Diem" x20        "Per Visit" x3   "" x2
//
// Matching only the two exact strings the PA grid checks for left 51 of 108
// procedure codes -- most of the time-based ones -- silently falling through to
// per-visit counting, which under-counts delivered units and reports a billing
// discrepancy on correctly billed claims.
//
// Note that SQL Server's default collation is case-insensitive, so the existing
// comparisons in helpers/preAuth.js are not exposed to the casing half of this;
// a JS object lookup is, which is why normalization happens here rather than
// being assumed. Those SQL comparisons *are* exposed to the wording half --
// they do not recognise 'Per 15 Minutes' or 'Per Hour' either. Out of scope
// here, but the PA grid's unit figures have the same blind spot.
const UNIT_OF_SERVICE_MINUTES = {
  '15 minutes': 15,
  'per 15 minutes': 15,
  'each 15 minutes': 15,
  '1 hour': 60,
  'per hour': 60,
  'each hour': 60,
  'hourly': 60,
};

/**
 * Folds a procUnitOfService value to the key UNIT_OF_SERVICE_MINUTES uses.
 * Case and internal whitespace only -- no fuzzy matching, so an unrecognised
 * spelling stays unrecognised and bills per visit rather than being guessed at.
 *
 * @param {string|null} unitOfService
 * @returns {number|null} minutes per unit, or null for per-visit billing.
 */
function normalizeUnitOfService(unitOfService) {
  const key = String(unitOfService || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return UNIT_OF_SERVICE_MINUTES[key] || null;
}

// monthlymonitoring.status values (helpers/monthlymonitoring.js).
const MT_APPROVED = 'Approved';

const TASK_DELETED = 2;

/**
 * Units for a total number of delivered minutes.
 *
 * Lifted verbatim from helpers/preAuth.js:652 so the two agree by construction:
 * anything under one unit still bills one unit, and the remainder rounds at the
 * half-unit mark.
 *
 * @param {number} minutes
 * @param {number} unitDuration minutes per unit (15 or 60).
 * @returns {number}
 */
function calculateUnits(minutes, unitDuration) {
  if (minutes < unitDuration) return 1;

  const fullUnits = Math.floor(minutes / unitDuration);
  const remainder = minutes % unitDuration;

  return remainder >= unitDuration / 2 ? fullUnits + 1 : fullUnits;
}

/**
 * Delivered units for a set of tasks under one unit of service.
 *
 * Time-based codes are summed *before* rounding, matching the PA grid: rounding
 * each visit first and adding up inflates the total, and the grid's figure is
 * the one the claim was built from.
 *
 * @param {Array<{minutes: number|null}>} tasks
 * @param {string|null} unitOfService procedure_code.procUnitOfService.
 * @returns {number} 0 when there are no tasks.
 */
function unitsForTasks(tasks, unitOfService) {
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0) return 0;

  const unitDuration = normalizeUnitOfService(unitOfService);
  if (!unitDuration) return list.length; // per-visit

  const totalMinutes = list.reduce((sum, task) => sum + (Number(task.minutes) || 0), 0);
  return calculateUnits(totalMinutes, unitDuration);
}

/**
 * Whole minutes between two datetime values, or null.
 * Mirrors elliq.js durationMinutes; kept local so this module has no dependency
 * on the markdown builders it feeds.
 */
function minutesBetween(start, end) {
  const s = start instanceof Date ? start : (start ? new Date(start) : null);
  const e = end instanceof Date ? end : (end ? new Date(end) : null);
  if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) return null;
  const ms = e.getTime() - s.getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}

/**
 * A date as YYYY-MM-DD for prose that ends up embedded.
 *
 * Without this a Date interpolates as "Tue Feb 24 2026 14:14:13 GMT-0600
 * (Central Standard Time)" -- forty characters of timezone noise inside a
 * sentence the model is meant to read, and it varies with the server's zone,
 * so the same fact would hash differently on different hosts and churn the
 * document.
 */
function formatDateOnly(value) {
  const date = value instanceof Date ? value : (value ? new Date(value) : null);
  if (!date || isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Ids safe to interpolate into an IN list.
 *
 * DBSendResponseParam binds scalars only, so a list has to be inlined -- which
 * is safe exactly as long as every element is a real integer. Everything else
 * is dropped rather than quoted.
 *
 * @param {Array<number|string>} ids
 * @returns {Array<number>} unique integers.
 */
function toIdList(ids) {
  const parsed = (Array.isArray(ids) ? ids : [])
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id));
  return [...new Set(parsed)];
}

/**
 * The company's primary business type, which selects the justification rule.
 *
 * A module subscription is a `settings` row keyed by feature_value rather than
 * feature_id alone (helpers/accountsReceivable.js:41), because feature_ids are
 * only unique within a feature_type.
 *
 * @param {Array<number>} companyIds
 * @returns {Promise<Map<number, number>>} company id -> feature id.
 */
async function loadBusinessTypes(companyIds) {
  const ids = toIdList(companyIds);
  if (ids.length === 0) return new Map();

  const rows = await DBSendResponseParam(
    `SELECT company_id, feature_id
       FROM settings
      WHERE feature_value = 'primaryBusinessType'
        AND company_id IN (${ids.join(', ')})`,
  );
  return new Map((rows || []).map((row) => [Number(row.company_id), Number(row.feature_id)]));
}

/**
 * Unit of service for a billed procedure code.
 *
 * procedure_code carries no company id, so it is matched on the code itself and
 * falls back to the task type (the join evv.js:466 and medicaid.js:782 use)
 * when the claim's code is not on file.
 *
 * @param {Object} params
 * @param {string} [params.procCode] Claim.procedureCode / preAuth.procedureCode.
 * @param {string} [params.taskType] task.tas_type, used as a fallback.
 * @returns {Promise<string|null>} e.g. '15 Minutes', '1 Hour', or null.
 */
async function getUnitOfService({ procCode, taskType }) {
  if (procCode) {
    const rows = await DBSendResponseParam(
      `SELECT TOP 1 procUnitOfService
         FROM procedure_code
        WHERE procProcCode = @procCode
        ORDER BY procIsActive DESC, procCode_id DESC`,
      { procCode: String(procCode).trim() },
    );
    if (rows && rows.length) return rows[0].procUnitOfService || null;
  }

  if (taskType) {
    const rows = await DBSendResponseParam(
      `SELECT TOP 1 procUnitOfService
         FROM procedure_code
        WHERE procTaskType = @taskType
        ORDER BY procIsActive DESC, procCode_id DESC`,
      { taskType: String(taskType).trim() },
    );
    if (rows && rows.length) return rows[0].procUnitOfService || null;
  }

  return null;
}

/**
 * Decides whether one task is justified, under the rule its company's business
 * type selects. The single place this judgement is made.
 *
 * `mandateDefined: false` is deliberately not the same thing as a failure: a
 * task type with no forms configured has nothing to be missing, and reporting
 * that as a gap would bury the real ones. It is surfaced separately so a
 * reviewer can tell "nothing was required" from "everything required was done".
 *
 * @param {Object} task an entry of the map loadTaskCompliance returns.
 * @returns {{rule: string, justified: boolean, mandateDefined: boolean, reason: string}}
 */
function judgeTask(task) {
  if (task.businessType === SUPPORT_COORDINATION) {
    const mt = task.mt;
    if (!mt) {
      return {
        rule: RULE_APPROVED_MT,
        justified: false,
        mandateDefined: true,
        reason: 'No monitoring tool (MT) exists for this task.',
      };
    }
    const approved = mt.approved === true || mt.approved === 1 || mt.status === MT_APPROVED;
    return {
      rule: RULE_APPROVED_MT,
      justified: approved,
      mandateDefined: true,
      reason: approved
        ? `MT ${mt.id} approved${formatDateOnly(mt.reviewedOn) ? ` on ${formatDateOnly(mt.reviewedOn)}` : ''}.`
        : `MT ${mt.id} is not approved (status: ${mt.status || 'unknown'}${mt.submitted ? ', submitted' : ', not submitted'}).`,
    };
  }

  if (task.expectedForms.length === 0) {
    return {
      rule: RULE_FORMS_SUBMITTED,
      justified: true,
      mandateDefined: false,
      reason: `No forms are configured for task type "${task.taskType || 'unknown'}", so there is nothing to verify.`,
    };
  }

  if (task.missingForms.length === 0) {
    return {
      rule: RULE_FORMS_SUBMITTED,
      justified: true,
      mandateDefined: true,
      reason: `All ${task.expectedForms.length} mandated form(s) submitted.`,
    };
  }

  const names = task.missingForms.map((form) => form.formName || `Form ${form.formId}`).join(', ');
  return {
    rule: RULE_FORMS_SUBMITTED,
    justified: false,
    mandateDefined: true,
    reason: `${task.missingForms.length} of ${task.expectedForms.length} mandated form(s) not submitted: ${names}.`,
  };
}

/**
 * Loads every compliance fact for a set of tasks, in a fixed number of queries
 * regardless of how many tasks are asked for.
 *
 * Batched rather than per-task because the callers are a nightly sweep over the
 * highest-volume object in the system and a QA endpoint over a whole claim
 * period -- both would otherwise multiply round trips against a SQL Server pool
 * shared with live traffic.
 *
 * @param {Array<number>} taskIds
 * @returns {Promise<Map<number, Object>>} task id -> facts (see judgeTask).
 */
async function loadTaskCompliance(taskIds) {
  const ids = toIdList(taskIds);
  if (ids.length === 0) return new Map();

  const idList = ids.join(', ');

  // OUTER APPLY TOP 1 rather than a plain LEFT JOIN: a task can have several
  // empLocate rows and a join would multiply the task row, which is the bug
  // buildTaskMarkdown works around with ORDER BY + [0].
  const taskRows = await DBSendResponseParam(
    `SELECT t.tas_id, t.tas_com_id, t.tas_type, t.tas_title,
            COALESCE(t.tas_cus_id, p.pro_customer_id) AS customer_id,
            t.tas_emp_id, t.tas_claim_id, t.tas_preAuth_id,
            t.tas_mm_id, t.tas_mm_status, t.tas_form_approval_status,
            t.tas_start_date, t.tas_start_time, t.tas_end_time,
            t.tas_is_active, t.checkin,
            el.empLocdate, el.checkoutEmpDate
       FROM task t
       LEFT JOIN project p ON t.tas_pro_id = p.pro_id
       OUTER APPLY (
            SELECT TOP 1 e.empLocdate, e.checkoutEmpDate
              FROM empLocate e
             WHERE e.taskId = t.tas_id
             ORDER BY e.empLocdate DESC
       ) el
      WHERE t.tas_id IN (${idList})`,
  );

  if (!taskRows || taskRows.length === 0) return new Map();

  // Forms mandated for each task's type. dropdowns is the bridge between
  // task.tas_type (a label) and task_form.taskType_id (an id); the
  // EntityName/is_Active predicate is the one every other consumer uses
  // (time_sheet_v2.js:392, workflows.js:689).
  //
  // task_form.status is not filtered on: it is written as a constant 1 and
  // unlinking deletes the row (helpers/task_form.js:24,53), so no consumer
  // treats it as meaningful.
  const expectedRows = await DBSendResponseParam(
    `SELECT t.tas_id, tf.form_id, f.form_name
       FROM task t
       JOIN dropdowns d ON d.EntityName = 'taskType'
                       AND d.CompanyID = t.tas_com_id
                       AND d.EntityValue = t.tas_type
                       AND d.is_Active IN (0, 3)
       JOIN task_form tf ON tf.taskType_id = d.ddID AND tf.company_id = t.tas_com_id
       LEFT JOIN fw_forms f ON f.form_id = tf.form_id
      WHERE t.tas_id IN (${idList})`,
  );

  const submittedRows = await DBSendResponseParam(
    `SELECT cf.task_id, cf.form_id AS submission_id, cf.form_type AS form_id,
            cf.created_on, cf.last_updated, f.form_name
       FROM customer_form cf
       LEFT JOIN fw_forms f ON f.form_id = cf.form_type
      WHERE cf.task_id IN (${idList})`,
  );

  const mtRows = await DBSendResponseParam(
    `SELECT monthly_monitoring_id, task_id, status, submitted, approved,
            mt_period, mt_type, submitted_on, reviewed_on
       FROM monthlymonitoring
      WHERE task_id IN (${idList})
      ORDER BY monthly_monitoring_id`,
  );

  const businessTypes = await loadBusinessTypes(taskRows.map((row) => row.tas_com_id));

  const byTask = new Map();

  for (const row of taskRows) {
    // Delivered minutes come from the EVV clock, not the scheduled window: the
    // PA grid bills off empLocdate/checkoutEmpDate (preAuth.js:318), and a task
    // scheduled for two hours that was clocked for one bills one.
    const evvMinutes = minutesBetween(row.empLocdate, row.checkoutEmpDate);
    const scheduledMinutes = minutesBetween(row.tas_start_time, row.tas_end_time);

    byTask.set(Number(row.tas_id), {
      taskId: Number(row.tas_id),
      companyId: row.tas_com_id === null ? null : Number(row.tas_com_id),
      customerId: row.customer_id === null ? null : Number(row.customer_id),
      employeeId: row.tas_emp_id === null ? null : Number(row.tas_emp_id),
      taskType: row.tas_type || null,
      taskTitle: row.tas_title || null,
      completed: Number(row.tas_is_active) === 1,
      deleted: Number(row.tas_is_active) === TASK_DELETED,
      checkedIn: row.checkin === true || row.checkin === 1,
      startDate: row.tas_start_date || null,
      startTime: row.tas_start_time || null,
      endTime: row.tas_end_time || null,
      claimId: row.tas_claim_id === null ? null : Number(row.tas_claim_id),
      preAuthId: row.tas_preAuth_id === null ? null : Number(row.tas_preAuth_id),
      formApprovalStatus: row.tas_form_approval_status,
      scheduledMinutes,
      evvMinutes,
      minutes: evvMinutes !== null ? evvMinutes : scheduledMinutes,
      minutesSource: evvMinutes !== null ? 'evv' : 'scheduled',
      clockIn: row.empLocdate || null,
      clockOut: row.checkoutEmpDate || null,
      businessType: businessTypes.get(Number(row.tas_com_id)) ?? null,
      expectedForms: [],
      submittedForms: [],
      missingForms: [],
      mt: row.tas_mm_id
        ? { id: row.tas_mm_id, status: row.tas_mm_status || null, submitted: null, approved: null, period: null, submittedOn: null, reviewedOn: null }
        : null,
    });
  }

  for (const row of expectedRows || []) {
    const task = byTask.get(Number(row.tas_id));
    if (!task) continue;
    task.expectedForms.push({ formId: Number(row.form_id), formName: row.form_name || null });
  }

  for (const row of submittedRows || []) {
    const task = byTask.get(Number(row.task_id));
    if (!task) continue;
    task.submittedForms.push({
      formId: row.form_id === null ? null : Number(row.form_id),
      formName: row.form_name || null,
      submissionId: Number(row.submission_id),
      createdOn: row.created_on || null,
      lastUpdated: row.last_updated || null,
    });
  }

  // The monthlymonitoring row wins over task.tas_mm_id/tas_mm_status: those two
  // are a denormalized copy on the task, and reviewMT updates the MT row.
  // Ordered by id, so the last write per task is the current one.
  for (const row of mtRows || []) {
    const task = byTask.get(Number(row.task_id));
    if (!task) continue;
    task.mt = {
      id: Number(row.monthly_monitoring_id),
      status: row.status || null,
      submitted: row.submitted === true || row.submitted === 1,
      approved: row.approved === true || row.approved === 1,
      period: row.mt_period || null,
      type: row.mt_type || null,
      submittedOn: row.submitted_on || null,
      reviewedOn: row.reviewed_on || null,
    };
  }

  for (const task of byTask.values()) {
    const submittedFormIds = new Set(task.submittedForms.map((form) => form.formId));
    task.missingForms = task.expectedForms.filter((form) => !submittedFormIds.has(form.formId));
    task.justification = judgeTask(task);
  }

  return byTask;
}

module.exports = {
  loadTaskCompliance,
  unitsForTasks,
  calculateUnits,
  getUnitOfService,
  loadBusinessTypes,
  minutesBetween,
  toIdList,
  TASK_DELETED,
  SUPPORT_COORDINATION,
  RULE_APPROVED_MT,
  RULE_FORMS_SUBMITTED,
};
