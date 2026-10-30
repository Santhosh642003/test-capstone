// PDF -> Form.io definition pipeline (project 05). Prompt is documented verbatim in
// prompts/05-form-ingestion.md; change PROMPT_VERSION and re-run the eval whenever it changes.
//
// Stages: precheck -> (chunk) -> model call -> parse -> deterministic repair -> validate
//         -> one model repair pass if still invalid -> manifest (confidence + heuristic flags).
const { Buffer } = require('buffer');
const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = require('pdf-lib');
const {
  RATE_LIMIT_STATUSES, FoundryRateLimitError, retryAfterFromHeaders, runFoundryRequest,
} = require('./foundryRateLimit');
const {
  SUPPORTED_TYPES, walk, flattenFields, repair, validate, heuristicFlags,
} = require('./formioSubset');

const PROMPT_VERSION = 'ff-0.1.0';
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 30;
const CHUNK_PAGES = 5;          // pages per model call for long PDFs
const MIN_CHARS_PER_PAGE = 40;  // below this on average the PDF is treated as image-only

const STAGES = [
  'Uploading PDF to secure storage',
  'Pre-check: page count, text layer, filled form fields',
  'Reading the form with the model',
  'Validating and repairing the Form.io definition',
  'Building field manifest and confidence flags',
];

const SYSTEM_PROMPT = 'You convert blank PDF forms into Form.io JSON definitions. Use only what is printed in the PDF. Do not invent fields, sections, options or text. Return valid JSON only.';

const CONTRACT_PROMPT = `# PDF form to Form.io conversion

You will receive a BLANK PDF form (or a page range of one). Convert it to a Form.io definition that a person can fill in on screen.
The PDF is the source of truth. Read both text and layout. Do not use outside knowledge.

## Output

Return ONE JSON object and nothing else:

{
  "definition": { "display": "form", "components": [ ... ] },
  "fields": [ { "key": "", "sourcePage": 1, "confidence": 0.0, "notes": "" } ]
}

"fields" has one entry for every INPUT component in "definition" (textfield, textarea, number, currency, datetime, radio, selectboxes, select, checkbox, signature, and the child components of a datagrid). Not for panels or text blocks.
- "key" is the component's key.
- "sourcePage" is the PDF page number (as printed in the original document, see PAGE RANGE) where the field appears.
- "confidence" is 0 to 1: 0.9+ means the label, type and options are unambiguous; about 0.6 means you had to guess between plausible alternatives; below 0.4 means you are mostly guessing.
- "notes" is "" when confidence is 0.9 or higher. Otherwise say, in one short sentence, what is uncertain (for example "ambiguous checkbox group", "label is an abbreviation", "unclear whether required").

## Supported components (use no others)

| PDF pattern | Form.io component | Notes |
|---|---|---|
| Short text line / blank | textfield | label, key, validate.required |
| Multi-line box | textarea | rows from the box height |
| Number / amount / hours | number, or currency for money | decimalLimit, min/max only if printed |
| Date / time | datetime | enableTime false for date-only |
| Yes/No, pick-one boxes | radio | values: [{label, value}] |
| Check all that apply | selectboxes | values: [{label, value}] |
| Long dropdown-like list | select | data.values: [{label, value}] |
| Single checkbox statement ("I agree...") | checkbox | label is the statement |
| Signature line | signature | follow it with a datetime "Date signed" if the form prints one |
| Repeating rows / table | datagrid | child components, one per column header |
| Section heading | panel | title; keep document order |
| Instructions / legal text | content | html with the text VERBATIM |

## Rules

- Every component has "type", a unique camelCase "key" (letters and digits, at most 64 characters, starting with a letter) and, for inputs, "label" and "input": true.
- A field marked with *, "required" or similar gets "validate": { "required": true }. Otherwise do not set it.
- Radio / selectboxes values: "label" exactly as printed, "value" a camelCase version of it. Include every printed option, in printed order.
- Keep document order. Group fields under a panel for each printed section heading. Use "columns" only when a two-column layout is needed to read the form, never to copy the print layout.
- Copy instruction and legal text verbatim into "content" components. Do not summarise, shorten or reword it.
- If two fields print the same label, keep both labels as printed; keys must still differ.
- Do not translate. Do not add fields that are not printed. Do not fill in any values.
- If a page range is given, only convert the fields on those pages; sections that continue from an earlier page start a panel titled as printed, with "(continued)" appended only if the heading is not repeated.

## Example

For a page with the heading "Section A - Individual Information", a line "Name of Individual *", and "Living Arrangement" with boxes "Family home" and "Group home":

{"definition":{"display":"form","components":[{"type":"panel","key":"sectionA","title":"Section A - Individual Information","input":false,"components":[{"type":"textfield","key":"nameOfIndividual","label":"Name of Individual","input":true,"validate":{"required":true}},{"type":"radio","key":"livingArrangement","label":"Living Arrangement","input":true,"values":[{"label":"Family home","value":"familyHome"},{"label":"Group home","value":"groupHome"}]}]}]},"fields":[{"key":"nameOfIndividual","sourcePage":1,"confidence":0.98,"notes":""},{"key":"livingArrangement","sourcePage":1,"confidence":0.95,"notes":""}]}`;

const REPAIR_PROMPT = 'The Form.io definition below failed validation. Fix ONLY the listed problems and return the corrected JSON in the same envelope ({"definition": ..., "fields": [...]}). Do not add, remove or reword any other field, label, option or text.';

const pageRangeNote = ({ from, to, total }) => (total > to - from + 1
  ? `\n\n## PAGE RANGE\nThis PDF excerpt contains pages ${from} to ${to} of a ${total}-page original. Report "sourcePage" using the ORIGINAL page numbers (the first page of this excerpt is page ${from}).`
  : `\n\n## PAGE RANGE\nThis is the complete ${total}-page document. Page 1 is the first page.`);

const priorNote = (priorKeys, lastSection) => (priorKeys.length
  ? `\nKeys already used on earlier pages (do not reuse): ${priorKeys.join(', ')}.${lastSection ? ` The previous page range ended inside the section "${lastSection}".` : ''}`
  : '');

// ---------- helpers ----------
class IngestionError extends Error {
  constructor(code, message) { super(message); this.name = 'IngestionError'; this.code = code; }
}

const parseJsonFromLlmContent = (content) => {
  const raw = Array.isArray(content) ? content.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('\n') : String(content || '');
  const normalized = raw.replace(/^\s*```json\s*/i, '').replace(/^\s*```\s*/i, '').replace(/\s*```\s*$/, '').trim();
  try { return JSON.parse(normalized); } catch (e) { /* salvage below */ }
  // Salvage: the outermost {...} when the model wrapped the JSON in prose.
  const start = normalized.indexOf('{');
  const end = normalized.lastIndexOf('}');
  if (start !== -1 && end > start) return JSON.parse(normalized.slice(start, end + 1));
  throw new IngestionError('BAD_MODEL_OUTPUT', 'The model did not return JSON.');
};

/**
 * Cheap checks before spending tokens. Throws IngestionError for anything we refuse:
 * not a PDF, too big, too many pages, image-only, or a filled-in form.
 */
const precheckPdf = async (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new IngestionError('EMPTY', 'No file received.');
  if (buffer.length > MAX_BYTES) throw new IngestionError('TOO_LARGE', `File is ${(buffer.length / 1048576).toFixed(1)} MB; the limit is 20 MB.`);
  if (buffer.slice(0, 5).toString('latin1') !== '%PDF-') throw new IngestionError('NOT_PDF', 'Only PDF files are supported.');

  let doc;
  try { doc = await PDFDocument.load(buffer, { ignoreEncryption: false, updateMetadata: false }); }
  catch (e) { throw new IngestionError('UNREADABLE', 'This PDF could not be read (it may be corrupt or password protected).'); }
  const pages = doc.getPageCount();
  if (pages > MAX_PAGES) throw new IngestionError('TOO_MANY_PAGES', `PDF has ${pages} pages; the limit is ${MAX_PAGES}.`);

  // Completed forms must never reach the model: any AcroForm field that already holds a value is refused.
  const filled = [];
  try {
    doc.getForm().getFields().forEach((f) => {
      let value = null;
      if (f instanceof PDFTextField) value = f.getText();
      else if (f instanceof PDFCheckBox) value = f.isChecked() ? 'checked' : null;
      else if (f instanceof PDFDropdown) value = (f.getSelected() || []).join(',') || null;
      else if (f instanceof PDFRadioGroup) value = f.getSelected() || null;
      if (value) filled.push(f.getName());
    });
  } catch (e) { /* no AcroForm: nothing to check */ }
  if (filled.length) {
    throw new IngestionError('FILLED_FORM', `This PDF already contains filled-in fields (${filled.slice(0, 3).join(', ')}${filled.length > 3 ? ', ...' : ''}). Upload a blank form only.`);
  }

  const chars = await countTextCharacters(buffer);
  if (chars !== null && chars / pages < MIN_CHARS_PER_PAGE) {
    throw new IngestionError('NO_TEXT_LAYER', 'This PDF looks like a scan with no text layer. Only text-based PDFs are supported.');
  }
  return { pages, bytes: buffer.length, textChars: chars };
};

// Counts extractable characters with pdfjs (loaded lazily). A scan has pages but (almost) no text. If pdfjs
// itself cannot open the file the check is skipped (null) rather than blocking an upload pdf-lib could read.
const countTextCharacters = async (buffer) => {
  let task;
  try {
    // pdf.js prints "Cannot polyfill DOMMatrix/Path2D" when its optional `canvas` package is absent; we only read text, so hide that noise.
    const { log } = console;
    const { warn } = console;
    const quiet = (orig) => (...a) => { if (!/Cannot polyfill/.test(String(a[0]))) orig(...a); };
    console.log = quiet(log);
    console.warn = quiet(warn);
    let pdfjs;
    try { pdfjs = require('pdfjs-dist/legacy/build/pdf.js'); } finally { console.log = log; console.warn = warn; }  

    task = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
    const doc = await task.promise;
    let chars = 0;
    for (let i = 1; i <= doc.numPages; i += 1) {
       
      const content = await (await doc.getPage(i)).getTextContent();
      chars += content.items.reduce((n, it) => n + String(it.str || '').replace(/\s+/g, '').length, 0);
    }
    return chars;
  } catch (e) { return null; } finally { if (task) task.destroy().catch(() => {}); }
};

const planChunks = (pages, size = CHUNK_PAGES) => {
  const chunks = [];
  for (let from = 1; from <= pages; from += size) chunks.push({ from, to: Math.min(pages, from + size - 1), total: pages });
  return chunks;
};

const extractPages = async (buffer, { from, to }) => {
  const src = await PDFDocument.load(buffer, { updateMetadata: false });
  const out = await PDFDocument.create();
  const idx = [];
  for (let i = from - 1; i <= to - 1; i += 1) idx.push(i);
  (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
  return Buffer.from(await out.save());
};

// ---------- Foundry transport ----------
class FoundryHttpError extends Error {
  constructor(status, bodyText, apiKey) {
    super(`LLM API returned ${status}: ${scrub(bodyText, apiKey).slice(0, 300)}`);
    this.name = 'FoundryHttpError';
    this.status = status;
  }
}

// Never let the API key travel inside an error message, a log line or a result file.
const scrub = (text, apiKey) => {
  let out = String(text || '');
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join('<redacted>');
  return out.replace(/Bearer\s+[A-Za-z0-9._-]{12,}/g, 'Bearer <redacted>');
};

/**
 * Turns any error from the model call into { status, errorClass, hint } for people to act on. The hint says what
 * to fix; it never contains secrets.
 */
const describeFoundryError = (err) => {
  const status = err && (err.status || err.statusCode) ? Number(err.status || err.statusCode) : null;
  const code = err && (err.code || (err.cause && err.cause.code));
  if (err instanceof FoundryRateLimitError || status === 429 || status === 503) {
    return { status: status || 429, errorClass: 'RateLimit', hint: 'Rate limited (HTTP 429/503): the shared gpt-4.1 deployment is out of tokens-per-minute right now. Wait a minute and retry; if it persists ask for more quota. Large PDFs can exceed the per-minute budget on their own.' };
  }
  if (status === 401) return { status, errorClass: 'AuthenticationError', hint: 'HTTP 401: FOUNDRY_API_KEY is wrong, expired, or belongs to a different Azure OpenAI resource than FOUNDRY_URL.' };
  if (status === 403) return { status, errorClass: 'PermissionDenied', hint: 'HTTP 403: the key was understood but access is denied. Check the resource firewall / allowed networks (is your IP allowed?), and that the key is for this resource.' };
  if (status === 404) return { status, errorClass: 'NotFound', hint: 'HTTP 404: the deployment name or endpoint path is wrong. FOUNDRY_LLM_MODEL must be the exact DEPLOYMENT name in Azure (not the model family), and FOUNDRY_URL must be the base ending in /openai/v1 (the code appends /chat/completions).' };
  if (status === 400) return { status, errorClass: 'BadRequest', hint: 'HTTP 400: the request was rejected. See the message; common causes: the deployment does not accept PDF file inputs, an unsupported response_format, or an old API surface (use the /openai/v1 base so no api-version is needed).' };
  if (status && status >= 500) return { status, errorClass: 'ServerError', hint: `HTTP ${status}: Azure OpenAI had a server-side problem. Retry in a minute.` };
  if (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN' || /fetch failed/i.test((err && err.message) || '')) {
    return { status: null, errorClass: 'NetworkError', hint: 'Could not reach the endpoint: check the host in FOUNDRY_URL, your network/VPN/proxy, and that the URL starts with https://.' };
  }
  if (err && err.code === 'NO_API_KEY') return { status: null, errorClass: 'NotConfigured', hint: 'FOUNDRY_API_KEY is not set.' };
  if (err && (err.code === 'BAD_MODEL_OUTPUT' || err.code === 'EMPTY_MODEL_OUTPUT')) return { status: null, errorClass: 'BadModelOutput', hint: 'The model answered but not with usable JSON. Run smoke:model to see the mode used; this usually means JSON mode is off and the model wrapped the JSON in prose.' };
  return { status, errorClass: (err && err.name) || 'Error', hint: 'Unexpected error: see the message.' };
};

// A 400 that is specifically about JSON mode / response_format (as opposed to any other bad request).
const isJsonModeRejection = (err) => err && err.status === 400 && /response_format|json_object|json_schema|json mode|structured output/i.test(err.message || '');

/**
 * Default model caller: Azure OpenAI chat completions (Foundry), PDF as a base64 file part like sdr.js.
 * Returns { content, usage, mode, fallback }: mode is 'json' (response_format json_object accepted together with the
 * PDF part) or 'text' (JSON requested only in the prompt). If the deployment rejects JSON mode the call is repeated
 * once without it and `fallback` records why (status + class, never the key). jsonMode: true (default) | false.
 * Tests, the smoke test and the eval inject or wrap their own caller.
 */
const makeFoundryCaller = ({ apiKey, baseUrl = 'https://fwfoundry.openai.azure.com/openai/v1', model = 'gpt-4.1', jsonMode = true } = {}) => async ({ system, text, pdf, filename, label }) => {
  if (!apiKey) throw new IngestionError('NO_API_KEY', 'The AI service is not configured (missing API key).');
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const userContent = [{ type: 'text', text }];
  if (pdf) userContent.push({ type: 'file', file: { filename: filename || 'form.pdf', file_data: `data:application/pdf;base64,${pdf.toString('base64')}` } });
  const send = (withJsonMode) => runFoundryRequest(async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        ...(withJsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
      }),
    });
    if (RATE_LIMIT_STATUSES.has(response.status)) throw new FoundryRateLimitError(response.status, retryAfterFromHeaders(response.headers));
    if (!response.ok) throw new FoundryHttpError(response.status, await response.text(), apiKey);
    return response.json();
  }, { label, maxAttempts: 2 });

  let data;
  let mode = jsonMode ? 'json' : 'text';
  let fallback = null;
  try { data = await send(!!jsonMode); }
  catch (e) {
    // Some deployments reject response_format together with file inputs; the prompt already demands JSON only.
    if (jsonMode && isJsonModeRejection(e)) {
      fallback = { fromMode: 'json', status: e.status, errorClass: describeFoundryError(e).errorClass, message: e.message };
      mode = 'text';
      data = await send(false);
    } else {
      if (e && e.message) e.message = scrub(e.message, apiKey);
      throw e;
    }
  }
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new IngestionError('EMPTY_MODEL_OUTPUT', 'Invalid or empty response from the model.');
  return { content, usage: data.usage || {}, mode, fallback };
};

const normaliseEnvelope = (parsed) => {
  const definition = parsed && parsed.definition ? parsed.definition : (parsed && parsed.components ? parsed : null);
  if (!definition) throw new IngestionError('BAD_MODEL_OUTPUT', 'The model output has no "definition".');
  return { definition, fields: Array.isArray(parsed.fields) ? parsed.fields : [] };
};

// Joins chunk outputs in page order. A panel that continues across a chunk boundary (same title as the
// last panel of the previous chunk) is merged into it.
const mergeChunks = (chunks) => {
  const components = [];
  const fields = [];
  chunks.forEach((c) => {
    (c.definition.components || []).forEach((comp) => {
      const last = components[components.length - 1];
      const sameTitle = (t) => String(t || '').replace(/\(continued\)/i, '').trim().toLowerCase();
      if (last && last.type === 'panel' && comp.type === 'panel' && sameTitle(last.title) === sameTitle(comp.title)) {
        last.components = [...(last.components || []), ...(comp.components || [])];
      } else components.push(comp);
    });
    fields.push(...c.fields);
  });
  return { definition: { display: 'form', components }, fields };
};

const sumUsage = (a, b) => ({
  promptTokens: (a.promptTokens || 0) + (b.prompt_tokens || b.promptTokens || 0),
  completionTokens: (a.completionTokens || 0) + (b.completion_tokens || b.completionTokens || 0),
});

/**
 * Per-field manifest for every input component, with the model's own confidence/notes (following
 * key renames made by repair) and heuristic flags added on top.
 */
const buildManifest = (definition, modelFields, renames) => {
  const queues = new Map();
  renames.forEach(({ from, to }) => { if (!queues.has(from)) queues.set(from, []); queues.get(from).push(to); });
  const byKey = new Map();
  modelFields.forEach((f) => {
    const q = queues.get(f && f.key);
    const key = q && q.length ? q.shift() : (f && f.key);
    if (key) byKey.set(key, f);
  });
  const fields = flattenFields(definition);
  const comps = fields.map((f) => f.component);
  return fields.map(({ component: c, parent }) => {
    const m = byKey.get(c.key);
    const flags = heuristicFlags(c, comps);
    const notes = [];
    if (m && m.notes) notes.push(String(m.notes));
    if (!m) notes.push('Model did not report this field');
    const reported = m && Number.isFinite(Number(m.confidence)) ? Math.min(1, Math.max(0, Number(m.confidence))) : null;
    return {
      key: c.key,
      type: c.type,
      label: c.label || '',
      section: parent && (parent.title || parent.label) ? (parent.title || parent.label) : '',
      sourcePage: m && Number.isInteger(Number(m.sourcePage)) ? Number(m.sourcePage) : null,
      confidence: m ? reported : 0.5,
      notes: notes.join('; '),
      flags,
    };
  });
};

/**
 * Runs the whole pipeline on one PDF buffer.
 * @param {Buffer} buffer
 * @param {object} opts { filename, callModel, onStage(label, progress), log }
 * @returns {{definition, fields, problems, usage}}
 */
const runIngestion = async (buffer, { filename = 'form.pdf', callModel, onStage = () => {}, log = () => {}, model = 'gpt-4.1' } = {}) => {
  if (typeof callModel !== 'function') throw new Error('runIngestion requires a callModel function');
  const t0 = Date.now();
  onStage(STAGES[1], 15);
  const { pages } = await precheckPdf(buffer);

  onStage(STAGES[2], 30);
  let usage = { promptTokens: 0, completionTokens: 0 };
  let jsonMode = null;
  const ranges = planChunks(pages);
  const results = [];
  const runChunk = async (range, i) => {
    const pdf = ranges.length === 1 ? buffer : await extractPages(buffer, range);
    const prior = ranges.length > 1 && i > 0 ? results.slice(0, i).filter(Boolean) : [];
    const priorKeys = []; let lastSection = '';
    prior.forEach((r) => walk(r.definition.components, (c) => { priorKeys.push(c.key); if (c.type === 'panel') lastSection = c.title; }));
    const text = CONTRACT_PROMPT + pageRangeNote(range) + priorNote(priorKeys, lastSection);
    const { content, usage: u, mode } = await callModel({ system: SYSTEM_PROMPT, text, pdf, filename, label: `form-ingestion-${range.from}-${range.to}` });
    usage = sumUsage(usage, u || {});
    if (mode && !jsonMode) jsonMode = mode;
    return normaliseEnvelope(parseJsonFromLlmContent(content));
  };
  // Chunks run one after another: each call is told which keys earlier pages used and which section it
  // continues, and the Foundry deployment's tokens-per-minute budget is shared with every other feature.
  for (let i = 0; i < ranges.length; i += 1) {
    results[i] = await runChunk(ranges[i], i);
    onStage(STAGES[2], 30 + Math.round(((i + 1) / ranges.length) * 40));
  }
  let merged = ranges.length === 1 ? results[0] : mergeChunks(results);

  onStage(STAGES[3], 75);
  let fixed = repair(merged.definition);
  let problems = validate(fixed.definition);
  let modelRepairs = 0;
  if (problems.length) {
    log(`form-ingestion: ${problems.length} validation problems after deterministic repair; asking the model once`);
    const text = `${REPAIR_PROMPT}\n\nProblems:\n${problems.map((p) => `- ${p}`).join('\n')}\n\nDefinition:\n${JSON.stringify({ definition: fixed.definition, fields: merged.fields })}`;
    try {
      const { content, usage: u } = await callModel({ system: SYSTEM_PROMPT, text, pdf: null, filename, label: 'form-ingestion-repair' });
      usage = sumUsage(usage, u || {});
      modelRepairs = 1;
      const again = normaliseEnvelope(parseJsonFromLlmContent(content));
      const refixed = repair(again.definition);
      const reproblems = validate(refixed.definition);
      if (reproblems.length <= problems.length) { merged = again; fixed = refixed; problems = reproblems; }
    } catch (e) {
      if (e instanceof FoundryRateLimitError) throw e;
      log(`form-ingestion: repair pass failed: ${e.message}`);
    }
  }

  onStage(STAGES[4], 90);
  const fields = buildManifest(fixed.definition, merged.fields, fixed.renames);
  return {
    definition: fixed.definition,
    fields,
    problems,
    usage: {
      model,
      promptVersion: PROMPT_VERSION,
      pages,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      seconds: Math.round((Date.now() - t0) / 100) / 10,
      repaired: fixed.repairs + modelRepairs,
      chunks: ranges.length,
      jsonMode,
    },
  };
};

module.exports = {
  PROMPT_VERSION, STAGES, SYSTEM_PROMPT, CONTRACT_PROMPT, REPAIR_PROMPT, SUPPORTED_TYPES,
  IngestionError, FoundryHttpError, describeFoundryError, scrub, isJsonModeRejection, precheckPdf, planChunks, extractPages, parseJsonFromLlmContent, mergeChunks,
  buildManifest, makeFoundryCaller, runIngestion, pageRangeNote, MAX_BYTES, MAX_PAGES, CHUNK_PAGES,
};
