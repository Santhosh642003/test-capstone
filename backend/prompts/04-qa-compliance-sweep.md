# 04 — Nightly QA Compliance Sweep (narrative billing verdict)

**Source:** `helpers/qaSweepJob.js`
**Persists to:** `qa_sweep_history` (`db/mssql/001_qa_sweep_history.sql`), read by the Compliance dashboard
**Schedule:** nightly at 03:00 `America/New_York`, after the 2am RAG sync so the two jobs don't
contend for the same SQL Server pool

Combines the deterministic exceptions from `helpers/complianceGaps.js` with an LLM narrative
verdict, and writes the merged result for the dashboard to render.

**The model's only job is the one thing `complianceGaps.js` cannot compute: whether the task
narrative text justifies what was billed.** It never touches unit arithmetic — that is already
decided by `helpers/taskCompliance.js` and handed to it as fact. That division is restated inside
the prompt itself, because it is the whole safety argument for putting a model near billing.

## Current wiring status

`scheduleNightlySweep()` is **commented out in `index.js:91`**, and the sweep is driven manually
from a "Run Sweep Now" button via `POST /api/fieldworker/compliance/run-now`
(`runSweepNowHandler`). Both the handler and the route carry a `TESTING ONLY` comment marking them
for deletion, with the cron to be re-enabled at the same time. `QA_SWEEP_ENABLED` is `true` in the
module, so re-enabling is a one-line uncomment in `index.js`.

## Model and inference settings

Goes through `callChatCompletions` from `helpers/caseSummaryTasks.js`, so it inherits that path's
settings:

| Setting | Value |
|---|---|
| Model | `FOUNDRY_LLM_MODEL`, defaulting to `gpt-4.1` |
| Endpoint | `FOUNDRY_URL` + `/chat/completions` |
| Temperature | `0.1` |
| Rate limiting | `runFoundryRequest`, label `case-summary-chat` |

## What gets an LLM call

`GAP_FILTERS = { includeCompliant: false }` — only claim lines and prior auths carrying at least one
deterministic issue are sent. A clean record has nothing for the model to narrate, so it costs
nothing.

Unlike `ragSync.js` this job keeps no watermark: `complianceGaps` reads SQL Server live, so every
run re-examines every active customer's current exceptions rather than a delta.

## System prompt

Verbatim from `NARRATIVE_SYSTEM_PROMPT`. The literal string is one line; shown here broken at the
`+` concatenation boundaries of the source.

```text
You are a Medicaid billing compliance reviewer. You are given the deterministic facts of one 
billing exception (unit counts, dates, linked task ids) and the narrative text employees wrote 
for the linked visits. Your only job is to judge whether that narrative text explicitly 
justifies the services being billed. Do not recompute units, dates or eligibility -- those are 
already decided and handed to you as fact. Base your answer strictly on the narrative text 
provided; do not invent details. Respond ONLY with valid JSON in this exact format: 
{"justified": true|false, "confidence": "high"|"medium"|"low", "rationale": "1-3 sentence explanation citing the narrative"}
```

## User prompt

Built by `evaluateNarrative`. `facts` is the deterministic exception summary; the narratives are
`elliq.buildTaskMarkdown(taskId)` output for each linked task, joined with `\n\n---\n\n`.

````text
Billing exception facts (already computed, do not recompute):
```json
«JSON.stringify(facts, null, 2)»
```

Narrative text for the linked task(s):

«task markdown, joined with \n\n---\n\n»
````

### The facts handed over, by gap type

**Claim gap:** `claim_id`, `claim_status`, `procedure_code`, `service_start_date`,
`service_end_date`, `units_billed`, `units_delivered`, `unit_of_service`, `issues`

**Prior-auth gap:** `prior_auth_id`, `prior_auth`, `procedure_code`, `auth_start_date`,
`auth_end_date`, `units_approved`, `units_billed`, `units_delivered`, `unit_of_service`, `issues`

## Required output schema

```json
{
  "justified": true,
  "confidence": "high | medium | low",
  "rationale": "1-3 sentence explanation citing the narrative"
}
```

## Guardrails

| Guardrail | Where it lives |
|---|---|
| Do not recompute units, dates or eligibility — they are handed over as fact | System prompt, and structurally: the model is given the computed figures, not the raw rows |
| Answer strictly from the narrative text provided; invent no details | System prompt |
| No linked task → no LLM call | `evaluateNarrative` returns `justified: false, confidence: 'high'` with rationale "No linked task narrative exists to evaluate." |
| Tasks that fail to load → no LLM call | Same, with "Linked tasks could not be loaded." |
| Unparseable model output is preserved, not swallowed | `parseVerdict` returns nulls plus `parse_error` holding the raw content |
| One bad record does not abort the sweep | Per-record `try/catch` increments `stats.recordsFailed` and continues |

## Post-processing

`parseVerdict` strips code fences and parses. `justified` is kept only if it is genuinely a boolean;
anything else becomes `null`, so "the model said something odd" is distinguishable in
`qa_sweep_history` from "the model said no".

Each row written to `qa_sweep_history` carries both halves side by side — `sql_facts` (the
deterministic exception) and `llm_verdict` (the narrative judgement) — so a dashboard reader can
always see which part of a finding came from arithmetic and which came from a model.
