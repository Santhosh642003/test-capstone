// ---------------------------------------------------------------------------
// Nightly QA sweep (Scenario 3 -- missing actions / compliance gaps).
//
// Combines the deterministic exceptions from helpers/complianceGaps.js with an
// LLM narrative verdict, and persists the merged result to qa_sweep_history
// (db/mssql/001_qa_sweep_history.sql) for the Compliance dashboard to render.
//
// Mirrors the shape of helpers/ragSync.js: iterate -> build -> write, wrapped
// in a node-schedule job registered once from index.js. Unlike ragSync this
// job does not maintain its own watermark -- complianceGaps reads SQL Server
// live (see the header comment there), so every run re-examines every active
// customer's current exceptions rather than a delta.
//
// The LLM's only job here is the one thing complianceGaps.js cannot compute:
// whether the task narrative text justifies what was billed. It never touches
// unit arithmetic -- that is already decided by helpers/taskCompliance.js and
// handed to it as fact.
// ---------------------------------------------------------------------------

const schedule = require('node-schedule');

const { DBSendResponseParam } = require('../queries/commonQueries');
const { getClaimGapsForCustomer, getPriorAuthGapsForCustomer } = require('./complianceGaps');
const elliq = require('./elliq');
const { callChatCompletions } = require('./caseSummaryTasks');
const { defaultLogger: logger } = require('../logger');

const QA_SWEEP_ENABLED = true;

// Hour of the nightly run, America/New_York. Runs after the RAG sync (2am) so
// the two nightly jobs don't contend for the same SQL Server pool at once.
const QA_SWEEP_CRON_HOUR = 3;

// Only claim lines / prior auths carrying at least one deterministic issue are
// worth an LLM call -- a clean record has nothing for the model to narrate.
const GAP_FILTERS = { includeCompliant: false };

// Guardrail restated in the prompt itself: the model is a narrative judge, not
// a calculator. It is handed the unit figures as already-decided fact.
const NARRATIVE_SYSTEM_PROMPT =
  'You are a Medicaid billing compliance reviewer. You are given the deterministic facts of one '
  + 'billing exception (unit counts, dates, linked task ids) and the narrative text employees wrote '
  + 'for the linked visits. Your only job is to judge whether that narrative text explicitly '
  + 'justifies the services being billed. Do not recompute units, dates or eligibility -- those are '
  + 'already decided and handed to you as fact. Base your answer strictly on the narrative text '
  + 'provided; do not invent details. Respond ONLY with valid JSON in this exact format: '
  + '{"justified": true|false, "confidence": "high"|"medium"|"low", "rationale": "1-3 sentence explanation citing the narrative"}';

/** Best-effort JSON parse of a model response, tolerant of a code fence. */
function parseVerdict(content) {
  const cleaned = (content || '').replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      justified: typeof parsed.justified === 'boolean' ? parsed.justified : null,
      confidence: parsed.confidence || null,
      rationale: parsed.rationale || null,
    };
  } catch (err) {
    return { justified: null, confidence: null, rationale: null, parse_error: content || null };
  }
}

/**
 * Fetches the markdown narrative for a set of tasks and asks the LLM whether,
 * together, they justify the billed exception described by `facts`.
 *
 * @param {Object} facts deterministic summary handed to the model as-is.
 * @param {Array<number>} taskIds tasks linked to the claim/auth.
 * @returns {Promise<Object>} { justified, confidence, rationale, model } or a
 *   null-verdict object when there is nothing to narrate.
 */
async function evaluateNarrative(facts, taskIds) {
  if (!taskIds.length) {
    return { justified: false, confidence: 'high', rationale: 'No linked task narrative exists to evaluate.', model: null };
  }

  const narratives = [];
  for (const taskId of taskIds) {
    const markdown = await elliq.buildTaskMarkdown(taskId);
    if (markdown) narratives.push(markdown);
  }

  if (!narratives.length) {
    return { justified: false, confidence: 'high', rationale: 'Linked tasks could not be loaded.', model: null };
  }

  const userMessage = [
    'Billing exception facts (already computed, do not recompute):',
    '```json',
    JSON.stringify(facts, null, 2),
    '```',
    '',
    'Narrative text for the linked task(s):',
    '',
    narratives.join('\n\n---\n\n'),
  ].join('\n');

  const assistantMessage = await callChatCompletions([
    { role: 'system', content: NARRATIVE_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ]);

  const verdict = parseVerdict(assistantMessage?.content);
  return { ...verdict, model: assistantMessage?.model || null };
}

/**
 * Inserts one merged (SQL facts + LLM verdict) row into qa_sweep_history.
 */
async function writeSweepRecord({ companyId, cusId, gapType, claimId, priorAuthId, issueCodes, sqlFacts, llmVerdict }) {
  await DBSendResponseParam(
    `INSERT INTO qa_sweep_history
            (company_id, cus_id, gap_type, claim_id, prior_auth_id, issue_codes, sql_facts, llm_verdict, swept_at)
     VALUES (@companyId, @cusId, @gapType, @claimId, @priorAuthId, @issueCodes, @sqlFacts, @llmVerdict, GETDATE())`,
    {
      companyId,
      cusId,
      gapType,
      claimId: claimId ?? null,
      priorAuthId: priorAuthId ?? null,
      issueCodes: issueCodes.join(','),
      sqlFacts: JSON.stringify(sqlFacts),
      llmVerdict: JSON.stringify(llmVerdict),
    },
  );
}

/**
 * Runs the claim-gap strategy for one customer: fetches the deterministic
 * exceptions, narrates each one, and writes the merged record.
 */
async function sweepClaimGapsForCustomer(companyId, cusId, stats) {
  const result = await getClaimGapsForCustomer(cusId, GAP_FILTERS);
  if (!result) return;

  for (const claim of result.claims) {
    try {
      const taskIds = claim.tasks.map((task) => task.task_id);
      const llmVerdict = await evaluateNarrative(
        {
          claim_id: claim.claim_id,
          claim_status: claim.claim_status,
          procedure_code: claim.procedure_code,
          service_start_date: claim.service_start_date,
          service_end_date: claim.service_end_date,
          units_billed: claim.units_billed,
          units_delivered: claim.units_delivered,
          unit_of_service: claim.unit_of_service,
          issues: claim.issues,
        },
        taskIds,
      );

      await writeSweepRecord({
        companyId,
        cusId,
        gapType: 'claim',
        claimId: claim.claim_id,
        priorAuthId: null,
        issueCodes: claim.issues.map((issue) => issue.code),
        sqlFacts: claim,
        llmVerdict,
      });
      stats.recordsWritten += 1;
    } catch (err) {
      stats.recordsFailed += 1;
      logger.error({ err: err.message, cusId, claimId: claim.claim_id }, 'qaSweepJob: Claim gap narration failed, continuing');
    }
  }
}

/**
 * Runs the prior-auth-gap strategy for one customer.
 */
async function sweepPriorAuthGapsForCustomer(companyId, cusId, stats) {
  const result = await getPriorAuthGapsForCustomer(cusId, GAP_FILTERS);
  if (!result) return;

  for (const auth of result.authorizations) {
    try {
      const taskIds = auth.tasks.map((task) => task.task_id);
      const llmVerdict = await evaluateNarrative(
        {
          prior_auth_id: auth.prior_auth_id,
          prior_auth: auth.prior_auth,
          procedure_code: auth.procedure_code,
          auth_start_date: auth.auth_start_date,
          auth_end_date: auth.auth_end_date,
          units_approved: auth.units_approved,
          units_billed: auth.units_billed,
          units_delivered: auth.units_delivered,
          unit_of_service: auth.unit_of_service,
          issues: auth.issues,
        },
        taskIds,
      );

      await writeSweepRecord({
        companyId,
        cusId,
        gapType: 'prior_auth',
        claimId: null,
        priorAuthId: auth.prior_auth_id,
        issueCodes: auth.issues.map((issue) => issue.code),
        sqlFacts: auth,
        llmVerdict,
      });
      stats.recordsWritten += 1;
    } catch (err) {
      stats.recordsFailed += 1;
      logger.error({ err: err.message, cusId, priorAuthId: auth.prior_auth_id }, 'qaSweepJob: Prior auth gap narration failed, continuing');
    }
  }
}

/** Active customers in scope for one company's sweep. */
async function listActiveCustomers(companyId) {
  const rows = await DBSendResponseParam(
    `SELECT cus_id FROM customer
      WHERE cus_company_id = @companyId AND cus_status = 'Active' AND cus_is_active = 1
      ORDER BY cus_id`,
    { companyId },
  );
  return (rows || []).map((row) => row.cus_id);
}

/**
 * Sweeps one company: every active customer, both gap strategies.
 *
 * @param {number} companyId
 * @returns {Promise<Object>} run statistics.
 */
async function runCompanySweep(companyId) {
  const stats = { companyId, customersProcessed: 0, customersFailed: 0, recordsWritten: 0, recordsFailed: 0 };
  const customers = await listActiveCustomers(companyId);

  logger.info({ companyId, customers: customers.length }, 'qaSweepJob: Starting company sweep');

  for (const cusId of customers) {
    try {
      await sweepClaimGapsForCustomer(companyId, cusId, stats);
      await sweepPriorAuthGapsForCustomer(companyId, cusId, stats);
      stats.customersProcessed += 1;
    } catch (err) {
      stats.customersFailed += 1;
      logger.error({ err: err.message, companyId, cusId }, 'qaSweepJob: Customer sweep failed, continuing');
    }
  }

  logger.info({ ...stats }, 'qaSweepJob: Company sweep complete');
  return stats;
}

/** Every active company (com_is_active is stored as the string 'True'). */
async function listActiveCompanies() {
  const rows = await DBSendResponseParam(
    `SELECT com_id FROM company WHERE com_is_active = 'True' ORDER BY com_id`,
  );
  return (rows || []).map((row) => row.com_id);
}

/**
 * Runs the sweep for every active company.
 *
 * @param {Object} [options]
 * @param {Array<number>} [options.companyIds] override the active-company
 *   lookup; for manual backfills and debugging only.
 * @returns {Promise<Object[]>} per-company statistics.
 */
async function runNightlySweep({ companyIds: override } = {}) {
  const companyIds = override || await listActiveCompanies();
  if (!companyIds.length) {
    logger.warn('qaSweepJob: No active companies, nothing to do');
    return [];
  }

  const results = [];
  for (const companyId of companyIds) {
    try {
      results.push(await runCompanySweep(companyId));
    } catch (err) {
      logger.error({ err: err.message, companyId }, 'qaSweepJob: Skipping company after failure');
    }
  }
  return results;
}

/** Registers the nightly job. Called once from index.js at boot. */
function scheduleNightlySweep() {
  if (!QA_SWEEP_ENABLED) {
    logger.info('qaSweepJob: Disabled (QA_SWEEP_ENABLED=false), nightly job not scheduled');
    return;
  }

  const rule = { hour: QA_SWEEP_CRON_HOUR, minute: 0, tz: 'America/New_York' };
  schedule.scheduleJob(rule, async () => {
    try {
      await runNightlySweep();
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, 'qaSweepJob: Nightly sweep threw');
    }
  });

  logger.info({ hour: QA_SWEEP_CRON_HOUR }, 'qaSweepJob: Nightly sweep scheduled');
}

// ---------------------------------------------------------------------------
// TESTING ONLY -- manual trigger for the sweep, wired to a dashboard button so
// the whole pipeline (SQL gap detection -> LLM narrative -> qa_sweep_history
// write -> dashboard read) can be exercised on demand against real dev data
// without waiting for the 3am cron.
//
// Before merging: delete this handler, delete its route in
// routes/compliance.js, and delete the "Run Sweep Now" button in
// ComplianceDashboard.js. See index.js for the matching cron re-enable step.
// ---------------------------------------------------------------------------
async function runSweepNowHandler(req, res) {
  const identity = req.callerIdentity;
  if (!identity?.companyId) {
    return res.status(401).json({ message: 'Unable to resolve caller identity' });
  }

  try {
    const stats = await runCompanySweep(identity.companyId);
    logger.info({ stats }, 'qaSweepJob: Manual sweep triggered via /compliance/run-now');
    res.status(200).json({ message: 'Sweep complete', stats });
  } catch (e) {
    logger.error({ err: e.message, stack: e.stack, companyId: identity.companyId }, 'qaSweepJob: Manual sweep failed');
    res.status(500).json({ message: 'Sweep failed', error: e.message });
  }
}

module.exports = {
  scheduleNightlySweep,
  runNightlySweep,
  runCompanySweep,
  runSweepNowHandler, // TESTING ONLY -- see comment above, remove before merge.
};
