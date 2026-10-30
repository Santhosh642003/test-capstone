# AI Form Ingestion — Plan

Project 2: PDF → Form.io definition → reviewed community form → form packs.
Written against the code in `FWAPI` (`helpers/sdr.js`, `helpers/foundryRateLimit.js`, `prompts/`) and the MIS front end in this repo.

## 1. What we are building

A support engineer uploads a blank state PDF in MIS. The model returns a Form.io definition plus a per-field manifest (confidence, notes, source page). The engineer reviews it next to the PDF, fixes it, and publishes. **The model drafts; a human always approves.** Goal: ~2 h/form → ~10 min of review.

## 2. Architecture (recommendation for the week-2 decision)

```
MIS UI ──► FieldworkerMIS  POST /forms/import ──► FWAPI  POST /task_form/import   (LLM code lives here)
              │  (auth, Blob upload, job row)        │  helpers/formIngestion.js
              │                                      └─ runFoundryRequest → Azure OpenAI gpt-4.1
              └──── GET /forms/import/{jobId}  (poll every ~700 ms; 230 s App Service ceiling ⇒ background job)
```

- **LLM code in FWAPI.** `config.js` (FOUNDRY_*), `foundryRateLimit.js` and the `prompts/` catalog are already there. MIS calls FWAPI service-to-service. This avoids duplicating keys and the shared 429 cool-down logic.
- **Background job, not a long request.** Upload returns `jobId` immediately; the job runs the pipeline and stores `{status, stage, result}`. The UI polls. The demo's `getImportJob` already uses exactly this shape.
- **Contract returned to the UI** (what `services/formsApi.js` consumes):
  `{ status: 'running'|'done'|'failed', stage, progress, result: { definition, fields:[{key, sourcePage, confidence, notes}], usage:{model, promptVersion, pages, promptTokens, completionTokens, seconds} } }`

## 3. Pipeline

| # | Stage | Detail |
|---|---|---|
| 1 | Pre-check | Size ≤ 20 MB, pages ≤ 30 (`pdf-lib`/`pdfjs-dist`), **text layer present** (image-only ⇒ reject "unsupported"), **reject PDFs with filled AcroForm values** (privacy: blank forms only). |
| 2 | Store | Original PDF to the restricted Blob container; keep URL for `form_source`. |
| 3 | Model call | Mirror `sdr.js`: system prompt with the output contract, PDF as a base64 `file` part, `temperature: 0`, wrapped in `runFoundryRequest`. Use JSON-schema structured output if the Azure deployment supports it; otherwise JSON-only prompt + the same salvage parser as `sdr.js`. |
| 4 | Parse + validate | Validate against a JSON Schema of the supported subset (same rules as `src/formio/validate.js`, which is the client mirror). |
| 5 | Repair | **Deterministic first:** add `input:true`, de-duplicate/camelCase keys (≤ 64 chars), drop empty options. **Then one model repair pass** with the validator errors if still invalid. If it still fails, return the errors to the reviewer — invalid JSON never reaches the builder. |
| 6 | Manifest | Per-field `sourcePage`, `confidence` (0–1), `notes` from the model, **plus heuristic flags that apply regardless**: label < 3 chars, radio/select with < 2 options, duplicate labels, `required` mismatch with `*` in label. |
| 7 | Log | Prompt version, model, tokens, timing at info level. **Never** log the PDF or full output. |

### Long PDFs
Split into page ranges (~4–6 pages, 1 page overlap). Each chunk gets: the contract, section titles/keys already emitted (to avoid duplicate keys and to continue an open section), and returns components for its pages. Merge in order, one `panel` per section, then run steps 4–6 once on the merged definition. Chunks can run in parallel but must respect the shared Foundry TPM budget — go through `runFoundryRequest`, cap concurrency at 2.

## 4. Prompt design (`prompts/05-form-ingestion.md`, `PROMPT_VERSION` constant)

1. **Role + grounding:** "Extract only what is printed. Do not invent fields, sections or options."
2. **Output contract:** the exact Form.io subset (brief §5.2 table) and the JSON envelope `{definition, fields[]}`.
3. **Mapping rules:** `*`/"required" ⇒ `validate.required`; "check all that apply" ⇒ `selectboxes`, single choice ⇒ `radio`; signature line ⇒ `signature` + paired "Date signed" `datetime`; blank-row tables ⇒ `datagrid` with column headers as child labels; headings ⇒ `panel` in document order; instructions/legal text ⇒ `content`, **verbatim**.
4. **Don'ts:** don't mimic print layout (columns only when it helps), don't summarise, don't merge sections, don't translate.
5. **Confidence rubric:** what 0.9 / 0.6 / 0.3 mean, and when to write a note (ambiguous checkbox group, unreadable label, abbreviation, unclear required flag).
6. **One short worked example** (the sample in the brief).
7. Documented verbatim in `prompts/`, edited in the same commit as the code, **eval re-run on every change** (house rule).

## 5. Evaluation harness (US-7)

`scripts/eval-form-ingestion.js` over `eval/pdfs/*.pdf` + `eval/gold/*.json`:

- **Field recall** — gold fields matched by normalised-label similarity (token Jaccard / Levenshtein ≥ 0.8, greedy one-to-one match).
- **Type accuracy**, **option-set accuracy** (radio/select/selectboxes, order-insensitive), **required-flag accuracy**.
- **Structural validity** — definition passes the validator *and* renders in Form.io (headless `Formio.createForm`).
- **Cost** — prompt/completion tokens per page, wall time.
- Output a Markdown table; commit it next to the prompt version (`eval/results/ff-0.1.0.md`).
- **Targets:** recall ≥ 85 %, type accuracy ≥ 90 %, 100 % render. Gold set: 3 hand-built by week 2 → 10–15 by week 8, mixing single-page, multi-page, table-heavy and dense-checkbox forms.

## 6. Data and integration (already mirrored in the demo UI)

- **Publish** → `POST /forms` with `public_form: 1`, `form_state`, `form_type`; `POST /forms/source` → `form_source` (blob URL, agency, model, prompt version, reviewer). Add `replaces_form_id` to `fw_forms` for revisions (published schemas are immutable once submissions exist).
- **Packs** → `form_pack`, `form_pack_item`, `subscribed_pack`, nullable `subscribed_form.pack_id`. Subscribing materialises rows into `subscribed_form`, so no existing query changes. Unsubscribing deletes only rows tagged with that pack. Pack publish runs `POST /task_form/packs/sync`.
- **Parameterised SQL only** (`mssql` request inputs); company scoping from the authenticated user; Cerbos gating on subscribe.

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scanned / image-only PDFs | Text-layer pre-check; reject with a clear message (out of scope this semester). |
| Completed forms with client data | AcroForm-value pre-check + explicit UI copy; blank forms only. |
| Ambiguous checkbox groups, abbreviations | Confidence + note per field; reviewer sees them highlighted (built). |
| Shared gpt-4.1 TPM / 429s | `runFoundryRequest`, concurrency cap, job queue; measure tokens/page early and agree a budget with the mentor. |
| Model drift between prompt edits | Eval gate on every prompt change; results committed per version. |
| Large tables / 30-page forms | Chunk + merge; cap pages; background job. |
| Source-agency reproduction terms | Record `source_agency`; keep instruction text verbatim; mentor to confirm. |

## 8. Timeline (maps to brief §8)

- **Wk 1–2:** gold forms (3), design note, confirm LLM location, trace `sdr.js`.
- **Wk 3–5:** ingestion v1 — single-page forms render; prompt v0.1 + first eval.
- **Wk 6–8:** validate/repair loop, chunking, review UI wired to the real job API, eval ≥ 85 % recall.
- **Wk 9–11:** packs tables, APIs, FieldWorker Form Packs section, sync.
- **Wk 12–14:** real packs on dev (SC·NJ, HH·AZ), feature flags, docs, demo video, final PRs.

## 9. Open questions for the mentor

1. FWAPI vs FieldworkerMIS for the model call (recommended: FWAPI).
2. Does the Azure `gpt-4.1` deployment version support JSON-schema structured output with file inputs?
3. Token budget per form / per page, and the TPM headroom on the shared deployment.
4. Where gold PDFs live (private `eval/` folder vs Blob container) and any redistribution limits.
5. Job storage: new `form_import_job` table vs in-memory + Blob (survives App Service restarts?).

## 10. Status: what exists now

| Piece | State |
|---|---|
| FWAPI ingestion pipeline, job API, publish, pack curation + subscription endpoints, SQL migration, prompt doc, eval harness, 22 tests | **Built** (`../backend/FORM_INGESTION.md`). Verified against stubs and an in-process HTTP smoke test; **not yet against the real model, database or blob storage** |
| MIS front end: Import Form, review, publish, Form Packs | **Built**; real mode calls the FWAPI routes above, demo mode (`npm run start:demo`) uses a simulated model and browser storage |
| FieldWorker customer UI (FWApp Form Library "Form Packs" section) | Not built (FWApp is not in the repo set). The `/task_form/packs*` endpoints it needs exist; the MIS "Customer view (preview)" tab shows the intended behaviour in demo mode |
| Real eval numbers (recall / type accuracy / tokens per page) | **None yet** — needs the dev API key and real state PDFs + gold forms |
