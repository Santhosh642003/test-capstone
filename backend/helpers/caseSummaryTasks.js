const axios = require('axios');
const { pool: vectorPool } = require('./vectorDb');
const { embedTexts, toVectorLiteral } = require('./ragEmbeddings');
const { getCustomersAssociatedAPI } = require('./customers');
const { loadTaskCompliance, loadBusinessTypes, SUPPORT_COORDINATION } = require('./taskCompliance');
const elliq = require('./elliq');
const {
  RATE_LIMIT_STATUSES,
  FoundryRateLimitError,
  retryAfterFromHeaders,
  runFoundryRequest,
} = require('./foundryRateLimit');
const { defaultLogger: logger } = require('../logger');
const { getCurrentRequestLogger } = require('../loggerContext');
const config = require('../config');

const SIMILARITY_SEARCH_TOP_K = 10;

// Document types that describe care, as opposed to what was billed for it.
// runClinicalTask ranks across all of these at once; the revenue-cycle types
// the compliance sweep added (claim_line, prior_auth) are deliberately absent.
const CLINICAL_OBJECT_TYPES = ['customer', 'project', 'task', 'casenote'];

/**
 * Thrown when the caller's identity does not grant access to the requested
 * customer. Moved here from the retired helpers/caseSummaryIngestion.js.
 */
class CustomerAccessError extends Error {
  constructor(customerId) {
    super('Customer not found.');
    this.name = 'CustomerAccessError';
    this.customerId = customerId;
  }
}

/**
 * Verifies the caller's identity grants access to customerId.
 *
 * This is the authorisation boundary for the whole case-summary surface -- the
 * chat agent takes a customerId straight from model output, so nothing below
 * may run before this passes.
 *
 * @param {number|string} customerId
 * @param {{companyId: number, employeeId: number}} identity
 * @throws {CustomerAccessError}
 */
async function assertCustomerAccess(customerId, identity) {
  const log = getCurrentRequestLogger();
  const wanted = Number(customerId);

  if (!identity || !identity.companyId || !identity.employeeId || Number.isNaN(wanted)) {
    log.warn({ customerId }, 'assertCustomerAccess: Invalid identity parameters');
    throw new CustomerAccessError(customerId);
  }

  // getCustomersAssociatedAPI throws rather than returning [] for an unknown
  // company, and the PoC let that propagate as a raw TypeError -- which
  // runClinicalTask does not recognise as a denial, so it reported a generic
  // "failed to prepare data" instead. Every failure to establish access is a
  // denial, so normalise them all to CustomerAccessError.
  let customers;
  try {
    customers = await getCustomersAssociatedAPI(identity.companyId, identity.employeeId);
  } catch (err) {
    log.warn({ err: err.message, customerId, companyId: identity.companyId },
      'assertCustomerAccess: Customer lookup failed, treating as denied');
    throw new CustomerAccessError(customerId);
  }

  if (!Array.isArray(customers) || !customers.some((c) => Number(c.cus_id) === wanted)) {
    log.warn({ customerId, companyId: identity.companyId, employeeId: identity.employeeId },
      'assertCustomerAccess: Customer access denied');
    throw new CustomerAccessError(customerId);
  }
}

const CHAT_MODEL_NAME = config.FOUNDRY_LLM_MODEL || process.env.FOUNDRY_LLM_MODEL || 'gpt-4.1';
const DEFAULT_TEMPERATURE = 0.1;

const TASK_RETRIEVAL_QUERIES = {
  summary: 'patient background history diagnosis treatment care plan overview',
  risks: 'risk assessment safety concerns safeguarding mental health physical harm',
  open_issues: 'outstanding issues pending actions unresolved problems follow-up required',
  flags: 'urgent escalation immediate concern crisis safeguarding medication alert',
};

const TASK_PROMPTS = {
  summary: `Based on the following clinical notes, provide a structured summary.

CONTEXT:
{context}

Respond ONLY with valid JSON in this exact format:
{
  "patient_overview": "2-3 sentence overview of the patient and their situation",
  "key_presenting_issues": ["issue 1", "issue 2", "..."],
  "current_status": "Current clinical status in 1-2 sentences",
  "care_setting": "Current or most recent care setting",
  "time_period_covered": "Approximate time period the notes cover"
}`,

  risks: `Based on the following clinical notes, identify and categorise all patient risks.

CONTEXT:
{context}

Respond ONLY with valid JSON in this exact format:
{
  "clinical_risks": [{"risk": "description", "severity": "high|medium|low", "evidence": "quote or reference from notes"}],
  "safety_risks": [{"risk": "description", "severity": "high|medium|low", "evidence": "..."}],
  "social_risks": [{"risk": "description", "severity": "high|medium|low", "evidence": "..."}],
  "risk_summary": "Overall risk profile in 1-2 sentences"
}`,

  open_issues: `Based on the following clinical notes, identify all unresolved issues.

CONTEXT:
{context}

Respond ONLY with valid JSON in this exact format:
{
  "clinical_issues": [{"issue": "description", "since": "date or 'unknown'", "assigned_to": "clinician or 'unassigned'"}],
  "administrative_issues": [{"issue": "description", "since": "date or 'unknown'", "priority": "high|medium|low"}],
  "pending_actions": ["action 1", "action 2"],
  "issue_count": 0
}`,

  flags: `Based on the following clinical notes, identify items requiring URGENT attention or escalation.

CONTEXT:
{context}

Respond ONLY with valid JSON in this exact format:
{
  "urgent_flags": [{"flag": "description", "reason": "why urgent", "recommended_action": "what to do"}],
  "safeguarding_concerns": ["concern 1", "concern 2"],
  "medication_alerts": ["alert 1", "alert 2"],
  "requires_immediate_review": true
}`,
};

const INNER_SYSTEM_PROMPT =
  'You are a clinical document analyst. Your role is to process patient case notes, assessments, and clinical records accurately and concisely. ' +
  'Always base your analysis strictly on the provided context. Do not invent or assume information not present in the text. ' +
  'Respond in the exact JSON format requested.';

/**
 * Low-level chat-completions caller against FOUNDRY_URL.
 *
 * @param {Array<{role: string, content?: string}>} messages
 * @param {object} [extra] - Additional request body fields (e.g. `tools`).
 * @returns {Promise<{role: string, content?: string, tool_calls?: object[]}>} The assistant message.
 */
async function callChatCompletions(messages, extra = {}) {
  const log = getCurrentRequestLogger();
  log.info({ model: CHAT_MODEL_NAME, messageCount: messages.length, hasTools: !!extra.tools }, 'callChatCompletions: Sending request to Foundry chat completions');

  const startTime = performance.now();
  try {
    const response = await runFoundryRequest(async () => {
      try {
        return await axios.post(
          `${config.FOUNDRY_URL}/chat/completions`,
          { model: CHAT_MODEL_NAME, messages, temperature: DEFAULT_TEMPERATURE, ...extra },
          { headers: { Authorization: `Bearer ${config.FOUNDRY_API_KEY}` } },
        );
      } catch (err) {
        if (RATE_LIMIT_STATUSES.has(err.response?.status)) {
          throw new FoundryRateLimitError(err.response.status, retryAfterFromHeaders(err.response.headers));
        }
        throw err;
      }
    }, { label: 'case-summary-chat' });
    const latency_ms = Math.round(performance.now() - startTime);
    const choice = response.data?.choices?.[0]?.message;
    const usage = response.data?.usage || null;

    log.debug(
      {
        inference: {
          model: response.data?.model || CHAT_MODEL_NAME,
          temperature: DEFAULT_TEMPERATURE,
          latency_ms,
          http_status: response.status,
          prompt_tokens: usage?.prompt_tokens ?? null,
          completion_tokens: usage?.completion_tokens ?? null,
          total_tokens: usage?.total_tokens ?? null,
        },
        input: {
          message_count: messages.length,
          system_prompt: messages.find((m) => m.role === 'system')?.content,
          latest_user_message: messages.slice().reverse().find((m) => m.role === 'user')?.content,
        },
        output: {
          role: choice?.role,
          content: choice?.content || null,
          tool_calls: choice?.tool_calls || null,
        },
      },
      'callChatCompletions: Structured LLM inference telemetry',
    );

    return choice;
  } catch (err) {
    const latency_ms = Math.round(performance.now() - startTime);
    log.error({ err: err.message, latency_ms, stack: err.stack }, 'callChatCompletions: Failed to call Foundry chat completions');
    throw err;
  }
}

/**
 * Parses JSON output from model responses, with fallback regex extraction.
 */
function parseJsonOutput(text) {
  const log = getCurrentRequestLogger();
  const cleaned = (text || '').replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    log.warn('parseJsonOutput: Direct JSON parsing failed, attempting regex extraction fallback');
  }

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (err) {
      log.error('parseJsonOutput: Regex extraction failed to produce valid JSON');
    }
  }

  log.error('parseJsonOutput: Failed to parse structured output from model text');
  return null;
}

/**
 * Runs one clinical-analysis task (summary/risks/open_issues/flags) for a customer.
 *
 * @param {'summary'|'risks'|'open_issues'|'flags'} taskId
 * @param {number} customerId
 * @param {{companyId: number, employeeId: number}} ctx
 * @returns {Promise<object>} Parsed structured result, or `{ error }`.
 */
async function runClinicalTask(taskId, customerId, ctx) {
  const log = getCurrentRequestLogger();
  log.info({ taskId, customerId, companyId: ctx?.companyId, employeeId: ctx?.employeeId }, 'runClinicalTask: Executing clinical analysis task');

  try {
    await assertCustomerAccess(customerId, { companyId: ctx.companyId, employeeId: ctx.employeeId });
  } catch (err) {
    if (err instanceof CustomerAccessError) {
      log.warn({ taskId, customerId }, 'runClinicalTask: Customer access denied');
      // Worded for the model, not for a person. "Customer not found." reads as
      // "no such patient exists", and the agent duly relays that to the user as
      // a query about their spelling -- when the usual cause is an id the agent
      // guessed rather than resolved, because the tool message holding the real
      // one did not survive into this turn's history. Say what to do instead.
      // The HTTP surface keeps err.message: see complianceGaps, which 404s.
      return {
        error: `No accessible customer with id ${customerId}. Either that id was never resolved by a `
          + 'lookup, or the customer is outside this user\'s caseload. Call search_patient_by_name with '
          + 'the patient\'s name to obtain a valid customerId and retry. Do not guess an id, do not reuse '
          + 'one from an earlier turn, and do not tell the user the patient does not exist on the strength '
          + 'of this error.',
      };
    }
    log.error(err, `runClinicalTask(${taskId}): failed to verify customer access`);
    return { error: 'Failed to prepare customer data for analysis.' };
  }

  // Query and document vectors must come from the same model and width, so this
  // uses the same embedding client the sweep writes with (1536 dims). A mismatch
  // would be rejected by pgvector rather than silently returning nonsense.
  const [queryEmbedding] = await embedTexts([TASK_RETRIEVAL_QUERIES[taskId]]);
  const embeddingLiteral = toVectorLiteral(queryEmbedding);

  log.debug({ taskId, customerId }, 'runClinicalTask: Querying pgvector database for similarity matches');

  // Searches every *care* document type for the customer -- profile, projects,
  // tasks and case notes -- in one ranking, which is what the single rag_chunks
  // table exists for. object_type/section_title are returned so the retrieved
  // context tells the model where each passage came from.
  //
  // The type list is explicit rather than open because the store also holds
  // revenue-cycle documents (claim_line, prior_auth) for these same customers.
  // Those chunks are dense with the vocabulary these queries use -- dates,
  // units, procedure codes, task references -- so they compete for a top-K slot
  // and would push actual clinical material out of a fixed-size window. A
  // summary of someone's care should not be assembled from their billing.
  const result = await vectorPool.query(
    `SELECT content, object_type, section_title, 1 - (embedding <=> $1) AS similarity
       FROM rag_chunks
      WHERE customer_id = $2
        AND object_type = ANY($4)
      ORDER BY embedding <=> $1
      LIMIT $3`,
    [embeddingLiteral, Number(customerId), SIMILARITY_SEARCH_TOP_K, CLINICAL_OBJECT_TYPES],
  );

  log.info({ taskId, customerId, matchedRows: result.rows.length, topSimilarity: result.rows[0]?.similarity }, 'runClinicalTask: Similarity search complete');

  if (result.rows.length === 0) {
    log.warn({ taskId, customerId }, 'runClinicalTask: No content found in RAG store');
    return { error: `No case record content found for customer ${customerId}.` };
  }

  const context = result.rows
    .map((row) => {
      const source = [row.object_type, row.section_title].filter(Boolean).join(' | ');
      return `[${source} | similarity: ${Number(row.similarity).toFixed(2)}]\n${row.content}`;
    })
    .join('\n\n---\n\n');

  const userMessage = TASK_PROMPTS[taskId].replace('{context}', context);
  const assistantMessage = await callChatCompletions([
    { role: 'system', content: INNER_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ]);

  const parsed = parseJsonOutput(assistantMessage.content);

  log.debug(
    {
      clinical_task: {
        task_id: taskId,
        customer_id: customerId,
        company_id: ctx?.companyId,
        employee_id: ctx?.employeeId,
      },
      retrieval: {
        query: TASK_RETRIEVAL_QUERIES[taskId],
        matched_rows: result.rows.length,
        top_similarity: result.rows[0] ? Number(Number(result.rows[0].similarity).toFixed(4)) : null,
        retrieved_context_bytes: context.length,
      },
      raw_llm_output: assistantMessage.content || null,
      extraction_result: parsed,
    },
    'runClinicalTask: Clinical task inference & extraction telemetry',
  );

  log.info({ taskId, customerId, success: !!parsed }, 'runClinicalTask: Task execution finished');
  return parsed || { error: 'Failed to parse structured output from model.' };
}

// ---------------------------------------------------------------------------
// Multi-patient aggregated tools
//
// These read only pre-computed rows written by the nightly sweep
// (helpers/ragSync.js) -- no embedding calls happen on this path. Date-scoped
// tools (encounters, clinical highlights) resolve the in-scope task/casenote
// ids from SQL Server first (accurate visit/note dates aren't stored in the
// RAG tables) and then fetch the matching pre-embedded documents.
// ---------------------------------------------------------------------------

const MAX_AGGREGATE_DOCUMENTS = 60;

/** Active customers (cus_status === 'Active') the caller can access. */
async function getActiveCustomers(ctx) {
  const customers = await getCustomersAssociatedAPI(ctx.companyId, ctx.employeeId);
  if (!Array.isArray(customers)) return [];
  return customers.filter((c) => c.cus_status === 'Active');
}

const DEFAULT_LOOKBACK_DAYS = 14;

/**
 * Two weeks back from now -- the default lookback when the caller gives no
 * time period. Unbounded aggregation (e.g. "summarize all cases" with no
 * range) over years of case history is slow and floods the model's context,
 * so date-scoped tools always fall back to a bounded window rather than "all
 * history" when the user doesn't specify one.
 */
function defaultSinceBoundary() {
  return new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400000);
}

/**
 * Resolves the lookback start for a date-scoped aggregated tool.
 *
 * The model passes `since` (an ISO date) worked out from the user's own
 * phrasing -- "last month", "since March", "the past 3 days" -- so the
 * window isn't hardcoded to any one lookback. Falls back to the last two
 * weeks when the model omits it or sends something unparseable.
 *
 * @param {{since?: string}} args
 * @returns {{since: Date, label: string}}
 */
function resolveSince(args) {
  const parsed = args?.since ? new Date(args.since) : null;
  const valid = parsed && !Number.isNaN(parsed.getTime());

  return {
    since: valid ? parsed : defaultSinceBoundary(),
    label: valid ? `since ${parsed.toISOString().slice(0, 10)}` : 'the past two weeks',
  };
}

function buildAggregateContext(rows, customerNameById) {
  return rows
    .map((row) => {
      const name = customerNameById.get(Number(row.customer_id)) || `Customer ${row.customer_id}`;
      return `[Patient: ${name} | ID: ${row.customer_id}]\n${row.markdown}`;
    })
    .join('\n\n---\n\n');
}

const AGGREGATE_PROMPTS = {
  summarize_all_patients: `Based on the following patient profiles and completed task activity, provide a consolidated summary across all patients.

PATIENTS:
{context}

COMPLETED TASK ACTIVITY:
{task_digest}

Respond ONLY with valid JSON in this exact format:
{
  "overview": "2-3 sentence overview of the patient population",
  "patient_status_breakdown": [{"customer_id": 0, "name": "", "status": "..."}],
  "high_priority_care_needs": ["need 1", "need 2"],
  "completed_task_activity": {
    "period": "the window the task figures cover, copied from the block above",
    "tasks_completed": 0,
    "by_patient": [{"customer_id": 0, "name": "", "tasks_completed": 0}],
    "forms_outstanding": ["patient - task - which required form is missing"],
    "mt_outstanding": ["patient - task - MT id and status"]
  }
}
The completed_task_activity figures must be copied from the COMPLETED TASK ACTIVITY block, never inferred
from the patient profiles. If that block says no completed tasks were recorded, set tasks_completed to 0
and leave the lists empty.`,

  review_recent_encounters: `Based on the following visit/encounter records from {range_label}, review for issues.

ENCOUNTERS:
{context}

Respond ONLY with valid JSON in this exact format:
{
  "encounters_reviewed": 0,
  "missed_checkins": ["..."],
  "delayed_visits": ["..."],
  "unresolved_notes": ["..."],
  "operational_issues": ["..."],
  "summary": "1-2 sentence overall summary"
}`,

  review_clinical_highlights: `Based on the following clinical notes and assessments from {range_label}, extract key highlights.

CLINICAL NOTES:
{context}

Respond ONLY with valid JSON in this exact format:
{
  "key_observations": ["..."],
  "health_trends": ["..."],
  "risk_indicators": ["..."],
  "urgent_flags": ["..."],
  "summary": "1-2 sentence overall summary"
}`,
};

/**
 * Consolidates patient case summaries across all active patients, together with
 * the tasks completed for them in the window.
 *
 * The profile documents themselves are not date-scoped -- a profile is current
 * by construction. `since` bounds only the completed-task activity folded in
 * below it.
 *
 * @param {{since?: string}} args
 * @param {ToolCallContext} ctx
 */
async function summarizeAllPatients(args, ctx) {
  const log = getCurrentRequestLogger();
  const activeCustomers = await getActiveCustomers(ctx);
  if (activeCustomers.length === 0) {
    return { error: 'No active patients found for this user.' };
  }

  const nameById = new Map(activeCustomers.map((c) => [Number(c.cus_id), c.cus_name]));
  const activeIds = activeCustomers.map((c) => Number(c.cus_id));

  const result = await vectorPool.query(
    `SELECT customer_id, markdown
       FROM rag_documents
      WHERE object_type = 'customer'
        AND company_id = $1
        AND customer_id = ANY($2::bigint[])
      ORDER BY customer_id
      LIMIT $3`,
    [ctx.companyId, activeIds, MAX_AGGREGATE_DOCUMENTS],
  );

  log.info({ activePatients: activeIds.length, matchedDocuments: result.rows.length }, 'summarizeAllPatients: Retrieved patient documents');

  if (result.rows.length === 0) {
    return { error: 'No patient records found in the RAG store yet.' };
  }

  const context = buildAggregateContext(result.rows, nameById);

  // A consolidated summary that describes who the patients are but not what was
  // actually delivered for them is half an answer -- and the task facts are the
  // half a reviewer acts on. Read live and folded in as a digest rather than as
  // one line per visit, so the summary stays a summary.
  const { since, label } = resolveSince(args);
  const completed = await collectCompletedTasks(ctx, activeCustomers, since, nameById);

  const userMessage = AGGREGATE_PROMPTS.summarize_all_patients
    .replace('{context}', context)
    .replace('{task_digest}', renderCompletedTaskDigest(completed, label));
  const assistantMessage = await callChatCompletions([
    { role: 'system', content: INNER_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ]);

  const parsed = parseJsonOutput(assistantMessage.content);
  log.info({ success: !!parsed }, 'summarizeAllPatients: Task execution finished');
  return parsed || { error: 'Failed to parse structured output from model.' };
}

/**
 * Reviews visit/task encounters across all active patients for a caller-supplied
 * date range (defaults to last week and this week).
 *
 * @param {{since?: string}} args
 * @param {ToolCallContext} ctx
 */
async function reviewRecentEncounters(args, ctx) {
  const log = getCurrentRequestLogger();
  const activeCustomers = await getActiveCustomers(ctx);
  if (activeCustomers.length === 0) {
    return { error: 'No active patients found for this user.' };
  }

  const nameById = new Map(activeCustomers.map((c) => [Number(c.cus_id), c.cus_name]));
  const activeIds = activeCustomers.map((c) => Number(c.cus_id));
  const { since, label } = resolveSince(args);

  const taskIdLists = await Promise.all(
    activeCustomers.map((c) => elliq.listTaskIdsForCustomer(c.cus_id, { since })),
  );
  const taskIds = [...new Set(taskIdLists.flat())];

  if (taskIds.length === 0) {
    return { error: `No encounters found for ${label}.` };
  }

  const result = await vectorPool.query(
    `SELECT customer_id, markdown
       FROM rag_documents
      WHERE object_type = 'task'
        AND customer_id = ANY($1::bigint[])
        AND object_id = ANY($2::bigint[])
      ORDER BY customer_id
      LIMIT $3`,
    [activeIds, taskIds, MAX_AGGREGATE_DOCUMENTS],
  );

  log.info({ activePatients: activeIds.length, taskIdsInRange: taskIds.length, matchedDocuments: result.rows.length, rangeLabel: label }, 'reviewRecentEncounters: Retrieved encounter documents');

  if (result.rows.length === 0) {
    return { error: `No encounter records found in the RAG store for ${label}.` };
  }

  const context = buildAggregateContext(result.rows, nameById);
  const userMessage = AGGREGATE_PROMPTS.review_recent_encounters.replace('{context}', context).replace('{range_label}', label);
  const assistantMessage = await callChatCompletions([
    { role: 'system', content: INNER_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ]);

  const parsed = parseJsonOutput(assistantMessage.content);
  log.info({ success: !!parsed }, 'reviewRecentEncounters: Task execution finished');
  return parsed || { error: 'Failed to parse structured output from model.' };
}

/**
 * Reviews clinical case notes and assessments across all active patients for
 * a caller-supplied date range (defaults to last week and this week).
 *
 * @param {{since?: string}} args
 * @param {ToolCallContext} ctx
 */
async function reviewClinicalHighlights(args, ctx) {
  const log = getCurrentRequestLogger();
  const activeCustomers = await getActiveCustomers(ctx);
  if (activeCustomers.length === 0) {
    return { error: 'No active patients found for this user.' };
  }

  const nameById = new Map(activeCustomers.map((c) => [Number(c.cus_id), c.cus_name]));
  const activeIds = activeCustomers.map((c) => Number(c.cus_id));
  const { since, label } = resolveSince(args);

  const caseNoteIdLists = await Promise.all(
    activeCustomers.map((c) => elliq.listCaseNoteIdsForCustomer(c.cus_id, { since })),
  );
  const caseNoteIds = [...new Set(caseNoteIdLists.flat())];

  if (caseNoteIds.length === 0) {
    return { error: `No clinical notes found for ${label}.` };
  }

  const result = await vectorPool.query(
    `SELECT customer_id, markdown
       FROM rag_documents
      WHERE object_type = 'casenote'
        AND customer_id = ANY($1::bigint[])
        AND object_id = ANY($2::bigint[])
      ORDER BY customer_id
      LIMIT $3`,
    [activeIds, caseNoteIds, MAX_AGGREGATE_DOCUMENTS],
  );

  log.info({ activePatients: activeIds.length, caseNoteIdsInRange: caseNoteIds.length, matchedDocuments: result.rows.length, rangeLabel: label }, 'reviewClinicalHighlights: Retrieved clinical note documents');

  if (result.rows.length === 0) {
    return { error: `No clinical note records found in the RAG store for ${label}.` };
  }

  const context = buildAggregateContext(result.rows, nameById);
  const userMessage = AGGREGATE_PROMPTS.review_clinical_highlights.replace('{context}', context).replace('{range_label}', label);
  const assistantMessage = await callChatCompletions([
    { role: 'system', content: INNER_SYSTEM_PROMPT },
    { role: 'user', content: userMessage },
  ]);

  const parsed = parseJsonOutput(assistantMessage.content);
  log.info({ success: !!parsed }, 'reviewClinicalHighlights: Task execution finished');
  return parsed || { error: 'Failed to parse structured output from model.' };
}

// ---------------------------------------------------------------------------
// Completed task review (tasks delivered, the forms filed against them, and
// the MT that is supposed to justify them).
//
// Unlike the tools above, these facts are read live from SQL Server rather than
// the nightly pgvector index, for the reason helpers/complianceGaps.js gives:
// "which visits were completed, and which of their forms are missing" is a
// predicate, not a similarity, and a review that reports a form somebody filed
// this morning as missing trains its reader to ignore it. There is nothing to
// rank here, so there is nothing to embed.
//
// helpers/taskCompliance.js already resolves, per task, the forms mandated for
// its type, the submissions filed against it, its monthlymonitoring (MT) row
// and the deterministic justification verdict -- so this is a projection of
// that map, never a second opinion on it.
// ---------------------------------------------------------------------------

// Tasks whose compliance facts are loaded in one call. loadTaskCompliance
// inlines the ids into `IN (...)`, and a whole caseload's visits over a wide
// window is a query worth bounding. Newest first, since tas_id is an ascending
// IDENTITY.
const MAX_COMPLETED_TASK_IDS = 400;

// Tasks itemised in a tool result. The counts alongside them always cover
// everything loaded; only the per-task list is cut, and the result says so.
const MAX_COMPLETED_TASK_ROWS = 60;

// Stored datetimes are rendered by elliq.formatValue, not by re-parsing them
// here: task.tas_start_time is a VARCHAR holding local wall-clock time, and
// `new Date(...)` on it reads it as local and re-emits it as UTC -- a visit at
// 09:00 reported as 14:00.
const formatTaskDate = (value) => elliq.formatValue(value);

// Sorts on the formatted string rather than a parsed timestamp: 'YYYY-MM-DD
// HH:MM:SS' already sorts correctly as text, and it cannot disagree with the
// date the same task is displayed under. Undated tasks sort last.
function taskSortKey(task) {
  return formatTaskDate(task.startTime) || '';
}

/**
 * One completed task as the agent sees it: what was delivered, what was filed
 * against it, and whether that adds up.
 */
function toCompletedTaskFacts(task, customerNameById, mtApplicable) {
  return {
    taskId: task.taskId,
    customerId: task.customerId,
    ...(customerNameById ? { patient: customerNameById.get(Number(task.customerId)) || null } : {}),
    taskType: task.taskType,
    title: task.taskTitle,
    date: formatTaskDate(task.startTime),
    durationMinutes: task.minutes,
    durationSource: task.minutesSource,
    checkedIn: task.checkedIn,
    formsSubmitted: task.submittedForms.map((form) => ({
      name: form.formName || `Form ${form.formId}`,
      submittedOn: formatTaskDate(form.createdOn),
    })),
    formsMissing: task.missingForms.map((form) => form.formName || `Form ${form.formId}`),
    ...(mtApplicable
      ? {
        mt: task.mt
          ? {
            id: task.mt.id,
            status: task.mt.status,
            submitted: task.mt.submitted,
            approved: task.mt.approved,
            period: task.mt.period,
            reviewedOn: formatTaskDate(task.mt.reviewedOn),
          }
          : null,
      }
      : {}),
    justified: task.justification.justified,
    justificationRule: task.justification.rule,
    justificationReason: task.justification.reason,
  };
}

/**
 * Completed tasks for a set of customers within a window, with their forms and MT.
 *
 * @param {ToolCallContext} ctx
 * @param {{cus_id: number}[]} customers
 * @param {Date|null} since
 * @param {Map<number, string>} [customerNameById] - omitted by single-patient
 *   callers, which already know whose tasks they asked for.
 * @returns {Promise<{tasks: object[], totals: object, truncated: boolean, mtApplicable: boolean}>}
 */
async function collectCompletedTasks(ctx, customers, since, customerNameById) {
  const log = getCurrentRequestLogger();

  const businessTypes = await loadBusinessTypes([ctx.companyId]);
  const mtApplicable = businessTypes.get(Number(ctx.companyId)) === SUPPORT_COORDINATION;

  const idLists = await Promise.all(
    customers.map((c) => elliq.listTaskIdsForCustomer(c.cus_id, { since, completedOnly: true })),
  );
  const allIds = [...new Set(idLists.flat())].map(Number).sort((a, b) => b - a);
  const taskIds = allIds.slice(0, MAX_COMPLETED_TASK_IDS);

  if (taskIds.length === 0) {
    return { tasks: [], totals: { tasksCompleted: 0, byPatient: [] }, truncated: false, mtApplicable };
  }

  const complianceMap = await loadTaskCompliance(taskIds);
  const tasks = [...complianceMap.values()]
    .sort((a, b) => taskSortKey(b).localeCompare(taskSortKey(a)))
    .map((task) => toCompletedTaskFacts(task, customerNameById, mtApplicable));

  const byPatient = new Map();
  for (const task of tasks) {
    const entry = byPatient.get(task.customerId) || {
      customerId: task.customerId,
      ...(customerNameById ? { patient: customerNameById.get(Number(task.customerId)) || null } : {}),
      tasksCompleted: 0,
    };
    entry.tasksCompleted += 1;
    byPatient.set(task.customerId, entry);
  }

  const totals = {
    tasksCompleted: tasks.length,
    tasksWithMissingForms: tasks.filter((t) => t.formsMissing.length > 0).length,
    formsSubmitted: tasks.reduce((sum, t) => sum + t.formsSubmitted.length, 0),
    // "0 of 0 tasks with an approved MT" is a finding to a reader who does not
    // know MT is a Support Coordination instrument, so the counts are absent
    // rather than zero for every other business type.
    ...(mtApplicable
      ? {
        tasksWithMt: tasks.filter((t) => t.mt).length,
        tasksWithApprovedMt: tasks.filter((t) => t.mt && t.mt.approved).length,
      }
      : {}),
    tasksNotJustified: tasks.filter((t) => !t.justified).length,
    byPatient: [...byPatient.values()].sort((a, b) => b.tasksCompleted - a.tasksCompleted),
  };

  log.info(
    { customerCount: customers.length, completedTaskIds: allIds.length, loadedTasks: tasks.length, tasksWithMissingForms: totals.tasksWithMissingForms },
    'collectCompletedTasks: Loaded completed task compliance facts',
  );

  return { tasks, totals, truncated: allIds.length > taskIds.length, mtApplicable };
}

/**
 * Shapes a collectCompletedTasks result into a tool return value: the counts,
 * a capped list, and an explicit word when something was left out.
 */
function completedTaskResult({ tasks, totals, truncated, mtApplicable }, label) {
  const listed = tasks.slice(0, MAX_COMPLETED_TASK_ROWS);
  const cut = truncated || tasks.length > listed.length;
  return {
    range: label,
    // Stated rather than implied: a result carrying no MT fields must not be
    // read as "these tasks have no MT".
    mtTracked: mtApplicable,
    ...(mtApplicable
      ? {}
      : { mtNote: 'Monitoring tools (MTs) are a Support Coordination instrument and are not tracked for this company. Do not report MT as missing, outstanding or unapproved; these tasks are judged on their mandated forms instead.' }),
    totals,
    tasks: listed,
    ...(cut
      ? {
        note: `The counts cover ${tasks.length} completed tasks; only the ${listed.length} most recent are `
          + 'itemised here. Say so if the user needs the rest, and suggest a narrower date range.',
      }
      : {}),
  };
}

/**
 * Completed tasks for one patient, with the forms filed against each and its MT.
 *
 * @param {{customerId: number, since?: string}} args
 * @param {ToolCallContext} ctx
 */
async function getCompletedTasks(args, ctx) {
  const log = getCurrentRequestLogger();
  const customerId = Number(args.customerId);

  try {
    await assertCustomerAccess(customerId, { companyId: ctx.companyId, employeeId: ctx.employeeId });
  } catch (err) {
    if (err instanceof CustomerAccessError) {
      log.warn({ customerId }, 'getCompletedTasks: Customer access denied');
      return {
        error: `No accessible customer with id ${customerId}. Call search_patient_by_name with the `
          + 'patient\'s name to obtain a valid customerId and retry. Do not guess an id, do not reuse one '
          + 'from an earlier turn, and do not tell the user the patient does not exist on the strength of '
          + 'this error.',
      };
    }
    log.error(err, 'getCompletedTasks: Failed to verify customer access');
    return { error: 'Failed to prepare customer data for analysis.' };
  }

  const { since, label } = resolveSince(args);
  const collected = await collectCompletedTasks(ctx, [{ cus_id: customerId }], since);

  if (collected.totals.tasksCompleted === 0) {
    return { error: `No completed tasks found for customer ${customerId} for ${label}.` };
  }

  log.info({ customerId, tasksCompleted: collected.totals.tasksCompleted, rangeLabel: label }, 'getCompletedTasks: Task execution finished');
  return completedTaskResult(collected, label);
}

/**
 * Completed tasks across every active patient associated with the user, with
 * their forms and MT.
 *
 * @param {{since?: string}} args
 * @param {ToolCallContext} ctx
 */
async function reviewCompletedTasks(args, ctx) {
  const log = getCurrentRequestLogger();
  const activeCustomers = await getActiveCustomers(ctx);
  if (activeCustomers.length === 0) {
    return { error: 'No active patients found for this user.' };
  }

  const nameById = new Map(activeCustomers.map((c) => [Number(c.cus_id), c.cus_name]));
  const { since, label } = resolveSince(args);
  const collected = await collectCompletedTasks(ctx, activeCustomers, since, nameById);

  if (collected.totals.tasksCompleted === 0) {
    return { error: `No completed tasks found across this user's active patients for ${label}.` };
  }

  log.info({ activePatients: activeCustomers.length, tasksCompleted: collected.totals.tasksCompleted, rangeLabel: label }, 'reviewCompletedTasks: Task execution finished');
  return completedTaskResult(collected, label);
}

/**
 * The completed-task block folded into the consolidated summary.
 *
 * Compact on purpose: the summary already carries a profile document per
 * patient, so this contributes counts and the exceptions worth naming, not one
 * line per visit.
 */
function renderCompletedTaskDigest({ tasks, totals, mtApplicable }, label) {
  if (totals.tasksCompleted === 0) return `No completed tasks recorded for ${label}.`;

  const perPatient = totals.byPatient
    .map((entry) => `- ${entry.patient || `Customer ${entry.customerId}`} (ID ${entry.customerId}): ${entry.tasksCompleted} completed`)
    .join('\n');

  const missingForms = tasks
    .filter((task) => task.formsMissing.length > 0)
    .slice(0, MAX_COMPLETED_TASK_ROWS)
    .map((task) => `- ${task.patient || `Customer ${task.customerId}`} | task ${task.taskId} (${task.taskType || 'task'}, ${task.date || 'date unknown'}): missing ${task.formsMissing.join(', ')}`)
    .join('\n');

  const mtOutstanding = !mtApplicable ? '' : tasks
    .filter((task) => task.mt && !task.mt.approved)
    .slice(0, MAX_COMPLETED_TASK_ROWS)
    .map((task) => `- ${task.patient || `Customer ${task.customerId}`} | task ${task.taskId}: MT ${task.mt.id} status ${task.mt.status || 'unknown'}`)
    .join('\n');

  return [
    `Window: ${label}`,
    `Totals: ${totals.tasksCompleted} completed tasks, ${totals.formsSubmitted} forms submitted, `
      + `${totals.tasksWithMissingForms} tasks with a missing required form, `
      + (mtApplicable ? `${totals.tasksWithApprovedMt} of ${totals.tasksWithMt} tasks with an approved MT, ` : '')
      + `${totals.tasksNotJustified} not justified.`,
    ...(mtApplicable
      ? []
      : ['MTs are not tracked for this company (Support Coordination only); leave completed_task_activity.mt_outstanding empty.']),
    '',
    'Completed per patient:',
    perPatient,
    ...(missingForms ? ['', 'Tasks with missing required forms:', missingForms] : []),
    ...(mtOutstanding ? ['', 'Completed tasks whose MT is not approved:', mtOutstanding] : []),
  ].join('\n');
}

module.exports = {
  CHAT_MODEL_NAME,
  callChatCompletions,
  runClinicalTask,
  CustomerAccessError,
  assertCustomerAccess,
  summarizeAllPatients,
  reviewRecentEncounters,
  reviewClinicalHighlights,
  getCompletedTasks,
  reviewCompletedTasks,
  collectCompletedTasks,
};
