# Demo runbook (Import Form + Form Packs)

```bash
npm install --legacy-peer-deps
npm run start:demo          # http://localhost:3000 — no login, no backend needed
```
Demo mode (`REACT_APP_DEMO=1`) skips Azure AD, opens on **Admin Tools → Import Form**, and serves data from the browser. Chrome/Edge recommended. Needs internet for the Form.io CDN styles (`src/index.js`).
For real environments set `REACT_APP_IMPORT_FORM_ENABLED=true` (feature flag); without it the two pages are hidden.

## 5-minute script
1. **Import Form** → click **Replay real GPT-4.1 result** (an unedited response captured from the Azure deployment on 2026-10-30 for the sample PDF; the header says it is a replay, not a live call) or **Use sample PDF (simulated)** (a hand-made draft). Both take ~10 s of staged progress. In the real replay the checkbox group and the table come back with empty labels: the review screen flags them (2 fields need review), and you fix them inline.
2. **Review** — PDF on the left, tabs on the right:
   - *Fields*: confidence badges, ⚑ reasons ("Ambiguous checkbox group", "Very short label"), jump to PDF page, edit label/type/required inline (rename "Dx" → "Primary Diagnosis" — the flag clears). Toggle "Needs review only".
   - *Builder*: full Form.io builder on the same draft. *Preview*: live rendered form.
3. **Publish…** — fill metadata (type, company type, state, agency; optionally "replaces" an existing form) → published as community form.
4. **Add to a pack** (or Admin Tools → **Form Packs**): edit "Home Healthcare · Arizona" (add/reorder/remove forms), **Publish**; on the published NJ pack use **New version** with change notes.
5. **Customer view (preview)** tab: pick a company type + state, see matching packs first ("Show all" for the rest), **Subscribe** → forms land in the library tagged "via pack"; the individually-subscribed form stays tagged "individually subscribed" and survives **Unsubscribe**.
6. "Reset demo data" restores the seed state.

## Real mode (against FWAPI)
Unset `REACT_APP_DEMO` and set `REACT_APP_IMPORT_FORM_ENABLED=true`; the two pages then call `<FWAPI>/task_form/...` (see `../backend/FORM_INGESTION.md` for the SQL migration, config and endpoint list). The Customer-view tab is demo-only.
