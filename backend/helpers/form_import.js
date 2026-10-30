// HTTP handlers for AI form ingestion and publishing (routes/task_form.js, under /import).
// All handlers sit behind requireMsalIdentity + requireMisAdmin (see routes): this is an internal MIS tool.
const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');

// models/indexSQL.js connects to SQL Server as soon as it is required, so it is loaded only by the handler that writes
// (publish). Import + polling never touch the database, which lets smoke/e2e scripts run without any SQL settings.
const getDb = () => require('../models/indexSQL.js');  
const config = require('../config');
const { FoundryRateLimitError, sendRateLimitResponse } = require('./foundryRateLimit');
const { defaultLogger: logger } = require('../logger');
const ingestion = require('./formIngestion');
const jobs = require('./formImportJobs');
const { validate, repair } = require('./formioSubset');

const { FOUNDRY_API_KEY, FOUNDRY_LLM_MODEL, FOUNDRY_URL, BLOB_KEY, FORM_IMPORT_CONTAINER_NAME, MIS_COMPANY_ID } = config;

const ACCOUNT_NAME = 'fieldworkblob';
// Same base the other Foundry features use (`${FOUNDRY_URL}/chat/completions`); the literal is only a fallback for a missing setting.
const FOUNDRY_BASE_URL = FOUNDRY_URL || 'https://fwfoundry.openai.azure.com/openai/v1';

// Replaceable in tests.
const deps = {
  callModel: null,
  uploadSource: null,
};
const getCaller = () => deps.callModel || ingestion.makeFoundryCaller({
  apiKey: FOUNDRY_API_KEY, baseUrl: FOUNDRY_BASE_URL, model: FOUNDRY_LLM_MODEL || 'gpt-4.1',
});

// Dedicated container, restricted access; the SQL row stores only the URL.
const uploadSourcePdf = async (buffer, filename, jobId) => {
  if (deps.uploadSource) return deps.uploadSource(buffer, filename, jobId);
  if (!BLOB_KEY || !FORM_IMPORT_CONTAINER_NAME) {
    logger.warn('form import: BLOB_KEY / FORM_IMPORT_CONTAINER_NAME not configured; source PDF will not be stored');
    return null;
  }
  const client = new BlobServiceClient(`https://${ACCOUNT_NAME}.blob.core.windows.net`, new StorageSharedKeyCredential(ACCOUNT_NAME, BLOB_KEY));
  const container = client.getContainerClient(FORM_IMPORT_CONTAINER_NAME);
  const safe = String(filename || 'form.pdf').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100);
  const blob = container.getBlockBlobClient(`${new Date().toISOString().slice(0, 10)}/${jobId}-${safe}`);
  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: 'application/pdf' } });
  return blob.url;
};

// ---------- DEV-ONLY auth bypass ----------
// DEV_AUTH_BYPASS=true replaces the Azure AD token check on the MIS-only routes with a fixed MIS-admin identity so the
// import endpoints can be exercised locally (scripts/e2e-import.js) without SQL or a real MSAL token. It is REFUSED
// (the module throws on load) when NODE_ENV=production or the API runs as FW_ENV=prod (config.js defaults to prod when
// FW_ENV is unset, so set FW_ENV=dev). Customer-side pack routes never use it. Every bypassed request is logged and
// answered with an X-Dev-Auth-Bypass header.
const isTrue = (v) => String(v || '').trim().toLowerCase() === 'true';
const DEV_AUTH_BYPASS = isTrue(process.env.DEV_AUTH_BYPASS);
if (DEV_AUTH_BYPASS && (process.env.NODE_ENV === 'production' || config.env === 'prod')) {
  throw new Error('DEV_AUTH_BYPASS=true is not allowed when NODE_ENV=production or FW_ENV=prod (FW_ENV defaults to prod when unset). Remove DEV_AUTH_BYPASS, or run with FW_ENV=dev and without NODE_ENV=production.');
}
if (DEV_AUTH_BYPASS) logger.warn('DEV_AUTH_BYPASS is ON: MIS routes accept unauthenticated requests as a dev MIS administrator. Never enable this outside local development.');

// MIS-route authentication: the real MSAL check, or the dev bypass above.
exports.requireMisIdentity = (req, res, next) => {
  // msalAuth pulls in the SQL layer (it looks the caller up in `employee`), so it is only loaded when a real token check is needed.
  if (!DEV_AUTH_BYPASS) return require('./msalAuth').requireMsalIdentity(req, res, next);  
  req.callerIdentity = { companyId: Number(MIS_COMPANY_ID), employeeId: Number(process.env.DEV_AUTH_BYPASS_EMP_ID) || 1 };
  res.set('X-Dev-Auth-Bypass', 'true');
  logger.warn({ path: req.path }, 'DEV_AUTH_BYPASS: request accepted without a token');
  return next();
};
exports.DEV_AUTH_BYPASS = DEV_AUTH_BYPASS;

// Gate for every MIS-only endpoint. Runs after requireMsalIdentity.
exports.requireMisAdmin = (req, res, next) => {
  if (!req.callerIdentity || Number(req.callerIdentity.companyId) !== Number(MIS_COMPANY_ID)) {
    return res.status(403).json({ message: 'This action is restricted to MIS administrators.' });
  }
  return next();
};

const statusFor = { EMPTY: 400, NOT_PDF: 415, TOO_LARGE: 413, TOO_MANY_PAGES: 422, FILLED_FORM: 422, NO_TEXT_LAYER: 422, UNREADABLE: 422 };

const runJob = async (jobId, buffer, filename) => {
  const log = (m) => logger.info(m);
  try {
    const result = await ingestion.runIngestion(buffer, {
      filename,
      model: FOUNDRY_LLM_MODEL || 'gpt-4.1',
      callModel: getCaller(),
      log,
      onStage: (stage, progress) => jobs.updateJob(jobId, { stage, progress }),
    });
    // Token usage and timing only; never the PDF or the model output.
    logger.info({ jobId, promptVersion: result.usage.promptVersion, model: result.usage.model, pages: result.usage.pages, tokens: result.usage.promptTokens + result.usage.completionTokens, seconds: result.usage.seconds, problems: result.problems.length }, 'form ingestion finished');
    jobs.updateJob(jobId, { status: 'done', progress: 100, result: { definition: result.definition, fields: result.fields, problems: result.problems, usage: result.usage } });
  } catch (err) {
    logger.error({ err, jobId }, 'form ingestion failed');
    const info = ingestion.describeFoundryError(err);
    logger.error({ jobId, status: info.status, errorClass: info.errorClass }, 'form ingestion model/pipeline error class');
    let message;
    if (err instanceof FoundryRateLimitError) message = 'The AI service is busy. Please try again in a minute.';
    else if (err.code && statusFor[err.code]) message = err.message;
    else if (info.status && [401, 403, 404].includes(info.status)) message = `The AI service rejected the request (HTTP ${info.status}). An administrator needs to check the Azure OpenAI settings: ${info.hint}`;
    else message = 'The model could not convert this PDF. Please try again or build the form manually.';
    jobs.updateJob(jobId, { status: 'failed', error: message });
  }
};

// POST /task_form/import  (multipart, field "file") -> 202 { jobId }
exports.postImport = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No file received.' });
    const buffer = req.file.buffer;
    const filename = req.file.originalname || 'form.pdf';
    try { await ingestion.precheckPdf(buffer); }
    catch (e) {
      if (e instanceof ingestion.IngestionError) return res.status(statusFor[e.code] || 422).json({ message: e.message, code: e.code });
      throw e;
    }
    if (!FOUNDRY_API_KEY && !deps.callModel) return res.status(500).json({ message: 'The AI service is not configured.' });

    let jobId;
    try { jobId = jobs.createJob({ filename, employeeId: req.callerIdentity.employeeId, companyId: req.callerIdentity.companyId, blobUrl: null }); }
    catch (e) { if (e.code === 'BUSY') return res.status(429).json({ message: e.message }); throw e; }

    // Store the source PDF, then run the model in the background so the request returns immediately.
    (async () => {
      try { jobs.updateJob(jobId, { stage: ingestion.STAGES[0], progress: 5, blobUrl: await uploadSourcePdf(buffer, filename, jobId) }); }
      catch (e) { logger.error({ err: e, jobId }, 'form import: could not store source PDF'); }
      await runJob(jobId, buffer, filename);
    })();
    return res.status(202).json({ jobId });
  } catch (err) {
    logger.error(err, 'postImport failed');
    return res.status(500).json({ message: 'Import failed.' });
  }
};

// GET /task_form/import/:jobId
exports.getImportJob = (req, res) => {
  const job = jobs.getJob(req.params.jobId);
  if (!job || Number(job.employeeId) !== Number(req.callerIdentity.employeeId)) return res.status(404).json({ message: 'Job not found.' });
  return res.json(jobs.publicView(job));
};

const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// POST /task_form/import/publish
// Body: { jobId?, filename, definition, usage:{model,promptVersion}, details:{name,description,formType,state,agency,companyTypes[],replacesFormId?} }
// Writes fw_forms (community form) and form_source in ONE transaction; form_id is allocated under a lock
// instead of the client-side MAX+1 used by the older builder endpoint.
exports.postPublish = async (req, res) => {
  const { details = {}, usage = {}, jobId } = req.body || {};
  const name = s(details.name, 255);
  const description = s(details.description, 1000);
  const formType = s(details.formType, 100);
  const agency = s(details.agency, 255);
  const state = s(details.state, 3).toUpperCase();
  const companyTypes = Array.isArray(details.companyTypes) ? details.companyTypes.map(Number).filter((n) => n >= 101 && n <= 106) : [];
  const replaces = details.replacesFormId == null ? null : Number(details.replacesFormId);
  if (!name || !description || !formType || !agency || !state || !companyTypes.length) {
    return res.status(400).json({ message: 'Name, description, form type, state, source agency and at least one company type are required.' });
  }
  if (replaces !== null && !Number.isInteger(replaces)) return res.status(400).json({ message: 'replacesFormId must be an integer.' });

  const { definition } = repair(req.body.definition);
  const problems = validate(definition);
  if (problems.length) return res.status(422).json({ message: 'The form definition is not valid.', problems });

  const job = jobId ? jobs.getJob(jobId) : null;
  const blobUrl = job && Number(job.employeeId) === Number(req.callerIdentity.employeeId) ? job.blobUrl : null;
  const formState = state === 'ALL' ? null : state;

  const db = getDb();
  const transaction = new db.Transaction();
  try {
    await transaction.begin();
    const idRequest = new db.Request(transaction);
    const idRow = await idRequest.query('SELECT ISNULL(MAX(form_id), 0) + 1 AS next_id FROM fw_forms WITH (UPDLOCK, HOLDLOCK)');
    const formId = idRow.recordset[0].next_id;

    if (replaces !== null) {
      const chk = await new db.Request(transaction).input('r', db.Int, replaces).query('SELECT form_id FROM fw_forms WHERE form_id = @r AND public_form = 1');
      if (!chk.recordset.length) { await transaction.rollback(); return res.status(400).json({ message: 'The form to replace was not found among community forms.' }); }
    }

    await new db.Request(transaction)
      .input('id', db.Int, formId)
      .input('name', db.VarChar(255), name)
      .input('descr', db.VarChar(1000), description)
      .input('by', db.Int, req.callerIdentity.employeeId)
      .input('type', db.VarChar(100), formType)
      .input('schema', db.NVarChar(db.MAX), JSON.stringify(definition))
      .input('company', db.Int, req.callerIdentity.companyId)
      .input('state', db.VarChar(2), formState)
      .input('sponsor', db.VarChar(255), agency)
      .input('replaces', db.Int, replaces)
      .query(`INSERT INTO fw_forms (form_id, form_name, form_description, form_added_on, form_added_by, form_type, json_schema, form_company, public_form, form_state, form_sponsor, replaces_form_id)
              VALUES (@id, @name, @descr, CURRENT_TIMESTAMP, @by, @type, @schema, @company, 1, @state, @sponsor, @replaces)`);

    await new db.Request(transaction)
      .input('id', db.Int, formId)
      .input('url', db.VarChar(1024), blobUrl)
      .input('agency', db.VarChar(255), agency)
      .input('model', db.VarChar(64), s(usage.model, 64) || null)
      .input('pv', db.VarChar(32), s(usage.promptVersion, 32) || null)
      .input('types', db.VarChar(50), companyTypes.join(','))
      .input('by', db.Int, req.callerIdentity.employeeId)
      .query(`INSERT INTO form_source (form_id, source_blob_url, source_agency, model, prompt_version, company_types, generated_on, reviewed_by)
              VALUES (@id, @url, @agency, @model, @pv, @types, SYSDATETIME(), @by)`);

    await transaction.commit();
    return res.json({ form_id: formId });
  } catch (err) {
    logger.error(err, 'postPublish failed');
    try { await transaction.rollback(); } catch (e) { /* already rolled back */ }
    return res.status(500).json({ message: 'Could not publish the form.' });
  }
};

exports.deps = deps;
exports.sendRateLimitResponse = sendRateLimitResponse;
