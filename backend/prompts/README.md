# FW — LLM Prompts

Every prompt FWAPI sends to a model, one file per AI project. The point of the folder is that a
prompt change shows up in `git diff` and goes through review like any other behaviour change,
instead of living only in a Word document that drifts.

| # | Project | Document | Source |
|---|---|---|---|
| 01 | Case Summary Chat / AI Companion — tool-calling agent over the RAG store | [`01-case-summary-chat.md`](01-case-summary-chat.md) | `helpers/caseSummaryChat.js`, `helpers/caseSummaryTasks.js` |
| 02 | HCBS case-note completeness scoring | [`02-case-note-guidance.md`](02-case-note-guidance.md) | `helpers/casenote_guidance.js` |
| 03 | SDR / NJISP PDF classification + extraction | [`03-sdr-njisp-extraction.md`](03-sdr-njisp-extraction.md) | `helpers/sdr.js` |
| 04 | Nightly QA compliance sweep — narrative billing verdict | [`04-qa-compliance-sweep.md`](04-qa-compliance-sweep.md) | `helpers/qaSweepJob.js` |
| 05 | PDF form ingestion — PDF → Form.io definition (MIS Import Form) | [`05-form-ingestion.md`](05-form-ingestion.md) | `helpers/formIngestion.js` |

## Rules for this folder

- **One file per project.** A project is one user-facing AI capability, however many prompts it
  takes to deliver it. The chat agent's orchestrator prompt, its inner analyst prompt, its seven
  task prompts and its ten tool descriptions are all one project, because they are one feature and
  they change together.
- **Prompts are copied verbatim.** No paraphrasing, no tidying up. If the source has a typo, the
  document has the same typo — otherwise the document stops being evidence of what the model
  actually receives.
- **Update the document in the same commit as the prompt.** A prompt edit and its document edit
  belong to one change; splitting them is what let the old `.docx` set go stale.
- **Line references are a convenience, not a contract.** They will rot as files move. The prompt
  text itself is the authoritative part of each document.

## Prompt surface, and what counts as one

A prompt is not only the system message. For the tool-calling agent the **tool names, descriptions
and parameter descriptions are prompt too** — the model reads them and routes on them, and a
reworded tool description changes behaviour exactly as a reworded system prompt does. They are
documented as prompts here for that reason.

## Not documented here

- **ElliQ caregiving advisor** (`helpers/elliq.js`) — a Foundry-hosted agent
  (`Your-caregiving-advisor` in project `proj-fieldworker`, endpoint
  `https://fwfoundry.services.ai.azure.com/api/projects/proj-fieldworker`). Its instructions live on
  the agent in the Foundry portal, not in this repo, so there is nothing here for git to track. What
  `elliq.js` does contain is the **markdown builders** (`buildCustomerMarkdown`, `buildProjectMarkdown`,
  `buildTaskMarkdown`, `buildCaseNoteMarkdown`, `buildClaimLineMarkdown`, `buildPriorAuthMarkdown`) —
  the retrieval corpus that projects 01 and 04 read. Those are data shaping, not prompts. If the
  hosted agent's instructions are ever exported, they get a file here.
- **The RAG ingestion pipeline** (`ragEmbeddings.js`, `ragChunking.js`, `ragSync.js`) — it calls a
  Foundry embedding model (`text-embedding-3-small`, 1536 dimensions, batches of 32) and chunks
  markdown at 2000 chars with 200 chars of overlap. No prompt, so nothing to track. It is what
  project 01 retrieves its `{context}` from.
- **`helpers/complianceGaps.js` and `helpers/taskCompliance.js`** — deterministic SQL and unit
  arithmetic. Project 04 hands their output to the model as already-decided fact.

## Shared inference config

Model and endpoint come from `config.js`, not from the prompt files:

| Setting | Source | Value |
|---|---|---|
| `FOUNDRY_LLM_MODEL` | env / `config.js` | defaults to `gpt-4.1` |
| `FOUNDRY_URL` | env / `config.js` | chat completions and embeddings base |
| `FOUNDRY_API_KEY` | env / `config.js` | bearer token on every call |

Every chat call except SDR's goes through `callChatCompletions` in `helpers/caseSummaryTasks.js`,
which wraps `helpers/foundryRateLimit.js` for 429 retry/backoff and logs an inference telemetry
line (model, latency, token counts, the system prompt that was sent).
