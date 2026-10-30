/**
 * casenote_guidance.js
 *
 * Evaluates a DSP's case note text against the 5 HCBS Service Strategies
 * and key person-centered indicators (mood, mobility, behavioral triggers).
 *
 * IMPORTANT: This module NEVER rewrites or alters the DSP's text.
 * It returns structured completeness feedback only.
 */

const axios = require('axios');
const config = require('../config');
const {
  RATE_LIMIT_STATUSES,
  FoundryRateLimitError,
  retryAfterFromHeaders,
  runFoundryRequest,
  sendRateLimitResponse,
} = require('./foundryRateLimit');
const { getCurrentRequestLogger } = require('../loggerContext');
const { defaultLogger: logger } = require('../logger');

const CHAT_MODEL_NAME = config.FOUNDRY_LLM_MODEL || process.env.FOUNDRY_LLM_MODEL || 'gpt-4.1';
const DEFAULT_TEMPERATURE = 0.1;

const GUIDANCE_SYSTEM_PROMPT = `You are an expert HCBS (Home and Community-Based Services) Clinical Compliance Assistant for Direct Support Professionals (DSPs) working with clients who have I/DD or dementia.

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
}`;

/**
 * Calls the Foundry LLM chat completions endpoint.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @returns {Promise<{role: string, content?: string}>}
 */
async function callLLM(messages) {
  const log = getCurrentRequestLogger();
  const startTime = performance.now();

  try {
    const response = await runFoundryRequest(async () => {
      try {
        return await axios.post(
          `${config.FOUNDRY_URL}/chat/completions`,
          { model: CHAT_MODEL_NAME, messages, temperature: DEFAULT_TEMPERATURE },
          { headers: { Authorization: `Bearer ${config.FOUNDRY_API_KEY}` } },
        );
      } catch (err) {
        if (RATE_LIMIT_STATUSES.has(err.response?.status)) {
          throw new FoundryRateLimitError(err.response.status, retryAfterFromHeaders(err.response.headers));
        }
        throw err;
      }
    }, { label: 'casenote-guidance' });
    const latencyMs = Math.round(performance.now() - startTime);
    const choice = response.data?.choices?.[0]?.message;
    const usage = response.data?.usage || null;

    log.info(
      {
        inference: {
          model: response.data?.model || CHAT_MODEL_NAME,
          latency_ms: latencyMs,
          prompt_tokens: usage?.prompt_tokens ?? null,
          completion_tokens: usage?.completion_tokens ?? null,
        },
      },
      'casenote_guidance: LLM inference complete',
    );

    return choice;
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startTime);
    log.error({ err: err.message, latency_ms: latencyMs }, 'casenote_guidance: LLM call failed');
    throw err;
  }
}

/**
 * Parses JSON output from model responses, with fallback regex extraction.
 * Mirrors the pattern used in caseSummaryTasks.js.
 */
function parseJsonOutput(text) {
  const log = getCurrentRequestLogger();
  const cleaned = (text || '').replace(/```(?:json)?\s*/g, '').replace(/```\s*$/g, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch (_err) {
    log.warn('casenote_guidance parseJsonOutput: Direct JSON parse failed, trying regex extraction');
  }

  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch (_err) {
      log.error('casenote_guidance parseJsonOutput: Regex extraction also failed');
    }
  }

  return null;
}

/**
 * Validates the shape of the parsed guidance response to ensure it contains
 * the expected fields. Returns the object if valid, null otherwise.
 */
function validateGuidanceResponse(parsed) {
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.completeness_score !== 'number') return null;
  if (!Array.isArray(parsed.strategies) || parsed.strategies.length !== 5) return null;
  if (!parsed.person_centered_indicators || typeof parsed.person_centered_indicators !== 'object') return null;
  if (!Array.isArray(parsed.guidance_tips)) return null;
  return parsed;
}

/**
 * Extracts plain text from Draft.js JSON content.
 * If the input is not valid Draft.js JSON, returns the raw string.
 */
function extractPlainText(noteText) {
  if (!noteText || typeof noteText !== 'string') return '';

  try {
    const parsed = JSON.parse(noteText);
    if (parsed.blocks && Array.isArray(parsed.blocks)) {
      return parsed.blocks.map((block) => block.text || '').join('\n');
    }
  } catch (_err) {
    // Not JSON, treat as plain text
  }

  return noteText;
}

/**
 * Evaluates a case note's text against the 5 HCBS Service Strategies
 * and person-centered indicators. Returns structured guidance JSON.
 *
 * @param {string} noteText - The raw note text (may be Draft.js JSON or plain text).
 * @returns {Promise<object>} The structured guidance response.
 */
async function evaluateNote(noteText) {
  const log = getCurrentRequestLogger();
  const plainText = extractPlainText(noteText);

  if (!plainText || plainText.trim().length === 0) {
    log.warn('casenote_guidance evaluateNote: Empty note text received');
    return {
      completeness_score: 0,
      strategies: [
        { id: 1, name: 'Daily Living & Personal Care Support', status: 'Missing', evidence: 'No text provided.' },
        { id: 2, name: 'Mobility, Physical Health & Safety', status: 'Missing', evidence: 'No text provided.' },
        { id: 3, name: 'Behavioral Support & De-escalation', status: 'Missing', evidence: 'No text provided.' },
        { id: 4, name: 'Social Community Integration & Skill Building', status: 'Missing', evidence: 'No text provided.' },
        { id: 5, name: 'Person-Centered ISP Outcome & Client Choice', status: 'Missing', evidence: 'No text provided.' },
      ],
      person_centered_indicators: {
        mood: { status: 'Missing', value: null },
        mobility: { status: 'Missing', value: null },
        behavioral_triggers: { status: 'Missing', value: null },
      },
      guidance_tips: ['The note is empty. Please describe the support provided during this session.'],
    };
  }

  log.info({ textLength: plainText.length }, 'casenote_guidance evaluateNote: Evaluating note');

  const messages = [
    { role: 'system', content: GUIDANCE_SYSTEM_PROMPT },
    { role: 'user', content: `Evaluate the following DSP case note:\n\n${plainText}` },
  ];

  const response = await callLLM(messages);
  const parsed = parseJsonOutput(response?.content);
  const validated = validateGuidanceResponse(parsed);

  if (!validated) {
    log.error({ rawContent: response?.content }, 'casenote_guidance evaluateNote: Failed to parse valid guidance from LLM');
    throw new Error('Failed to generate guidance evaluation. Please try again.');
  }

  return validated;
}

// ── Express route handler ──────────────────────────────────────────────────────

/**
 * POST /api/fieldworker/comment/guidance
 * Body: { note_text: string }
 * Returns: structured guidance JSON
 */
exports.getGuidance = async function (req, res) {
  const log = getCurrentRequestLogger();
  const { note_text } = req.body;

  if (!note_text || typeof note_text !== 'string' || !note_text.trim()) {
    return res.status(400).json({ message: 'note_text is required' });
  }

  try {
    const guidance = await evaluateNote(note_text);
    log.info({ completeness_score: guidance.completeness_score }, 'casenote_guidance: Guidance generated successfully');
    return res.json(guidance);
  } catch (err) {
    if (err instanceof FoundryRateLimitError) {
      log.warn({ retryAfterSeconds: err.retryAfterSeconds }, 'casenote_guidance: Foundry rate limited the request');
      return sendRateLimitResponse(res, err);
    }

    log.error({ err: err.message }, 'casenote_guidance: Error generating guidance');
    return res.status(500).json({ message: err.message || 'Failed to generate guidance' });
  }
};
