const { FOUNDRY_API_KEY } = require('../config.js');
const {
    RATE_LIMIT_STATUSES,
    FoundryRateLimitError,
    retryAfterFromHeaders,
    runFoundryRequest,
    sendRateLimitResponse,
} = require('./foundryRateLimit');
const db = require('../models/indexSQL.js');
const { DBInsertAndReturnParam, DBSendResponseParam } = require('../queries/commonQueries');

const ALLOWED_DOCUMENT_TYPES = new Set(['SDR', 'NJISP']);
const ALLOWED_STATUSES = new Set(['success', 'rejected', 'failed']);
const DEFAULT_RECENT_LIMIT = 5;
const MAX_RECENT_LIMIT = 50;

const MODEL_NAME = 'gpt-4.1';
const SYSTEM_PROMPT = 'You are a careful structured-data extraction agent. You must extract only information grounded in the provided PDF. Do not invent fields, values, section names, or summaries. Return valid JSON only.';
const LLM_BASE_URL = 'https://fwfoundry.openai.azure.com/openai/v1';
const LLM_API_KEY = FOUNDRY_API_KEY;

const parseJsonFromLlmContent = (content) => {
    const rawContent = Array.isArray(content)
        ? content
            .map((part) => (typeof part === 'string' ? part : part?.text || ''))
            .join('\n')
        : String(content || '');

    const normalized = rawContent
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

    return JSON.parse(normalized);
};

exports.postSdrUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No document received' });
        }

        if (!LLM_API_KEY) {
            return res.status(500).json({
                message: 'API key is not configured'
            });
        }

        const filename = req.file.originalname || 'unknown.pdf';
        const base64Pdf = `data:${req.file.mimetype || 'application/pdf'};base64,${req.file.buffer.toString('base64')}`;

        if (!base64Pdf) {
            return res.status(500).json({
                message: 'Error reading file data',
                error: 'FILE_DATA_MISSING'
            });
        }

        const prompt = (() => {/*
# SDR / NJISP PDF Extraction Prompt

You will process one PDF. The only acceptable document types are:

- "SDR" — Service Detail Report issued by the New Jersey Division of Developmental Disabilities. Strong signals: sections like "Service Authorizations", "Prior Authorization and Distribution", "Support Coordination Company", DDD identifiers, procedure codes/tiers, distribution rows.
- "NJISP" — New Jersey Individualized Service Plan, also issued by the New Jersey Division of Developmental Disabilities (referenced as "NJ ISP" or "Individualized Service Plan"). Strong signals: outcome statements, person-centered planning language, ISP cover sheet, plan signature pages.
- "OTHER" — anything else (any non-NJISP / non-SDR document, including unrelated PDFs, scans, forms, invoices, blank pages, etc.).

## Step 1 — Classify

Determine the document_type strictly from the PDF content. Use exactly one of: "NJISP", "SDR", "OTHER".
If you are not confident the document is NJISP or SDR, classify it as "OTHER". Do not guess.

## Step 2 — Output

- If document_type is "OTHER": return ONLY this JSON and nothing else:
  {
    "document_type": "OTHER",
    "rejection_reason": "<one short sentence describing what the document appears to be>"
  }
  Do not include any other keys. Do not attempt extraction.

- If document_type is "SDR" or "NJISP": return the full schema below with `document_type` set to the detected value ("SDR" or "NJISP") and extract every applicable field from the PDF. Leave any field that is not present in the PDF as `""` or `[]`.

The PDF is the source of truth. Read both text and layout. Do not use outside knowledge.

Your job is strict extraction, not summarization.
Do not invent values.
Do not move content across sections unless clearly indicated in the PDF.

If a field is missing, leave it as `""` or `[]` according to the schema.

---

## Schema
{
    "document_type": "",
    "plan_id": "",
    "customer_information": {
        "first_name": "",
        "last_name": "",
        "customer_id": "",
        "date_of_birth": "",
        "age": "",
        "gender": "",
        "county": "",
        "program": "",
        "medicaid_id": "",
        "medicaid_type": "",
        "ddd_status": "",
        "waiver_enrollment_date": "",
    	"contact_details": {
    	    "address": "",
    	    "home_phone": "",
    	    "work_phone": "",
    	    "cell_phone": "",
    	    "email": ""
    	}
    },
    "guardianship_contacts": [
        {
            "name": "", 
            "relationship": "", 
            "contact_details": {
                "address": "",
                "home_phone": "",
                "work_phone": "",
                "cell_phone": "",
                "email": ""
            }
        }
    ],
    "emergency_contacts": [
        {
            "priority": "", 
            "name": "", 
            "relationship": "", 
            "contact_details": {
                "primary_phone": "",
                "secondary_phone": ""
            }
        }
    ],
    "medical_practitioners": [
        {"name": "", "specialty": "", "phone_number": "", "notes": ""}
    ],
    "preferred_hospital": {
        "name": "", 
        "contact_details": {"address": "", "phone_number": ""}, 
        "notes": ""
    },
    "primary_care_physician": {
        "name": "", 
        "contact_details": {"address": "", "phone_number": ""}, 
        "notes": ""
    },
    "administrative_service_organization": {
        "name": "", 
        "cm_name": "", 
        "id_group": "", 
        "contact_details": {"cell_phone": "", "email": ""}
    },
    "managed_care_organization": {
        "name": "", 
        "cm_name": "", 
        "id_group": "", 
        "contact_details": {"cell_phone": "", "email": ""}
    },
    "private_insurance": {
        "name": "", 
        "cm_name": "", 
        "id_group": "", 
        "contact_details": {"cell_phone": "", "email": ""}
    },
    "diagnosis_information": {
        "diagnoses": [
            {
                "diagnosis_type": "",
                "icd_code": "",
                "description": ""
            }
        ]
    },
    "support_coordination_company": {
        "company_name": "",
        "company_phone": "",
        "company_email": "", 
        "sc_name": "",
        "sc_email": "",
        "scs_name": "",
        "scs_email": ""
    },
    "provider_information": {
        "provider_name": "",
        "billing_npi": "",
        "provider_phone": "",
        "provider_fax": "",
        "provider_email": "",
        "provider_address": ""
    },
    "service_authorizations": [
        {
            "service_name": "",
            "procedure_code": "",
            "procedure_tier": "",
            "reference": "",
            "start_date": "",
            "end_date": "",
            "total_units": "",
            "total_cost": "",
            "rate": "",
            "unit_type": "",
            "frequency": "",
            "service_location": "",
            "provider_name": "",
            "service_description": "",
            "claims_information": "",
            "associated_goals": [
                {"outcome_number": "", "outcome_description": ""}
            ]
        }
    ],
    "prior_authorization_and_distribution": [
        {
            "ddd_id": "", 
            "member_medicaid_id": "",
            "provider_medicaid_id": "",
            "prior_authorization_number": "",
            "pa_start_date": "",
            "pa_end_date": "",
            "approved_units_till_date": "",
            "procedure_code": "",
            "distribution_standard": "",
            "distribution": [
                {
                    "row_number": "",
                    "start_date": "",
                    "end_date": "",
                    "authorized_units": "",
                    "authorized_hours": ""
                }
            ]
        }
    ],
    "rate_change": [
        {
            "description": "",
            "outcome_number": "",
            "service_number": "",
            "procedure_code": "",
            "old_rate": "",
            "old_rate_effective_date": "",
            "new_rate": "",
            "new_rate_effective_date": ""
        }
    ],
    "medication_info": [
        {
            "order": "", 
            "medication_name": "", 
            "dosage_info": "", 
            "frequency_info": "", 
            "medication_notes": "", 
            "self_medication": ""
        }
    ],
    "customer_goals": [
        {"outcome_number": "", "outcome_description": ""}
    ],
    "customer_needs": {
        "health_needs": {
            "allergies": {
                "summary": "",
                "subcategories": [
                    {"subcategory_name": "", "need_description": ""}
                ]
            },
            "dietary": {
                "summary": "",
                "subcategories": [
                    {"subcategory_name": "", "need_description": ""}
                ]
            },
            "health_hazards": {
                "summary": "",
                "subcategories": [
                    {"subcategory_name": "", "need_description": ""}
                ]
            },
            "self_care": {
                "summary": "",
                "subcategories": [
                    {"subcategory_name": "", "need_description": ""}
                ]
            }
        },
        "support_needs": {
            "behavior": {
                "summary": "",
                "subcategories": [
                    {"subcategory_name": "", "need_description": ""}
                ]
            },
            "mobility": {
                "summary": "",
                "subcategories": [
                    {"subcategory_name": "", "need_description": ""}
                ]
            },
            "religious_cultural": {
                "summary": "",
                "subcategories": [
                    {"subcategory_name": "", "need_description": ""}
                ]
            },
            "support_settings": {
                "summary": "",
                "subcategories": [
                    {"subcategory_name": "", "need_description": ""}
                ]
            }
        }
    },
    "employment_and_voting": {
        "employment_status": "",
        "employment_history_or_context": "",
        "employment_plan": "",
        "voting_plan": ""
    },
    "team_members_present": [
        {
            "name": "",
            "relationship_or_agency": "",
            "primary_contact": ""
        }
    ],
    "authorizations_and_signatures": {
        "attestation_text": "",
        "support_coordinator_review_note": "",
        "participant": {
            "name": "",
            "signature_present": false,
            "date": ""
        },
        "guardian_legal_representative": {
            "name": "",
            "signature_present": false,
            "date": ""
        }
    }
}

---

## Extraction Rules — service_authorizations / customer_goals / associated_goals

NJISP plans group services under outcomes. The plan prints an `Outcome <N>` heading, the
outcome statement itself (a sentence such as "Christopher will work on participation and
employment skills."), and then one or more `Service <M> : <Service Name>` blocks that belong
to that outcome. A plan can hold any number of outcomes, and each outcome can hold any
number of services.

- The `Outcome <N>` heading is sticky. It applies to every service block that follows it
  until the next `Outcome <N>` heading appears. The heading is printed only once, so
  services that continue onto later pages still belong to the last outcome printed — do not
  leave their `associated_goals` empty just because the page they sit on does not repeat the
  heading.
- The service counter restarts at `Service 1` under each new outcome. A reset back to
  `Service 1` means a new outcome started; a counter that keeps climbing means the same
  outcome continues. Use this to resolve outcomes whose heading is faint, split across a
  page break, or otherwise hard to read.
- Emit one `service_authorizations` entry per printed `Service <M>` block, in printed order,
  flattened across all outcomes — the array is not nested by outcome, the outcome is carried
  on each entry instead.
- `associated_goals` on each service holds the outcome that service sits under: normally
  exactly one entry. Add more entries only when the PDF explicitly lists a service under more
  than one outcome. It is `[]` only when the document prints no outcome for that service at
  all (typical for SDRs, which list authorizations without outcomes).
- `outcome_number` is the bare number exactly as printed — `"1"`, `"2"` — with no `Outcome`
  prefix, no `#`, and no service number appended.
- `service_description` is the free-text note the plan prints inside the service block with
  no field label of its own, after the labeled lines (`Total Cost` is normally the last
  labeled one) and before the next `Service <M>` or `Outcome <N>` heading. It is the only
  unlabeled text in the block.
  - Copy it verbatim. Do not summarize, rephrase, or expand abbreviations.
  - When more than one unlabeled line follows — for instance an `EVV Description:` line and
    the bulleted `• EVV Status: ...` lines beneath it — keep all of them, in printed order,
    joined with newlines, as one `service_description` value.
  - Never put a labeled value in it. `Provider :`, `Location :`, `Reference :`, `Claims :`,
    `Procedure :`, and `Code :` each have their own field and must not be repeated here.
  - Never put the outcome statement in it — that belongs to `outcome_description`.
  - Leave it `""` when the service block prints no unlabeled text. Page headers and footers
    (the `Note: Information reflected as of...` line, the page number, `Plan ID`, `Print
    Date`) are not part of any service block — never treat them as a description.
- `outcome_description` is the outcome statement copied verbatim from the PDF. Do not
  summarize it, do not substitute the service name, and do not use the service description or
  the provider label in its place.
- `customer_goals` is the list of every distinct outcome in the plan, in printed order, one
  entry per outcome — not one per service. Every `outcome_number` used in any service's
  `associated_goals` must appear in `customer_goals`, and the same number must carry the same
  `outcome_description` in both places, character for character. These two lists are joined
  on `outcome_number` downstream, so a mismatch drops the link.

Worked example — a plan printing `Outcome 1` with `Service 1`/`Service 2`, then `Outcome 2`
with `Service 1` through `Service 4`, yields six `service_authorizations` entries: the first
two carry `associated_goals` of outcome `"1"`, the remaining four carry outcome `"2"`, and
`customer_goals` holds two entries.

---

## Extraction Rules — customer_needs

`customer_needs` has a fixed set of eight categories. Four under `health_needs`
(`allergies`, `dietary`, `health_hazards`, `self_care`) and four under `support_needs`
(`behavior`, `mobility`, `religious_cultural`, `support_settings`).

- Always return all eight category keys, even when the PDF has nothing for them. An empty
  category is `{"summary": "", "subcategories": []}`. Never add, rename, drop, or reorder these keys.
- NJISP documents print these categories as headings, typically under a "Health & Nutrition
  Needs" section and a "Safety and Support Needs" section, with each need listed under a
  bolded subcategory label. When the PDF prints such a heading, route by that heading —
  it always wins over the content descriptions below, which exist only for documents that
  do not print these headings. Heading-to-key mapping:
  - "Allergies" → `allergies`, "Dietary" → `dietary`, "Health Hazards" → `health_hazards`,
    "Self-Care" → `self_care`
  - "Behavior" → `behavior`, "Communication" → `behavior` (communication needs are stored
    alongside behavioral needs), "Mobility" → `mobility`,
    "Religious/Cultural" → `religious_cultural`, "Support Settings" → `support_settings`
- Route each need the PDF describes into exactly one category. Do not duplicate the same
  need across categories.
  - `allergies` — food, medication, environmental, insect, or other allergies and allergic reactions.
  - `dietary` — diet orders, food textures, liquid consistency, feeding/eating supports, nutrition plans, food restrictions.
  - `health_hazards` — health/medical risks such as choking, aspiration, seizures, falls, elopement, pica, self-injury, water or heat/cold safety.
  - `self_care` — activities of daily living: bathing, dressing, grooming, toileting, hygiene, medication self-administration.
  - `behavior` — behavioral supports, behavior plans, communication supports, crisis or de-escalation needs.
  - `mobility` — ambulation, transfers, wheelchair/walker or other mobility equipment, positioning.
  - `religious_cultural` — religious practices, cultural preferences, language preferences.
  - `support_settings` — the settings and staffing arrangements in which supports are delivered (supervision level, staffing ratio, residential/day setting requirements).
- `subcategory_name` is the label printed in the PDF, copied verbatim (for example
  "Food Allergies", "Choking Risk", "Bathing"). Do not normalize it to a preset list and do
  not invent a label. If the PDF states a need with no label of its own, leave
  `subcategory_name` as `""` and put the text in `need_description`.
- Emit one entry per printed subcategory label, not one per bullet. When a label has several
  bullets beneath it, keep the label once and join the bullets into a single
  `need_description` separated by newlines, in the order printed. A label such as "Other"
  may appear under more than one category — that is expected; keep it under each.
- `need_description` is the PDF's own wording for that need. Do not summarize or rephrase.
- `summary` holds only category-level text the PDF states about the category as a whole
  (for example an "Allergies: NKA" line or an introductory sentence for the section). If
  there is no such text, leave it `""` — do not synthesize it from the subcategories.
- If the PDF has a need that fits none of the eight categories, omit it rather than forcing
  it into an unrelated category.

---

## Extraction Rules — support_coordination_company / provider_information

NJISP and SDR cover pages print a "Support Coordination" block (SDR may label it
"Support Coordination Company"). Read that block top-to-bottom and map every printed line —
these fields are used to verify document ownership, so a blank here is a failure, not a
neutral default.

- `company_name` — the agency name printed on the first line directly beneath the
  "Support Coordination" heading, above the `P :` phone line. Copy it verbatim exactly as
  printed, including underscores, digits, misspellings, and unusual casing. A value that
  looks like an internal identifier rather than a conventional business name (for example
  `Agency_Name_No_Time` or `SC Co 02`) is still the company name — extract it as-is. Only leave
  it `""` when no line at all is printed there. Never substitute the coordinator's name, an
  email domain, or a label for it.

`provider_information.provider_name` (primarily SDR) follows the same rule: copy the
provider/agency name exactly as printed, including punctuation and identifier-like names.

---

## Final Output

- Return ONLY valid JSON
- No explanations
- No markdown in output
- Do not add or rename keys (except: when document_type is "OTHER", return only `document_type` and `rejection_reason`)
- Do not merge sections
- `document_type` must be exactly one of: "NJISP", "SDR", "OTHER"
*/}).toString().split('/*')[1].split('*/')[0];

        // maxAttempts is 2 rather than the default 3: this runs inside an HTTP
        // request the browser is holding open, and extraction of a long document
        // already takes 60-90s. One retry costs at most another 30s and stays
        // clear of the 230s App Service request ceiling.
        const data = await runFoundryRequest(async () => {
            const response = await fetch(`${LLM_BASE_URL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${LLM_API_KEY}`
                },
                body: JSON.stringify({
                    model: MODEL_NAME,
                    temperature: 0,
                    messages: [
                        {
                            role: 'system',
                            content: SYSTEM_PROMPT
                        },
                        {
                            role: 'user',
                            content: [
                                {
                                    type: 'text',
                                    text: prompt
                                },
                                {
                                    type: 'file',
                                    file: {
                                        filename,
                                        file_data: base64Pdf
                                    }
                                }
                            ]
                        }
                    ]
                })
            });

            if (RATE_LIMIT_STATUSES.has(response.status)) {
                throw new FoundryRateLimitError(response.status, retryAfterFromHeaders(response.headers));
            }

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`LLM API returned ${response.status}: ${errText}`);
            }

            return response.json();
        }, { label: 'sdr-extraction', maxAttempts: 2 });

        const outputContent = data.choices?.[0]?.message?.content;
        if (!outputContent) {
            throw new Error('Invalid or empty response from LLM.');
        }

        const outputJson = parseJsonFromLlmContent(outputContent);

        const ACCEPTED_DOC_TYPES = new Set(['NJISP', 'SDR']);
        const detectedType = String(outputJson?.document_type || '').toUpperCase().trim();
        const isValidDocument = ACCEPTED_DOC_TYPES.has(detectedType);

        if (!isValidDocument) {
            return res.status(200).json({
                message: `Processed file: ${filename}`,
                uploadDetails: outputJson,
                isValidDocument: false,
                rejectionReason:
                    outputJson?.rejection_reason ||
                    'Document does not appear to be an NJISP or Service Detail Report (SDR).'
            });
        }

        return res.status(200).json({
            message: `Processed file: ${filename}`,
            uploadDetails: outputJson,
            isValidDocument: true
        });
    } catch (error) {
        // The client reads `message`; `error` is kept alongside it because the
        // original shape only ever sent `error`, which the upload form does not
        // read -- which is why every failure here surfaced as the generic
        // "Failed to upload document. Please try again."
        if (error instanceof FoundryRateLimitError) {
            console.error('LLM rate limited:', error.message);
            return sendRateLimitResponse(res, error, 'The document service is busy right now. Please try again in a minute.');
        }

        console.error('LLM API error:', error);
        const message = `System error: ${error.message}`;
        return res.status(500).json({ message, error: message });
    }
};

exports.postServicePlanUpload = async (req, res) => {
    try {
        const { com_id, uploaded_by, filename, document_type, payload, status, execution_results } = req.body || {};

        if (!com_id || !uploaded_by || !document_type || !payload || !status) {
            return res.status(400).json({
                code: 400,
                message: 'com_id, uploaded_by, document_type, payload, and status are required',
            });
        }
        if (!ALLOWED_DOCUMENT_TYPES.has(String(document_type).toUpperCase())) {
            return res.status(400).json({ code: 400, message: 'document_type must be SDR or NJISP' });
        }
        if (!ALLOWED_STATUSES.has(String(status).toLowerCase())) {
            return res.status(400).json({ code: 400, message: 'status must be success, rejected, or failed' });
        }

        const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
        const executionResultsString = execution_results == null
            ? null
            : (typeof execution_results === 'string' ? execution_results : JSON.stringify(execution_results));

        const result = await DBInsertAndReturnParam(
            `INSERT INTO service_plan_upload (com_id, uploaded_by, uploaded_on, filename, document_type, payload, status, execution_results)
                VALUES (@com_id, @uploaded_by, GETDATE(), @filename, @document_type, @payload, @status, @execution_results);
            SELECT SCOPE_IDENTITY()`,
            {
                com_id: { type: db.Int, value: Number(com_id) },
                uploaded_by: { type: db.Int, value: Number(uploaded_by) },
                filename: { type: db.VarChar(255), value: filename || null },
                document_type: { type: db.VarChar(20), value: String(document_type).toUpperCase() },
                payload: { type: db.NVarChar(db.MAX), value: payloadString },
                status: { type: db.VarChar(20), value: String(status).toLowerCase() },
                execution_results: { type: db.NVarChar(db.MAX), value: executionResultsString },
            }
        );

        if (result.code !== 200) {
            return res.status(500).json(result);
        }
        return res.status(200).json({ code: 200, service_plan_upload_id: result.id });
    } catch (error) {
        console.error('postServicePlanUpload error:', error);
        return res.status(500).json({ code: 500, message: `System error: ${error.message}` });
    }
};

exports.getServicePlanUploads = async (req, res) => {
    try {
        const comId = Number(req.query.com_id);
        if (!comId) {
            return res.status(400).json({ code: 400, message: 'com_id query param is required' });
        }
        const requestedLimit = Number(req.query.limit) || DEFAULT_RECENT_LIMIT;
        const limit = Math.min(Math.max(1, requestedLimit), MAX_RECENT_LIMIT);

        const rows = await DBSendResponseParam(
            `SELECT TOP (@limit)
                    spu.service_plan_upload_id,
                    spu.com_id,
                    spu.uploaded_by,
                    LTRIM(RTRIM(ISNULL(e.emp_first_name, '') + ' ' + ISNULL(e.emp_last_name, ''))) AS uploaded_by_name,
                    spu.uploaded_on,
                    spu.filename,
                    spu.document_type,
                    spu.status,
                    spu.execution_results
                FROM service_plan_upload spu
                JOIN employee e ON e.emp_id = spu.uploaded_by
            WHERE spu.com_id = @com_id
            ORDER BY spu.uploaded_on DESC`,
            {
                com_id: { type: db.Int, value: comId },
                limit: { type: db.Int, value: limit },
            }
        );

        return res.status(200).json(rows);
    } catch (error) {
        console.error('getServicePlanUploads error:', error);
        return res.status(500).json({ code: 500, message: `System error: ${error.message}` });
    }
};
