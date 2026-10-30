// Scoring for the form-ingestion eval: how closely a generated definition matches a hand-built gold one.
const { flattenFields, validate, OPTION_TYPES } = require('../helpers/formioSubset');

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));
const jaccard = (a, b) => {
  const A = tokens(a); const B = tokens(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; A.forEach((t) => { if (B.has(t)) inter += 1; });
  return inter / (A.size + B.size - inter);
};
const levRatio = (a, b) => {
  const s = norm(a); const t = norm(b);
  if (!s.length && !t.length) return 1;
  const d = Array.from({ length: s.length + 1 }, (_, i) => [i, ...Array(t.length).fill(0)]);
  for (let j = 1; j <= t.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= s.length; i += 1) for (let j = 1; j <= t.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
  return 1 - d[s.length][t.length] / Math.max(s.length, t.length);
};
const similarity = (a, b) => Math.max(jaccard(a, b), levRatio(a, b));
const MATCH_THRESHOLD = 0.8;

const optionLabels = (c) => (c.type === 'select' ? (c.data && c.data.values) || [] : c.values || []).map((v) => norm(v.label)).sort().join('|');
const ratio = (num, den) => (den === 0 ? null : num / den);

/**
 * Greedy one-to-one matching of gold fields to generated fields by label similarity (>= 0.8, best pairs first).
 * Returns recall (gold fields found), precision (generated fields that are real), type / option-set / required
 * accuracy over matched pairs, and structural validity.
 */
const scoreForm = (generated, gold) => {
  const g = flattenFields(gold).map((f) => f.component);
  const p = flattenFields(generated).map((f) => f.component);
  const pairs = [];
  g.forEach((gc, gi) => p.forEach((pc, pi) => { const sim = similarity(gc.label, pc.label); if (sim >= MATCH_THRESHOLD) pairs.push({ gi, pi, sim }); }));
  pairs.sort((a, b) => b.sim - a.sim);
  const usedG = new Set(); const usedP = new Set(); const matched = [];
  pairs.forEach(({ gi, pi }) => { if (!usedG.has(gi) && !usedP.has(pi)) { usedG.add(gi); usedP.add(pi); matched.push([g[gi], p[pi]]); } });

  const typeOk = matched.filter(([a, b]) => a.type === b.type).length;
  const optPairs = matched.filter(([a]) => OPTION_TYPES.has(a.type) || a.type === 'select');
  const optOk = optPairs.filter(([a, b]) => optionLabels(a) === optionLabels(b)).length;
  const reqOk = matched.filter(([a, b]) => !!(a.validate && a.validate.required) === !!(b.validate && b.validate.required)).length;
  return {
    goldFields: g.length, generatedFields: p.length, matched: matched.length,
    recall: ratio(matched.length, g.length), precision: ratio(matched.length, p.length),
    typeAccuracy: ratio(typeOk, matched.length), optionAccuracy: ratio(optOk, optPairs.length), requiredAccuracy: ratio(reqOk, matched.length),
    structurallyValid: validate(generated).length === 0,
    missing: g.filter((_, i) => !usedG.has(i)).map((c) => c.label),
  };
};

module.exports = { scoreForm, similarity, MATCH_THRESHOLD };
