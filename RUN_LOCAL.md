# Run the AI Form Ingestion demo locally

```
AIForms/
  frontend/   MIS front end (Import Form + Form Packs)   <- the demo you click through
  backend/    FWAPI "fieldworker" folder (ingestion pipeline, pack endpoints, tests)
```

You only need `frontend/` for the meeting. `backend/` is for running its tests.

## 0. Requirements
- **Node 22** (this is what everything was tested on). Check: `node -v` → should print `v22.x`.
  Node 18/20 are untested. If you are on something else, install 22:
  - Mac/Linux (nvm): `nvm install 22 && nvm use 22`
  - Windows: install Node 22 LTS from nodejs.org (or `nvm-windows`: `nvm install 22.22.0` then `nvm use 22.22.0`), then open a NEW terminal.
  - Too NEW is fine too: the `start`/`build` scripts already pass `--openssl-legacy-provider` and a larger memory limit.
- Chrome or Edge. **Internet is needed** while the app runs (Form.io builder styles load from `cdn.form.io`).

## 1. Front end demo (≈ 3 min, most of it `npm install`)

**Mac / Linux**
```bash
unzip AIForms-run-local.zip
cd AIForms/frontend
npm install --legacy-peer-deps
cp .env.example .env          # optional for demo mode (start:demo sets REACT_APP_DEMO=1 itself)
npm run start:demo
```

**Windows (PowerShell or cmd)**
```bat
tar -xf AIForms-run-local.zip
cd AIForms\frontend
npm install --legacy-peer-deps
copy .env.example .env
npm run start:demo
```
(or right-click the zip → Extract All, then `cd` into `AIForms\frontend`)

The first compile takes ~1 minute ("Compiled with warnings" is normal: the warnings are in old MIS files, not the new pages). It opens **http://localhost:3000** — you land straight on *Admin Tools → Import Form*, **no Azure login**.

### Click-through (5 minutes)
1. **Import Form** → click **Use sample PDF** (or drop `frontend/public/demo/sample-isp-intake.pdf`). Staged progress runs ~10 s.
2. **Review screen:** PDF on the left; tabs on the right.
   - **Fields**: confidence badges and ⚑ reasons (e.g. "Ambiguous checkbox group", "Very short label"); click a `p.1` link to jump the PDF; turn on **Needs review only**; edit a label inline (rename **Dx → Primary Diagnosis** and its flag clears); change a type or the Required box.
   - **Builder**: the full Form.io builder on the same draft. **Preview**: the rendered form.
3. **Publish…** → fill description, form type (e.g. Intake), company type(s), State (e.g. NJ), source agency → **Publish**. Page confirms "now a community form".
4. **Add to a pack** (or **Admin Tools → Form Packs**): the seeded packs are listed. **New pack** → name, state, add forms with the ⊕ buttons → **Save pack**. On a pack: **Publish** (draft) or **New version** (published; needs change notes).
5. **Customer view (preview)** tab: pick business type + state, **Subscribe** to a pack (its forms appear "via pack"), then **Unsubscribe** — the form that was subscribed individually stays.
6. **Reset demo data** (top right of Form Packs) restores the starting state.

## 2. Backend tests (≈ 2 min)
```bash
cd AIForms/backend
# Mac/Linux:                      # Windows PowerShell:                 # Windows cmd:
PUPPETEER_SKIP_DOWNLOAD=1 npm install   # $env:PUPPETEER_SKIP_DOWNLOAD=1; npm install   # set PUPPETEER_SKIP_DOWNLOAD=1 && npm install
npm test
```
(`PUPPETEER_SKIP_DOWNLOAD` stops npm from downloading a ~150 MB Chromium the tests don't need.)
Copying `.env.example` to `.env` is **not** required for the tests.

**Passing looks like:** 22 lines starting with `ok 1 - …` … `ok 22 - …` and at the end
```
# tests 22
# pass 22
# fail 0
```
A few `Warning: Cannot polyfill DOMMatrix / Path2D` lines are harmless (an optional pdf.js dependency).

## 3. What is real vs simulated  (say this in the meeting)
- **Demo mode** (`npm run start:demo`): the "AI" is a **canned model response** for the bundled sample PDF — *any* PDF you upload returns the same draft. Published forms and packs are stored in the **browser's localStorage**; there is no server.
- The UI itself is real: PDF rendering, field editing, Form.io builder/preview, validation, publish dialog, pack rules.
- **Backend tests** use a **stubbed model, stubbed SQL and stubbed blob storage**.
- **Nothing has run against Azure OpenAI, the real SQL Server, Azure Blob, or real state PDFs.** There are no real accuracy, cost or speed numbers yet. The only gold form is the fictional sample.
- The FieldWorker customer app (FWApp) Form Packs section is not built; the "Customer view (preview)" tab only shows the intended behaviour.

## 4. Real mode: first run against Azure OpenAI (not needed for the meeting)
In `backend/`: `cp .env.example .env`, fill in `FOUNDRY_API_KEY`, `FOUNDRY_URL` (base ending `/openai/v1`), optionally `FOUNDRY_LLM_MODEL` (your deployment name) and `FW_ENV=dev`, then run in order:
`npm run check:env` → `npm run smoke:model` → `npm run eval:forms` → `npm run e2e:import`.
Success output, the top failure messages and the dev-only `DEV_AUTH_BYPASS` flag are described in `backend/FORM_INGESTION.md` ("First real run"). **These scripts were only exercised against a local mock server, not against Azure.** No script runs the SQL migration; `check:env` prints the exact command and target database for you to confirm.

### Other real-mode settings
See `frontend/.env.example` / `backend/.env.example` (placeholders; values marked DEMO vs REAL) and `backend/FORM_INGESTION.md` (SQL migration `backend/db/mssql/002_form_packs.sql`, endpoints, config). Needs the dev Azure key, database and blob container.

## 5. Troubleshooting
| Symptom | Fix |
|---|---|
| `Error: error:0308010C:digital envelope routines::unsupported` / `ERR_OSSL_EVP_UNSUPPORTED` | Use `npm run start:demo` (passes the legacy-OpenSSL flag). If you still see it: Mac/Linux `export NODE_OPTIONS=--openssl-legacy-provider`, Windows cmd `set NODE_OPTIONS=--openssl-legacy-provider`, PowerShell `$env:NODE_OPTIONS="--openssl-legacy-provider"`, then retry — or switch to Node 22. |
| `JavaScript heap out of memory` while compiling | Run `npm run start:demo` / `npm run build:demo` (they raise the heap to 4 GB); don't use plain `npm start`. |
| `npm install` fails with `ERESOLVE` / peer dependency conflict | Use `npm install --legacy-peer-deps` (exactly as above). |
| Backend `npm install` hangs on "puppeteer" | Set `PUPPETEER_SKIP_DOWNLOAD=1` first (see §2). |
| PDF pane shows "This PDF could not be displayed" or stays grey | The pdf.js worker didn't load. Check `npm ls pdfjs-dist` shows **2.16.105** (reinstall with `npm install --legacy-peer-deps`); hard-refresh (Ctrl/Cmd+Shift+R). If it still fails, the PDF can't be shown but the Fields/Builder/Preview tabs still work. |
| `Something is already running on port 3000` | Answer `Y` to use another port, or set one: Mac/Linux `PORT=3001 npm run start:demo`; Windows cmd `set PORT=3001 && npm run start:demo`; PowerShell `$env:PORT=3001; npm run start:demo`. Then open that port. |
| Builder/preview look unstyled | You're offline or `cdn.form.io` is blocked. |
| You see the Microsoft sign-in card instead of Import Form | You started with `npm start` instead of `npm run start:demo`. |
| Console shows "Can't perform a React state update on an unmounted component" | Known, harmless dev-mode warning. |
| `npm test`: "Cannot find module" for something | You're in the wrong folder (must be `AIForms/backend`) or `npm install` didn't finish. |

## 6. Avoid these live
- Every menu item **other than Import Form and Form Packs** (Billing, Dashboards, …) calls real Azure services and will error in demo mode. Don't click them; the DEV/TEST/PROD switch does nothing useful here either.
- In the Publish dialog, **Form type** and **Company type** open dropdown lists; click an empty part of the dialog title to close one before filling the next field.
- Builder tab takes a couple of seconds the first time. Don't resize the window while the PDF is rendering.
- Don't claim the AI result is from a live model — it's simulated in this mode.
