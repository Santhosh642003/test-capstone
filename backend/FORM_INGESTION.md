# AI form ingestion + form packs — backend (FWAPI)

Implements project 05 on the server: PDF → Form.io definition (Azure OpenAI `gpt-4.1`), reviewed and published as a community form, bundled into subscribable packs. The MIS front end (`FieldworkerMISFrontEnd`) calls these routes; with `REACT_APP_DEMO` unset it talks to them for real.

## Setup
1. **SQL** — run `db/mssql/002_form_packs.sql` against the dev APIDB (idempotent). Adds `form_pack`, `form_pack_item`, `form_pack_version`, `subscribed_pack`, `form_source`, plus `fw_forms.replaces_form_id` and `subscribed_form.pack_id` (and `form_state`/`form_sponsor` if missing). Copy it into the DB Schema project when merging.
2. **Dependencies** — `npm install` (adds `ajv`, `pdf-lib`, `pdfjs-dist`).
3. **Config** (environment / Azure app settings — never in git):

| Variable | Purpose |
|---|---|
| `FOUNDRY_API_KEY`, `FOUNDRY_LLM_MODEL` | already used by `sdr.js`; the model call fails cleanly if the key is missing |
| `BLOB_KEY` | existing storage key |
| `FORM_IMPORT_CONTAINER_NAME` | **new** — dedicated, access-restricted container for uploaded source PDFs. If unset, imports still work but the PDF is not stored (`form_source.source_blob_url` is NULL) and a warning is logged |
| `MIS_COMPANY_ID` | company whose employees count as MIS administrators (default `2000`, ANALYTIQ — same rule as the MIS front end) |

## Endpoints (all under `/api/fieldworker/task_form`, `Authorization: Bearer <MSAL token>`)

MIS administrators only (`requireMsalIdentity` + `requireMisAdmin`):

| Method + path | Purpose |
|---|---|
| `POST /import` (multipart field `file`) | Pre-check, store PDF, start background job → `202 {jobId}`. Refusals: 413 too large, 415 not a PDF, 422 >30 pages / image-only / pre-filled fields, 429 too many running |
| `GET /import/:jobId` | `{status:'running', stage, progress}` · `{status:'done', result:{definition, fields[], problems[], usage}}` · `{status:'failed', error}`. Only the uploader can read a job |
| `POST /import/publish` | One transaction: `fw_forms` (community form, `form_state`, `form_sponsor`, `replaces_form_id`) + `form_source` (blob URL, agency, model, prompt version, company types, reviewer). Re-validates the definition server-side |
| `GET /packs/admin`, `GET /packs/admin/forms` | Packs (with items + version history) and community forms (without `json_schema`) |
| `POST /packs/admin`, `PUT /packs/admin/:id` | Create / edit; exactly one state or `null` = all states; ≥ 1 community form |
| `POST /packs/admin/:id/publish` `{notes}` | v1 on first publish; later publishes bump the version, require change notes, record `form_pack_version`, and sync subscribers in the same transaction |
| `POST /packs/admin/:id/retire`, `POST /packs/sync {pack_id}` | Hide a pack (subscribers keep their forms) / re-apply a pack to subscribers |

Company admins (`requireMsalIdentity`; the company comes from the verified token, never from the request body):

| Method + path | Purpose |
|---|---|
| `GET /packs` | Published packs, matching the company's type (`settings.feature_value='primaryBusinessType'`, 101–106) and state (`feature_id 99`) first, with `subscribed` status |
| `POST /packs/subscribed {pack_id}` | Materialises the pack's forms into `subscribed_form` (tagged `pack_id`); forms the company already holds individually are left untouched |
| `DELETE /packs/subscribed {pack_id}` | Removes only rows tagged with that pack, so individual subscriptions survive |

Subscribe/unsubscribe require `employee.emp_is_admin` to be true. **TODO:** confirm this matches the Cerbos rule the existing subscribe buttons use (FWApp) and switch to Cerbos if they differ.

Existing endpoints (`/subscribed`, `/forms`, `/form`, task-form assignment) are unchanged and keep working because pack subscriptions live in `subscribed_form`.

## Pipeline (`helpers/formIngestion.js`)
pre-check → (split into 5-page ranges when longer) → model call (`temperature 0`, JSON mode, PDF as `file` part, via `runFoundryRequest`) → parse with salvage → deterministic repair (aliases like `email`→`textfield`, `input:true`, unique camelCase keys ≤ 64) → validate (JSON Schema via `ajv` + option/duplicate checks) → **one** model repair pass if still invalid → manifest (model confidence/notes/page + heuristic flags). Output that cannot be repaired is returned with `problems` for the reviewer; the draft is never thrown away.
Prompt: `prompts/05-form-ingestion.md` (generated from the code by `node scripts/gen-prompt-doc.js`; a test fails if they drift). Bump `PROMPT_VERSION` and re-run the eval on every prompt change.

## Tests and eval
- `npm test` — 41 tests, no network or database (model, SQL and blob stubbed): pipeline, repair, chunking, pre-checks, import job flow, publish transaction, pack rules (subscribe/unsubscribe/sync), prompt-doc sync.
- `npm run eval:forms` — runs the real model over `eval/pdfs` against `eval/gold`, writes `eval/results/<promptVersion>.md`. `npm run eval:forms -- --replay` checks the harness itself with a saved reply (not a model result). See `eval/README.md`.

## Known limits / decisions to confirm
- **Not yet run against the real model, database or blob storage** — only against stubs. First real run: `npm run eval:forms` with the dev key, then one import through MIS on dev.
- **Auth audience:** `msalAuth.js` accepts tokens for *its own* environment's app registration, while the MIS UI signs in against the prod registration. Calling dev/test FWAPI from MIS needs a token issued for that environment's scope (or MIS signing in per environment).
- **Where this lives:** the brief proposes pack curation in `FieldworkerMIS` and the model call in `FWAPI`. Everything is in FWAPI here so MIS needs no new API; moving the admin routes to `FieldworkerMIS` is a copy of `helpers/form_packs.js` (curation half) + the SQL.
- Jobs are in memory (a restart fails in-flight imports; the engineer re-uploads). Move to a table if that matters.
- Text-layer detection counts extractable characters (< 40 per page ⇒ "scan"); if pdf.js cannot open the file the check is skipped rather than blocking.
- Chunks run sequentially (each call is told the keys already used); a 30-page form is ~6 calls.
- Token cost/page is unmeasured until the first real eval run — agree a budget with the mentor then.

## First real run (against Azure OpenAI)

Nothing here has been run against the real Azure deployment yet: the scripts were exercised only against a local stand-in server, and `npm test` uses stubs. Do these in order and stop at the first failure.

0. **Set up `.env`** — `cp .env.example .env`, fill in the placeholders (never commit `.env`; it is git-ignored). For steps 1–3 you only need `FOUNDRY_API_KEY` and `FOUNDRY_URL` (the base ending in `/openai/v1`); optionally `FOUNDRY_LLM_MODEL` = your **deployment** name (default `gpt-4.1`). For step 4 also set `FW_ENV=dev`. Scripts never use SQL, and they set `FW_LOGGING_METHOD=console` so they cannot upload or delete anything in the log blob container.

| # | Command | What it does | Success looks like |
|---|---|---|---|
| 1 | `npm run check:env` | Lists each variable as set / missing / placeholder (never the value); no network or DB connection | `Model smoke test / eval: READY` (full API may say NOT READY: that is fine for steps 2–4). Also prints the migration command and target database **without running it** |
| 2 | `npm run smoke:model` | ONE real call through the pipeline (same prompt, same PDF file part, `runFoundryRequest`) on `eval/pdfs/sample-isp-intake.pdf`, or `-- path/to/blank.pdf` (≤ 5 pages) | `RESULT: SUCCESS`, `Mode that worked: JSON mode …` (or `text mode` + the recorded reason JSON mode was rejected, which is also fine), `Output parsed as JSON: yes`, `Passes Form.io subset: yes (0 validator errors)`, ~19 fields, token counts and latency. Exit code 0 |
| 3 | `npm run eval:forms` | Runs the sample through the pipeline and scores it against the gold form; writes `eval/results/ff-0.1.0.md` | Table with recall/type/option/required/valid, file header states date, deployment name, JSON mode, 1 form and that the gold set is a single fictional form. **Do not quote these as accuracy.** Commit the results file with the prompt version |
| 4 | `npm run e2e:import` | Serves only the import routes in-process (dev auth bypass), uploads the PDF to `POST /import`, polls `GET /import/:jobId` | `POST /import -> HTTP 202`, stages `running … done`, `RESULT: SUCCESS`, fields in draft, 0 validator errors. It lists what was skipped (blob upload unless `--with-blob`; SQL; publish) |

`e2e:import -- --url https://<host>/api/fieldworker/task_form/import --token <MSAL access token>` calls a running API instead (the token must be for that API's environment).

**Database migration is never run by any script.** `npm run check:env` prints the exact `sqlcmd` command and the target server/database (from your `.env`, `FW_ENV`) for you to review and run yourself.

### Dev-only auth bypass (`DEV_AUTH_BYPASS`)
`DEV_AUTH_BYPASS=true` replaces the Azure AD token check on the **MIS-only** import and pack-curation routes with a fixed MIS-admin identity (company `MIS_COMPANY_ID`, employee `DEV_AUTH_BYPASS_EMP_ID` or 1). It exists so the import endpoints can be exercised locally without SQL or a token. Safeguards: the module **throws on load** (the API will not start) if it is set while `NODE_ENV=production` or `FW_ENV=prod` (an unset `FW_ENV` counts as prod); every bypassed request is logged as a warning and returns an `X-Dev-Auth-Bypass: true` header; customer-side pack routes never use it; any value other than `true` leaves real auth in force. `e2e:import` enables it for its own process only. Do not put it in a shared or deployed environment.

### Top 5 failure messages and fixes
| Message (smoke:model / eval) | Meaning and fix |
|---|---|
| `NOT RUN: missing FOUNDRY_API_KEY, FOUNDRY_URL` | `.env` not found or values still `<placeholders>`. Run `npm run check:env`. Variables exported in your shell win over `.env`. |
| `AuthenticationError … HTTP 401` | Wrong or expired key, or a key from a different resource than `FOUNDRY_URL`. Re-copy the key from the same Azure OpenAI resource. |
| `PermissionDenied … HTTP 403` | Key accepted but access denied: usually the resource firewall / allowed networks (your IP or VPN) or a key for another resource. |
| `NotFound … HTTP 404` | `FOUNDRY_LLM_MODEL` is not an existing **deployment** name, or `FOUNDRY_URL` is wrong. It must be the base ending `/openai/v1` (the code appends `/chat/completions`; do not paste the full URL). |
| `RateLimit … HTTP 429` / `NetworkError` | 429: the shared deployment is out of tokens-per-minute; wait a minute and retry (the pipeline already backs off once). NetworkError: wrong host in `FOUNDRY_URL`, or VPN/proxy. |

Also: `Mode that worked: text mode … JSON mode fallback rejected with HTTP 400` is **not** a failure — the deployment does not accept `response_format` together with a PDF part, so the pipeline asks for JSON in the prompt only (and the salvage parser handles stray prose). If the draft then has validator errors, paste the `Validator errors` list to the team: that is prompt-tuning work, not plumbing.
