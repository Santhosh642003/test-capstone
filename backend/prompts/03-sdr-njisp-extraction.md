# 03 — SDR / NJISP PDF Classification and Extraction

**Source:** `helpers/sdr.js`
**Routes:** `POST /api/fieldworker/sdr/upload` (multipart, one PDF — the LLM call),
`POST /api/fieldworker/sdr/uploads` (persist a result), `GET /api/fieldworker/sdr/uploads` (read them back)

Classifies an uploaded PDF as `SDR`, `NJISP` or `OTHER`, and for the two accepted types extracts a
structured payload grounded strictly in the document. The PDF is sent to the model directly as a
base64 `file` content part — there is no OCR or text-extraction step in front of it.

## Model and inference settings

| Setting | Value |
|---|---|
| Model | `gpt-4.1` (`MODEL_NAME`, hardcoded — this one does **not** read `FOUNDRY_LLM_MODEL`) |
| Endpoint | `https://fwfoundry.openai.azure.com/openai/v1/chat/completions` (`LLM_BASE_URL`, hardcoded) |
| Temperature | `0` |
| Auth | `Authorization: Bearer ${FOUNDRY_API_KEY}` |
| Transport | `fetch`, not axios |
| Rate limiting | `runFoundryRequest`, label `sdr-extraction`, `maxAttempts: 2` |

`maxAttempts` is 2 rather than the default 3 deliberately: this runs inside an HTTP request the
browser is holding open, and extraction of a long document already takes 60–90s. One retry costs at
most another 30s and stays clear of the 230s App Service request ceiling.

## Message shape

```
system: SYSTEM_PROMPT
user:   [ { type: 'text', text: prompt },
          { type: 'file', file: { filename, file_data: 'data:application/pdf;base64,...' } } ]
```

## System prompt

Verbatim from `SYSTEM_PROMPT`:

```text
You are a careful structured-data extraction agent. You must extract only information grounded in the provided PDF. Do not invent fields, values, section names, or summaries. Return valid JSON only.
```

## User prompt

The extraction spec. It is written in the source as a comment inside an IIFE and recovered with
`(() => {/* ... */}).toString().split('/*')[1].split('*/')[0]` — a way to keep a long multi-line
prompt readable without escaping. Verbatim:

````text
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
````

## Guardrails

| Guardrail | Where it lives |
|---|---|
| Extract only what is grounded in the PDF; invent no fields, values, section names or summaries | System prompt |
| Classify as `OTHER` rather than guess when not confident | User prompt, Step 1 |
| `OTHER` returns only `document_type` + `rejection_reason` and nothing else | User prompt, Step 2 |
| Type allowlist enforced in code, not just asked for | `ACCEPTED_DOC_TYPES` / `ALLOWED_DOCUMENT_TYPES` = `{ SDR, NJISP }`; anything else returns `isValidDocument: false` with the model's `rejection_reason`, or a default message |
| Missing API key fails closed | 500 before any upload is processed |
| Empty model content | Throws `Invalid or empty response from LLM.` |

## Post-processing

`parseJsonFromLlmContent` flattens array-of-parts content, strips a leading ```` ```json ````/```` ``` ````
fence and a trailing fence, then `JSON.parse`. The parsed `document_type` is uppercased and trimmed
before the allowlist check.

`/upload` only extracts and returns; it writes nothing. Persistence is a separate client call to
`POST /uploads` (`postServicePlanUpload`), which validates the status against `ALLOWED_STATUSES` =
`{ success, rejected, failed }` before inserting. `GET /uploads` reads recent extractions back, with
a limit defaulting to `DEFAULT_RECENT_LIMIT` (5) and clamped to `MAX_RECENT_LIMIT` (50).

## When changing this prompt

The user prompt carries the whole output contract — the field list, the per-section schema and the
grounding rules — so a change here is a change to the shape of every stored extraction. Check what
reads the persisted payload before editing the schema section.
