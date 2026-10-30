// ---------------------------------------------------------------------------
// Nightly incremental RAG sync.
//
// Rebuilds the markdown documents produced by helpers/elliq.js and keeps the
// pgvector store (rag_documents / rag_chunks) in step with SQL Server.
//
// Change detection is hash-based rather than purely timestamp-based, because
// the source data cannot support a watermark on its own:
//
//   * customer.cus_updated_at is a DATE -- day granularity only.
//   * customer_goal / customer_health_need / customer_support_need /
//     customer_adl / customer_extension have no timestamp columns at all, yet
//     all of them feed buildCustomerMarkdown.
//   * comments.isDeleted (soft delete) does not bump comments.updated_at.
//   * Claim has no updated-at column, so a status edit changes nothing a
//     watermark can see -- and claim status is the whole basis of the
//     compliance sweep.
//
// So the watermark is used only to narrow the *candidate* set cheaply, and the
// SHA-256 of each rendered document is the authority on whether anything
// actually changed. Unchanged documents cost zero embedding calls, which is
// what makes the periodic full sweep -- the safety net for the untimestamped
// tables -- affordable.
//
// Schema: db/pgvector/001_rag_schema.sql
// ---------------------------------------------------------------------------

const crypto = require('crypto');
const schedule = require('node-schedule');

const config = require('../config');
const { DBSendResponseParam } = require('../queries/commonQueries');
const { pool } = require('./vectorDb');
const { chunkDocument } = require('./ragChunking');
const { embedTextsBatched, toVectorLiteral } = require('./ragEmbeddings');
const { loadTaskCompliance } = require('./taskCompliance');
const elliq = require('./elliq');
const { defaultLogger: logger } = require('../logger');

// --- Settings --------------------------------------------------------------

const RAG_SYNC_ENABLED = true;

const RAG_AI_COMPANION_FEATURE_ID = 26;

// Hour of the nightly run, America/New_York.
const RAG_SYNC_CRON_HOUR = 2;

// How stale a full sweep may get. The sweep is the only thing that catches
// edits to customer_goal / customer_health_need / customer_support_need /
// customer_adl / customer_extension, none of which have timestamp columns.
const RAG_FULL_SWEEP_DAYS = 7;

// Rewind applied to the watermark, covering rows written while the previous
// run was in flight. Free, because re-examined documents hash-match.
const RAG_WATERMARK_OVERLAP_MINUTES = 120;

// How far back tasks and case notes are ingested. null = all history.
// Widening this later needs no migration: the next full sweep sees the older
// ids appear, hashes them as new, and backfills them.
const RAG_LOOKBACK_DAYS = 90;

// How far back claim lines and prior authorizations are ingested, measured on
// their own service/authorization dates rather than on task start times.
//
// Wider than RAG_LOOKBACK_DAYS on purpose: an authorization runs for a plan
// year, and a claim line still sitting at 'Ready to Bill' months after the
// service date is the single most interesting record a compliance sweep can
// find. Windowing these to 90 days would hide exactly the backlog the QA
// coordinator is looking for. They are also far lower volume than tasks, so the
// wider window costs little.
const RAG_BILLING_LOOKBACK_DAYS = 400;

// Customer lifecycle statuses in ingestion scope.
//
// cus_status is the lifecycle field -- 'Active' / 'Inactive' / 'Prospect' /
// 'Dormant' / 'Transferred Out' -- maintained automatically by
// sp_updateCustomerStatus from the customer's project dates, and it is what the
// rest of the API filters on (helpers/reports.js, customers.js, comment.js,
// directories.js). Not to be confused with cus_is_active, which is the
// soft-delete flag set by helpers/delete.js and filtered separately below.
//
// A list rather than a boolean so widening scope (e.g. adding 'Dormant') is a
// one-line change. Statuses outside it are pruned on each full sweep by
// pruneOutOfScopeCustomers rather than left behind stale: a discharged client's
// documents going unrefreshed but still retrievable is worse than them being
// absent. A customer returning to scope is re-ingested on the next sweep.
const RAG_CUSTOMER_STATUSES = ['Active'];

// Stops a long backfill from running into business hours and competing with
// live traffic for the SQL Server pool. A run that hits the cap stops cleanly
// and resumes the next night. 0 = uncapped.
const RAG_SYNC_MAX_RUNTIME_MINUTES = 240;

// Arbitrary fixed base key. Every container instance boots the same scheduler,
// so the advisory lock is what keeps exactly one of them doing the work. This
// is stricter than the jitter + "did it run today" log-table guard used by
// report_schedule.js, which still races when two instances wake together.
const RAG_SYNC_LOCK_NAMESPACE = 8274451001;

/**
 * The lock key, namespaced by the SQL Server database being indexed.
 *
 * The lock lives in the pgvector store, and dev and test share one of those
 * while reading from *different* SQL Server databases. With a single fixed key
 * they contend: both schedulers fire at the same instant, pg_try_advisory_lock
 * is non-blocking so the loser does not retry, and one environment silently
 * skips the whole night. That is not a hypothetical -- it is why company 2004
 * (dev) has no run on 2026-08-19 and the test companies have none since.
 *
 * Keying on config.APIDB rather than config.env isolates by *data source*, which
 * is what actually must not be synced twice concurrently. Two environments
 * pointed at the same database still share a key, and an environment renamed
 * without its database changing keeps the same one.
 *
 * @param {string} database SQL Server database name.
 * @returns {number} lock key, safely inside bigint range.
 */
function syncLockKey(database) {
  // A sha256 slice rather than APIDB's own hash, so the key is stable across
  // restarts, deploys and Node versions. Unsigned, so it can only ever push the
  // key above the namespace, never below it into another feature's range.
  const offset = crypto.createHash('sha256').update(String(database), 'utf8').digest().readUInt32BE(0);
  return RAG_SYNC_LOCK_NAMESPACE + offset;
}

const RAG_SYNC_LOCK_KEY = syncLockKey(config.APIDB);

// ---------------------------------------------------------------------------
// Advisory lock
// ---------------------------------------------------------------------------

/**
 * Takes the cross-instance sync lock.
 *
 * The lock is session-scoped, so it is held on one dedicated client for the
 * whole run rather than borrowed from the pool per query.
 *
 * @returns {Promise<{release: () => Promise<void>}|null>} null when another
 *   instance already holds it.
 */
async function acquireSyncLock() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1::bigint) AS acquired', [RAG_SYNC_LOCK_KEY]);
    if (!rows[0].acquired) {
      client.release();
      return null;
    }
    return {
      release: async () => {
        try {
          await client.query('SELECT pg_advisory_unlock($1::bigint)', [RAG_SYNC_LOCK_KEY]);
        } finally {
          client.release();
        }
      },
    };
  } catch (err) {
    client.release();
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sync state + run log
// ---------------------------------------------------------------------------

async function loadSyncState(companyId) {
  const { rows } = await pool.query(
    'SELECT company_id, watermark, last_full_sweep_at FROM rag_sync_state WHERE company_id = $1',
    [companyId],
  );
  return rows[0] || null;
}

/**
 * Full sweep when we have never swept, or when the last one has aged out.
 * A company with no state row therefore backfills on its first ever run --
 * there is no separate backfill step.
 */
function decideMode(state, force) {
  if (force === 'full') return 'full';
  if (force === 'incremental') return 'incremental';
  if (!state || !state.last_full_sweep_at) return 'full';
  const ageDays = (Date.now() - new Date(state.last_full_sweep_at).getTime()) / 86400000;
  return ageDays >= RAG_FULL_SWEEP_DAYS ? 'full' : 'incremental';
}

/**
 * Watermark rewound by a safety overlap, to catch rows written while the
 * previous run was mid-flight. The overlap costs nothing: re-examined
 * documents hash-match and are skipped.
 */
function incrementalCutoff(state) {
  const watermark = state ? new Date(state.watermark) : new Date('1900-01-01T00:00:00Z');
  return new Date(watermark.getTime() - RAG_WATERMARK_OVERLAP_MINUTES * 60000);
}

async function startRunLog(companyId, mode) {
  const { rows } = await pool.query(
    'INSERT INTO rag_sync_runs (company_id, mode) VALUES ($1, $2) RETURNING id',
    [companyId, mode],
  );
  return rows[0].id;
}

async function finishRunLog(runId, status, stats, errorMessage) {
  await pool.query(
    `UPDATE rag_sync_runs
        SET status = $2, finished_at = now(), candidates = $3, customers_processed = $4,
            customers_failed = $5, documents_changed = $6, documents_unchanged = $7,
            documents_deleted = $8, chunks_written = $9, error = $10
      WHERE id = $1`,
    [
      runId, status, stats.candidates, stats.customersProcessed, stats.customersFailed,
      stats.documentsChanged, stats.documentsUnchanged, stats.documentsDeleted,
      stats.chunksWritten, errorMessage || null,
    ],
  );
}

async function saveSyncState(companyId, watermark, fullSweepAt) {
  await pool.query(
    `INSERT INTO rag_sync_state (company_id, watermark, last_full_sweep_at, updated_at)
          VALUES ($1, $2, $3, now())
     ON CONFLICT (company_id) DO UPDATE
             SET watermark = EXCLUDED.watermark,
                 last_full_sweep_at = COALESCE(EXCLUDED.last_full_sweep_at, rag_sync_state.last_full_sweep_at),
                 updated_at = now()`,
    [companyId, watermark, fullSweepAt],
  );
}

// ---------------------------------------------------------------------------
// Candidate discovery (SQL Server)
// ---------------------------------------------------------------------------

/**
 * Scope predicate shared by both candidate queries: a customer is in scope when
 * its lifecycle status is one we ingest and it has not been soft-deleted.
 *
 * Both conditions are needed and they mean different things -- cus_status is the
 * lifecycle, cus_is_active is the delete flag (helpers/delete.js). The strict
 * `= 1` matches the rest of the API (customers.js:2333, evv_nj.js:168,
 * monthlymonitoring.js); NULL rows are already invisible everywhere else, and
 * surfacing them only through retrieval would be surprising.
 *
 * @param {string} alias table alias for `customer` in the surrounding query.
 * @returns {{sql: string, params: Object}}
 */
function customerScopeFilter(alias) {
  const params = {};
  const placeholders = RAG_CUSTOMER_STATUSES.map((status, i) => {
    params[`status${i}`] = status;
    return `@status${i}`;
  });
  return {
    sql: `${alias}.cus_status IN (${placeholders.join(', ')}) AND ${alias}.cus_is_active = 1`,
    params,
  };
}

/**
 * Companies subscribed to the AI Companion module.
 *
 * A module subscription is a `settings` row carrying the module's feature_id
 * with feature_value 'functionality' -- the shape written by
 * PUT /config/settings/replace from the Subscription tab, and the same pair
 * helpers/auth.js:34 joins against `defaults` to build a user's feature list.
 * feature_value is matched too, because feature_ids are only unique within a
 * feature_type: 26 also exists in the individual-settings numbering.
 *
 * DISTINCT because nothing constrains `settings` to one row per
 * (company_id, feature_id) -- a double save would otherwise sync the company
 * twice in the same run.
 *
 * @returns {Promise<Array<number>>} company ids, ascending.
 */
async function listSubscribedCompanies() {
  const rows = await DBSendResponseParam(
    `SELECT DISTINCT s.company_id
       FROM settings s
      WHERE s.feature_id = @featureId
        AND s.feature_value = 'functionality'
      ORDER BY s.company_id`,
    { featureId: RAG_AI_COMPANION_FEATURE_ID },
  );
  return (rows || []).map((row) => row.company_id);
}

/** The company's customers in ingestion scope. */
async function listAllCustomers(companyId) {
  const scope = customerScopeFilter('c');
  const rows = await DBSendResponseParam(
    `SELECT c.cus_id
       FROM customer c
      WHERE c.cus_company_id = @companyId
        AND ${scope.sql}
      ORDER BY c.cus_id`,
    { companyId, ...scope.params },
  );
  return (rows || []).map((row) => row.cus_id);
}

/**
 * Customers touched since the cutoff, via their own row or any of their
 * projects, tasks or case notes.
 *
 * cus_updated_at is compared against CAST(@since AS DATE) rather than @since
 * because the column is a DATE: a customer edited at 14:00 today stores
 * midnight today, which would sort *before* a same-day cutoff and be missed.
 * Widening to the day boundary over-selects slightly, which the hash check
 * absorbs for free.
 *
 * cus_created_at is checked alongside it so a brand-new customer is picked up
 * even if the creating code path never set cus_updated_at.
 *
 * The Claim and preAuth arms are best-effort. Claim has no updated-at column at
 * all -- CreateDate/SubmitDate/LastResponseDate are the only signals, and an
 * in-grid status edit (helpers/claims.js updateClaim) bumps none of them, so a
 * claim moving from 'Ready to Bill' to 'Deferred' is invisible to the
 * incremental pass and is picked up by the weekly full sweep instead. That is
 * the same trade the untimestamped customer_* child tables already make, and it
 * is why the compliance endpoints in helpers/complianceGaps.js read SQL Server
 * live rather than the index.
 */
async function listChangedCustomers(companyId, since) {
  const scope = customerScopeFilter('c');
  const rows = await DBSendResponseParam(
    `SELECT c.cus_id
       FROM customer c
      WHERE c.cus_company_id = @companyId
        AND ${scope.sql}
        AND c.cus_id IN (
              SELECT cus_id FROM (
                   SELECT c2.cus_id AS cus_id
                     FROM customer c2
                    WHERE c2.cus_company_id = @companyId
                      AND (c2.cus_updated_at >= CAST(@since AS DATE)
                           OR c2.cus_created_at >= CAST(@since AS DATE))
                    UNION
                   SELECT p.pro_customer_id
                     FROM project p
                    WHERE p.pro_com_id = @companyId
                      AND p.pro_customer_id IS NOT NULL
                      AND p.pro_updated_at >= @since
                    UNION
                   SELECT COALESCE(t.tas_cus_id, tp.pro_customer_id)
                     FROM task t
                     LEFT JOIN project tp ON t.tas_pro_id = tp.pro_id
                    WHERE t.tas_com_id = @companyId
                      AND (t.tas_updated_at >= @since OR t.tas_created_at >= @since)
                    UNION
                   SELECT cm.customer_id
                     FROM comments cm
                     JOIN customer cc ON cm.customer_id = cc.cus_id
                    WHERE cc.cus_company_id = @companyId
                      AND (cm.created_at >= @since OR cm.updated_at >= @since)
                    UNION
                   SELECT COALESCE(t.tas_cus_id, tp.pro_customer_id)
                     FROM Claim clm
                     JOIN task t ON t.tas_claim_id = clm.claim_ID
                     LEFT JOIN project tp ON t.tas_pro_id = tp.pro_id
                    WHERE clm.companyID = @companyId
                      AND (clm.CreateDate >= @since
                           OR clm.SubmitDate >= @since
                           OR clm.LastResponseDate >= CAST(@since AS DATE))
                    UNION
                   -- Claims with no task at all (CSV upload / manual entry),
                   -- reached the same way listClaimIdsForCustomer reaches them.
                   SELECT cc2.cus_id
                     FROM Claim clm
                     JOIN customer cc2 ON cc2.cus_company_id = clm.companyID
                                      AND LTRIM(RTRIM(cc2.DDDID)) = LTRIM(RTRIM(clm.DDDID))
                    WHERE clm.companyID = @companyId
                      AND cc2.DDDID IS NOT NULL AND LTRIM(RTRIM(cc2.DDDID)) <> ''
                      AND (clm.CreateDate >= @since
                           OR clm.SubmitDate >= @since
                           OR clm.LastResponseDate >= CAST(@since AS DATE))
                    UNION
                   SELECT pc.cus_id
                     FROM preAuth pa
                     JOIN customer pc ON pc.DDDID = pa.DDDID AND pc.cus_company_id = pa.companyId
                    WHERE pa.companyId = @companyId
                      AND pa.uploadedOn >= @since
              ) touched
               WHERE cus_id IS NOT NULL
            )
      ORDER BY c.cus_id`,
    { companyId, since, ...scope.params },
  );
  return (rows || []).map((row) => row.cus_id);
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

/** Oldest task / case note to ingest. null = all history. */
function lookbackCutoff() {
  if (!RAG_LOOKBACK_DAYS) return null;
  return new Date(Date.now() - RAG_LOOKBACK_DAYS * 86400000);
}

/** Oldest claim line / prior auth to ingest. null = all history. */
function billingLookbackCutoff() {
  if (!RAG_BILLING_LOOKBACK_DAYS) return null;
  return new Date(Date.now() - RAG_BILLING_LOOKBACK_DAYS * 86400000);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function documentKey(objectType, objectId) {
  return `${objectType}:${objectId}`;
}

/**
 * Builds every markdown document belonging to one customer.
 *
 * Sequential on purpose: a full sweep walks a lot of tasks per customer,
 * and the SQL Server connection pool is shared with live API traffic.
 *
 * @returns {Promise<Array|null>} null when the customer no longer exists.
 */
async function collectCustomerDocuments(cusId) {
  const since = lookbackCutoff();
  const billingSince = billingLookbackCutoff();

  const customerMarkdown = await elliq.buildCustomerMarkdown(cusId);
  if (customerMarkdown === null) return null;

  const documents = [{ objectType: 'customer', objectId: Number(cusId), markdown: customerMarkdown }];

  const projectIds = await elliq.listProjectIdsForCustomer(cusId);
  for (const id of projectIds) {
    const markdown = await elliq.buildProjectMarkdown(id);
    if (markdown !== null) documents.push({ objectType: 'project', objectId: Number(id), markdown });
  }

  const taskIds = await elliq.listTaskIdsForCustomer(cusId, { since });

  // One compliance load for the customer's whole task list rather than one per
  // task. buildTaskMarkdown falls back to loading its own when nothing is
  // passed, which is right for the single-document endpoints and would be five
  // extra round trips per task here -- across the highest-volume document type,
  // for every customer, every night.
  const complianceMap = await loadTaskCompliance(taskIds);

  for (const id of taskIds) {
    const markdown = await elliq.buildTaskMarkdown(id, { compliance: complianceMap.get(Number(id)) });
    if (markdown !== null) documents.push({ objectType: 'task', objectId: Number(id), markdown });
  }

  const caseNoteIds = await elliq.listCaseNoteIdsForCustomer(cusId, { since });
  for (const id of caseNoteIds) {
    const markdown = await elliq.buildCaseNoteMarkdown(id);
    if (markdown !== null) documents.push({ objectType: 'casenote', objectId: Number(id), markdown });
  }

  const claimIds = await elliq.listClaimIdsForCustomer(cusId, { since: billingSince });
  for (const id of claimIds) {
    const markdown = await elliq.buildClaimLineMarkdown(id);
    if (markdown !== null) documents.push({ objectType: 'claim_line', objectId: Number(id), markdown });
  }

  const preAuthIds = await elliq.listPreAuthIdsForCustomer(cusId, { since: billingSince });
  for (const id of preAuthIds) {
    const markdown = await elliq.buildPriorAuthMarkdown(id);
    if (markdown !== null) documents.push({ objectType: 'prior_auth', objectId: Number(id), markdown });
  }

  return documents;
}

// ---------------------------------------------------------------------------
// pgvector writes
// ---------------------------------------------------------------------------

async function loadExistingHashes(customerId) {
  const { rows } = await pool.query(
    'SELECT object_type, object_id, content_hash FROM rag_documents WHERE customer_id = $1',
    [customerId],
  );
  return new Map(rows.map((row) => [documentKey(row.object_type, row.object_id), row.content_hash]));
}

/**
 * Chunks, embeds and stores one document, replacing whatever was there before.
 *
 * Embedding happens before BEGIN: a network round trip inside the transaction
 * would hold the document's row lock for the duration of the API call.
 *
 * @returns {Promise<number>} chunks written.
 */
async function writeDocument({ companyId, customerId, objectType, objectId, markdown, contentHash }) {
  const chunks = chunkDocument({ markdown, objectType, objectId, customerId });
  const embeddings = await embedTextsBatched(chunks.map((chunk) => chunk.embedText));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO rag_documents
              (object_type, object_id, company_id, customer_id, content_hash, markdown, chunk_count, embedded_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (object_type, object_id) DO UPDATE
              SET company_id = EXCLUDED.company_id,
                  customer_id = EXCLUDED.customer_id,
                  content_hash = EXCLUDED.content_hash,
                  markdown = EXCLUDED.markdown,
                  chunk_count = EXCLUDED.chunk_count,
                  embedded_at = now(),
                  updated_at = now()
        RETURNING id`,
      [objectType, objectId, companyId, customerId, contentHash, markdown, chunks.length],
    );
    const documentId = rows[0].id;

    // Replace rather than merge: chunk boundaries shift when the source text
    // changes, so old chunks have no stable identity to update against.
    await client.query('DELETE FROM rag_chunks WHERE document_id = $1', [documentId]);

    for (const [index, chunk] of chunks.entries()) {
      await client.query(
        `INSERT INTO rag_chunks
                (document_id, chunk_index, object_type, object_id, company_id,
                 customer_id, section_title, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          documentId, chunk.chunkIndex, objectType, objectId, companyId,
          customerId, chunk.sectionTitle, chunk.content, chunk.metadata,
          toVectorLiteral(embeddings[index]),
        ],
      );
    }

    await client.query('COMMIT');
    return chunks.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes documents we hold that no longer exist upstream. Covers hard deletes,
 * soft-deleted case notes (comments.isDeleted), deactivated tasks and projects,
 * and objects that have aged out of RAG_LOOKBACK_DAYS. Chunks follow via
 * ON DELETE CASCADE.
 */
async function deleteDocuments(customerId, keys) {
  if (keys.length === 0) return 0;
  const objectTypes = keys.map((key) => key.split(':')[0]);
  const objectIds = keys.map((key) => Number(key.split(':')[1]));

  const { rowCount } = await pool.query(
    `DELETE FROM rag_documents
      WHERE customer_id = $1
        AND (object_type, object_id) IN (SELECT * FROM unnest($2::text[], $3::bigint[]))`,
    [customerId, objectTypes, objectIds],
  );
  return rowCount;
}

async function deleteAllDocumentsForCustomer(customerId) {
  const { rowCount } = await pool.query('DELETE FROM rag_documents WHERE customer_id = $1', [customerId]);
  return rowCount;
}

/**
 * Drops documents belonging to customers no longer in ingestion scope.
 *
 * Without this, restricting ingestion by cus_status would strand anyone whose
 * status later moves out of scope: they stop being visited by the sweep, so the
 * per-customer prune never runs for them and their documents stay indefinitely,
 * unrefreshed but still retrievable.
 *
 * Full sweeps only -- an incremental run's candidate list is a delta, not the
 * complete membership, so it cannot distinguish "out of scope" from
 * "unchanged".
 *
 * @param {number} companyId
 * @param {Array<number>} inScopeCustomerIds complete in-scope list for the company.
 * @returns {Promise<number>} documents removed.
 */
async function pruneOutOfScopeCustomers(companyId, inScopeCustomerIds) {
  // An empty list means the lookup returned nothing -- a misconfigured company
  // id, say. Deleting the company's entire store on that basis would be a very
  // expensive way to find out.
  if (inScopeCustomerIds.length === 0) {
    logger.warn({ companyId }, 'ragSync: In-scope customer list empty, skipping out-of-scope prune');
    return 0;
  }

  const { rowCount } = await pool.query(
    `DELETE FROM rag_documents
      WHERE company_id = $1
        AND customer_id IS NOT NULL
        AND customer_id <> ALL($2::bigint[])`,
    [companyId, inScopeCustomerIds],
  );
  return rowCount;
}

// ---------------------------------------------------------------------------
// Per-customer sync
// ---------------------------------------------------------------------------

async function syncCustomer(companyId, cusId, stats) {
  const documents = await collectCustomerDocuments(cusId);

  if (documents === null) {
    const removed = await deleteAllDocumentsForCustomer(cusId);
    stats.documentsDeleted += removed;
    logger.info({ cusId, removed }, 'ragSync: Customer no longer exists, removed its documents');
    return;
  }

  const existing = await loadExistingHashes(cusId);
  const liveKeys = new Set();

  for (const doc of documents) {
    const key = documentKey(doc.objectType, doc.objectId);
    liveKeys.add(key);

    const contentHash = sha256(doc.markdown);
    if (existing.get(key) === contentHash) {
      stats.documentsUnchanged += 1;
      continue;
    }

    stats.chunksWritten += await writeDocument({
      companyId,
      customerId: Number(cusId),
      objectType: doc.objectType,
      objectId: doc.objectId,
      markdown: doc.markdown,
      contentHash,
    });
    stats.documentsChanged += 1;
  }

  const stale = [...existing.keys()].filter((key) => !liveKeys.has(key));
  stats.documentsDeleted += await deleteDocuments(cusId, stale);
}

// ---------------------------------------------------------------------------
// Company sync
// ---------------------------------------------------------------------------

/**
 * Syncs one company.
 *
 * @param {number} companyId
 * @param {Object} [options]
 * @param {'full'|'incremental'} [options.force] override the automatic mode.
 * @returns {Promise<Object>} run statistics.
 */
async function runCompanySync(companyId, { force } = {}) {
  const startedAt = new Date();
  const state = await loadSyncState(companyId);
  const mode = decideMode(state, force);
  const runId = await startRunLog(companyId, mode);

  const stats = {
    companyId,
    mode,
    candidates: 0,
    customersProcessed: 0,
    customersFailed: 0,
    documentsChanged: 0,
    documentsUnchanged: 0,
    documentsDeleted: 0,
    chunksWritten: 0,
  };

  logger.info({ companyId, mode }, 'ragSync: Starting company sync');

  try {
    const candidates = mode === 'full'
      ? await listAllCustomers(companyId)
      : await listChangedCustomers(companyId, incrementalCutoff(state));
    stats.candidates = candidates.length;

    logger.info({ companyId, mode, candidates: candidates.length }, 'ragSync: Candidate customers resolved');

    const deadline = RAG_SYNC_MAX_RUNTIME_MINUTES > 0
      ? startedAt.getTime() + RAG_SYNC_MAX_RUNTIME_MINUTES * 60000
      : Infinity;
    let timedOut = false;

    for (const cusId of candidates) {
      if (Date.now() > deadline) {
        timedOut = true;
        logger.warn({ companyId, processed: stats.customersProcessed, remaining: candidates.length - stats.customersProcessed },
          'ragSync: Runtime cap reached, stopping early');
        break;
      }

      try {
        await syncCustomer(companyId, cusId, stats);
        stats.customersProcessed += 1;
      } catch (err) {
        // One bad customer must not abort the run. The weekly full sweep will
        // retry it, since its watermark contribution is never recorded
        // individually.
        stats.customersFailed += 1;
        logger.error({ err: err.message, companyId, cusId }, 'ragSync: Customer sync failed, continuing');
      }
    }

    if (timedOut) {
      // Watermark deliberately not advanced: the run did not cover its
      // candidate set. Tomorrow re-covers the same ground, and hash-matching
      // makes the already-done portion cost SQL reads only.
      await finishRunLog(runId, 'timed_out', stats, `Stopped after ${RAG_SYNC_MAX_RUNTIME_MINUTES} minutes`);
      logger.warn({ ...stats }, 'ragSync: Company sync timed out');
      return stats;
    }

    // Only a completed full sweep holds the company's complete in-scope
    // membership, which is what makes "not in this list" safe to act on.
    if (mode === 'full') {
      const pruned = await pruneOutOfScopeCustomers(companyId, candidates);
      stats.documentsDeleted += pruned;
      if (pruned > 0) {
        logger.info({ companyId, pruned }, 'ragSync: Pruned documents for out-of-scope customers');
      }
    }

    await saveSyncState(companyId, startedAt, mode === 'full' ? startedAt : null);
    await finishRunLog(runId, stats.customersFailed > 0 ? 'partial' : 'success', stats, null);
    logger.info({ ...stats }, 'ragSync: Company sync complete');
    return stats;
  } catch (err) {
    await finishRunLog(runId, 'failed', stats, err.message);
    logger.error({ err: err.message, stack: err.stack, companyId }, 'ragSync: Company sync failed');
    throw err;
  }
}

/**
 * Runs the sync for every subscribed company, under the cross-instance lock.
 *
 * Membership is resolved at run time rather than at boot, so a subscription
 * change takes effect on the next nightly run without a restart.
 *
 * @param {Object} [options]
 * @param {'full'|'incremental'} [options.force]
 * @param {Array<number>} [options.companyIds] override the subscription lookup;
 *   for manual backfills and debugging only.
 * @returns {Promise<Object[]>} per-company statistics.
 */
async function runNightlySync({ force, companyIds: override } = {}) {
  const companyIds = override || await listSubscribedCompanies();
  if (!companyIds.length) {
    logger.warn(
      { featureId: RAG_AI_COMPANION_FEATURE_ID },
      'ragSync: No companies subscribed to the AI Companion module, nothing to do',
    );
    return [];
  }

  logger.info({ companyIds }, 'ragSync: Subscribed companies resolved');

  const lock = await acquireSyncLock();
  if (!lock) {
    // Expected when a second container instance of this environment wakes at
    // the same time. Seeing another environment's database here instead would
    // mean the key is no longer isolating them.
    logger.warn(
      { database: config.APIDB, lockKey: RAG_SYNC_LOCK_KEY, companyIds },
      'ragSync: Another instance holds the sync lock, skipping this run',
    );
    return [];
  }

  const results = [];
  try {
    for (const companyId of companyIds) {
      try {
        results.push(await runCompanySync(companyId, { force }));
      } catch (err) {
        // Already logged and recorded in rag_sync_runs; keep going so one
        // company cannot block the others.
        logger.error({ err: err.message, companyId }, 'ragSync: Skipping company after failure');
      }
    }
  } finally {
    await lock.release();
  }
  return results;
}

/**
 * Registers the nightly job. Called once from index.js at boot.
 */
function scheduleNightlySync() {
  if (!RAG_SYNC_ENABLED) {
    logger.info('ragSync: Disabled (RAG_SYNC_ENABLED=false), nightly job not scheduled');
    return;
  }

  const rule = { hour: RAG_SYNC_CRON_HOUR, minute: 0, tz: 'America/New_York' };
  schedule.scheduleJob(rule, async () => {
    try {
      await runNightlySync();
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, 'ragSync: Nightly sync threw');
    }
  });

  logger.info(
    {
      // Companies are resolved per run, not here -- boot-time membership would
      // go stale the moment someone toggles the module.
      scope: `settings.feature_id = ${RAG_AI_COMPANION_FEATURE_ID} (AI Companion)`,
      database: config.APIDB,
      lockKey: RAG_SYNC_LOCK_KEY,
      hour: RAG_SYNC_CRON_HOUR,
      lookbackDays: RAG_LOOKBACK_DAYS || 'all history',
      billingLookbackDays: RAG_BILLING_LOOKBACK_DAYS || 'all history',
      customerStatuses: RAG_CUSTOMER_STATUSES,
      fullSweepDays: RAG_FULL_SWEEP_DAYS,
    },
    'ragSync: Nightly sync scheduled',
  );
}

module.exports = {
  scheduleNightlySync,
  runNightlySync,
  runCompanySync,
  syncCustomer,
};
