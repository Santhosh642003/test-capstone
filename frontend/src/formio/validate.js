// Client-side guard for the Form.io subset the importer supports (brief §5.2).
// Mirrors the server-side validation so invalid JSON never reaches the builder.

export const SUPPORTED_TYPES = [
  'textfield', 'textarea', 'number', 'currency', 'datetime', 'radio', 'selectboxes',
  'select', 'checkbox', 'signature', 'datagrid', 'panel', 'fieldset', 'columns',
  'htmlelement', 'content',
];

const LAYOUT_TYPES = new Set(['panel', 'fieldset', 'columns', 'htmlelement', 'content']);
const OPTION_TYPES = new Set(['radio', 'selectboxes']);

export const toKey = (label, fallback = 'field') => {
  const words = String(label || '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  const key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('');
  return (/^[0-9]/.test(key) ? `f${key}` : key).slice(0, 64);
};

// Depth-first walk in document order; calls fn(component, parent, depth).
export const walk = (components = [], fn, parent = null, depth = 0) => {
  components.forEach((c) => {
    fn(c, parent, depth);
    if (Array.isArray(c.components)) walk(c.components, fn, c, depth + 1);
    if (Array.isArray(c.columns)) c.columns.forEach((col) => walk(col.components || [], fn, c, depth + 1));
  });
};

export const flatten = (form) => {
  const out = [];
  walk(form?.components, (c, parent, depth) => {
    if (LAYOUT_TYPES.has(c.type)) return;
    out.push({ component: c, parent, depth });
  });
  return out;
};

// Repairs obvious issues in place on a deep copy: missing input flag, duplicate/invalid keys, empty option values.
export const repair = (form) => {
  const copy = JSON.parse(JSON.stringify(form || {}));
  copy.display = copy.display || 'form';
  copy.components = Array.isArray(copy.components) ? copy.components : [];
  const seen = new Set();
  walk(copy.components, (c) => {
    if (!c.input && !LAYOUT_TYPES.has(c.type)) c.input = true;
    if (LAYOUT_TYPES.has(c.type) && c.type !== 'htmlelement' && c.type !== 'content') c.input = false;
    let key = /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(c.key || '') ? c.key : toKey(c.key || c.label, c.type);
    let n = 2;
    const base = key;
    while (seen.has(key)) key = `${base.slice(0, 60)}${n++}`;
    seen.add(key);
    c.key = key;
    if (OPTION_TYPES.has(c.type) && Array.isArray(c.values)) {
      c.values = c.values.filter((v) => v && String(v.label || '').trim()).map((v) => ({ ...v, value: v.value || toKey(v.label, 'option') }));
    }
  });
  return copy;
};

// Returns a list of human-readable problems; an empty list means the draft is safe to render.
export const validate = (form) => {
  const errors = [];
  if (!form || typeof form !== 'object') return ['Definition is not an object'];
  if (!Array.isArray(form.components) || form.components.length === 0) return ['Definition has no components'];
  const seen = new Set();
  walk(form.components, (c) => {
    if (!c || typeof c !== 'object') { errors.push('Component is not an object'); return; }
    if (!SUPPORTED_TYPES.includes(c.type)) errors.push(`Unsupported component type "${c.type}"`);
    if (!c.key) errors.push(`Component of type ${c.type} has no key`);
    else if (seen.has(c.key)) errors.push(`Duplicate key "${c.key}"`);
    else seen.add(c.key);
    if (c.key && c.key.length > 64) errors.push(`Key "${c.key}" exceeds 64 characters`);
    if (OPTION_TYPES.has(c.type) && !(Array.isArray(c.values) && c.values.length)) errors.push(`"${c.key}" (${c.type}) has no options`);
    if (c.type === 'select' && !(c.data && Array.isArray(c.data.values) && c.data.values.length)) errors.push(`"${c.key}" (select) has no options`);
  });
  return errors;
};

// Heuristic flags that apply regardless of what the model reported (brief §6, "Confidence").
export const heuristicFlags = (c) => {
  const flags = [];
  const label = String(c.label || '').trim();
  if (label.length < 3) flags.push('Very short label');
  if (OPTION_TYPES.has(c.type) && Array.isArray(c.values) && c.values.length < 2) flags.push('Choice field with a single option');
  if (c.type === 'select' && (c.data?.values || []).length < 2) flags.push('Dropdown with fewer than two options');
  return flags;
};
