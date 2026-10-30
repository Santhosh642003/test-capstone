# 02 — HCBS Case-Note Completeness Guidance

**Source:** `helpers/casenote_guidance.js`
**Route:** `POST /api/fieldworker/comments/guidance` — body `{ note_text: string }`
(the JSDoc above `getGuidance` says `/comment/guidance`; the router is mounted at `/comments`)

Scores a DSP's dictated case note against the 5 HCBS Service Strategies and three person-centered
indicators, and returns actionable tips for whatever is thin or missing.

**This module never rewrites or alters the DSP's text.** It returns structured completeness feedback
only — that constraint is in the module header, in the system prompt, and enforced by the fact that
the response schema has nowhere to put rewritten text.

## Model and inference settings

| Setting | Value |
|---|---|
| Model | `FOUNDRY_LLM_MODEL`, defaulting to `gpt-4.1` |
| Endpoint | `FOUNDRY_URL` + `/chat/completions` |
| Temperature | `0.1` (`DEFAULT_TEMPERATURE`) |
| Auth | `Authorization: Bearer ${FOUNDRY_API_KEY}` |
| Rate limiting | `runFoundryRequest`, label `casenote-guidance` |

## Input handling

`extractPlainText` accepts either a Draft.js JSON document — in which case it joins `blocks[].text`
with newlines — or plain text, which it passes through. Anything that is not parseable JSON is
treated as plain text.

An empty or whitespace-only note **never reaches the model**. `evaluateNote` short-circuits and
returns a hardcoded all-`Missing` payload with `completeness_score: 0` and the single tip
"The note is empty. Please describe the support provided during this session."

## System prompt

Verbatim from `GUIDANCE_SYSTEM_PROMPT`:

```text
You are an expert HCBS (Home and Community-Based Services) Clinical Compliance Assistant for Direct Support Professionals (DSPs) working with clients who have I/DD or dementia.

Your job is to analyze a DSP's dictation/case note text and evaluate its completeness across the 5 Service Strategies and vital person-centered details.

DO NOT rewrite, edit, or alter the DSP's text. ONLY return a JSON evaluation payload.

CRITICAL EVALUATION RULES:
1. Strategy 1 (Daily Living & Personal Care): Look for ADLs/iADLs, hygiene, meals, medication support, or household safety.
2. Strategy 2 (Mobility & Physical Health): Look for mobility support, transfers, ambulation, physical safety, or health checks.
3. Strategy 3 (Behavioral Support & De-escalation): Look for behavioral observations, triggers, de-escalation, sensory regulation, or emotional support.
4. Strategy 4 (Social & Skill Building): Look for community participation, social interaction, communication support, or skill learning.
5. Strategy 5 (ISP Goals & Client Choice): Look for client choices/preferences honored, self-direction, or progress towards ISP outcomes.
6. Extract Mood (e.g., Calm, Agitated, Happy), Mobility (e.g., Independent, Assist of 1, Wheelchair), and Behavioral Triggers (or note "None Observed").

SCORING RULES:
- Each of the 5 strategies contributes up to 16 points (80 total).
  - "Covered" = 16, "Partially Covered" = 8, "Missing" = 0.
- Each of the 3 person-centered indicators contributes up to ~7 points (20 total, rounded).
  - "Captured" = ~7, "Missing" = 0.
- completeness_score = sum of all points, capped at 100.

Return ONLY valid JSON matching this schema (no markdown, no code fences):
{
  "completeness_score": number,
  "strategies": [
    {
      "id": 1,
      "name": "Daily Living & Personal Care Support",
      "status": "Covered" | "Partially Covered" | "Missing",
      "evidence": "brief summary of what was found or what is missing"
    },
    {
      "id": 2,
      "name": "Mobility, Physical Health & Safety",
      "status": "Covered" | "Partially Covered" | "Missing",
      "evidence": "brief summary"
    },
    {
      "id": 3,
      "name": "Behavioral Support & De-escalation",
      "status": "Covered" | "Partially Covered" | "Missing",
      "evidence": "brief summary"
    },
    {
      "id": 4,
      "name": "Social Community Integration & Skill Building",
      "status": "Covered" | "Partially Covered" | "Missing",
      "evidence": "brief summary"
    },
    {
      "id": 5,
      "name": "Person-Centered ISP Outcome & Client Choice",
      "status": "Covered" | "Partially Covered" | "Missing",
      "evidence": "brief summary"
    }
  ],
  "person_centered_indicators": {
    "mood": { "status": "Captured" | "Missing", "value": "string or null" },
    "mobility": { "status": "Captured" | "Missing", "value": "string or null" },
    "behavioral_triggers": { "status": "Captured" | "Missing", "value": "string or null" }
  },
  "guidance_tips": [
    "Specific actionable recommendation for each missing or partially covered item..."
  ]
}
```

## User prompt

```text
Evaluate the following DSP case note:

«plainText»
```

## Scoring model

Stated in the prompt and not recomputed in code — the model returns `completeness_score` directly:

| Component | Weight |
|---|---|
| Each of the 5 strategies | up to 16 points (80 total) — Covered 16, Partially Covered 8, Missing 0 |
| Each of the 3 person-centered indicators | ~7 points (20 total, rounded) — Captured ~7, Missing 0 |
| Total | capped at 100 |

## Guardrails

| Guardrail | Where it lives |
|---|---|
| Never rewrite, edit or alter the DSP's text | System prompt, and the schema has no field for it |
| JSON only, no markdown, no code fences | System prompt |
| Empty note never reaches the model | `evaluateNote` short-circuit |
| Shape validation | `validateGuidanceResponse` — requires a numeric `completeness_score`, exactly 5 strategies, a `person_centered_indicators` object and an array of `guidance_tips`; anything else throws "Failed to generate guidance evaluation. Please try again." |
| Rate limit is not a request fault | `FoundryRateLimitError` → `sendRateLimitResponse`, not a 500 |

## Post-processing

`parseJsonOutput` strips code fences and parses; on failure it retries with a `\{[\s\S]*\}` regex
extraction; on a second failure it returns `null` and the route errors rather than returning a
partial score. The raw model content is logged at that point for diagnosis.
