// Data layer for Import Form and Form Packs.
// Real mode talks to the endpoints in the project brief (§5.1, §5.5); demo mode
// (REACT_APP_DEMO=1) uses an in-browser store so the flow can be shown without a backend.
import axios from 'axios';
import { DEMO_MODE } from '../config';
import { SAMPLE_DEFINITION, SAMPLE_META, SAMPLE_USAGE } from '../demo/sampleDraft';
import { flatten, repair, validate } from '../formio/validate';

export const COMPANY_TYPES = [
  { id: 101, label: 'Support Coordination' },
  { id: 102, label: 'Service Provider' },
  { id: 103, label: 'Home Healthcare' },
  { id: 104, label: 'Case Management' },
  { id: 105, label: 'Day Care / Community Center' },
  { id: 106, label: 'Group Home' },
];
export const companyTypeLabel = (id) => COMPANY_TYPES.find((t) => t.id === id)?.label ?? 'Any type';

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
  'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH',
  'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
];

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_PAGES = 30;

// ---------- Demo store ----------
const STORE_KEY = 'fwmis_demo_store_v1';
const simpleForm = (id, name, type, state, agency) => ({
  form_id: id, form_name: name, form_type: type, form_state: state, form_sponsor: agency, public_form: 1,
  json_schema: { display: 'form', components: [{ type: 'textfield', key: 'name', label: 'Name', input: true }] },
});
const seed = () => ({
  nextFormId: 2100,
  nextPackId: 3,
  forms: [
    simpleForm(2001, 'NJ Monthly Monitoring Tool', 'Monitoring', 'NJ', 'NJ DDD'),
    simpleForm(2002, 'NJ Quarterly Monitoring Tool', 'Monitoring', 'NJ', 'NJ DDD'),
    simpleForm(2003, 'NJ Incident Report', 'Incident', 'NJ', 'NJ DDD'),
    simpleForm(2004, 'NJ Support Coordination Intake', 'Intake', 'NJ', 'NJ DDD'),
    simpleForm(2005, 'AZ Home Health Visit Note', 'Visit', 'AZ', 'AHCCCS'),
    simpleForm(2006, 'AZ Client Rights Acknowledgement', 'Consent', 'AZ', 'AHCCCS'),
  ],
  packs: [
    {
      pack_id: 1, pack_name: 'Support Coordination · New Jersey', pack_description: 'Core DDD forms for NJ support coordination agencies.',
      company_type: 101, state_id: 'NJ', version: 2, status: 'published', published_on: '2026-09-18',
      items: [2004, 2001, 2002, 2003],
      history: [{ version: 1, on: '2026-09-02', notes: 'Initial pack' }, { version: 2, on: '2026-09-18', notes: 'Added NJ Incident Report' }],
    },
    {
      pack_id: 2, pack_name: 'Home Healthcare · Arizona', pack_description: 'AHCCCS visit and consent forms.',
      company_type: 103, state_id: 'AZ', version: 1, status: 'draft', published_on: null,
      items: [2005, 2006], history: [],
    },
  ],
  // The simulated FieldWorker company used by the "Customer view" tab.
  company: { name: 'Garden State Support Services', type: 101, state: 'NJ' },
  subscribedForms: [{ form_id: 2001, pack_id: null }], // already subscribed to one form individually
  subscribedPacks: [],
  jobs: {},
});
let memory = null;
const load = () => {
  if (memory) return memory;
  try { memory = JSON.parse(localStorage.getItem(STORE_KEY)) || seed(); } catch (e) { memory = seed(); }
  return memory;
};
const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ ...memory, jobs: {} })); } catch (e) { /* storage unavailable */ } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const resetDemoData = () => { memory = seed(); save(); };

// ---------- Import ----------
const STAGES = [
  { at: 0, label: 'Uploading PDF to secure storage' },
  { at: 1500, label: 'Pre-check: page count, text layer, filled form fields' },
  { at: 3000, label: 'Reading the form with the model' },
  { at: 7500, label: 'Validating and repairing the Form.io definition' },
  { at: 9000, label: 'Building field manifest and confidence flags' },
];
const DEMO_TOTAL_MS = 10500;

const countPdfPages = async (file) => {
  const text = await file.text().catch(() => '');
  const m = text.match(/\/Type\s*\/Page[^s]/g);
  return m ? m.length : null;
};

export const precheck = async (file) => {
  if (!file) return 'Choose a PDF file.';
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return 'Only PDF files are supported.';
  if (file.size > MAX_PDF_BYTES) return `File is ${(file.size / 1048576).toFixed(1)} MB; the limit is 20 MB.`;
  const pages = await countPdfPages(file);
  if (pages && pages > MAX_PDF_PAGES) return `PDF has ${pages} pages; the limit is ${MAX_PDF_PAGES}.`;
  return null;
};

// All real-mode calls go to FWAPI (/api/fieldworker/task_form/...), where the model call, validation and
// pack tables live. `apiurl` is the FWAPI base for the selected environment (see FW_APIURL in config.js).
export const startImport = async (apiurl, file) => {
  if (!DEMO_MODE) {
    const body = new FormData();
    body.append('file', file);
    const { data } = await axios.post(`${apiurl}/task_form/import`, body);
    return data.jobId;
  }
  const s = load();
  const jobId = `demo-${Date.now()}`;
  s.jobs[jobId] = { startedAt: Date.now(), filename: file.name };
  return jobId;
};

// Assembles the review payload shared by real and demo mode: validated definition + manifest.
export const buildDraft = ({ definition, fields = [], usage = {} }) => {
  const repaired = repair(definition);
  const problems = validate(repaired);
  const meta = {};
  fields.forEach((f) => { meta[f.key] = f; });
  return { definition: repaired, meta, problems, usage };
};

export const getImportJob = async (apiurl, jobId) => {
  if (!DEMO_MODE) {
    const { data } = await axios.get(`${apiurl}/task_form/import/${jobId}`);
    if (data.status === 'done') return { status: 'done', draft: buildDraft(data.result) };
    return data;
  }
  const job = load().jobs[jobId];
  if (!job) return { status: 'failed', error: 'Job not found' };
  const elapsed = Date.now() - job.startedAt;
  if (elapsed < DEMO_TOTAL_MS) {
    const stage = [...STAGES].reverse().find((st) => elapsed >= st.at);
    return { status: 'running', stage: stage.label, progress: Math.round((elapsed / DEMO_TOTAL_MS) * 100) };
  }
  const fields = Object.entries(SAMPLE_META).map(([key, m]) => ({ key, ...m }));
  return { status: 'done', draft: buildDraft({ definition: SAMPLE_DEFINITION, fields, usage: SAMPLE_USAGE }) };
};

// Manifest rows derived from the live definition so edits are always reflected.
export const buildManifest = (definition, meta = {}) => flatten(definition).map(({ component: c, parent, depth }) => ({
  key: c.key,
  type: c.type,
  label: c.label || c.title || '',
  required: !!c.validate?.required,
  section: parent?.title || parent?.label || '',
  depth,
  sourcePage: meta[c.key]?.sourcePage ?? null,
  confidence: meta[c.key]?.confidence ?? null,
  notes: meta[c.key]?.notes ?? '',
}));

// ---------- Community forms ----------
export const listCommunityForms = async (apiurl) => {
  if (!DEMO_MODE) {
    const { data } = await axios.get(`${apiurl}/task_form/packs/admin/forms`);
    return data;
  }
  await wait(150);
  return load().forms.filter((f) => f.public_form === 1);
};

export const publishForm = async (apiurl, { details, definition, usage, filename, jobId, user }) => {
  if (!DEMO_MODE) {
    // One server-side transaction writes fw_forms (community form) and form_source.
    const { data } = await axios.post(`${apiurl}/task_form/import/publish`, { details, definition, usage, filename, jobId });
    return { form_id: data.form_id };
  }
  const payload = {
    form_name: details.name,
    form_description: details.description,
    form_type: details.formType,
    form_state: details.state,
    form_sponsor: details.agency,
    form_company_types: details.companyTypes,
    replaces_form_id: details.replacesFormId ?? null,
    public_form: 1,
    json_schema: definition,
    form_added_by: user?.emp_id,
  };
  await wait(600);
  const s = load();
  const form_id = s.nextFormId++;
  s.forms.push({ ...payload, form_id, source: { filename, model: usage.model, prompt_version: usage.promptVersion } });
  save();
  return { form_id };
};

// ---------- Packs (curation) ----------
export const validatePack = (pack) => {
  const errors = [];
  if (!pack.pack_name?.trim()) errors.push('Pack name is required.');
  if (!pack.items?.length) errors.push('A pack must contain at least one form.');
  if (pack.state_id === undefined || pack.state_id === '') errors.push('Choose exactly one state, or "All states".');
  return errors;
};

export const listPacks = async (apiurl) => {
  if (!DEMO_MODE) return (await axios.get(`${apiurl}/task_form/packs/admin`)).data;
  await wait(100);
  return JSON.parse(JSON.stringify(load().packs));
};

export const savePack = async (apiurl, pack) => {
  if (!DEMO_MODE) {
    return pack.pack_id
      ? (await axios.put(`${apiurl}/task_form/packs/admin/${pack.pack_id}`, pack)).data
      : (await axios.post(`${apiurl}/task_form/packs/admin`, pack)).data;
  }
  const s = load();
  if (pack.pack_id) {
    const i = s.packs.findIndex((p) => p.pack_id === pack.pack_id);
    s.packs[i] = { ...s.packs[i], ...pack };
  } else {
    s.packs.push({ ...pack, pack_id: s.nextPackId++, version: 1, status: 'draft', published_on: null, history: [] });
  }
  save();
};

export const publishPack = async (apiurl, packId, notes) => {
  if (!DEMO_MODE) return (await axios.post(`${apiurl}/task_form/packs/admin/${packId}/publish`, { notes })).data;
  const s = load();
  const p = s.packs.find((x) => x.pack_id === packId);
  const first = p.status !== 'published';
  if (!first) p.version += 1;
  p.status = 'published';
  p.published_on = new Date().toISOString().slice(0, 10);
  p.history.push({ version: p.version, on: p.published_on, notes: notes || (first ? 'Initial pack' : 'Updated') });
  // POST /task_form/packs/sync: push the new version to subscribers.
  const subscribers = s.subscribedPacks.filter((sp) => sp.pack_id === packId);
  subscribers.forEach((sp) => { syncCompany(s, p); sp.subscribed_version = p.version; });
  save();
  return { synced: subscribers.length };
};

export const retirePack = async (apiurl, packId) => {
  if (!DEMO_MODE) return axios.post(`${apiurl}/task_form/packs/admin/${packId}/retire`);
  const p = load().packs.find((x) => x.pack_id === packId);
  p.status = 'retired';
  save();
};

// ---------- Customer view (what FWApp's Form Library will do) ----------
const syncCompany = (s, pack) => {
  s.subscribedForms = s.subscribedForms.filter((r) => r.pack_id !== pack.pack_id || pack.items.includes(r.form_id));
  pack.items.forEach((fid) => {
    if (!s.subscribedForms.some((r) => r.form_id === fid)) s.subscribedForms.push({ form_id: fid, pack_id: pack.pack_id });
  });
};

export const getCompanyView = async () => {
  await wait(80);
  const s = load();
  const published = s.packs.filter((p) => p.status === 'published');
  const matches = (p) => (p.company_type == null || p.company_type === s.company.type) && (!p.state_id || p.state_id === s.company.state);
  return JSON.parse(JSON.stringify({
    company: s.company,
    packs: published.map((p) => ({
      ...p,
      matching: matches(p),
      subscribed: s.subscribedPacks.find((sp) => sp.pack_id === p.pack_id) || null,
    })).sort((a, b) => Number(b.matching) - Number(a.matching)),
    library: s.subscribedForms.map((r) => ({ ...r, form: s.forms.find((f) => f.form_id === r.form_id) })).filter((r) => r.form),
  }));
};

export const setDemoCompany = (patch) => { const s = load(); s.company = { ...s.company, ...patch }; save(); };

export const subscribePack = async (packId) => {
  const s = load();
  const p = s.packs.find((x) => x.pack_id === packId);
  syncCompany(s, p);
  s.subscribedPacks.push({ pack_id: packId, subscribed_version: p.version });
  save();
};

export const unsubscribePack = async (packId) => {
  const s = load();
  // Forms the company subscribed to individually (pack_id null) are kept.
  s.subscribedForms = s.subscribedForms.filter((r) => r.pack_id !== packId);
  s.subscribedPacks = s.subscribedPacks.filter((sp) => sp.pack_id !== packId);
  save();
};
