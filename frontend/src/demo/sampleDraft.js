// Simulated model output for public/demo/sample-isp-intake.pdf. Same shape the real
// POST /forms/import job will return: { definition, fields[], usage }.
// confidence/notes/sourcePage are what we ask the model to emit per field.

const tf = (key, label, required = false, extra = {}) => ({ type: 'textfield', key, label, input: true, validate: { required }, ...extra });

export const SAMPLE_DEFINITION = {
  display: 'form',
  components: [
    {
      type: 'content', key: 'instructions', input: false, label: 'Instructions',
      html: '<p><em>Instructions: Complete all fields marked with * . Print clearly. Submit to the Support Coordinator within 5 business days of enrollment.</em></p>',
    },
    {
      type: 'panel', key: 'sectionA', title: 'Section A — Individual Information', input: false,
      components: [
        tf('nameOfIndividual', 'Name of Individual', true),
        { type: 'datetime', key: 'dateOfBirth', label: 'Date of Birth', input: true, enableTime: false, format: 'MM/dd/yyyy', validate: { required: true } },
        tf('medicaidId', 'Medicaid ID', true),
        { type: 'textfield', key: 'phoneNumber', label: 'Phone Number', input: true, inputMask: '(999) 999-9999' },
        tf('dx', 'Dx'),
        {
          type: 'radio', key: 'livingArrangement', label: 'Living Arrangement', input: true, validate: { required: true },
          values: [
            { label: 'Family home', value: 'familyHome' },
            { label: 'Supported apartment', value: 'supportedApartment' },
            { label: 'Group home', value: 'groupHome' },
          ],
        },
        tf('county', 'County', true),
      ],
    },
    {
      type: 'panel', key: 'sectionB', title: 'Section B — Support Needs', input: false,
      components: [
        {
          type: 'selectboxes', key: 'supportNeeds', label: 'Support Needs (check all that apply)', input: true,
          values: [
            { label: 'Mobility assistance', value: 'mobilityAssistance' },
            { label: 'Communication support', value: 'communicationSupport' },
            { label: 'Medication administration', value: 'medicationAdministration' },
            { label: 'Behavioral support', value: 'behavioralSupport' },
            { label: 'Personal care', value: 'personalCare' },
            { label: 'Transportation', value: 'transportation' },
          ],
        },
        { type: 'textarea', key: 'additionalNotesAboutSupportNeeds', label: 'Additional notes about support needs', input: true, rows: 4 },
      ],
    },
    {
      type: 'panel', key: 'sectionC', title: 'Section C — Current Medications', input: false,
      components: [
        {
          type: 'datagrid', key: 'currentMedications', label: 'Current Medications', input: true,
          components: [
            tf('medication', 'Medication'), tf('dose', 'Dose'), tf('frequency', 'Frequency'), tf('prescriber', 'Prescriber'),
          ],
        },
      ],
    },
    {
      type: 'panel', key: 'sectionD', title: 'Section D — Consent', input: false,
      components: [
        {
          type: 'content', key: 'consentText', input: false, label: 'Consent text',
          html: "<p>By signing below, I confirm that the information provided is accurate to the best of my knowledge and I authorize the release of this information to the individual's support team.</p>",
        },
        { type: 'checkbox', key: 'consentAgree', label: 'I agree to the terms of consent above.', input: true, validate: { required: true } },
      ],
    },
    {
      type: 'panel', key: 'sectionE', title: 'Section E — Signatures', input: false,
      components: [
        { type: 'signature', key: 'signatureOfIndividualGuardian', label: 'Signature of Individual / Guardian', input: true, validate: { required: true } },
        { type: 'datetime', key: 'dateSigned', label: 'Date Signed', input: true, enableTime: false, validate: { required: true } },
        { type: 'signature', key: 'signatureOfSupportCoordinator', label: 'Signature of Support Coordinator', input: true, validate: { required: true } },
        { type: 'datetime', key: 'dateSigned2', label: 'Date Signed', input: true, enableTime: false, validate: { required: true } },
        {
          type: 'content', key: 'retentionNote', input: false, label: 'Retention note',
          html: "<p><em>Note: A copy of this form must be retained in the individual's record for seven (7) years.</em></p>",
        },
      ],
    },
  ],
};

// key -> { sourcePage, confidence, notes } as the model would report them.
export const SAMPLE_META = {
  nameOfIndividual: { sourcePage: 1, confidence: 0.98 },
  dateOfBirth: { sourcePage: 1, confidence: 0.97 },
  medicaidId: { sourcePage: 1, confidence: 0.97 },
  phoneNumber: { sourcePage: 1, confidence: 0.93 },
  dx: { sourcePage: 1, confidence: 0.58, notes: 'Abbreviated label "Dx:" — likely "Diagnosis"; confirm wording' },
  livingArrangement: { sourcePage: 1, confidence: 0.95 },
  county: { sourcePage: 1, confidence: 0.96, notes: 'Plain text line; may be intended as a dropdown of NJ counties' },
  supportNeeds: { sourcePage: 1, confidence: 0.62, notes: 'Ambiguous checkbox group — "check all that apply" read as multiple choice (selectboxes)' },
  additionalNotesAboutSupportNeeds: { sourcePage: 1, confidence: 0.9 },
  currentMedications: { sourcePage: 1, confidence: 0.81, notes: 'Table with 4 blank rows read as a repeating datagrid' },
  medication: { sourcePage: 1, confidence: 0.9 },
  dose: { sourcePage: 1, confidence: 0.9 },
  frequency: { sourcePage: 1, confidence: 0.9 },
  prescriber: { sourcePage: 1, confidence: 0.9 },
  consentAgree: { sourcePage: 2, confidence: 0.94 },
  signatureOfIndividualGuardian: { sourcePage: 2, confidence: 0.96 },
  dateSigned: { sourcePage: 2, confidence: 0.95 },
  signatureOfSupportCoordinator: { sourcePage: 2, confidence: 0.96 },
  dateSigned2: { sourcePage: 2, confidence: 0.7, notes: 'Duplicate label "Date Signed" — key de-duplicated automatically' },
};

export const SAMPLE_USAGE = { model: 'gpt-4.1', promptVersion: 'ff-0.1.0', pages: 2, promptTokens: 4210, completionTokens: 1630, seconds: 14.2, repaired: 1 };
