const fs = require('fs');
const path = require('path');
const { AIProjectClient } = require('@azure/ai-projects');
const { DefaultAzureCredential } = require('@azure/identity');
const { DBSendResponseParam } = require('../queries/commonQueries');
const { loadTaskCompliance, unitsForTasks, getUnitOfService, SUPPORT_COORDINATION } = require('./taskCompliance');

const FOUNDRY_ENDPOINT = 'https://fwfoundry.services.ai.azure.com/api/projects/proj-fieldworker';
const FOUNDRY_AGENT_NAME = 'Your-caregiving-advisor';
const MAX_MESSAGE_LENGTH = 4000;

let openAIClient;
function getClient() {
  if (!openAIClient) {
    const projectClient = new AIProjectClient(FOUNDRY_ENDPOINT, new DefaultAzureCredential());
    openAIClient = projectClient.getOpenAIClient();
  }
  return openAIClient;
}

// POST /api/fieldworker/elliq/chat
// Body: { threadId?: string, message: string }
// Returns: { threadId, reply }
exports.chat = async function (req, res) {
  const { threadId, message } = req.body;
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ message: 'message is required' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ message: `Message exceeds maximum length of ${MAX_MESSAGE_LENGTH} characters` });
  }

  const ai = getClient();
  try {
    let conversationId = threadId;
    if (!conversationId) {
      const conversation = await ai.conversations.create();
      conversationId = conversation.id;
    }

    await ai.conversations.items.create(conversationId, {
      items: [{ type: 'message', role: 'user', content: message.trim() }],
    });

    const response = await ai.responses.create(
      { conversation: conversationId },
      { body: { agent: { name: FOUNDRY_AGENT_NAME, type: 'agent_reference' } } },
    );

    if (!response.output_text) {
      return res.status(500).json({ message: 'ElliQ returned an empty response' });
    }
    res.status(200).json({ threadId: conversationId, reply: response.output_text });
  } catch (e) {
    console.error('ElliQ chat error:', e);
    res.status(500).json({ message: 'ElliQ error', error: e.message });
  }
};

// GET /api/fieldworker/elliq/messages?threadId=xxx
// Returns: { data: [{ role, text, id }] } in chronological order
exports.getMessages = async function (req, res) {
  const { threadId } = req.query;
  if (!threadId) {
    return res.status(400).json({ message: 'threadId is required' });
  }

  const ai = getClient();
  try {
    const itemsPage = await ai.conversations.items.list(threadId);
    const messages = [];
    for await (const item of itemsPage) {
      if (item.type !== 'message') continue;
      const part = item.content?.find((c) => c.type === 'input_text' || c.type === 'output_text');
      if (part) messages.push({ role: item.role, text: part.text, id: item.id });
    }
    res.status(200).json({ data: messages.reverse() });
  } catch (e) {
    console.error('ElliQ getMessages error:', e);
    const isNotFound = e.status === 404 || e.statusCode === 404 || /not found/i.test(e.message);
    if (isNotFound) {
      return res.status(404).json({ expired: true, message: 'Thread not found or expired' });
    }
    res.status(500).json({ message: 'Failed to load messages', error: e.message });
  }
};

// ---------------------------------------------------------------------------
// RAG context generation
// Turns FieldWorker records into markdown documents to be embedded into a
// vector database for ElliQ retrieval. The build* functions return the
// markdown string; the HTTP endpoints persist it to
// files/elliq-markdown/{object_type}/{object_type}_{id}.md via writeMarkdownFile.
// ---------------------------------------------------------------------------

// Root output directory for generated markdown files, alongside the other
// generated artifacts in files/ (documents, evv_logfiles, medicaid, ...).
const MARKDOWN_DIR = path.join(__dirname, '..', 'files', 'elliq-markdown');

// Writes a built markdown doc to files/elliq-markdown/{objectType}/{objectType}_{id}.md
// (creating directories as needed) and returns the absolute file path.
async function writeMarkdownFile(objectType, id, markdown) {
  const dir = path.join(MARKDOWN_DIR, objectType);
  await fs.promises.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${objectType}_${id}.md`);
  await fs.promises.writeFile(filePath, markdown, 'utf8');
  return filePath;
}
exports.writeMarkdownFile = writeMarkdownFile; // reused by the batch RAG pipeline

// Renders a single DB value for markdown. Returns null for empty values so the
// caller can skip the field entirely (cleaner docs embed better).
function formatValue(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    // SQL Server "not set" rows come back as ~1899/1900 sentinel dates — treat as empty.
    if (value.getUTCFullYear() <= 1900) return null;
    const iso = value.toISOString();
    // Date-only columns come back at midnight UTC; keep the date, drop the time.
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    // Avoid scientific notation for large numeric ids (e.g., medicaid_id stored as numeric).
    return value.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
  }
  const str = String(value).trim();
  if (str === '') return null;
  // Some datetime columns come back as ISO strings, not Date objects
  // (e.g. task.tas_start_time = "2020-09-06T19:00:00"). Normalize "T" -> space.
  const iso = str.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  if (iso) return iso[2] === '00:00:00' ? iso[1] : `${iso[1]} ${iso[2]}`;
  return str;
}

exports.formatValue = formatValue;

// A text value may be plain text OR a serialized Draft.js / mui-rte content
// state (JSON: { blocks: [...], entityMap: {...} }). This flattens the Draft
// format to readable markdown — block structure (headers/lists/quotes) is
// preserved; inline styles are dropped (low value for embeddings). Plain text
// is returned unchanged.
function draftToMarkdown(text) {
  if (!text) return '';
  const trimmed = String(text).trim();
  if (!trimmed.startsWith('{')) return trimmed; // fast path: plain text

  let raw;
  try {
    raw = JSON.parse(trimmed);
  } catch (e) {
    return trimmed; // looked like JSON but isn't — treat as plain text
  }
  if (!raw || !Array.isArray(raw.blocks)) return trimmed; // not a Draft content state

  return raw.blocks
    .map((block) => {
      const t = block.text || '';
      switch (block.type) {
        case 'header-one': return `# ${t}`;
        case 'header-two': return `## ${t}`;
        case 'header-three': return `### ${t}`;
        case 'header-four': return `#### ${t}`;
        case 'header-five': return `##### ${t}`;
        case 'header-six': return `###### ${t}`;
        case 'unordered-list-item': return `- ${t}`;
        case 'ordered-list-item': return `1. ${t}`;
        case 'blockquote': return `> ${t}`;
        case 'code-block': return `    ${t}`;
        default: return t; // unstyled / paragraph
      }
    })
    .join('\n')
    .trim();
}

// "First Last" from two name columns, or null when neither is populated.
// Used to render resolved foreign keys as names: an embedding cannot do
// anything with "Employee ID: 700123", so every id that points at a person,
// place or organisation is joined and rendered as its name.
function fullName(first, last) {
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name || null;
}

// Coerces a DB value (Date object or ISO datetime string) to a Date, or null.
function toDate(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Whole minutes between two datetime-ish DB values, or null if not computable.
function durationMinutes(start, end) {
  const s = toDate(start);
  const e = toDate(end);
  if (!s || !e) return null;
  const ms = e.getTime() - s.getTime();
  return ms > 0 ? Math.round(ms / 60000) : null;
}

// Extracts "HH:MM" from a formatValue() output ("YYYY-MM-DD HH:MM:SS"), or null.
// Reads the time off the formatted string (not a Date) to avoid timezone shifts —
// formatValue is the single source of truth for how stored times are displayed.
function timeOfDay(formatted) {
  if (!formatted) return null;
  const m = String(formatted).match(/\b(\d{2}:\d{2}):\d{2}/);
  return m ? m[1] : null;
}

// "2.5 hours (14:00 - 16:30)" from start/end DB values, or null if duration is
// not computable. Omits the "(start - end)" range when times aren't available.
function formatDuration(start, end) {
  const mins = durationMinutes(start, end);
  if (mins === null) return null;
  const hours = +(mins / 60).toFixed(2); // 2.5, 1, 3.25
  const range = [timeOfDay(formatValue(start)), timeOfDay(formatValue(end))];
  const suffix = range[0] && range[1] ? ` (${range[0]} - ${range[1]})` : '';
  return `${hours} hour${hours === 1 ? '' : 's'}${suffix}`;
}

// Renders [db_column, label, formatter?] field groups into markdown "## Section"
// blocks. Empty fields are skipped; a section with no populated fields is
// omitted. The optional third element overrides formatValue for that field
// (e.g. draftToMarkdown for rich-text columns).
// Shared by every object builder (customer, project, ...).
function renderSections(row, sections) {
  const lines = [];
  for (const section of sections) {
    const rendered = section.fields
      .map(([col, label, format]) => {
        const formatted = format ? format(row[col]) || null : formatValue(row[col]);
        return formatted === null ? null : `* **${label}:** ${formatted}`;
      })
      .filter(Boolean);
    if (rendered.length === 0) continue; // skip a section with no populated fields
    lines.push('', `## ${section.title}`, ...rendered);
  }
  return lines;
}

// The customer profile: a single "General Information" section listing every
// customer column (ordered list of [db_column, label] pairs). Empty fields are
// skipped. Columns also present in the frontmatter (cus_id, cus_company_id,
// cus_status) are repeated here so the body lists the full table. Lowercase
// race/ethnicity/preferred_language/marital_status come from customer_extension
// (merged into the row by the builder) — in live data a customer never has both
// the customer-table and extension variants populated.
// Split into three sections rather than one flat "General Information" so that
// header-based chunking produces semantically coherent chunks. As one section
// it ran ~3,700 chars — over half the document and past the 2,000-char chunk
// cap, so it split into two windows of mostly administrative fields that then
// competed with the clinical sections for top-K on every query. Separated, the
// administrative noise lands in its own chunk that rarely wins retrieval.
//
// The company-defined custom slots (place01char..place16number) and
// customer_extension_id are deliberately omitted: the slots carry a different
// meaning per company with no label available here, so "Custom Field 3: Yes"
// is pure noise, and the extension id is an internal key.
const CUSTOMER_SECTIONS = [
  {
    title: 'Demographics & Contact',
    fields: [
      ['cus_id', 'Customer ID'],
      ['cus_company_id', 'Company ID'],
      ['cus_name', 'Full Name'],
      ['cus_first_name', 'First Name'],
      ['cus_last_name', 'Last Name'],
      ['cus_is_company', 'Is Company'],
      ['cus_type', 'Type'],
      ['cus_status', 'Status'],
      ['cus_is_active', 'Active'],
      ['cus_local_id', 'Local ID'],
      ['dob', 'Date of Birth'],
      ['cus_age', 'Age'],
      ['gender', 'Gender'],
      ['Race', 'Race'],
      ['race', 'Race'],
      ['Ethnicity', 'Ethnicity'],
      ['ethnicity', 'Ethnicity'],
      ['marital_status', 'Marital Status'],
      ['County', 'County'],
      ['cus_address', 'Address'],
      ['mailing_detail', 'Mailing Detail'],
      ['cus_phone', 'Phone'],
      ['home_phone', 'Home Phone'],
      ['mobile', 'Mobile'],
      ['cus_email', 'Email'],
      ['email', 'Alternate Email'],
      ['LanguagePreference', 'Language Preference'],
      ['preferred_language', 'Preferred Language'],
      ['ProviderGenderPreference', 'Provider Gender Preference'],
      ['PreferRepeatProviders', 'Prefers Repeat Providers'],
      ['HasPet', 'Has Pet'],
    ],
  },
  {
    title: 'Clinical & Eligibility',
    fields: [
      ['PrimaryDiagnosisCode', 'Primary Diagnosis Code'],
      ['SecondaryDiagnosisCode', 'Secondary Diagnosis Code'],
      ['diagnose_code', 'Diagnosis Code'],
      ['medicaid_id', 'Medicaid ID'],
      ['medicaid_eligible', 'Medicaid Eligible'],
      ['MedicaidEndDate', 'Medicaid End Date'],
      ['waiver_program', 'Waiver Program'],
      ['func_criteria_met', 'Functional Criteria Met'],
      ['last_assess_date', 'Last Assessment Date'],
      ['private_payer_name', 'Private Payer'],
      ['DDDID', 'DDD ID'],
      ['DDD_tier', 'DDD Tier'],
      ['NJCATSelfcare', 'NJCAT Self-Care Score'],
      ['NJCATBehavioral', 'NJCAT Behavioral Score'],
      ['NJCATMedical', 'NJCAT Medical Score'],
      ['NJCATFCA', 'NJCAT FCA'],
      ['last_plan_approval_date', 'Last Plan Approval Date'],
      ['renewal_date', 'Renewal Date'],
    ],
  },
  {
    title: 'Administrative',
    fields: [
      ['cus_acquired_date', 'Acquired Date'],
      ['sign_page_date', 'Sign Page Date'],
      ['AgencyAssignDate', 'Agency Assign Date'],
      ['TransferOutDate', 'Transfer Out Date'],
      ['TransferOutReason', 'Transfer Out Reason'],
      ['DriverLicenseNumber', 'Driver License Number'],
      ['DLIssueState', 'Driver License Issue State'],
      ['DLIssueDate', 'Driver License Issue Date'],
      ['DLExpiryDate', 'Driver License Expiry Date'],
      ['cus_created_at', 'Created At'],
      ['cus_updated_at', 'Updated At'],
    ],
  },
];

// Single row per customer (customer_health_need has a UNIQUE constraint on
// customer_id). Free-text plain fields entered via multiline TextFields.
const CUSTOMER_HEALTH_NEED_SECTIONS = [
  {
    title: 'Health & Nutrition Needs',
    fields: [
      ['allergies', 'Allergies'],
      ['dietary', 'Dietary'],
      ['health_hazards', 'Health Hazards'],
      ['self_care', 'Self-Care'],
    ],
  },
];

// One row per customer in practice (no UNIQUE constraint — the builder takes
// the latest row by customer_adl_id). All customer_adl columns.
const CUSTOMER_ADL_SECTIONS = [
  {
    title: 'Activities of Daily Living (ADL)',
    fields: [
      ['Grooming', 'Grooming'],
      ['DressUpperBody', 'Dress Upper Body'],
      ['DressLowerBody', 'Dress Lower Body'],
      ['Bathing', 'Bathing'],
      ['ToiletTransferring', 'Toilet Transferring'],
      ['ToiletHygiene', 'Toilet Hygiene'],
      ['Transferring', 'Transferring'],
      ['Ambulation', 'Ambulation'],
      ['MoneyManagement', 'Money Management'],
      ['HouseholdManagement', 'Household Management'],
      ['HealthManagement', 'Health Management'],
      ['MealPreparation', 'Meal Preparation'],
      ['Communication', 'Communication'],
      ['Transportation', 'Transportation'],
      ['Shopping', 'Shopping'],
      ['added_by_name', 'Assessed By'],
      ['addedOn', 'Assessed On'],
    ],
  },
];

// Single row per customer (customer_support_need has a UNIQUE constraint on
// customer_id). Free-text plain fields entered via multiline TextFields.
const CUSTOMER_SUPPORT_NEED_SECTIONS = [
  {
    title: 'Safety and Support Needs',
    fields: [
      ['behavior', 'Behavior'],
      ['mobility', 'Mobility'],
      ['religious_cultural', 'Religious/Cultural'],
      ['support_settings', 'Support Settings'],
    ],
  },
];

// Builds a markdown customer profile (YAML frontmatter + sectioned fields).
// Returns the markdown string, or null if no customer with that id exists.
// This is the reusable building block for the ElliQ RAG pipeline — the batch
// job will call this in-memory and feed the result to the vectorizer.
exports.buildCustomerMarkdown = async function (cusId) {
  const rows = await DBSendResponseParam(
    'SELECT * FROM customer WHERE cus_id = @cusId',
    { cusId },
  );
  if (!rows || rows.length === 0) return null;
  const c = rows[0];

  // Related records: the customer_extension row (merged into General
  // Information), active goals (many) + the single health/support need and
  // ADL rows, the customer contacts, and the company's payers. goal_status != 3
  // marks "deleted/removed" goals (see customer_goal helper & metabase report);
  // status defaults to 0 on insert so != 3 never drops NULLs.
  const [extRows, goals, healthRows, supportRows, adlRows, contactRows, payerRows] = await Promise.all([
    DBSendResponseParam(
      'SELECT TOP 1 * FROM customer_extension WHERE cus_id = @cusId ORDER BY customer_extension_id DESC',
      { cusId },
    ),
    DBSendResponseParam(
      `SELECT goal_title, goal_detail
         FROM customer_goal
        WHERE customer_id = @cusId AND goal_status != 3
        ORDER BY customer_goal_id`,
      { cusId },
    ),
    DBSendResponseParam(
      'SELECT * FROM customer_health_need WHERE customer_id = @cusId',
      { cusId },
    ),
    DBSendResponseParam(
      'SELECT * FROM customer_support_need WHERE customer_id = @cusId',
      { cusId },
    ),
    // Employee joined so the assessor renders as a name rather than an id.
    DBSendResponseParam(
      `SELECT TOP 1 adl.*, e.emp_first_name, e.emp_last_name
         FROM customer_adl adl
         LEFT JOIN employee e ON e.emp_id = adl.addedBy
        WHERE adl.customer_id = @cusId
        ORDER BY adl.customer_adl_id DESC`,
      { cusId },
    ),
    // "Customer Contacts" as shown on the Clients -> People tab: contacts
    // linked via ProjectContact to any of the customer's projects (frontend
    // GET /projcontact?customer_id=, filtered to con_is_active !== false).
    // DISTINCT because the same contact can be linked through several projects.
    DBSendResponseParam(
      `SELECT DISTINCT pc.pc_relationship,
              ct.con_id, ct.con_first_name, ct.con_last_name, ct.con_contact_type,
              ct.con_phone, ct.con_Addr_line1, ct.con_Addr_line2, ct.con_city,
              ct.con_state, ct.con_zip, ct.con_note
         FROM ProjectContact pc
         JOIN contact ct ON pc.cont_id = ct.con_id
         JOIN project p ON pc.proj_id = p.pro_id
        WHERE p.pro_customer_id = @cusId
          AND (ct.con_is_active IS NULL OR ct.con_is_active = 1)
        ORDER BY ct.con_id`,
      { cusId },
    ),
    // "Payers" as shown on the Settings -> Billing tab: companyPayerRel rows
    // for the customer's company joined to payer (frontend GET
    // /associate_payer?compId=, kept when a payer row exists). Credentials
    // (credentials table / credId) are intentionally NOT selected.
    DBSendResponseParam(
      `SELECT cpr.payerId, cpr.enrollmentStatus, cpr.relStartDate, cpr.relEndDate,
              cpr.relEnrollmentDate, cpr.payerTaxId, cpr.conFirstName, cpr.conLastName,
              cpr.conDesignation, cpr.payerAddrLine1, cpr.payerAddrLine2, cpr.payerCity,
              cpr.payerZip, cpr.payerPhone,
              py.payer_name, py.payer_state, py.payer_is_active, py.payer_type
         FROM companyPayerRel cpr
         JOIN payer py ON py.payer_id = cpr.payerId
        WHERE cpr.compId = @companyId
        ORDER BY cpr.id`,
      { companyId: c.cus_company_id },
    ),
  ]);

  const lines = [
    '---',
    'object_type: customer',
    `customer_id: ${c.cus_id}`,
    `company_id: ${c.cus_company_id}`,
    `status: ${c.cus_status || ''}`,
    '---',
    '',
    `# Customer: ${c.cus_name.trim()}`,
  ];

  // Extension columns are lowercase (race vs Race), so spreading can't clobber
  // the customer columns; its cus_id matches the customer's by definition.
  // private_payer_name resolves the private_payer id against the payer table.
  const privatePayerName = c.private_payer
    ? formatValue((await DBSendResponseParam(
      'SELECT payer_name FROM payer WHERE payer_id = @payerId',
      { payerId: c.private_payer },
    ) || [])[0]?.payer_name)
    : null;

  lines.push(...renderSections(
    { ...c, ...(extRows && extRows[0]), private_payer_name: privatePayerName },
    CUSTOMER_SECTIONS,
  ));

  // Goals are a list of rows (not a single record), so they don't fit the
  // [column, label] section pattern — render each goal as its own bullet.
  const goalLines = (goals || [])
    .map((g) => {
      const title = formatValue(g.goal_title);
      const detail = formatValue(g.goal_detail);
      if (title === null && detail === null) return null;
      return `* **${title || 'Goal'}:** ${detail || ''}`.trimEnd();
    })
    .filter(Boolean);
  if (goalLines.length) {
    lines.push('', '## Goals/Outcomes', ...goalLines);
  }

  if (healthRows && healthRows.length) {
    lines.push(...renderSections(healthRows[0], CUSTOMER_HEALTH_NEED_SECTIONS));
  }
  if (supportRows && supportRows.length) {
    lines.push(...renderSections(supportRows[0], CUSTOMER_SUPPORT_NEED_SECTIONS));
  }
  if (adlRows && adlRows.length) {
    const adl = adlRows[0];
    lines.push(...renderSections(
      { ...adl, added_by_name: fullName(adl.emp_first_name, adl.emp_last_name) },
      CUSTOMER_ADL_SECTIONS,
    ));
  }

  // Contacts are a list of rows, rendered one bullet each (like goals). Field
  // layout mirrors the People tab card: name, relationship (pc_relationship
  // falling back to con_contact_type), phone, address, note.
  const contactLines = (contactRows || [])
    .map((ct) => {
      const name = [ct.con_first_name, ct.con_last_name].filter(Boolean).join(' ').trim();
      const address = [ct.con_Addr_line1, ct.con_Addr_line2, ct.con_city, ct.con_state, ct.con_zip]
        .map(formatValue)
        .filter(Boolean)
        .join(', ');
      const details = [
        ['Relationship', formatValue(ct.pc_relationship) || formatValue(ct.con_contact_type)],
        ['Phone', formatValue(ct.con_phone)],
        ['Address', address || null],
        ['Note', formatValue(ct.con_note)],
      ]
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
      if (!name && !details) return null;
      return `* **${name || 'Contact'}:** ${details}`.trimEnd();
    })
    .filter(Boolean);
  if (contactLines.length) {
    lines.push('', '## Customer Contacts', ...contactLines);
  }

  // Payers are a list of rows, rendered one bullet each. Mirrors the Settings
  // -> Billing payer card (status, dates, contact, phone, address, tax id,
  // enrollment) — credentials are never included.
  const payerLines = (payerRows || [])
    .map((py) => {
      const name = formatValue(py.payer_name);
      const address = [py.payerAddrLine1, py.payerAddrLine2, py.payerCity, py.payer_state, py.payerZip]
        .map(formatValue)
        .filter(Boolean)
        .join(', ');
      const contact = [py.conFirstName, py.conLastName].filter(Boolean).join(' ').trim();
      const details = [
        ['Status', py.payer_is_active === null || py.payer_is_active === undefined ? null : (py.payer_is_active ? 'Active' : 'Inactive')],
        ['Type', formatValue(py.payer_type)],
        ['State', formatValue(py.payer_state)],
        ['Tax ID', formatValue(py.payerTaxId)],
        ['Phone', formatValue(py.payerPhone)],
        ['Address', address || null],
        ['Enrollment Status', formatValue(py.enrollmentStatus)],
        ['Enrollment Date', formatValue(py.relEnrollmentDate)],
        ['Start Date', formatValue(py.relStartDate)],
        ['End Date', formatValue(py.relEndDate)],
        ['Contact', contact || null],
        ['Contact Designation', formatValue(py.conDesignation)],
      ]
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
      if (!name && !details) return null;
      return `* **${name || `Payer ${py.payerId}`}:** ${details}`.trimEnd();
    })
    .filter(Boolean);
  if (payerLines.length) {
    lines.push('', '## Payers', ...payerLines);
  }

  return lines.join('\n');
};

// GET /api/fieldworker/elliq/customer/:cus_id/markdown
// Builds the doc, writes it to files/elliq-markdown/customer/customer_{cus_id}.md.
// Returns: { cus_id, file, markdown }
//
// Readable rendered markdown (real line breaks via jq -r):
//   curl -s http://localhost:4000/api/fieldworker/elliq/customer/603598/markdown | jq -r '.markdown'
exports.getCustomerMarkdown = async function (req, res) {
  const cusId = parseInt(req.params.cus_id, 10);
  if (isNaN(cusId)) {
    return res.status(400).json({ message: 'Invalid cus_id' });
  }
  try {
    const markdown = await exports.buildCustomerMarkdown(cusId);
    if (markdown === null) {
      return res.status(404).json({ message: `Customer ${cusId} not found` });
    }
    const file = await writeMarkdownFile('customer', cusId, markdown);
    res.status(200).json({ cus_id: cusId, file, markdown });
  } catch (e) {
    console.error('ElliQ getCustomerMarkdown error:', e);
    res.status(500).json({ message: 'Failed to build customer markdown', error: e.message });
  }
};

// The project profile: a single "General Information" section listing every
// project column. Empty fields are skipped. Columns also present in the
// frontmatter (pro_id, pro_customer_id, pro_com_id, start/end dates) are
// repeated here so the body lists the full table.
const PROJECT_SECTIONS = [
  {
    title: 'General Information',
    fields: [
      ['pro_id', 'Project ID'],
      ['pro_customer_id', 'Customer ID'],
      ['pro_com_id', 'Company ID'],
      ['pro_title', 'Title'],
      ['pro_description', 'Description'],
      ['pro_status', 'Status'],
      ['pro_is_active', 'Active'],
      ['pro_starts_on', 'Start Date'],
      ['pro_ends_on', 'End Date'],
      ['Program', 'Program'],
      ['pro_currency', 'Currency'],
      ['pro_price', 'Price'],
      ['pro_self_pay', 'Self Pay'],
      ['primary_payer_name', 'Primary Payer'],
      ['secondary_payer_name', 'Secondary Payer'],
      ['first_billing_date', 'First Billing Date'],
      ['DDD_ID', 'DDD ID'],
      ['DDD_plan_id', 'DDD Plan ID'],
      ['DDD_budget_amt', 'DDD Budget Amount'],
      ['plan_program_name', 'Plan Program Name'],
      ['plan_approval_date', 'Plan Approval Date'],
      ['medicaid_approv_date', 'Medicaid Approval Date'],
      ['medicaid_prgm_status_code', 'Medicaid Program Status Code'],
      ['last_plan_modified_date', 'Last Plan Modified Date'],
      ['active_plan_version', 'Active Plan Version'],
      ['active_plan_status', 'Active Plan Status'],
      ['active_plan_budget', 'Active Plan Budget'],
      ['active_plan_allocated', 'Active Plan Allocated'],
      ['active_plan_expended', 'Active Plan Expended'],
      ['active_plan_creation_date', 'Active Plan Creation Date'],
      ['active_plan_startdate', 'Active Plan Start Date'],
      ['active_plan_duedate', 'Active Plan Due Date'],
      ['curr_plan', 'Current Plan'],
      ['curr_plan_version', 'Current Plan Version'],
      ['curr_plan_budget', 'Current Plan Budget'],
      ['curr_plan_allocated', 'Current Plan Allocated'],
      ['LastMCType', 'Last MC Type'],
      ['LastMCDate', 'Last MC Date'],
      ['LastMMTUploadDate', 'Last MMT Upload Date'],
      ['LastAnnualVisitDate', 'Last Annual Visit Date'],
      ['customer_name', 'Customer'],
      ['manager_name', 'Manager'],
      ['contact_name', 'Contact'],
      ['pro_created_at', 'Created At'],
      ['pro_updated_at', 'Updated At'],
      ['created_by_name', 'Created By'],
      ['updated_by_name', 'Updated By'],
    ],
  },
];

// Builds a markdown project profile (YAML frontmatter + sectioned fields).
// Returns the markdown string, or null if no project with that id exists.
exports.buildProjectMarkdown = async function (proId) {
  // Manager, contact, customer, payers and the audit employees are joined so
  // they render as names -- "Manager ID: 700123" is unretrievable, "Manager:
  // Maria Alvarez" is what someone would actually ask about.
  const rows = await DBSendResponseParam(
    `SELECT p.*,
            cus.cus_name,
            mgr.emp_first_name AS mgr_first, mgr.emp_last_name AS mgr_last,
            cre.emp_first_name AS cre_first, cre.emp_last_name AS cre_last,
            upd.emp_first_name AS upd_first, upd.emp_last_name AS upd_last,
            con.con_first_name, con.con_last_name,
            pp.payer_name AS primary_payer_name,
            sp.payer_name AS secondary_payer_name
       FROM project p
       LEFT JOIN customer cus ON cus.cus_id = p.pro_customer_id
       LEFT JOIN employee mgr ON mgr.emp_id = p.pro_manager_id
       LEFT JOIN employee cre ON cre.emp_id = p.pro_created_by
       LEFT JOIN employee upd ON upd.emp_id = p.pro_updated_by
       LEFT JOIN contact con ON con.con_id = p.pro_contact_id
       LEFT JOIN payer pp ON pp.payer_id = p.pro_primary_payer
       LEFT JOIN payer sp ON sp.payer_id = p.pro_secondary_payer
      WHERE p.pro_id = @proId`,
    { proId },
  );
  if (!rows || rows.length === 0) return null;
  const p = rows[0];

  // Project locations: location rows joined via projectLocation (same join the
  // project detail endpoint uses for its "locations" list — no active filter).
  const locationRows = await DBSendResponseParam(
    `SELECT l.*
       FROM projectLocation pl
       JOIN location l ON l.loc_id = pl.ploc_loc_id
      WHERE pl.ploc_pro_id = @proId
      ORDER BY pl.ploc_id`,
    { proId },
  );

  const title = (p.pro_title && p.pro_title.trim()) || `Project ${p.pro_id}`;
  const lines = [
    '---',
    'object_type: project',
    `project_id: ${p.pro_id}`,
    `customer_id: ${p.pro_customer_id}`,
    `company_id: ${p.pro_com_id}`,
    `project_start_date: ${formatValue(p.pro_starts_on) || ''}`,
    `project_end_date: ${formatValue(p.pro_ends_on) || ''}`,
    '---',
    '',
    `# Project: ${title}`,
  ];

  lines.push(...renderSections({
    ...p,
    customer_name: formatValue(p.cus_name),
    manager_name: fullName(p.mgr_first, p.mgr_last),
    contact_name: fullName(p.con_first_name, p.con_last_name),
    created_by_name: fullName(p.cre_first, p.cre_last),
    updated_by_name: fullName(p.upd_first, p.upd_last),
  }, PROJECT_SECTIONS));

  // Locations are a list of rows, rendered one bullet each — the address is
  // the bullet name, remaining location columns follow as details.
  const locationLines = (locationRows || [])
    .map((l) => {
      const address = [l.loc_addr_line1, l.loc_addr_line2, l.loc_city, l.loc_state, l.loc_zip]
        .map(formatValue)
        .filter(Boolean)
        .join(', ');
      const coords = [formatValue(l.loc_lat), formatValue(l.loc_lon)].filter(Boolean).join(', ');
      const details = [
        ['Location ID', formatValue(l.loc_id)],
        ['Type', formatValue(l.loc_type)],
        ['Status', formatValue(l.loc_status)],
        ['County', formatValue(l.loc_county)],
        ['Phone', formatValue(l.loc_phone_number)],
        ['Coordinates', coords || null],
        ['Active', formatValue(l.loc_is_active)],
        ['Association Date', formatValue(l.loc_association_date)],
        ['Facility Type', formatValue(l.FacilityType)],
        ['Facility Code Qualifier', formatValue(l.FacilityCodeQualifier)],
      ]
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
      if (!address && !details) return null;
      return `* **${address || `Location ${l.loc_id}`}:** ${details}`.trimEnd();
    })
    .filter(Boolean);
  if (locationLines.length) {
    lines.push('', '## Project Locations', ...locationLines);
  }

  return lines.join('\n');
};

// GET /api/fieldworker/elliq/project/:pro_id/markdown
// Builds the doc, writes it to files/elliq-markdown/project/project_{pro_id}.md.
// Returns: { pro_id, file, markdown }
//
// Readable rendered markdown (real line breaks via jq -r):
//   curl -s http://localhost:4000/api/fieldworker/elliq/project/<pro_id>/markdown | jq -r '.markdown'
exports.getProjectMarkdown = async function (req, res) {
  const proId = parseInt(req.params.pro_id, 10);
  if (isNaN(proId)) {
    return res.status(400).json({ message: 'Invalid pro_id' });
  }
  try {
    const markdown = await exports.buildProjectMarkdown(proId);
    if (markdown === null) {
      return res.status(404).json({ message: `Project ${proId} not found` });
    }
    const file = await writeMarkdownFile('project', proId, markdown);
    res.status(200).json({ pro_id: proId, file, markdown });
  } catch (e) {
    console.error('ElliQ getProjectMarkdown error:', e);
    res.status(500).json({ message: 'Failed to build project markdown', error: e.message });
  }
};

// Builds a markdown case note. Joins comments → customer (customer name) and
// employee (author name). Returns the markdown string, or null if no comment
// with that id exists. LEFT JOINs so a note with a missing link still renders.
exports.buildCaseNoteMarkdown = async function (commentId) {
  const rows = await DBSendResponseParam(
    `SELECT cm.comment_id, cm.customer_id, cm.emp_id, cm.task_id, cm.created_at, cm.comment_text,
            c.cus_name,
            e.emp_first_name, e.emp_last_name,
            t.tas_type, t.tas_title, t.tas_start_time, t.tas_end_time
       FROM comments cm
       LEFT JOIN customer c ON cm.customer_id = c.cus_id
       LEFT JOIN employee e ON cm.emp_id = e.emp_id
       LEFT JOIN task t ON cm.task_id = t.tas_id
      WHERE cm.comment_id = @commentId`,
    { commentId },
  );
  if (!rows || rows.length === 0) return null;
  const n = rows[0];

  const customerName = (n.cus_name || '').trim();
  const employeeName = [n.emp_first_name, n.emp_last_name].filter(Boolean).join(' ').trim();
  const createdAt = formatValue(n.created_at) || '';
  const narrative = draftToMarkdown(n.comment_text);

  const lines = [
    '---',
    'object_type: casenote',
    `note_id: ${n.comment_id}`,
    `customer_id: ${n.customer_id}`,
    `employee_id: ${n.emp_id}`,
    `task_id: ${n.task_id || ''}`,
    '---',
    '',
    `# Case Note - ${createdAt}`,
    `**Customer:** ${customerName}`,
    `**Employee:** ${employeeName}`,
    '',
    '## Clinical Narrative & Observations',
    narrative,
  ];

  // When the note is tied to a task, append task details.
  if (n.task_id) {
    const taskType = formatValue(n.tas_type);
    const title = formatValue(n.tas_title);
    const duration = formatDuration(n.tas_start_time, n.tas_end_time);
    const detailLines = [];
    if (title !== null) detailLines.push(`* **Title:** ${title}`);
    if (duration !== null) detailLines.push(`* **Duration:** ${duration}`);
    if (detailLines.length) {
      lines.push('', `## ${taskType ? `${taskType} ` : ''}Task Details`, ...detailLines);
    }
  }

  // Goals are linked by customer_id, so they would render on every note. Titles
  // only, and goal_detail deliberately omitted: the full text is identical
  // across all of a customer's notes, and duplicating it into (say) 50 notes
  // produces 50 near-identical chunks that crowd out genuinely distinct
  // material in top-K. Titles keep the associative hook without the mass; the
  // canonical full version lives in the customer profile.
  const goalRows = await DBSendResponseParam(
    `SELECT goal_title
       FROM customer_goal
      WHERE customer_id = @customerId AND goal_status != 3
      ORDER BY customer_goal_id`,
    { customerId: n.customer_id },
  );
  const goalTitles = (goalRows || [])
    .map((g) => formatValue(g.goal_title))
    .filter(Boolean);
  if (goalTitles.length) {
    lines.push('', '## Active Goals', ...goalTitles.map((t) => `* ${t}`));
  }

  return lines.join('\n');
};

// GET /api/fieldworker/elliq/casenote/:comment_id/markdown
// Builds the doc, writes it to files/elliq-markdown/casenote/casenote_{comment_id}.md.
// Returns: { comment_id, file, markdown }
//
// Readable rendered markdown (real line breaks via jq -r):
//   curl -s http://localhost:4000/api/fieldworker/elliq/casenote/<comment_id>/markdown | jq -r '.markdown'
exports.getCaseNoteMarkdown = async function (req, res) {
  const commentId = parseInt(req.params.comment_id, 10);
  if (isNaN(commentId)) {
    return res.status(400).json({ message: 'Invalid comment_id' });
  }
  try {
    const markdown = await exports.buildCaseNoteMarkdown(commentId);
    if (markdown === null) {
      return res.status(404).json({ message: `Comment ${commentId} not found` });
    }
    const file = await writeMarkdownFile('casenote', commentId, markdown);
    res.status(200).json({ comment_id: commentId, file, markdown });
  } catch (e) {
    console.error('ElliQ getCaseNoteMarkdown error:', e);
    res.status(500).json({ message: 'Failed to build case note markdown', error: e.message });
  }
};

// The task profile: a single "General Information" section listing every task
// column. Empty fields are skipped. Columns also present in the frontmatter
// (tas_id, tas_type, tas_cus_id, tas_emp_id, tas_com_id) or the heading
// (tas_title) are repeated here so the body lists the full table. claim_status
// is joined in from Claim.
// Tasks are by far the highest-volume document type, so this section is kept to
// what describes the visit: what was done, by whom, for whom, when, where.
//
// Revenue-cycle plumbing stays out of *this* section -- Invoice ID, Timesheet
// Entry, Billable by Default, and bare internal ids (Location 1/2, Prerequisite
// Task, Active Status flags). None of it answers a care question, and
// multiplied across every task in the window it was a large share of the index.
//
// The ids that link a task to what was billed for it -- claim, prior auth, MT --
// were excluded on the same grounds, and Scenario 3 (compliance gaps) needs
// them back. They return as frontmatter and as a dedicated "Billing &
// Compliance" section rather than as more General Information bullets: the
// frontmatter is what a hybrid query filters on, and keeping the section
// separate means header-based chunking isolates it, so a care question still
// retrieves the care chunk and not the billing one.
// task.tas_is_active = 2 marks a soft-deleted task. Named here because it is
// the value this module has to exclude in three places.
const TASK_DELETED = 2;

const TASK_SECTIONS = [
  {
    title: 'General Information',
    fields: [
      ['tas_id', 'Task ID'],
      ['tas_title', 'Title'],
      ['tas_type', 'Type'],
      ['task_status', 'Status'],
      ['customer_name', 'Customer'],
      ['employee_name', 'Performed By'],
      ['project_title', 'Project'],
      ['location_summary', 'Location'],
      ['tas_description', 'Description', draftToMarkdown],
      ['tas_notes', 'Notes', draftToMarkdown],
      ['tas_priority', 'Priority'],
      ['tas_required_sig', 'Signature Required'],
      ['tas_start_date', 'Start Date'],
      ['tas_end_date', 'End Date'],
      ['tas_start_time', 'Start Time'],
      ['tas_end_time', 'End Time'],
      ['duration_summary', 'Duration'],
      ['start_time_actual', 'Actual Start Time'],
      ['end_time_actual', 'Actual End Time'],
      ['task_emp_timezone', 'Employee Timezone'],
      ['tas_travel_time', 'Travel Time (minutes)'],
      ['checkin', 'Checked In'],
      ['tas_expenses', 'Expenses'],
      ['tas_created_at', 'Created At'],
      ['tas_updated_at', 'Updated At'],
      ['created_by_name', 'Created By'],
      ['updated_by_name', 'Updated By'],
    ],
  },
];

// Builds a markdown task profile. Joins task -> project (customer link),
// empLocate (EVV clock-in/out + GPS; one row holds both events, keyed
// taskId=tas_id) and Claim (the billing line this task was rolled into).
// Returns the markdown string, or null if no task with that id exists.
//
// `compliance` is an optional preloaded entry from
// taskCompliance.loadTaskCompliance. The sweep loads one map per customer and
// passes entries in; callers that omit it pay for a per-task load, which is
// fine for the single-document HTTP endpoints but would multiply badly across
// a full sweep.
exports.buildTaskMarkdown = async function (tasId, { compliance } = {}) {
  // Employee, customer, project and location joined so the document names them
  // instead of listing ids. Added to the existing query rather than fetched
  // separately -- tasks are the highest-volume document type, so extra round
  // trips here multiply across the whole sweep.
  const rows = await DBSendResponseParam(
    `SELECT t.*,
            p.pro_customer_id, p.pro_title,
            cus.cus_name,
            emp.emp_first_name AS emp_first, emp.emp_last_name AS emp_last,
            cre.emp_first_name AS cre_first, cre.emp_last_name AS cre_last,
            upd.emp_first_name AS upd_first, upd.emp_last_name AS upd_last,
            l.loc_addr_line1, l.loc_city, l.loc_state, l.loc_type,
            el.empLocdate, el.checkoutEmpDate, el.emploc_lat, el.emploc_lon,
            clm.Status AS claim_status, clm.authUnits AS claim_units,
            clm.procedureCode AS claim_proc_code, clm.priorAuth AS claim_prior_auth
       FROM task t
       LEFT JOIN project p ON t.tas_pro_id = p.pro_id
       LEFT JOIN customer cus ON cus.cus_id = COALESCE(t.tas_cus_id, p.pro_customer_id)
       LEFT JOIN employee emp ON emp.emp_id = t.tas_emp_id
       LEFT JOIN employee cre ON cre.emp_id = t.tas_created_by
       LEFT JOIN employee upd ON upd.emp_id = t.tas_updated_by
       LEFT JOIN location l ON l.loc_id = t.tas_loc_id
       LEFT JOIN empLocate el ON el.taskId = t.tas_id
       LEFT JOIN Claim clm ON clm.claim_ID = t.tas_claim_id
      WHERE t.tas_id = @tasId
      ORDER BY el.empLocdate DESC`,
    { tasId },
  );
  if (!rows || rows.length === 0) return null;
  const t = rows[0]; // most recent EVV record (if any) via ORDER BY

  // Forms submitted against this task (customer_form.task_id), with the form
  // definition name from fw_forms and the author from employee. The stored
  // submission JSON (customer_form.data) is intentionally not selected.
  const formRows = await DBSendResponseParam(
    `SELECT cf.form_id, cf.customer_id, cf.form_type,
            cf.created_on, cf.last_updated,
            f.form_name,
            e.emp_first_name, e.emp_last_name
       FROM customer_form cf
       LEFT JOIN fw_forms f ON cf.form_type = f.form_id
       LEFT JOIN employee e ON e.emp_id = cf.created_by
      WHERE cf.task_id = @tasId
      ORDER BY cf.form_id`,
    { tasId },
  );

  const dur = durationMinutes(t.tas_start_time, t.tas_end_time);
  const title = (t.tas_title && t.tas_title.trim()) || `Task ${t.tas_id}`;

  // Compliance facts: the caller's preloaded entry when there is one, otherwise
  // a load for this task alone.
  const taskCompliance = compliance
    || (await loadTaskCompliance([tasId])).get(Number(tasId))
    || null;

  const completed = Number(t.tas_is_active) === 1;
  const deleted = Number(t.tas_is_active) === TASK_DELETED;
  const taskStatus = deleted ? 'Deleted' : (completed ? 'Completed' : 'Open');
  const checkedIn = t.checkin === true || t.checkin === 1;
  const submittedFormCount = (formRows || []).length;
  const missingFormCount = (taskCompliance?.missingForms || []).length;
  const mtApplicable = taskCompliance
    ? taskCompliance.businessType === SUPPORT_COORDINATION || Boolean(taskCompliance.mt)
    : Boolean(t.tas_mm_id);

  const lines = [
    '---',
    'object_type: task',
    `task_id: ${t.tas_id}`,
    `task_type: ${formatValue(t.tas_type) || ''}`,
    `customer_id: ${t.tas_cus_id || t.pro_customer_id || ''}`,
    `employee_id: ${t.tas_emp_id || ''}`,
    `company_id: ${t.tas_com_id || ''}`,
    `task_start_date: ${formatValue(t.tas_start_time) || ''}`,
    `task_end_date: ${formatValue(t.tas_end_time) || ''}`,
    `duration_minutes: ${dur ?? ''}`,
    `task_status: ${taskStatus}`,
    `completed: ${completed}`,
    `deleted: ${deleted}`,
    `checked_in: ${checkedIn}`,
    `forms_submitted: ${submittedFormCount}`,
    `forms_missing: ${missingFormCount}`,
    `claim_id: ${t.tas_claim_id || ''}`,
    `claim_status: ${formatValue(t.claim_status) || ''}`,
    `prior_auth_id: ${t.tas_preAuth_id || ''}`,
    ...(mtApplicable
      ? [
        `mt_id: ${formatValue(t.tas_mm_id) || ''}`,
        `mt_status: ${formatValue(taskCompliance?.mt?.status ?? t.tas_mm_status) || ''}`,
      ]
      : []),
    `justified: ${taskCompliance ? taskCompliance.justification.justified : ''}`,
    '---',
    '',
    `# Task: ${title}`,
  ];

  const locationSummary = [t.loc_addr_line1, t.loc_city, t.loc_state]
    .map(formatValue)
    .filter(Boolean)
    .join(', ');

  lines.push(...renderSections({
    ...t,
    customer_name: formatValue(t.cus_name),
    employee_name: fullName(t.emp_first, t.emp_last),
    project_title: formatValue(t.pro_title),
    task_status: taskStatus,
    location_summary: [locationSummary || null, formatValue(t.loc_type)].filter(Boolean).join(' | ') || null,
    duration_summary: formatDuration(t.tas_start_time, t.tas_end_time),
    created_by_name: fullName(t.cre_first, t.cre_last),
    updated_by_name: fullName(t.upd_first, t.upd_last),
  }, TASK_SECTIONS));

  const clockIn = formatValue(t.empLocdate);
  const clockOut = formatValue(t.checkoutEmpDate);
  const lat = formatValue(t.emploc_lat);
  const lon = formatValue(t.emploc_lon);
  const evvLines = [];
  if (clockIn || clockOut) {
    evvLines.push(`* **Clock In:** ${clockIn || 'N/A'} | **Clock Out:** ${clockOut || 'N/A'}`);
  }
  if (lat || lon) {
    evvLines.push(`* **Location Verified:** Lat: ${lat || 'N/A'}, Long: ${lon || 'N/A'}`);
  }
  if (evvLines.length) {
    lines.push('', '## EVV & Verification Context', ...evvLines);
  }

  // One bullet per submitted form: name plus submission details — never the
  // stored JSON data itself.
  const formLines = (formRows || [])
    .map((f) => {
      const formName = formatValue(f.form_name) || `Form ${f.form_type}`;
      const author = [f.emp_first_name, f.emp_last_name].filter(Boolean).join(' ').trim();
      const details = [
        ['Created On', formatValue(f.created_on)],
        ['Last Updated', formatValue(f.last_updated)],
        ['Created By', author || null],
      ]
        .filter(([, v]) => v !== null)
        .map(([k, v]) => `${k}: ${v}`)
        .join(' | ');
      return `* **${formName}:** ${details}`.trimEnd();
    });

  // Forms mandated for this task's type that have no submission. Without these
  // the section could only ever describe what was done -- a missing form is
  // invisible in a list of submissions, and it is the whole compliance check.
  const missingFormLines = (taskCompliance?.missingForms || [])
    .map((form) => `* **${form.formName || `Form ${form.formId}`}:** NOT SUBMITTED (required for task type "${formatValue(t.tas_type) || 'unknown'}")`);

  if (formLines.length || missingFormLines.length) {
    lines.push('', '## Forms', ...formLines, ...missingFormLines);
  }

  if (taskCompliance) {
    lines.push('', ...renderComplianceSection(taskCompliance, {
      claimId: t.tas_claim_id,
      claimStatus: t.claim_status,
      claimUnits: t.claim_units,
      claimProcCode: t.claim_proc_code,
      priorAuth: t.claim_prior_auth,
    }));
  }

  return lines.join('\n');
};

// Renders the "Billing & Compliance" section shared by the task, claim line and
// prior auth documents: what was billed, what was delivered, and whether the
// task is justified under its company's rule.
//
// The verdict is stated in words rather than left implicit in the facts. The
// model reading this is asked whether a narrative justifies the units, and it
// should not also be inferring "3 of 4 forms submitted" means non-compliant --
// that judgement is deterministic and is made in helpers/taskCompliance.js.
function renderComplianceSection(compliance, claim = {}) {
  const lines = ['## Billing & Compliance'];

  const facts = [
    ['Claim ID', claim.claimId ? formatValue(claim.claimId) : null],
    ['Claim Status', formatValue(claim.claimStatus)],
    ['Prior Auth', formatValue(claim.priorAuth)],
    ['Prior Auth ID', compliance.preAuthId ? formatValue(compliance.preAuthId) : null],
    ['Procedure Code', formatValue(claim.claimProcCode)],
    ['Units Billed', claim.claimUnits === undefined || claim.claimUnits === null ? null : formatValue(claim.claimUnits)],
    ['Delivered Minutes', compliance.minutes === null ? null : `${compliance.minutes} (source: ${compliance.minutesSource})`],
    ['Form Approval Status', compliance.formApprovalStatus === null || compliance.formApprovalStatus === undefined
      ? null
      : formatValue(compliance.formApprovalStatus)],
  ]
    .filter(([, value]) => value !== null)
    .map(([label, value]) => `* **${label}:** ${value}`);

  lines.push(...facts);

  if (compliance.mt) {
    const mt = compliance.mt;
    const detail = [
      mt.status ? `status: ${mt.status}` : null,
      mt.period ? `period: ${mt.period}` : null,
      mt.submitted === null ? null : `submitted: ${mt.submitted ? 'Yes' : 'No'}`,
      mt.approved === null ? null : `approved: ${mt.approved ? 'Yes' : 'No'}`,
      mt.reviewedOn ? `reviewed: ${formatValue(mt.reviewedOn)}` : null,
    ].filter(Boolean).join(' | ');
    lines.push(`* **Monitoring Tool (MT) ${mt.id}:** ${detail}`);
  }

  const { justification } = compliance;
  lines.push(
    `* **Justification Rule:** ${justification.rule === 'approved_mt'
      ? 'Support Coordination - an approved MT justifies the units'
      : 'Forms mandated for the task type must be submitted'}`,
    `* **Justified:** ${justification.justified ? 'Yes' : 'No'} - ${justification.reason}`,
  );

  return lines;
}

// GET /api/fieldworker/elliq/task/:tas_id/markdown
// Builds the doc, writes it to files/elliq-markdown/task/task_{tas_id}.md.
// Returns: { tas_id, file, markdown }
//
// Readable rendered markdown (real line breaks via jq -r):
//   curl -s http://localhost:4000/api/fieldworker/elliq/task/<tas_id>/markdown | jq -r '.markdown'
exports.getTaskMarkdown = async function (req, res) {
  const tasId = parseInt(req.params.tas_id, 10);
  if (isNaN(tasId)) {
    return res.status(400).json({ message: 'Invalid tas_id' });
  }
  try {
    const markdown = await exports.buildTaskMarkdown(tasId);
    if (markdown === null) {
      return res.status(404).json({ message: `Task ${tasId} not found` });
    }
    const file = await writeMarkdownFile('task', tasId, markdown);
    res.status(200).json({ tas_id: tasId, file, markdown });
  } catch (e) {
    console.error('ElliQ getTaskMarkdown error:', e);
    res.status(500).json({ message: 'Failed to build task markdown', error: e.message });
  }
};

// ---------------------------------------------------------------------------
// Revenue-cycle documents (Scenario 3 — missing actions / compliance gaps)
//
// A claim line and a prior auth are only interesting to a QA sweep next to the
// tasks that are supposed to justify them, so both documents carry their linked
// tasks inline with a per-task verdict from helpers/taskCompliance.js.
//
// The link is resolved *backwards*: neither Claim nor preAuth stores a task id.
// task.tas_claim_id / task.tas_preAuth_id are stamped when a prior auth is sent
// to claims (helpers/claims.js:849), so one claim line fans out to many tasks
// and a claim with no tasks at all is a finding in its own right.
// ---------------------------------------------------------------------------

// Claim columns worth embedding. The X12/EDI plumbing (control number, facility
// type, patient address, payer id, error codes) is omitted: it never answers a
// compliance question and it is most of the table.
//
// authUnits is labelled "Units Billed" because that is what it holds here --
// the same column name on preAuth means units *approved*. Anyone reading the
// two documents side by side would otherwise reasonably assume they match.
const CLAIM_SECTIONS = [
  {
    title: 'Claim Line',
    fields: [
      ['claim_ID', 'Claim ID'],
      ['Status', 'Claim Status'],
      ['customer_name', 'Customer'],
      ['priorAuth', 'Prior Authorization'],
      ['procedureCode', 'Procedure Code'],
      ['procedureModifierCode', 'Procedure Modifier'],
      ['DiagnosisCode', 'Diagnosis Code'],
      ['startDate', 'Service Start Date'],
      ['endDate', 'Service End Date'],
      ['authUnits', 'Units Billed'],
      ['authAmount', 'Amount Billed'],
      ['CreateDate', 'Created At'],
      ['SubmitDate', 'Submitted At'],
      ['LastResponseDate', 'Last Response Date'],
      ['Response', 'Payer Response'],
      ['errDescription', 'Error Description'],
      ['source', 'Source'],
      ['uploadedBy', 'Created By'],
    ],
  },
];

const PREAUTH_SECTIONS = [
  {
    title: 'Prior Authorization',
    fields: [
      ['primaryID', 'Prior Auth Record ID'],
      ['priorAuth', 'Prior Authorization'],
      ['customer_name', 'Customer'],
      ['procedureCode', 'Procedure Code'],
      ['procedureCodeModifier', 'Procedure Modifier'],
      ['serviceType', 'Service Type'],
      ['startDate', 'Authorization Start Date'],
      ['endDate', 'Authorization End Date'],
      ['authUnits', 'Units Approved'],
      ['authAmount', 'Amount Approved'],
      ['isNewPlan', 'New Plan'],
      ['uploadedOn', 'Uploaded On'],
      ['uploadedBy', 'Uploaded By'],
      ['errDescription', 'Error Description'],
    ],
  },
];

// One bullet per linked task: what it was, when, who did it, and the verdict.
// The verdict is spelled out per task rather than only summarised, because a
// claim built from six tasks where one is unjustified is the case this whole
// scenario exists to catch.
function renderLinkedTasks(taskRows, complianceMap) {
  return taskRows.map((row) => {
    const compliance = complianceMap.get(Number(row.tas_id));
    const label = formatValue(row.tas_title) || `Task ${row.tas_id}`;
    const detail = [
      formatValue(row.tas_type),
      formatValue(row.tas_start_date),
      fullName(row.emp_first_name, row.emp_last_name),
      compliance && compliance.minutes !== null ? `${compliance.minutes} min (${compliance.minutesSource})` : null,
    ].filter(Boolean).join(' | ');

    const verdict = compliance
      ? `${compliance.justification.justified ? 'JUSTIFIED' : 'NOT JUSTIFIED'} — ${compliance.justification.reason}`
      : 'No compliance record could be loaded for this task.';

    return `* **Task ${row.tas_id} (${label}):** ${detail}\n  * ${verdict}`;
  });
}

// Approved / billed / delivered side by side. Delivered is computed here from
// the EVV clock and the procedure's unit of service — never inferred by the
// model, which is being asked to judge a narrative, not to do arithmetic.
function renderUnitsReconciliation({ approved, billed, delivered, unitOfService, taskCount }) {
  const lines = ['## Units Reconciliation'];
  const rows = [
    ['Units Approved', approved],
    ['Units Billed', billed],
    ['Units Delivered (computed)', delivered],
    ['Unit of Service', unitOfService || 'Per visit'],
    ['Tasks Counted', taskCount],
  ]
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([label, value]) => `* **${label}:** ${value}`);

  lines.push(...rows);

  if (Number.isFinite(billed) && Number.isFinite(delivered) && billed !== delivered) {
    lines.push(`* **Discrepancy:** billed ${billed} unit(s) against ${delivered} delivered — a difference of ${billed - delivered}.`);
  }
  if (Number.isFinite(approved) && Number.isFinite(billed) && billed > approved) {
    lines.push(`* **Over-authorization:** billed ${billed} unit(s) against ${approved} approved — a difference of ${billed - approved}.`);
  }

  return lines;
}

// Loads the tasks rolled into a claim line or sitting inside an auth period,
// with the names a document should show instead of ids.
async function loadTasksForBilling(whereClause, params) {
  const rows = await DBSendResponseParam(
    `SELECT t.tas_id, t.tas_title, t.tas_type, t.tas_start_date, t.tas_end_date,
            t.tas_preAuth_id, t.tas_claim_id, t.tas_com_id,
            COALESCE(t.tas_cus_id, p.pro_customer_id) AS customer_id,
            cus.cus_name,
            emp.emp_first_name, emp.emp_last_name
       FROM task t
       LEFT JOIN project p ON t.tas_pro_id = p.pro_id
       LEFT JOIN customer cus ON cus.cus_id = COALESCE(t.tas_cus_id, p.pro_customer_id)
       LEFT JOIN employee emp ON emp.emp_id = t.tas_emp_id
      WHERE (${whereClause})
        AND t.tas_is_active <> ${TASK_DELETED}
      ORDER BY t.tas_id`,
    params,
  );
  return rows || [];
}

// Builds a markdown claim line document: the billing line, the tasks it was
// built from, the unit reconciliation, and each task's justification verdict.
// Returns the markdown string, or null if no claim with that id exists.
exports.buildClaimLineMarkdown = async function (claimId) {
  const rows = await DBSendResponseParam(
    'SELECT * FROM Claim WHERE claim_ID = @claimId',
    { claimId },
  );
  if (!rows || rows.length === 0) return null;
  const claim = rows[0];

  const taskRows = await loadTasksForBilling('t.tas_claim_id = @claimId', { claimId });
  const complianceMap = await loadTaskCompliance(taskRows.map((row) => row.tas_id));

  // Preferred route to the customer is the tasks, which are already
  // customer-resolved: exact, and it costs no extra query. DDDID is the
  // fallback, needed because a claim with no task -- a CSV upload or a manual
  // entry -- would otherwise render as an anonymous document, and those are the
  // claims a compliance sweep most wants to see. It is a fallback rather than
  // the primary route because the column is VARCHAR(10) on customer and
  // VARCHAR(MAX) on Claim, so the comparison needs trimming and cannot use an
  // index.
  let customerId = taskRows.map((row) => row.customer_id).find((id) => id !== null && id !== undefined) || null;
  let customerName = taskRows.map((row) => row.cus_name).find(Boolean) || null;

  if (!customerId && claim.DDDID && String(claim.DDDID).trim() !== '') {
    const customerRows = await DBSendResponseParam(
      `SELECT TOP 1 cus_id, cus_name
         FROM customer
        WHERE cus_company_id = @companyId
          AND LTRIM(RTRIM(DDDID)) = @dddId
        ORDER BY cus_id`,
      { companyId: claim.companyID, dddId: String(claim.DDDID).trim() },
    );
    if (customerRows && customerRows.length) {
      customerId = customerRows[0].cus_id;
      customerName = customerRows[0].cus_name || null;
    }
  }

  const unitOfService = await getUnitOfService({
    procCode: claim.procedureCode,
    taskType: taskRows.length ? taskRows[0].tas_type : null,
  });
  const deliveredUnits = unitsForTasks(
    taskRows.map((row) => complianceMap.get(Number(row.tas_id))).filter(Boolean),
    unitOfService,
  );

  const unjustified = taskRows.filter((row) => {
    const compliance = complianceMap.get(Number(row.tas_id));
    return compliance && !compliance.justification.justified;
  });

  const billedUnits = claim.authUnits === null || claim.authUnits === undefined ? null : Number(claim.authUnits);

  const lines = [
    '---',
    'object_type: claim_line',
    `claim_id: ${claim.claim_ID}`,
    `claim_status: ${formatValue(claim.Status) || ''}`,
    `customer_id: ${customerId || ''}`,
    `company_id: ${claim.companyID || ''}`,
    `prior_auth: ${formatValue(claim.priorAuth) || ''}`,
    `procedure_code: ${formatValue(claim.procedureCode) || ''}`,
    `service_start_date: ${formatValue(claim.startDate) || ''}`,
    `service_end_date: ${formatValue(claim.endDate) || ''}`,
    `units_billed: ${billedUnits ?? ''}`,
    `units_delivered: ${deliveredUnits}`,
    `linked_task_count: ${taskRows.length}`,
    `unjustified_task_count: ${unjustified.length}`,
    '---',
    '',
    `# Claim Line ${claim.claim_ID}${customerName ? ` - ${customerName}` : ''}`,
  ];

  lines.push(...renderSections({ ...claim, customer_name: customerName }, CLAIM_SECTIONS));

  lines.push('', ...renderUnitsReconciliation({
    approved: null, // the approved figure lives on the prior auth document
    billed: billedUnits,
    delivered: deliveredUnits,
    unitOfService,
    taskCount: taskRows.length,
  }));

  if (taskRows.length) {
    lines.push('', '## Linked Tasks', ...renderLinkedTasks(taskRows, complianceMap));
  } else {
    // Stated rather than left as an absent section: "this claim line has no
    // task behind it" is the strongest finding this document can carry, and an
    // empty section would read as "not applicable".
    lines.push('', '## Linked Tasks', '* **No tasks are linked to this claim line.** Nothing in the system evidences the units billed.');
  }

  if (unjustified.length) {
    lines.push('', '## Compliance Exceptions', ...unjustified.map((row) => {
      const compliance = complianceMap.get(Number(row.tas_id));
      return `* **Task ${row.tas_id}:** ${compliance.justification.reason}`;
    }));
  }

  const noteRows = await DBSendResponseParam(
    `SELECT billing_note_title, billing_note, created_at
       FROM billing_notes
      WHERE claim_id = @claimId AND (isDeleted = 0 OR isDeleted IS NULL)
      ORDER BY billing_note_id`,
    { claimId },
  );
  const noteLines = (noteRows || [])
    .map((note) => {
      const body = draftToMarkdown(note.billing_note);
      if (!body) return null;
      const heading = formatValue(note.billing_note_title) || formatValue(note.created_at) || 'Billing Note';
      return `* **${heading}:** ${body}`;
    })
    .filter(Boolean);
  if (noteLines.length) {
    lines.push('', '## Billing Notes', ...noteLines);
  }

  return lines.join('\n');
};

// Builds a markdown prior authorization document: the authorization, every task
// inside its period, what has been billed against it, and the unit position.
// Returns the markdown string, or null if no prior auth with that id exists.
exports.buildPriorAuthMarkdown = async function (preAuthId) {
  const rows = await DBSendResponseParam(
    `SELECT pa.*, c.cus_id, c.cus_name
       FROM preAuth pa
       LEFT JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = pa.companyId
      WHERE pa.primaryID = @preAuthId`,
    { preAuthId },
  );
  if (!rows || rows.length === 0) return null;
  const auth = rows[0];

  // Two routes to the tasks, and both are needed. tas_preAuth_id is only
  // stamped once the auth has been sent to claims, so on its own it cannot see
  // the case this strategy is looking for: an authorization whose period has
  // passed with nothing delivered against it. The date-range route is how the
  // PA grid itself matches tasks (helpers/preAuth.js:277-289).
  const linkedRows = await loadTasksForBilling('t.tas_preAuth_id = @preAuthId', { preAuthId });

  let windowRows = [];
  if (auth.cus_id) {
    windowRows = await loadTasksForBilling(
      `(t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
         AND t.tas_start_date BETWEEN @startDate AND @endDate`,
      { cusId: auth.cus_id, startDate: auth.startDate, endDate: auth.endDate },
    );
  }

  const taskRows = [];
  const seen = new Set();
  for (const row of [...linkedRows, ...windowRows]) {
    if (seen.has(Number(row.tas_id))) continue;
    seen.add(Number(row.tas_id));
    taskRows.push(row);
  }
  taskRows.sort((a, b) => a.tas_id - b.tas_id);

  const complianceMap = await loadTaskCompliance(taskRows.map((row) => row.tas_id));

  const unitOfService = await getUnitOfService({
    procCode: auth.procedureCode,
    taskType: taskRows.length ? taskRows[0].tas_type : null,
  });
  const deliveredUnits = unitsForTasks(
    taskRows.map((row) => complianceMap.get(Number(row.tas_id))).filter(Boolean),
    unitOfService,
  );

  // Everything billed against this authorization *period*. Matched on the
  // authorization number rather than on the tasks, so a claim raised outside
  // the normal flow still shows up -- but narrowed to claims whose service
  // dates overlap this row.
  //
  // The date predicate is not optional: one authorization number spans a
  // preAuth row per service week (ten weekly rows for one number is normal in
  // live data), so matching on the number alone would credit every week of the
  // authorization with every claim raised against it.
  const claimRows = auth.priorAuth
    ? await DBSendResponseParam(
      `SELECT claim_ID, Status, authUnits, authAmount, startDate, endDate, procedureCode
         FROM Claim
        WHERE companyID = @companyId AND priorAuth = @priorAuth
          AND startDate <= @authEnd AND endDate >= @authStart
        ORDER BY claim_ID`,
      { companyId: auth.companyId, priorAuth: auth.priorAuth, authStart: auth.startDate, authEnd: auth.endDate },
    )
    : [];

  const billedUnits = (claimRows || []).reduce((sum, claim) => sum + (Number(claim.authUnits) || 0), 0);
  const approvedUnits = auth.authUnits === null || auth.authUnits === undefined ? null : Number(auth.authUnits);

  const unjustified = taskRows.filter((row) => {
    const compliance = complianceMap.get(Number(row.tas_id));
    return compliance && !compliance.justification.justified;
  });

  const lines = [
    '---',
    'object_type: prior_auth',
    `prior_auth_id: ${auth.primaryID}`,
    `prior_auth: ${formatValue(auth.priorAuth) || ''}`,
    `customer_id: ${auth.cus_id || ''}`,
    `company_id: ${auth.companyId || ''}`,
    `procedure_code: ${formatValue(auth.procedureCode) || ''}`,
    `auth_start_date: ${formatValue(auth.startDate) || ''}`,
    `auth_end_date: ${formatValue(auth.endDate) || ''}`,
    `units_approved: ${approvedUnits ?? ''}`,
    `units_billed: ${billedUnits}`,
    `units_delivered: ${deliveredUnits}`,
    `task_count: ${taskRows.length}`,
    `unjustified_task_count: ${unjustified.length}`,
    '---',
    '',
    `# Prior Authorization ${formatValue(auth.priorAuth) || auth.primaryID}${auth.cus_name ? ` - ${auth.cus_name}` : ''}`,
  ];

  lines.push(...renderSections({ ...auth, customer_name: auth.cus_name }, PREAUTH_SECTIONS));

  lines.push('', ...renderUnitsReconciliation({
    approved: approvedUnits,
    billed: billedUnits,
    delivered: deliveredUnits,
    unitOfService,
    taskCount: taskRows.length,
  }));

  if (taskRows.length) {
    lines.push('', '## Tasks In Authorization Period', ...renderLinkedTasks(taskRows, complianceMap));
  } else {
    lines.push('', '## Tasks In Authorization Period', '* **No tasks fall inside this authorization period.** Nothing has been delivered against it.');
  }

  if (claimRows.length) {
    lines.push('', '## Claims Billed Against This Authorization', ...claimRows.map((claim) => {
      const detail = [
        `Status: ${formatValue(claim.Status) || 'unknown'}`,
        `Units: ${claim.authUnits ?? 'N/A'}`,
        `Service: ${formatValue(claim.startDate) || '?'} to ${formatValue(claim.endDate) || '?'}`,
      ].join(' | ');
      return `* **Claim ${claim.claim_ID}:** ${detail}`;
    }));
  }

  if (unjustified.length) {
    lines.push('', '## Compliance Exceptions', ...unjustified.map((row) => {
      const compliance = complianceMap.get(Number(row.tas_id));
      return `* **Task ${row.tas_id}:** ${compliance.justification.reason}`;
    }));
  }

  return lines.join('\n');
};

// GET /api/fieldworker/elliq/claim/:claim_id/markdown
// Builds the doc, writes it to files/elliq-markdown/claim_line/claim_line_{claim_id}.md.
// Returns: { claim_id, file, markdown }
exports.getClaimLineMarkdown = async function (req, res) {
  const claimId = parseInt(req.params.claim_id, 10);
  if (isNaN(claimId)) {
    return res.status(400).json({ message: 'Invalid claim_id' });
  }
  try {
    const markdown = await exports.buildClaimLineMarkdown(claimId);
    if (markdown === null) {
      return res.status(404).json({ message: `Claim ${claimId} not found` });
    }
    const file = await writeMarkdownFile('claim_line', claimId, markdown);
    res.status(200).json({ claim_id: claimId, file, markdown });
  } catch (e) {
    console.error('ElliQ getClaimLineMarkdown error:', e);
    res.status(500).json({ message: 'Failed to build claim line markdown', error: e.message });
  }
};

// GET /api/fieldworker/elliq/preauth/:preauth_id/markdown
// Builds the doc, writes it to files/elliq-markdown/prior_auth/prior_auth_{primaryID}.md.
// Returns: { preauth_id, file, markdown }
exports.getPriorAuthMarkdown = async function (req, res) {
  const preAuthId = parseInt(req.params.preauth_id, 10);
  if (isNaN(preAuthId)) {
    return res.status(400).json({ message: 'Invalid preauth_id' });
  }
  try {
    const markdown = await exports.buildPriorAuthMarkdown(preAuthId);
    if (markdown === null) {
      return res.status(404).json({ message: `Prior authorization ${preAuthId} not found` });
    }
    const file = await writeMarkdownFile('prior_auth', preAuthId, markdown);
    res.status(200).json({ preauth_id: preAuthId, file, markdown });
  } catch (e) {
    console.error('ElliQ getPriorAuthMarkdown error:', e);
    res.status(500).json({ message: 'Failed to build prior auth markdown', error: e.message });
  }
};

// 12 months before now — the lookback window for the bulk per-customer
// task/casenote endpoints below.
function twelveMonthsAgo() {
  const d = new Date();
  d.setMonth(d.getMonth() - 12);
  return d;
}

// Id-lookup helpers, factored out so other modules (helpers/ragSync.js) can
// reuse the exact same SQL in-process instead of duplicating it. Purely
// additive -- generateCustomerFiles below and its three callers are unchanged,
// still use their own inline idQuery/idParams.
// Each of these returns a plain array of numeric ids.
exports.listProjectIdsForCustomer = async function (cusId) {
  const rows = await DBSendResponseParam(
    'SELECT pro_id FROM project WHERE pro_customer_id = @cusId ORDER BY pro_id',
    { cusId },
  );
  return (rows || []).map((row) => row.pro_id);
};

// The `since` option overrides the 12-month cutoff; pass `{ since: null }` for
// all history. helpers/ragSync.js passes its own window, driven by
// RAG_LOOKBACK_DAYS. The default is unchanged, so the HTTP endpoints below keep
// their existing 12-month behaviour.
//
// `completedOnly` narrows further to tasks marked complete (tas_is_active = 1).
// Off by default, so the sweep and the existing endpoints still return every
// live task in the window -- an open task is a document worth having.
exports.listTaskIdsForCustomer = async function (cusId, { since = twelveMonthsAgo(), completedOnly = false } = {}) {
  const rows = await DBSendResponseParam(
    `SELECT DISTINCT t.tas_id
       FROM task t
       LEFT JOIN project p ON t.tas_pro_id = p.pro_id
      WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
        ${since ? 'AND t.tas_start_time >= @cutoff' : ''}
        ${completedOnly ? 'AND t.tas_is_active = 1' : 'AND t.tas_is_active <> 2'}
      ORDER BY t.tas_id`,
    since ? { cusId, cutoff: since.toISOString().slice(0, 19) } : { cusId },
  );
  return (rows || []).map((row) => row.tas_id);
};

// Claim lines belonging to a customer.
//
// Two routes, exactly as the gap endpoint uses (helpers/complianceGaps.js). The
// task route is exact but only sees claims raised through the send-to-claims
// flow, which is what stamps task.tas_claim_id. Claims uploaded by CSV or
// entered by hand have no task at all -- and "this claim line has nothing
// behind it" is the strongest finding the sweep can produce, so indexing only
// the task route would hide precisely the records worth finding.
//
// The window is the claim's own service/creation date rather than the task
// start time the other list helpers use: a claim raised late for old service
// dates is exactly the kind of record a QA sweep wants, and windowing it by its
// tasks would hide it.
exports.listClaimIdsForCustomer = async function (cusId, { since = twelveMonthsAgo() } = {}) {
  const rows = await DBSendResponseParam(
    `SELECT claim_ID FROM (
            SELECT c.claim_ID, c.endDate, c.CreateDate
              FROM Claim c
              JOIN task t ON t.tas_claim_id = c.claim_ID
              LEFT JOIN project p ON t.tas_pro_id = p.pro_id
             WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
             UNION
            SELECT c.claim_ID, c.endDate, c.CreateDate
              FROM Claim c
              JOIN customer cu ON cu.cus_company_id = c.companyID
                              AND LTRIM(RTRIM(cu.DDDID)) = LTRIM(RTRIM(c.DDDID))
             WHERE cu.cus_id = @cusId
               AND cu.DDDID IS NOT NULL AND LTRIM(RTRIM(cu.DDDID)) <> ''
     ) claims
      ${since ? 'WHERE (claims.endDate >= @cutoff OR claims.CreateDate >= @cutoff)' : ''}
      ORDER BY claim_ID`,
    since ? { cusId, cutoff: since } : { cusId },
  );
  return (rows || []).map((row) => row.claim_ID);
};

// Prior authorizations belonging to a customer.
//
// Reached primarily through customer.DDDID, the join the PA grid itself uses
// (helpers/preAuth.js:300), because an authorization with no tasks against it
// is precisely the gap Strategy 2 looks for and a task-based lookup could never
// surface it. The task-linked route is unioned in as a safety net for rows
// whose DDDID does not match cleanly — the column is VARCHAR(10) on customer
// and VARCHAR(MAX) on preAuth.
exports.listPreAuthIdsForCustomer = async function (cusId, { since = twelveMonthsAgo() } = {}) {
  const rows = await DBSendResponseParam(
    `SELECT primaryID FROM (
            SELECT pa.primaryID, pa.endDate
              FROM preAuth pa
              JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = pa.companyId
             WHERE c.cus_id = @cusId
             UNION
            SELECT pa.primaryID, pa.endDate
              FROM preAuth pa
              JOIN task t ON t.tas_preAuth_id = pa.primaryID
              LEFT JOIN project p ON t.tas_pro_id = p.pro_id
             WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
     ) auths
      ${since ? 'WHERE auths.endDate >= @cutoff' : ''}
      ORDER BY primaryID`,
    since ? { cusId, cutoff: since } : { cusId },
  );
  return (rows || []).map((row) => row.primaryID);
};

exports.listCaseNoteIdsForCustomer = async function (cusId, { since = twelveMonthsAgo() } = {}) {
  const rows = await DBSendResponseParam(
    `SELECT comment_id
       FROM comments
      WHERE customer_id = @cusId AND (isDeleted = 0 OR isDeleted IS NULL)${since ? ' AND created_at >= @cutoff' : ''}
      ORDER BY comment_id`,
    since ? { cusId, cutoff: since } : { cusId },
  );
  return (rows || []).map((row) => row.comment_id);
};

// Shared by the bulk per-customer endpoints: verifies the customer exists
// (null when it doesn't), fetches the id list via idQuery, then builds and
// writes one markdown file per id. Builds run sequentially to avoid flooding
// the connection pool. Returns [{ <idColumn>, file }].
async function generateCustomerFiles(cusId, { idQuery, idParams, idColumn, objectType, build }) {
  const customerRows = await DBSendResponseParam(
    'SELECT cus_id FROM customer WHERE cus_id = @cusId',
    { cusId },
  );
  if (!customerRows || customerRows.length === 0) return null;

  const idRows = await DBSendResponseParam(idQuery, idParams);
  const files = [];
  for (const row of idRows || []) {
    const id = row[idColumn];
    const markdown = await build(id);
    if (markdown === null) continue;
    const file = await writeMarkdownFile(objectType, id, markdown);
    files.push({ [idColumn]: id, file });
  }
  return files;
}

// GET /api/fieldworker/elliq/customer/:cus_id/projects/markdown
// Generates a markdown file for every project of the customer
// (files/elliq-markdown/project/project_{pro_id}.md). Returns: { cus_id, count, files }
exports.generateCustomerProjectFiles = async function (req, res) {
  const cusId = parseInt(req.params.cus_id, 10);
  if (isNaN(cusId)) {
    return res.status(400).json({ message: 'Invalid cus_id' });
  }
  try {
    const files = await generateCustomerFiles(cusId, {
      idQuery: 'SELECT pro_id FROM project WHERE pro_customer_id = @cusId ORDER BY pro_id',
      idParams: { cusId },
      idColumn: 'pro_id',
      objectType: 'project',
      build: exports.buildProjectMarkdown,
    });
    if (files === null) {
      return res.status(404).json({ message: `Customer ${cusId} not found` });
    }
    res.status(200).json({ cus_id: cusId, count: files.length, files });
  } catch (e) {
    console.error('ElliQ generateCustomerProjectFiles error:', e);
    res.status(500).json({ message: 'Failed to generate project files', error: e.message });
  }
};

// GET /api/fieldworker/elliq/customer/:cus_id/tasks/markdown
// Generates a markdown file for every task of the customer started in the last
// 12 months (files/elliq-markdown/task/task_{tas_id}.md). Tasks link to the customer
// directly (tas_cus_id) or through their project (pro_customer_id).
// tas_start_time is VARCHAR holding ISO datetimes, so the cutoff is compared as
// an ISO string (lexicographic order matches chronological order).
// Returns: { cus_id, count, files }
exports.generateCustomerTaskFiles = async function (req, res) {
  const cusId = parseInt(req.params.cus_id, 10);
  if (isNaN(cusId)) {
    return res.status(400).json({ message: 'Invalid cus_id' });
  }
  try {
    const files = await generateCustomerFiles(cusId, {
      idQuery: `SELECT DISTINCT t.tas_id
                  FROM task t
                  LEFT JOIN project p ON t.tas_pro_id = p.pro_id
                 WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
                   AND t.tas_start_time >= @cutoff
                   AND t.tas_is_active <> 2
                 ORDER BY t.tas_id`,
      idParams: { cusId, cutoff: twelveMonthsAgo().toISOString().slice(0, 19) },
      idColumn: 'tas_id',
      objectType: 'task',
      build: exports.buildTaskMarkdown,
    });
    if (files === null) {
      return res.status(404).json({ message: `Customer ${cusId} not found` });
    }
    res.status(200).json({ cus_id: cusId, count: files.length, files });
  } catch (e) {
    console.error('ElliQ generateCustomerTaskFiles error:', e);
    res.status(500).json({ message: 'Failed to generate task files', error: e.message });
  }
};

// GET /api/fieldworker/elliq/customer/:cus_id/claims/markdown
// Generates a markdown file for every claim line built from the customer's
// tasks in the last 12 months
// (files/elliq-markdown/claim_line/claim_line_{claim_ID}.md).
// Returns: { cus_id, count, files }
exports.generateCustomerClaimFiles = async function (req, res) {
  const cusId = parseInt(req.params.cus_id, 10);
  if (isNaN(cusId)) {
    return res.status(400).json({ message: 'Invalid cus_id' });
  }
  try {
    const files = await generateCustomerFiles(cusId, {
      idQuery: `SELECT claim_ID FROM (
                       SELECT c.claim_ID, c.endDate, c.CreateDate
                         FROM Claim c
                         JOIN task t ON t.tas_claim_id = c.claim_ID
                         LEFT JOIN project p ON t.tas_pro_id = p.pro_id
                        WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
                        UNION
                       SELECT c.claim_ID, c.endDate, c.CreateDate
                         FROM Claim c
                         JOIN customer cu ON cu.cus_company_id = c.companyID
                                         AND LTRIM(RTRIM(cu.DDDID)) = LTRIM(RTRIM(c.DDDID))
                        WHERE cu.cus_id = @cusId
                          AND cu.DDDID IS NOT NULL AND LTRIM(RTRIM(cu.DDDID)) <> ''
                ) claims
                 WHERE (claims.endDate >= @cutoff OR claims.CreateDate >= @cutoff)
                 ORDER BY claim_ID`,
      idParams: { cusId, cutoff: twelveMonthsAgo() },
      idColumn: 'claim_ID',
      objectType: 'claim_line',
      build: exports.buildClaimLineMarkdown,
    });
    if (files === null) {
      return res.status(404).json({ message: `Customer ${cusId} not found` });
    }
    res.status(200).json({ cus_id: cusId, count: files.length, files });
  } catch (e) {
    console.error('ElliQ generateCustomerClaimFiles error:', e);
    res.status(500).json({ message: 'Failed to generate claim line files', error: e.message });
  }
};

// GET /api/fieldworker/elliq/customer/:cus_id/preauths/markdown
// Generates a markdown file for every prior authorization of the customer
// ending in the last 12 months
// (files/elliq-markdown/prior_auth/prior_auth_{primaryID}.md).
// Returns: { cus_id, count, files }
exports.generateCustomerPreAuthFiles = async function (req, res) {
  const cusId = parseInt(req.params.cus_id, 10);
  if (isNaN(cusId)) {
    return res.status(400).json({ message: 'Invalid cus_id' });
  }
  try {
    const files = await generateCustomerFiles(cusId, {
      idQuery: `SELECT primaryID FROM (
                       SELECT pa.primaryID, pa.endDate
                         FROM preAuth pa
                         JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = pa.companyId
                        WHERE c.cus_id = @cusId
                        UNION
                       SELECT pa.primaryID, pa.endDate
                         FROM preAuth pa
                         JOIN task t ON t.tas_preAuth_id = pa.primaryID
                         LEFT JOIN project p ON t.tas_pro_id = p.pro_id
                        WHERE (t.tas_cus_id = @cusId OR p.pro_customer_id = @cusId)
                ) auths
                 WHERE auths.endDate >= @cutoff
                 ORDER BY primaryID`,
      idParams: { cusId, cutoff: twelveMonthsAgo() },
      idColumn: 'primaryID',
      objectType: 'prior_auth',
      build: exports.buildPriorAuthMarkdown,
    });
    if (files === null) {
      return res.status(404).json({ message: `Customer ${cusId} not found` });
    }
    res.status(200).json({ cus_id: cusId, count: files.length, files });
  } catch (e) {
    console.error('ElliQ generateCustomerPreAuthFiles error:', e);
    res.status(500).json({ message: 'Failed to generate prior auth files', error: e.message });
  }
};

// GET /api/fieldworker/elliq/customer/:cus_id/casenotes/markdown
// Generates a markdown file for every case note (comment) of the customer
// created in the last 12 months (files/elliq-markdown/casenote/casenote_{comment_id}.md).
// Returns: { cus_id, count, files }
exports.generateCustomerCaseNoteFiles = async function (req, res) {
  const cusId = parseInt(req.params.cus_id, 10);
  if (isNaN(cusId)) {
    return res.status(400).json({ message: 'Invalid cus_id' });
  }
  try {
    const files = await generateCustomerFiles(cusId, {
      idQuery: `SELECT comment_id
                  FROM comments
                 WHERE customer_id = @cusId AND created_at >= @cutoff
                 ORDER BY comment_id`,
      idParams: { cusId, cutoff: twelveMonthsAgo() },
      idColumn: 'comment_id',
      objectType: 'casenote',
      build: exports.buildCaseNoteMarkdown,
    });
    if (files === null) {
      return res.status(404).json({ message: `Customer ${cusId} not found` });
    }
    res.status(200).json({ cus_id: cusId, count: files.length, files });
  } catch (e) {
    console.error('ElliQ generateCustomerCaseNoteFiles error:', e);
    res.status(500).json({ message: 'Failed to generate case note files', error: e.message });
  }
};
