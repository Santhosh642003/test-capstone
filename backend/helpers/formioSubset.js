// The subset of Form.io that PDF ingestion is allowed to produce (project brief section 5.2),
// plus the validate / repair / heuristic-flag functions the pipeline runs on every draft.
// Pure functions, no I/O. FieldworkerMISFrontEnd/src/formio/validate.js is the client-side mirror:
// change one, change the other.
const Ajv = require('ajv');

const SUPPORTED_TYPES = [
  'textfield', 'textarea', 'number', 'currency', 'datetime', 'radio', 'selectboxes',
  'select', 'checkbox', 'signature', 'datagrid', 'panel', 'fieldset', 'columns',
  'htmlelement', 'content',
];
const CONTAINER_TYPES = new Set(['panel', 'fieldset', 'columns', 'datagrid']);
const TEXT_ONLY_TYPES = new Set(['htmlelement', 'content']);
const LAYOUT_TYPES = new Set(['panel', 'fieldset', 'columns', 'htmlelement', 'content']);
const OPTION_TYPES = new Set(['radio', 'selectboxes']);
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

// Types a model commonly reaches for that map cleanly onto the supported subset.
const TYPE_ALIASES = {
  email: 'textfield', phoneNumber: 'textfield', url: 'textfield', password: 'textfield',
  day: 'datetime', time: 'datetime', checkboxgroup: 'selectboxes', table: 'datagrid',
};

const componentSchema = {
  type: 'object',
  required: ['type', 'key'],
  properties: {
    type: { enum: SUPPORTED_TYPES },
    key: { type: 'string', pattern: KEY_PATTERN.source },
    label: { type: 'string' },
    title: { type: 'string' },
    input: { type: 'boolean' },
    components: { type: 'array', items: { $ref: '#/definitions/component' } },
    columns: { type: 'array', items: { type: 'object', properties: { components: { type: 'array', items: { $ref: '#/definitions/component' } } } } },
    values: { type: 'array', items: { type: 'object', required: ['label', 'value'], properties: { label: { type: 'string', minLength: 1 }, value: { type: 'string', minLength: 1 } } } },
    data: { type: 'object', properties: { values: { type: 'array', items: { type: 'object', required: ['label', 'value'] } } } },
    validate: { type: 'object', properties: { required: { type: 'boolean' } } },
  },
};
const formSchema = {
  type: 'object',
  required: ['components'],
  properties: { display: { type: 'string' }, components: { type: 'array', minItems: 1, items: { $ref: '#/definitions/component' } } },
  definitions: { component: componentSchema },
};
const validateSchema = new Ajv({ allErrors: true, strict: false }).compile(formSchema);

const toKey = (label, fallback = 'field') => {
  const words = String(label || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  const key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  return (/^[0-9]/.test(key) ? `f${key}` : key).slice(0, 64);
};

// Depth-first walk in document order: fn(component, parent, depth).
const walk = (components, fn, parent = null, depth = 0) => {
  (components || []).forEach((c) => {
    if (!c || typeof c !== 'object') return;
    fn(c, parent, depth);
    if (Array.isArray(c.components)) walk(c.components, fn, c, depth + 1);
    if (Array.isArray(c.columns)) c.columns.forEach((col) => walk(col && col.components, fn, c, depth + 1));
  });
};

// Input components only (layout and text blocks excluded), in document order.
const flattenFields = (form) => {
  const out = [];
  walk(form && form.components, (c, parent, depth) => {
    if (!LAYOUT_TYPES.has(c.type)) out.push({ component: c, parent, depth });
  });
  return out;
};

/**
 * Deterministic repair, on a deep copy: alias unsupported types, add `input`, fix invalid or duplicate
 * keys, drop empty options, default select/option values. Returns the repaired definition plus the
 * list of {from, to} key renames in document order so per-field metadata can follow its component.
 */
const repair = (form) => {
  const copy = JSON.parse(JSON.stringify(form && typeof form === 'object' ? form : {}));
  copy.display = copy.display || 'form';
  copy.components = Array.isArray(copy.components) ? copy.components : [];
  const seen = new Set();
  const renames = [];
  let repairs = 0;
  const log = []; // one entry per repair applied, in document order (shown by smoke:model --out)
  const fix = (entry) => { log.push(entry); repairs += 1; };
  walk(copy.components, (c) => {
    if (TYPE_ALIASES[c.type]) { fix({ change: 'type-alias', key: c.key, from: c.type, to: TYPE_ALIASES[c.type] }); c.type = TYPE_ALIASES[c.type]; }
    const wantsInput = !LAYOUT_TYPES.has(c.type);
    if (wantsInput && c.input !== true) { c.input = true; fix({ change: 'set-input', key: c.key, value: true }); }
    if (!wantsInput && c.input !== false) { c.input = false; fix({ change: 'set-input', key: c.key, value: false }); }
    const original = c.key;
    let key = KEY_PATTERN.test(original || '') ? original : toKey(original || c.label || c.title, c.type);
    const base = key;
    let n = 2;
    while (seen.has(key)) key = `${base.slice(0, 60)}${n++}`;
    seen.add(key);
    if (key !== original) fix({ change: 'key-renamed', from: original === undefined ? null : original, to: key });
    c.key = key;
    renames.push({ from: original, to: key });
    if (OPTION_TYPES.has(c.type) && Array.isArray(c.values)) {
      const before = c.values.length;
      c.values = c.values.filter((v) => v && String(v.label || '').trim()).map((v) => ({ ...v, label: String(v.label), value: String(v.value || toKey(v.label, 'option')) }));
      if (c.values.length !== before) fix({ change: 'dropped-empty-options', key, count: before - c.values.length });
    }
    if (c.type === 'select') {
      const src = (c.data && c.data.values) || c.values || [];
      c.data = { values: src.filter((v) => v && String(v.label || '').trim()).map((v) => ({ ...v, label: String(v.label), value: String(v.value || toKey(v.label, 'option')) })) };
      delete c.values;
    }
    if (TEXT_ONLY_TYPES.has(c.type) && c.type === 'content' && typeof c.html !== 'string') c.html = '';
  });
  return { definition: copy, renames, repairs, log };
};

// Problems that make a draft unsafe to hand to the builder. Empty list = valid.
const validate = (form) => {
  if (!form || typeof form !== 'object') return ['Definition is not an object'];
  const errors = [];
  if (!validateSchema(form)) {
    (validateSchema.errors || []).forEach((e) => errors.push(`${e.instancePath || '(root)'} ${e.message}`));
  }
  const seen = new Set();
  walk(form.components, (c) => {
    if (c.key) { if (seen.has(c.key)) errors.push(`Duplicate key "${c.key}"`); seen.add(c.key); }
    if (OPTION_TYPES.has(c.type) && !(Array.isArray(c.values) && c.values.length)) errors.push(`"${c.key}" (${c.type}) has no options`);
    if (c.type === 'select' && !(c.data && Array.isArray(c.data.values) && c.data.values.length)) errors.push(`"${c.key}" (select) has no options`);
    if (c.type === 'datagrid' && !(Array.isArray(c.components) && c.components.length)) errors.push(`"${c.key}" (datagrid) has no columns`);
  });
  return [...new Set(errors)];
};

// Flags raised regardless of what the model said about its own confidence (brief section 6).
const heuristicFlags = (c, allFields = []) => {
  const flags = [];
  const label = String(c.label || '').trim();
  if (label.length < 3) flags.push('Very short label');
  if (OPTION_TYPES.has(c.type) && Array.isArray(c.values) && c.values.length < 2) flags.push('Choice field with a single option');
  if (c.type === 'select' && ((c.data && c.data.values) || []).length < 2) flags.push('Dropdown with fewer than two options');
  if (label && allFields.filter((f) => String(f.label || '').trim().toLowerCase() === label.toLowerCase() && f.type !== 'signature').length > 1 && c.type !== 'datetime') {
    flags.push('Duplicate label');
  }
  if (/\*\s*$/.test(label) && !(c.validate && c.validate.required)) flags.push('Label ends with * but field is not required');
  return flags;
};

module.exports = { SUPPORTED_TYPES, CONTAINER_TYPES, LAYOUT_TYPES, OPTION_TYPES, KEY_PATTERN, toKey, walk, flattenFields, repair, validate, heuristicFlags };
