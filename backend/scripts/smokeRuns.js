// Pure helpers for `smoke:model --runs N`: compare the field labels the model produced across repeated runs on the
// same PDF. No I/O, no environment, no model access.

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * One run's labels as a Map(identity -> text shown to people). Identity is the normalised label plus its occurrence
 * number, so a repeated label ("Date Signed" twice) counts twice; a field with an empty label is identified by its key.
 */
const labelMap = (fields) => {
  const seen = new Map();
  const out = new Map();
  (fields || []).forEach((f) => {
    const base = norm(f.label) || `(empty label) ${f.key}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const shown = (String(f.label || '').trim() || `(empty label) ${f.key}`) + (n > 1 ? ` (#${n})` : '');
    out.set(`${base}#${n}`, shown);
  });
  return out;
};

const jaccard = (a, b) => {
  const A = new Set(a.keys()); const B = new Set(b.keys());
  if (!A.size && !B.size) return 1;
  let inter = 0; A.forEach((k) => { if (B.has(k)) inter += 1; });
  return inter / (A.size + B.size - inter);
};
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * runs: [{ run: 1, labels: Map }, ...] for the runs that succeeded.
 * Returns { comparedRuns, someButNotAll: [{ label, inRuns, missingFromRuns }], overlap: { pairwise, mean, min, max } | null }.
 */
const compareRuns = (runs) => {
  const ids = runs.map((r) => r.run);
  const all = new Map(); // identity -> { label, inRuns[] }
  runs.forEach((r) => r.labels.forEach((shown, key) => {
    if (!all.has(key)) all.set(key, { label: shown, inRuns: [] });
    all.get(key).inRuns.push(r.run);
  }));
  const someButNotAll = [...all.values()]
    .filter((e) => e.inRuns.length < runs.length)
    .map((e) => ({ label: e.label, inRuns: e.inRuns, missingFromRuns: ids.filter((i) => !e.inRuns.includes(i)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (runs.length < 2) return { comparedRuns: ids, someButNotAll, overlap: null };
  const pairwise = runs.map((a) => runs.map((b) => round3(jaccard(a.labels, b.labels))));
  const off = [];
  for (let i = 0; i < runs.length; i += 1) for (let j = i + 1; j < runs.length; j += 1) off.push(pairwise[i][j]);
  return {
    comparedRuns: ids,
    someButNotAll,
    overlap: { pairwise, mean: round3(off.reduce((s, x) => s + x, 0) / off.length), min: Math.min(...off), max: Math.max(...off) },
  };
};

// Same rule the single-run summary uses for "fields needing review".
const isFlagged = (f) => !!(f.flags.length || (f.confidence !== null && f.confidence < 0.85) || f.notes);

module.exports = { norm, labelMap, jaccard, compareRuns, isFlagged };
