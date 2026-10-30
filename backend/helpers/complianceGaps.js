// ---------------------------------------------------------------------------
// Compliance gap detection (Scenario 3).
//
// The deterministic half of the QA sweep. Retrieval can rank passages by
// meaning but it cannot answer "every claim line still awaiting submission" --
// that is a predicate, not a similarity, and getting it approximately right is
// the same as getting it wrong when the output is a compliance finding.
//
// So these endpoints compute the exceptions in SQL and hand back facts: which
// claim lines have no task behind them, which tasks are unjustified under their
// company's rule, and where billed units diverge from delivered or approved
// ones. The model's job is then only to narrate a verdict it cannot get wrong,
// and to judge the one thing that genuinely needs judgement -- whether the
// narrative text justifies what was billed.
//
// Reading SQL Server live rather than the pgvector index is deliberate: the
// index is refreshed nightly, Claim has no updated-at column for the
// incremental pass to key on (see helpers/ragSync.js), and a QA sweep that
// reports gaps somebody fixed this morning trains its user to ignore it.
//
// Scope: per customer, matching every other RAG surface. The company-wide QA
// queue is deferred; when it lands, the query shape here is unchanged and only
// the access check and the customer predicate move up a level.
// ---------------------------------------------------------------------------

const { DBSendResponseParam } = require('../queries/commonQueries');
const { loadTaskCompliance, unitsForTasks, getUnitOfService, toIdList, TASK_DELETED } = require('./taskCompliance');
const { assertCustomerAccess, CustomerAccessError } = require('./caseSummaryTasks');
const { getCurrentRequestLogger } = require('../loggerContext');

// Claim.Status when a line has been built but not yet sent to the payer -- the
// ticket's "pending_submission". The rest of the vocabulary is Deferred,
// Pending, Accepted, Rejected, Denied, Processed as Primary/Secondary and
// Released (helpers/medicaid.js, components/Billing/Claims/Claims.js).
const CLAIM_STATUS_PENDING_SUBMISSION = 'Ready to Bill';

// Issue codes. Stable strings rather than prose so a caller -- a prompt, a grid,
// a later company-wide queue -- can filter and count them without parsing
// sentences.
const ISSUE_NO_LINKED_TASKS = 'no_linked_tasks';
const ISSUE_UNJUSTIFIED_TASKS = 'unjustified_tasks';
const ISSUE_UNITS_MISMATCH = 'units_billed_vs_delivered_mismatch';
const ISSUE_UNITS_EXCEED_AUTH = 'units_billed_exceed_authorization';
const ISSUE_NO_TASKS_IN_PERIOD = 'no_tasks_in_authorization_period';
const ISSUE_CLAIM_OUTSIDE_AUTH_PERIOD = 'claim_billed_outside_authorization_period';

/**
 * Whether two date ranges overlap. Any missing endpoint means "cannot tell",
 * which is treated as no overlap rather than assumed.
 */
function datesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return new Date(aStart).getTime() <= new Date(bEnd).getTime()
    && new Date(aEnd).getTime() >= new Date(bStart).getTime();
}

/**
 * Resolves the customer once: the company scopes every claim query, and the
 * DDD id is the only route to claim lines that have no task linked to them --
 * which is the finding this whole endpoint exists to surface.
 *
 * @param {number} cusId
 * @returns {Promise<Object|null>} null when no such customer exists.
 */
async function loadCustomer(cusId) {
  const rows = await DBSendResponseParam(
    'SELECT cus_id, cus_name, cus_company_id, DDDID FROM customer WHERE cus_id = @cusId',
    { cusId },
  );
  return rows && rows.length ? rows[0] : null;
}

/**
 * Unit of service per procedure code, memoized for the length of one request.
 *
 * A customer's claim lines repeat the same handful of codes, and each lookup is
 * a round trip against a pool shared with live traffic.
 */
function unitOfServiceLoader() {
  const cache = new Map();
  return async (procCode, taskType) => {
    const key = `${procCode || ''}|${taskType || ''}`;
    if (!cache.has(key)) {
      cache.set(key, await getUnitOfService({ procCode, taskType }));
    }
    return cache.get(key);
  };
}

/** Tasks rolled into a set of claim lines, grouped by claim id. */
async function loadTasksByClaim(claimIds) {
  const ids = toIdList(claimIds);
  if (ids.length === 0) return new Map();

  const rows = await DBSendResponseParam(
    `SELECT t.tas_id, t.tas_claim_id, t.tas_title, t.tas_type, t.tas_start_date,
            emp.emp_first_name, emp.emp_last_name
       FROM task t
       LEFT JOIN employee emp ON emp.emp_id = t.tas_emp_id
      WHERE t.tas_claim_id IN (${ids.join(', ')})
        AND t.tas_is_active <> ${TASK_DELETED}
      ORDER BY t.tas_id`,
  );

  const byClaim = new Map();
  for (const row of rows || []) {
    const claimId = Number(row.tas_claim_id);
    if (!byClaim.has(claimId)) byClaim.set(claimId, []);
    byClaim.get(claimId).push(row);
  }
  return byClaim;
}

/** Shapes one task for the response: identity, verdict, and why. */
function describeTask(row, compliance) {
  return {
    task_id: Number(row.tas_id),
    title: row.tas_title || null,
    task_type: row.tas_type || null,
    service_date: row.tas_start_date || null,
    performed_by: [row.emp_first_name, row.emp_last_name].filter(Boolean).join(' ').trim() || null,
    delivered_minutes: compliance ? compliance.minutes : null,
    minutes_source: compliance ? compliance.minutesSource : null,
    justified: compliance ? compliance.justification.justified : null,
    justification_rule: compliance ? compliance.justification.rule : null,
    justification_reason: compliance ? compliance.justification.reason : 'No compliance record could be loaded for this task.',
    missing_forms: compliance ? compliance.missingForms.map((form) => form.formName || `Form ${form.formId}`) : [],
    mt_status: compliance && compliance.mt ? compliance.mt.status : null,
  };
}

/**
 * Strategy 1: claim lines whose tasks do not justify what is being billed.
 *
 * @param {number} cusId
 * @param {Object} [filters]
 * @param {string} [filters.status] Claim.Status, defaults to 'Ready to Bill'.
 *   Pass 'all' to sweep every status.
 * @param {string} [filters.startDate] service window start (inclusive).
 * @param {string} [filters.endDate] service window end (inclusive).
 * @param {boolean} [filters.includeCompliant] return clean claim lines too.
 * @returns {Promise<Object|null>} null when the customer does not exist.
 */
async function getClaimGapsForCustomer(cusId, filters = {}) {
  const customer = await loadCustomer(cusId);
  if (!customer) return null;

  const status = filters.status === undefined ? CLAIM_STATUS_PENDING_SUBMISSION : filters.status;
  const filterByStatus = status && status !== 'all';

  // Predicates are appended as literal fragments rather than bound as nullable
  // parameters: DBSendResponseParam infers the SQL type from the value, and a
  // null gives it nothing to infer from.
  const params = { cusId, companyId: customer.cus_company_id };
  const conditions = ['c.companyID = @companyId'];

  if (filterByStatus) {
    conditions.push('c.Status = @status');
    params.status = status;
  }
  if (filters.startDate) {
    conditions.push('c.endDate >= @startDate');
    params.startDate = filters.startDate;
  }
  if (filters.endDate) {
    conditions.push('c.startDate <= @endDate');
    params.endDate = filters.endDate;
  }

  // Two routes to the customer's claim lines. The task route is exact; the DDD
  // route is what catches a claim line with no task linked at all, which the
  // task route by definition cannot see and which is the strongest finding
  // this endpoint produces.
  const customerRoutes = [
    `c.claim_ID IN (
        SELECT t.tas_claim_id
          FROM task t
          LEFT JOIN project p ON t.tas_pro_id = p.pro_id
         WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
           AND t.tas_claim_id IS NOT NULL
     )`,
  ];
  if (customer.DDDID) {
    customerRoutes.push('LTRIM(RTRIM(c.DDDID)) = @dddId');
    params.dddId = String(customer.DDDID).trim();
  }
  conditions.push(`(${customerRoutes.join(' OR ')})`);

  const claimRows = await DBSendResponseParam(
    `SELECT c.claim_ID, c.Status, c.priorAuth, c.procedureCode, c.procedureModifierCode,
            c.startDate, c.endDate, c.authUnits, c.authAmount, c.CreateDate, c.SubmitDate
       FROM Claim c
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY c.claim_ID`,
    params,
  );

  const claims = claimRows || [];
  const tasksByClaim = await loadTasksByClaim(claims.map((claim) => claim.claim_ID));
  const complianceMap = await loadTaskCompliance(
    [...tasksByClaim.values()].flat().map((row) => row.tas_id),
  );
  const resolveUnitOfService = unitOfServiceLoader();

  const results = [];

  for (const claim of claims) {
    const taskRows = tasksByClaim.get(Number(claim.claim_ID)) || [];
    const compliances = taskRows.map((row) => complianceMap.get(Number(row.tas_id))).filter(Boolean);

    const unitOfService = await resolveUnitOfService(
      claim.procedureCode,
      taskRows.length ? taskRows[0].tas_type : null,
    );
    const deliveredUnits = unitsForTasks(compliances, unitOfService);
    const billedUnits = claim.authUnits === null || claim.authUnits === undefined
      ? null
      : Number(claim.authUnits);

    const unjustified = taskRows.filter((row) => {
      const compliance = complianceMap.get(Number(row.tas_id));
      return compliance && !compliance.justification.justified;
    });

    const issues = [];
    if (taskRows.length === 0) {
      issues.push({
        code: ISSUE_NO_LINKED_TASKS,
        detail: 'No task is linked to this claim line, so nothing in the system evidences the units billed.',
      });
    }
    if (unjustified.length) {
      issues.push({
        code: ISSUE_UNJUSTIFIED_TASKS,
        detail: `${unjustified.length} of ${taskRows.length} linked task(s) are not justified under the company's rule.`,
      });
    }
    if (taskRows.length && billedUnits !== null && billedUnits !== deliveredUnits) {
      issues.push({
        code: ISSUE_UNITS_MISMATCH,
        detail: `Billed ${billedUnits} unit(s) against ${deliveredUnits} computed from delivered time (${unitOfService || 'per visit'}).`,
      });
    }

    if (issues.length === 0 && !filters.includeCompliant) continue;

    results.push({
      claim_id: Number(claim.claim_ID),
      claim_status: claim.Status || null,
      prior_auth: claim.priorAuth || null,
      procedure_code: claim.procedureCode || null,
      procedure_modifier: claim.procedureModifierCode || null,
      service_start_date: claim.startDate || null,
      service_end_date: claim.endDate || null,
      units_billed: billedUnits,
      units_delivered: deliveredUnits,
      unit_of_service: unitOfService || 'Per visit',
      amount_billed: claim.authAmount === null || claim.authAmount === undefined ? null : Number(claim.authAmount),
      created_at: claim.CreateDate || null,
      submitted_at: claim.SubmitDate || null,
      linked_task_count: taskRows.length,
      unjustified_task_count: unjustified.length,
      issues,
      tasks: taskRows.map((row) => describeTask(row, complianceMap.get(Number(row.tas_id)))),
    });
  }

  return {
    cus_id: Number(cusId),
    customer_name: customer.cus_name || null,
    company_id: customer.cus_company_id === null ? null : Number(customer.cus_company_id),
    filters: {
      status: filterByStatus ? status : 'all',
      start_date: filters.startDate || null,
      end_date: filters.endDate || null,
      include_compliant: Boolean(filters.includeCompliant),
    },
    summary: {
      claims_examined: claims.length,
      claims_with_issues: results.filter((claim) => claim.issues.length > 0).length,
      claims_without_tasks: results.filter((claim) => claim.linked_task_count === 0).length,
      unjustified_tasks: results.reduce((total, claim) => total + claim.unjustified_task_count, 0),
    },
    claims: results,
  };
}

/**
 * Strategy 2: prior authorizations whose delivered work does not account for
 * what has been billed against them.
 *
 * @param {number} cusId
 * @param {Object} [filters]
 * @param {string} [filters.startDate] period start; defaults to all history.
 * @param {string} [filters.endDate] period end.
 * @param {boolean} [filters.includeCompliant]
 * @returns {Promise<Object|null>} null when the customer does not exist.
 */
async function getPriorAuthGapsForCustomer(cusId, filters = {}) {
  const customer = await loadCustomer(cusId);
  if (!customer) return null;

  const params = { cusId, companyId: customer.cus_company_id };
  const conditions = ['pa.companyId = @companyId'];

  // Overlap rather than containment: an authorization running across the
  // requested window is in scope even though neither of its endpoints is.
  if (filters.startDate) {
    conditions.push('pa.endDate >= @startDate');
    params.startDate = filters.startDate;
  }
  if (filters.endDate) {
    conditions.push('pa.startDate <= @endDate');
    params.endDate = filters.endDate;
  }

  const customerRoutes = [
    `pa.primaryID IN (
        SELECT t.tas_preAuth_id
          FROM task t
          LEFT JOIN project p ON t.tas_pro_id = p.pro_id
         WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
           AND t.tas_preAuth_id IS NOT NULL
     )`,
  ];
  if (customer.DDDID) {
    customerRoutes.push('LTRIM(RTRIM(pa.DDDID)) = @dddId');
    params.dddId = String(customer.DDDID).trim();
  }
  conditions.push(`(${customerRoutes.join(' OR ')})`);

  const authRows = await DBSendResponseParam(
    `SELECT pa.primaryID, pa.priorAuth, pa.procedureCode, pa.procedureCodeModifier,
            pa.serviceType, pa.startDate, pa.endDate, pa.authUnits, pa.authAmount
       FROM preAuth pa
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY pa.primaryID`,
    params,
  );

  const auths = authRows || [];

  // Every task that could belong to any of these authorizations, fetched once
  // over the union of their periods and partitioned in memory below. Per-auth
  // queries would mean a task fetch and a five-query compliance load for each
  // authorization, against a pool shared with live traffic, to re-read mostly
  // the same tasks -- a customer's authorizations overlap by construction.
  const periodStart = auths.reduce((min, auth) => (!min || auth.startDate < min ? auth.startDate : min), null);
  const periodEnd = auths.reduce((max, auth) => (!max || auth.endDate > max ? auth.endDate : max), null);

  let allTaskRows = [];
  if (auths.length) {
    allTaskRows = await DBSendResponseParam(
      `SELECT t.tas_id, t.tas_title, t.tas_type, t.tas_start_date, t.tas_preAuth_id,
              emp.emp_first_name, emp.emp_last_name
         FROM task t
         LEFT JOIN project p ON t.tas_pro_id = p.pro_id
         LEFT JOIN employee emp ON emp.emp_id = t.tas_emp_id
        WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
          AND t.tas_is_active <> ${TASK_DELETED}
          AND (t.tas_preAuth_id IS NOT NULL
               OR t.tas_start_date BETWEEN @periodStart AND @periodEnd)
        ORDER BY t.tas_id`,
      { cusId, periodStart, periodEnd },
    ) || [];
  }

  const complianceMap = await loadTaskCompliance(allTaskRows.map((row) => row.tas_id));

  // All claims carrying any of these authorization numbers, grouped by number.
  //
  // An authorization number is NOT one authorization: in live data a single
  // number spans a row per service week (ten weekly rows of 10 units each for
  // one number is normal). So a claim cannot be attributed to a row by its
  // number alone -- doing that credits every row of the number with every
  // claim, which multiplies the billed figure by the number of rows and makes
  // units_billed_exceed_authorization fire identically on all of them.
  // Attribution is by service-date overlap below.
  const authNumbers = [...new Set(auths.map((auth) => auth.priorAuth).filter(Boolean))];
  const claimsByAuth = new Map();
  let allPeriods = [];
  if (authNumbers.length) {
    // Bound as one parameter per value; authorization numbers are free text.
    const claimParams = { companyId: customer.cus_company_id };
    const placeholders = authNumbers.map((value, index) => {
      claimParams[`auth${index}`] = value;
      return `@auth${index}`;
    });
    const allClaimRows = await DBSendResponseParam(
      `SELECT claim_ID, Status, authUnits, startDate, endDate, priorAuth
         FROM Claim
        WHERE companyID = @companyId AND priorAuth IN (${placeholders.join(', ')})
        ORDER BY claim_ID`,
      claimParams,
    );
    for (const row of allClaimRows || []) {
      if (!claimsByAuth.has(row.priorAuth)) claimsByAuth.set(row.priorAuth, []);
      claimsByAuth.get(row.priorAuth).push(row);
    }

    // Every authorized period for those numbers, including rows outside the
    // caller's date window. Without the unwindowed set, a claim covered by a
    // period the caller filtered out would be reported as billed outside any
    // authorization -- a false finding produced by the filter itself.
    allPeriods = await DBSendResponseParam(
      `SELECT primaryID, priorAuth, startDate, endDate
         FROM preAuth
        WHERE companyId = @companyId AND priorAuth IN (${placeholders.join(', ')})`,
      claimParams,
    ) || [];
  }

  const resolveUnitOfService = unitOfServiceLoader();
  const results = [];

  for (const auth of auths) {
    // Tasks inside the authorization period, not just tasks already stamped
    // with tas_preAuth_id: that stamp is only written once the auth has been
    // sent to claims (helpers/claims.js:849), so relying on it alone would make
    // an authorization with nothing delivered against it look like it had no
    // tasks *and* no obligation.
    const taskRows = allTaskRows.filter((row) => {
      if (row.tas_preAuth_id !== null && Number(row.tas_preAuth_id) === Number(auth.primaryID)) return true;
      if (!row.tas_start_date || !auth.startDate || !auth.endDate) return false;
      const serviceDate = new Date(row.tas_start_date).getTime();
      return serviceDate >= new Date(auth.startDate).getTime()
        && serviceDate <= new Date(auth.endDate).getTime();
    });

    const compliances = taskRows.map((row) => complianceMap.get(Number(row.tas_id))).filter(Boolean);

    const unitOfService = await resolveUnitOfService(
      auth.procedureCode,
      taskRows.length ? taskRows[0].tas_type : null,
    );
    const deliveredUnits = unitsForTasks(compliances, unitOfService);
    const approvedUnits = auth.authUnits === null || auth.authUnits === undefined ? null : Number(auth.authUnits);

    // Claims carrying this authorization number AND overlapping this row's
    // service period. Matched on the number rather than through the tasks, so
    // a claim raised outside the normal flow still counts; narrowed by dates so
    // it counts against the period it was actually delivered in.
    const claimRows = (claimsByAuth.get(auth.priorAuth) || [])
      .filter((claim) => datesOverlap(claim.startDate, claim.endDate, auth.startDate, auth.endDate));

    const billedUnits = claimRows.reduce((sum, claim) => sum + (Number(claim.authUnits) || 0), 0);
    const unjustified = taskRows.filter((row) => {
      const compliance = complianceMap.get(Number(row.tas_id));
      return compliance && !compliance.justification.justified;
    });

    const issues = [];
    if (taskRows.length === 0) {
      issues.push({
        code: ISSUE_NO_TASKS_IN_PERIOD,
        detail: 'No task falls inside this authorization period, so nothing has been delivered against it.',
      });
    }
    if (unjustified.length) {
      issues.push({
        code: ISSUE_UNJUSTIFIED_TASKS,
        detail: `${unjustified.length} of ${taskRows.length} task(s) in the period are not justified under the company's rule.`,
      });
    }
    if (approvedUnits !== null && billedUnits > approvedUnits) {
      issues.push({
        code: ISSUE_UNITS_EXCEED_AUTH,
        detail: `Billed ${billedUnits} unit(s) against ${approvedUnits} approved — over by ${billedUnits - approvedUnits}.`,
      });
    }
    if (claimRows.length && billedUnits !== deliveredUnits) {
      issues.push({
        code: ISSUE_UNITS_MISMATCH,
        detail: `Billed ${billedUnits} unit(s) against ${deliveredUnits} computed from delivered time (${unitOfService || 'per visit'}).`,
      });
    }

    if (issues.length === 0 && !filters.includeCompliant) continue;

    results.push({
      prior_auth_id: Number(auth.primaryID),
      prior_auth: auth.priorAuth || null,
      procedure_code: auth.procedureCode || null,
      procedure_modifier: auth.procedureCodeModifier || null,
      service_type: auth.serviceType || null,
      auth_start_date: auth.startDate || null,
      auth_end_date: auth.endDate || null,
      units_approved: approvedUnits,
      units_billed: billedUnits,
      units_delivered: deliveredUnits,
      unit_of_service: unitOfService || 'Per visit',
      task_count: taskRows.length,
      unjustified_task_count: unjustified.length,
      issues,
      claims: claimRows.map((claim) => ({
        claim_id: Number(claim.claim_ID),
        claim_status: claim.Status || null,
        units_billed: claim.authUnits === null || claim.authUnits === undefined ? null : Number(claim.authUnits),
        service_start_date: claim.startDate || null,
        service_end_date: claim.endDate || null,
      })),
      tasks: taskRows.map((row) => describeTask(row, complianceMap.get(Number(row.tas_id)))),
    });
  }

  // Claims carrying one of these authorization numbers whose service dates fall
  // inside none of that number's authorized periods.
  //
  // Reported separately rather than dropped: date-based attribution means such
  // a claim belongs to no row, so without this it would silently vanish from
  // the sweep -- and "billed against an authorization, outside every period it
  // authorizes" is a finding in its own right, not an absence of one.
  const unattributedClaims = [];
  for (const [priorAuth, claims] of claimsByAuth) {
    const periods = allPeriods.filter((period) => period.priorAuth === priorAuth);
    for (const claim of claims) {
      const covered = periods.some((period) => datesOverlap(claim.startDate, claim.endDate, period.startDate, period.endDate));
      if (covered) continue;
      unattributedClaims.push({
        claim_id: Number(claim.claim_ID),
        claim_status: claim.Status || null,
        units_billed: claim.authUnits === null || claim.authUnits === undefined ? null : Number(claim.authUnits),
        service_start_date: claim.startDate || null,
        service_end_date: claim.endDate || null,
        issues: [{
          code: ISSUE_CLAIM_OUTSIDE_AUTH_PERIOD,
          detail: `Claim carries authorization ${priorAuth} but its service dates fall outside all ${periods.length} authorized period(s) for that number.`,
        }],
      });
    }
  }

  return {
    cus_id: Number(cusId),
    customer_name: customer.cus_name || null,
    company_id: customer.cus_company_id === null ? null : Number(customer.cus_company_id),
    filters: {
      start_date: filters.startDate || null,
      end_date: filters.endDate || null,
      include_compliant: Boolean(filters.includeCompliant),
    },
    summary: {
      authorizations_examined: auths.length,
      authorizations_with_issues: results.filter((auth) => auth.issues.length > 0).length,
      authorizations_without_tasks: results.filter((auth) => auth.task_count === 0).length,
      unjustified_tasks: results.reduce((total, auth) => total + auth.unjustified_task_count, 0),
      claims_outside_authorized_periods: unattributedClaims.length,
    },
    authorizations: results,
    unattributed_claims: unattributedClaims,
  };
}

/**
 * Reads the merged (SQL facts + LLM verdict) records written by the nightly
 * QA sweep (helpers/qaSweepJob.js), most recent first.
 *
 * Company-scoped rather than customer-scoped like the two live sweeps above:
 * this is the dashboard's landing list across every customer the sweep found
 * an issue for, so the caller's verified companyId (never a request param) is
 * the only filter.
 *
 * @param {number} companyId
 * @param {Object} [filters]
 * @param {number} [filters.cusId] narrow to one customer.
 * @param {number} [filters.limit] row cap, defaults to 200.
 * @returns {Promise<Array<Object>>}
 */
async function getSweepHistoryForCompany(companyId, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 1000);
  const params = { companyId };
  const conditions = ['company_id = @companyId'];
  if (filters.cusId) {
    conditions.push('cus_id = @cusId');
    params.cusId = Number(filters.cusId);
  }

  const rows = await DBSendResponseParam(
    `SELECT TOP ${limit} id, company_id, cus_id, gap_type, claim_id, prior_auth_id,
            issue_codes, sql_facts, llm_verdict, swept_at
       FROM qa_sweep_history
      WHERE ${conditions.join(' AND ')}
      ORDER BY swept_at DESC, id DESC`,
    params,
  );

  return (rows || []).map((row) => ({
    id: Number(row.id),
    company_id: Number(row.company_id),
    cus_id: Number(row.cus_id),
    gap_type: row.gap_type,
    claim_id: row.claim_id === null ? null : Number(row.claim_id),
    prior_auth_id: row.prior_auth_id === null ? null : Number(row.prior_auth_id),
    issue_codes: (row.issue_codes || '').split(',').filter(Boolean),
    sql_facts: JSON.parse(row.sql_facts),
    llm_verdict: row.llm_verdict ? JSON.parse(row.llm_verdict) : null,
    swept_at: row.swept_at || null,
  }));
}

// GET /api/fieldworker/compliance/history
//   ?cusId=123&limit=200
// Requires MSAL Authorization header. Scoped to the caller's own company.
exports.getSweepHistory = async function (req, res) {
  const log = getCurrentRequestLogger();
  const identity = req.callerIdentity;
  if (!identity?.companyId) {
    return res.status(401).json({ message: 'Unable to resolve caller identity' });
  }

  try {
    const rows = await getSweepHistoryForCompany(identity.companyId, {
      cusId: req.query.cusId,
      limit: req.query.limit,
    });
    log.info({ companyId: identity.companyId, count: rows.length }, 'sweep history: fetched');
    res.status(200).json({ company_id: identity.companyId, count: rows.length, records: rows });
  } catch (e) {
    log.error({ err: e.message, stack: e.stack, companyId: identity.companyId }, 'sweep history: fetch failed');
    res.status(500).json({ message: 'Failed to load sweep history', error: e.message });
  }
};

/**
 * Parses the query string shared by both handlers.
 * `includeCompliant` is opt-in: the default response is the exception list.
 */
function parseFilters(query) {
  return {
    status: query.status,
    startDate: query.startDate || undefined,
    endDate: query.endDate || undefined,
    includeCompliant: query.includeCompliant === 'true' || query.includeCompliant === '1',
  };
}

/**
 * Runs one gap handler behind the customer access check.
 *
 * assertCustomerAccess is the same boundary the rest of the AI surface uses
 * (helpers/caseSummaryTasks.js): the caller's identity comes from the verified
 * MSAL token, never from the request body, and a customer outside their scope
 * is a 404 rather than a 403 -- confirming a customer id exists is itself a
 * disclosure.
 */
async function handleGapRequest(req, res, { load, label }) {
  const log = getCurrentRequestLogger();
  const cusId = parseInt(req.params.cus_id, 10);
  if (isNaN(cusId)) {
    return res.status(400).json({ message: 'Invalid cus_id' });
  }

  const identity = req.callerIdentity;

  try {
    await assertCustomerAccess(cusId, { companyId: identity?.companyId, employeeId: identity?.employeeId });
  } catch (err) {
    if (err instanceof CustomerAccessError) {
      log.warn({ cusId, companyId: identity?.companyId }, `${label}: customer access denied`);
      return res.status(404).json({ message: `Customer ${cusId} not found` });
    }
    throw err;
  }

  try {
    const result = await load(cusId, parseFilters(req.query));
    if (result === null) {
      return res.status(404).json({ message: `Customer ${cusId} not found` });
    }
    log.info({ cusId, summary: result.summary }, `${label}: sweep complete`);
    res.status(200).json(result);
  } catch (e) {
    log.error({ err: e.message, stack: e.stack, cusId }, `${label}: sweep failed`);
    res.status(500).json({ message: `Failed to run ${label}`, error: e.message });
  }
}

// GET /api/fieldworker/compliance/customer/:cus_id/claim-gaps
//   ?status=Ready to Bill | all   (default: Ready to Bill)
//   &startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//   &includeCompliant=true
// Requires MSAL Authorization header.
exports.getClaimGaps = function (req, res) {
  return handleGapRequest(req, res, { load: getClaimGapsForCustomer, label: 'claim gap sweep' });
};

// GET /api/fieldworker/compliance/customer/:cus_id/prior-auth-gaps
//   ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&includeCompliant=true
// Requires MSAL Authorization header.
exports.getPriorAuthGaps = function (req, res) {
  return handleGapRequest(req, res, { load: getPriorAuthGapsForCustomer, label: 'prior auth gap sweep' });
};

exports.getClaimGapsForCustomer = getClaimGapsForCustomer;
exports.getPriorAuthGapsForCustomer = getPriorAuthGapsForCustomer;
exports.CLAIM_STATUS_PENDING_SUBMISSION = CLAIM_STATUS_PENDING_SUBMISSION;
exports.ISSUE_NO_LINKED_TASKS = ISSUE_NO_LINKED_TASKS;
exports.ISSUE_UNJUSTIFIED_TASKS = ISSUE_UNJUSTIFIED_TASKS;
exports.ISSUE_UNITS_MISMATCH = ISSUE_UNITS_MISMATCH;
exports.ISSUE_UNITS_EXCEED_AUTH = ISSUE_UNITS_EXCEED_AUTH;
exports.ISSUE_NO_TASKS_IN_PERIOD = ISSUE_NO_TASKS_IN_PERIOD;
