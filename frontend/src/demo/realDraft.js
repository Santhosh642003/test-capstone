// A REAL model response, captured from the Azure OpenAI GPT-4.1 deployment on 2026-10-30 by `npm run smoke:model -- --out`
// (prompt ff-0.1.0, JSON mode, 24 s) for public/demo/sample-isp-intake.pdf, and replayed by the demo. It is not edited:
// the empty labels on the checkbox group and the table are what the model actually returned, and the review screen
// flags them. `fields` is only what the model reported for itself (the table's columns were left out of its field list).
export const REAL_DEFINITION = {
  "display": "form",
  "components": [
    {
      "type": "content",
      "key": "instructions",
      "html": "Instructions: Complete all fields marked with * . Print clearly. Submit to the Support Coordinator within 5 business days of enrollment.",
      "input": false
    },
    {
      "type": "panel",
      "key": "sectionAIndividualInformation",
      "title": "SECTION A - INDIVIDUAL INFORMATION",
      "input": false,
      "components": [
        {
          "type": "textfield",
          "key": "nameOfIndividual",
          "label": "Name of Individual",
          "input": true,
          "validate": {
            "required": true
          }
        },
        {
          "type": "datetime",
          "key": "dateOfBirth",
          "label": "Date of Birth",
          "input": true,
          "enableTime": false,
          "validate": {
            "required": true
          }
        },
        {
          "type": "textfield",
          "key": "medicaidId",
          "label": "Medicaid ID",
          "input": true,
          "validate": {
            "required": true
          }
        },
        {
          "type": "textfield",
          "key": "phoneNumber",
          "label": "Phone Number",
          "input": true
        },
        {
          "type": "textfield",
          "key": "dx",
          "label": "Dx:",
          "input": true
        },
        {
          "type": "radio",
          "key": "livingArrangement",
          "label": "Living Arrangement",
          "input": true,
          "validate": {
            "required": true
          },
          "values": [
            {
              "label": "Family home",
              "value": "familyHome"
            },
            {
              "label": "Supported apartment",
              "value": "supportedApartment"
            },
            {
              "label": "Group home",
              "value": "groupHome"
            }
          ]
        },
        {
          "type": "textfield",
          "key": "county",
          "label": "County",
          "input": true,
          "validate": {
            "required": true
          }
        }
      ]
    },
    {
      "type": "panel",
      "key": "sectionBSupportNeeds",
      "title": "SECTION B - SUPPORT NEEDS (check all that apply)",
      "input": false,
      "components": [
        {
          "type": "selectboxes",
          "key": "supportNeeds",
          "label": "",
          "input": true,
          "values": [
            {
              "label": "Mobility assistance",
              "value": "mobilityAssistance"
            },
            {
              "label": "Communication support",
              "value": "communicationSupport"
            },
            {
              "label": "Medication administration",
              "value": "medicationAdministration"
            },
            {
              "label": "Behavioral support",
              "value": "behavioralSupport"
            },
            {
              "label": "Personal care",
              "value": "personalCare"
            },
            {
              "label": "Transportation",
              "value": "transportation"
            }
          ]
        },
        {
          "type": "textarea",
          "key": "additionalNotesAboutSupportNeeds",
          "label": "Additional notes about support needs",
          "input": true,
          "rows": 3
        }
      ]
    },
    {
      "type": "panel",
      "key": "sectionCCurrentMedications",
      "title": "SECTION C - CURRENT MEDICATIONS",
      "input": false,
      "components": [
        {
          "type": "datagrid",
          "key": "currentMedications",
          "label": "",
          "input": true,
          "components": [
            {
              "type": "textfield",
              "key": "medication",
              "label": "Medication",
              "input": true
            },
            {
              "type": "textfield",
              "key": "dose",
              "label": "Dose",
              "input": true
            },
            {
              "type": "textfield",
              "key": "frequency",
              "label": "Frequency",
              "input": true
            },
            {
              "type": "textfield",
              "key": "prescriber",
              "label": "Prescriber",
              "input": true
            }
          ]
        }
      ]
    },
    {
      "type": "panel",
      "key": "sectionDConsent",
      "title": "SECTION D - CONSENT",
      "input": false,
      "components": [
        {
          "type": "content",
          "key": "consentText",
          "html": "By signing below, I confirm that the information provided is accurate to the best of my knowledge\nand I authorize the release of this information to the individual's support team.",
          "input": false
        },
        {
          "type": "checkbox",
          "key": "agreeToConsent",
          "label": "I agree to the terms of consent above.",
          "input": true,
          "validate": {
            "required": true
          }
        }
      ]
    },
    {
      "type": "panel",
      "key": "sectionESignatures",
      "title": "SECTION E - SIGNATURES",
      "input": false,
      "components": [
        {
          "type": "signature",
          "key": "signatureOfIndividualGuardian",
          "label": "Signature of Individual / Guardian",
          "input": true,
          "validate": {
            "required": true
          }
        },
        {
          "type": "datetime",
          "key": "dateSignedIndividualGuardian",
          "label": "Date Signed",
          "input": true,
          "enableTime": false,
          "validate": {
            "required": true
          }
        },
        {
          "type": "signature",
          "key": "signatureOfSupportCoordinator",
          "label": "Signature of Support Coordinator",
          "input": true,
          "validate": {
            "required": true
          }
        },
        {
          "type": "datetime",
          "key": "dateSignedSupportCoordinator",
          "label": "Date Signed",
          "input": true,
          "enableTime": false,
          "validate": {
            "required": true
          }
        }
      ]
    },
    {
      "type": "content",
      "key": "retentionNote",
      "html": "Note: A copy of this form must be retained in the individual's record for seven (7) years.",
      "input": false
    }
  ]
};

export const REAL_FIELDS = [
  {
    "key": "nameOfIndividual",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "dateOfBirth",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "medicaidId",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "phoneNumber",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "dx",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "livingArrangement",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "county",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "supportNeeds",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "additionalNotesAboutSupportNeeds",
    "sourcePage": 1,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "agreeToConsent",
    "sourcePage": 2,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "signatureOfIndividualGuardian",
    "sourcePage": 2,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "dateSignedIndividualGuardian",
    "sourcePage": 2,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "signatureOfSupportCoordinator",
    "sourcePage": 2,
    "confidence": 0.98,
    "notes": ""
  },
  {
    "key": "dateSignedSupportCoordinator",
    "sourcePage": 2,
    "confidence": 0.98,
    "notes": ""
  }
];

export const REAL_USAGE = {
  "model": "gpt-4.1",
  "promptVersion": "ff-0.1.0",
  "pages": 2,
  "promptTokens": 1351,
  "completionTokens": 1937,
  "seconds": 24,
  "repaired": 0,
  "replayNote": "Replay of a real GPT-4.1 response captured on 2026-10-30 (not a live call)"
};
