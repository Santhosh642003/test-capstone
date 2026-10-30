# AI Form Ingestion & Community Form Packs (NJIT Capstone 2026, Project 2)

- `frontend/` — MIS front end: Import Form (PDF → Form.io draft review/publish) and Form Packs. Demo mode needs no backend or login. See `frontend/DEMO.md`, plan in `frontend/AI_PLAN.md`.
- `backend/` — FWAPI additions: ingestion pipeline, import/pack endpoints, SQL migration, prompt doc, eval harness, tests. See `backend/FORM_INGESTION.md`.
- `RUN_LOCAL.md` — how to run everything locally (Node 22), troubleshooting, and what is real vs simulated.

Status: the demo UI and the backend (tested with stubbed model/SQL/blob and a local mock server) are built. Nothing has been run yet against the real Azure OpenAI deployment, the real database or real state PDFs.

No secrets are committed; copy `.env.example` to `.env` in each folder and fill in your own values.
