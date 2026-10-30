// Run: npm test   (no network, no database: the model and SQL are stubbed)
process.env.FW_LOGGING_METHOD = 'console';
process.env.BLOB_KEY = process.env.BLOB_KEY || 'dGVzdA==';
const { Buffer } = require('buffer');
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const fi = require('../helpers/formIngestion');
const subset = require('../helpers/formioSubset');
const { scoreForm } = require('../scripts/evalMetrics');

const SAMPLE_PDF = fs.readFileSync(path.join(__dirname, '..', 'eval', 'pdfs', 'sample-isp-intake.pdf'));
const GOLD = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'eval', 'gold', 'sample-isp-intake.json'), 'utf8'));

// A model that returns the gold form with the kinds of defects real output has.
const flawedFromGold = () => {
  const def = JSON.parse(JSON.stringify(GOLD));
  const fields = [];
  subset.walk(def.components, (c) => { if (!subset.LAYOUT_TYPES.has(c.type)) fields.push({ key: c.key, sourcePage: 1, confidence: 0.95, notes: '' }); });
  def.components[1].components.forEach((c) => { delete c.input; });          // missing input:true
  def.components[1].components[3].type = 'phoneNumber';                       // unsupported but aliasable
  return { definition: def, fields };
};
const fakeModel = (envelopeFn = flawedFromGold, wrap = (s) => s) => {
  const calls = [];
  const fn = async (req) => { calls.push(req); return { content: wrap(JSON.stringify(envelopeFn(req))), usage: { prompt_tokens: 1000, completion_tokens: 500 } }; };
  fn.calls = calls;
  return fn;
};

test('runIngestion: repairs, validates and builds a manifest', async () => {
  const model = fakeModel(flawedFromGold, (s) => '```json\n' + s + '\n```');
  const stages = [];
  const r = await fi.runIngestion(SAMPLE_PDF, { callModel: model, onStage: (s) => stages.push(s) });
  assert.deepStrictEqual(r.problems, []);
  assert.strictEqual(model.calls.length, 1);
  assert.ok(model.calls[0].pdf && model.calls[0].pdf.length > 1000, 'PDF is sent as a file part');
  assert.ok(model.calls[0].text.includes('complete 2-page document'));
  assert.strictEqual(r.usage.promptVersion, fi.PROMPT_VERSION);
  assert.strictEqual(r.usage.promptTokens, 1000);
  assert.ok(r.usage.repaired > 0);
  assert.ok(stages.every((s) => fi.STAGES.includes(s)), 'stage labels match what the UI shows');
  const phone = r.fields.find((f) => f.key === 'phoneNumber');
  assert.strictEqual(phone.type, 'textfield');
  assert.strictEqual(subset.validate(r.definition).length, 0);
  assert.ok(r.fields.find((f) => f.key === 'dx').flags.includes('Very short label'));
});

test('runIngestion: duplicate keys are renamed and metadata follows the right component', async () => {
  const model = fakeModel(() => ({
    definition: { components: [
      { type: 'textfield', key: 'dateSigned', label: 'Date Signed One', input: true },
      { type: 'textfield', key: 'dateSigned', label: 'Date Signed Two', input: true },
    ] },
    fields: [{ key: 'dateSigned', sourcePage: 1, confidence: 0.9 }, { key: 'dateSigned', sourcePage: 2, confidence: 0.5, notes: 'second one' }],
  }));
  const r = await fi.runIngestion(SAMPLE_PDF, { callModel: model });
  assert.deepStrictEqual(r.fields.map((f) => f.key), ['dateSigned', 'dateSigned2']);
  assert.strictEqual(r.fields[1].sourcePage, 2);
  assert.strictEqual(r.fields[1].confidence, 0.5);
});

test('runIngestion: one model repair pass when deterministic repair is not enough', async () => {
  let n = 0;
  const model = fakeModel(() => {
    n += 1;
    if (n === 1) return { definition: { components: [{ type: 'radio', key: 'pick', label: 'Pick', input: true, values: [] }] }, fields: [] };
    return { definition: { components: [{ type: 'radio', key: 'pick', label: 'Pick', input: true, values: [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }] }] }, fields: [{ key: 'pick', sourcePage: 1, confidence: 0.8 }] };
  });
  const r = await fi.runIngestion(SAMPLE_PDF, { callModel: model });
  assert.strictEqual(model.calls.length, 2);
  assert.strictEqual(model.calls[1].pdf, null, 'repair pass sends text only');
  assert.match(model.calls[1].text, /failed validation/);
  assert.deepStrictEqual(r.problems, []);
});

test('runIngestion: unrepairable output is returned with problems, never thrown', async () => {
  const model = fakeModel(() => ({ definition: { components: [{ type: 'radio', key: 'pick', label: 'Pick', input: true, values: [] }] }, fields: [] }));
  const r = await fi.runIngestion(SAMPLE_PDF, { callModel: model });
  assert.ok(r.problems.length > 0);
  assert.strictEqual(model.calls.length, 2, 'exactly one repair attempt');
});

test('long PDFs are chunked, page numbers are original, panels spanning a boundary merge', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 7; i += 1) { const p = doc.addPage(); p.drawText(`Page ${i + 1} of a long blank form with plenty of printed text to count as a text layer`, { x: 20, y: 700 }); }
  const buf = Buffer.from(await doc.save());
  const model = fakeModel((req) => {
    const m = req.text.match(/pages (\d+) to (\d+)/);
    const from = m ? Number(m[1]) : 1;
    return {
      definition: { components: [{ type: 'panel', key: `p${from}`, title: 'Section A', input: false, components: [{ type: 'textfield', key: `f${from}`, label: `Field ${from}`, input: true }] }] },
      fields: [{ key: `f${from}`, sourcePage: from, confidence: 0.9 }],
    };
  });
  const r = await fi.runIngestion(buf, { callModel: model });
  assert.strictEqual(model.calls.length, 2);
  assert.match(model.calls[1].text, /pages 6 to 7 of a 7-page original/);
  assert.match(model.calls[1].text, /do not reuse\): p1, f1/);
  assert.strictEqual(r.definition.components.length, 1, 'continued panel merged');
  assert.deepStrictEqual(r.fields.map((f) => f.sourcePage), [1, 6]);
  assert.strictEqual(r.usage.chunks, 2);
});

test('precheck refuses non-PDF, too many pages, image-only and filled forms', async () => {
  await assert.rejects(fi.precheckPdf(Buffer.from('hello')), { code: 'NOT_PDF' });
  await assert.rejects(fi.precheckPdf(Buffer.alloc(0)), { code: 'EMPTY' });

  const big = await PDFDocument.create(); for (let i = 0; i < 31; i += 1) big.addPage();
  await assert.rejects(fi.precheckPdf(Buffer.from(await big.save())), { code: 'TOO_MANY_PAGES' });

  // a scan-like PDF: pages that contain only graphics
  await assert.rejects(fi.precheckPdf(fs.readFileSync(path.join(__dirname, 'fixtures', 'no-text-layer.pdf'))), { code: 'NO_TEXT_LAYER' });

  const filled = await PDFDocument.create();
  const page = filled.addPage(); page.drawText('A form with enough printed words on this page to look like real text content', { x: 10, y: 700 });
  const tf = filled.getForm().createTextField('clientName'); tf.addToPage(page, { x: 10, y: 600 }); tf.setText('Jane Doe');
  await assert.rejects(fi.precheckPdf(Buffer.from(await filled.save({ useObjectStreams: false }))), { code: 'FILLED_FORM' });

  const ok = await fi.precheckPdf(SAMPLE_PDF);
  assert.strictEqual(ok.pages, 2);
});

test('parseJsonFromLlmContent salvages fenced and prose-wrapped JSON', () => {
  assert.deepStrictEqual(fi.parseJsonFromLlmContent('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepStrictEqual(fi.parseJsonFromLlmContent('Here you go: {"a":1} hope it helps'), { a: 1 });
  assert.throws(() => fi.parseJsonFromLlmContent('no json here'), { code: 'BAD_MODEL_OUTPUT' });
});

test('validate rejects unsupported types, duplicate keys, empty options', () => {
  const bad = { components: [
    { type: 'button', key: 'b' },
    { type: 'textfield', key: 'a' }, { type: 'textfield', key: 'a' },
    { type: 'radio', key: 'r', values: [] },
  ] };
  const problems = subset.validate(bad);
  assert.ok(problems.some((p) => /Duplicate key "a"/.test(p)));
  assert.ok(problems.some((p) => /"r" \(radio\) has no options/.test(p)));
  assert.ok(problems.length >= 3);
  assert.deepStrictEqual(subset.validate(GOLD), []);
});

test('the gold form scores 100% against itself', () => {
  const s = scoreForm(GOLD, GOLD);
  assert.strictEqual(s.recall, 1); assert.strictEqual(s.typeAccuracy, 1); assert.strictEqual(s.optionAccuracy, 1); assert.strictEqual(s.requiredAccuracy, 1);
});

test('prompts/05-form-ingestion.md is in sync with the prompts in code', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'prompts', '05-form-ingestion.md'), 'utf8');
  [fi.SYSTEM_PROMPT, fi.CONTRACT_PROMPT, fi.REPAIR_PROMPT, fi.PROMPT_VERSION].forEach((t) => assert.ok(doc.includes(t), 'run: node scripts/gen-prompt-doc.js'));
});
