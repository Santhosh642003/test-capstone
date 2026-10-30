const { DBinsertSendID, DBSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const moment = require('moment');

// GET /api/fieldworker/ah_sync/status/:customer_id
exports.getSyncStatusHandler = async function (req, res) {
    try {
        const customer_id = parseInt(req.params.customer_id);
        if (isNaN(customer_id)) return res.status(400).json({ message: 'Invalid customer_id' });
        const record = await exports.getSyncStatus(customer_id);
        return res.status(200).json(record || null);
    } catch (err) {
        console.log('QUERY FAILURE | getSyncStatus Query Failed:');
        console.log(err);
        return res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

// Creates (or no-ops if already exists) the sync record when a customer is invited to AH.
exports.createSyncRecord = async function ({ customer_id, ah_patient_id, ah_user_id }) {
    const check = await DBSendResponse(`SELECT sync_id FROM customer_ah_sync WHERE customer_id = ${customer_id}`);

    if (check && check.length > 0) return; // already exists – idempotent

    const data = {
        customer_id,
        ah_patient_id,
        ah_user_id: ah_user_id || null,
        invited_at: moment().utc().format('YYYY-MM-DDTHH:mm:ss'),
        consent_given: 0,
        initial_sync_done: 0,
        sync_medication: 1,
        sync_assessment: 1,
        sync_incident: 1,
        sync_adl: 1,
        sync_vaccine: 1,
        created_at: moment().utc().format('YYYY-MM-DDTHH:mm:ss'),
    };
    await DBSendResponse(generateInsertSQL('customer_ah_sync', data));
};

// Returns the sync record only if consent has been given.
exports.getAHPatientIdForCustomer = async function (customer_id) {
    const rows = await DBSendResponse(
        `SELECT * FROM customer_ah_sync WHERE customer_id = ${customer_id} AND consent_given = 1`
    );
    return rows && rows.length > 0 ? rows[0] : null;
};

// Returns the full sync record regardless of consent status.
exports.getSyncStatus = async function (customer_id) {
    const rows = await DBSendResponse(
        `SELECT * FROM customer_ah_sync WHERE customer_id = ${customer_id}`
    );
    return rows && rows.length > 0 ? rows[0] : null;
};

// Mirror a single FW medication row → ah_Medication. Returns new AH medicationID.
exports.mirrorMedicationToAH = async function ({ fw_medication_row: m, ah_patient_id }) {
    const data = {
        medicationFor: ah_patient_id,
        drugID: m.drugID || null,
        dosage: m.dosage ? generateSQLText(m.dosage, 256, null) : null,
        condition: m.condition ? generateSQLText(m.condition, 256, null) : null,
        notes: m.notes ? generateSQLText(m.notes, 512, null) : null,
        addedBy: null, // do not mirror caregiver ID to AH user space
        addedOn: moment().utc().format('YYYY-MM-DDTHH:mm:ss'),
        startDate: m.startDate ? moment(m.startDate).format('YYYY-MM-DD') : null,
        endDate: m.endDate ? moment(m.endDate).format('YYYY-MM-DD') : null,
        repeatUnit: m.repeatUnit || null,
        repeatEvery: m.repeatEvery || null,
        repeatOn: m.repeatOn || null,
        timeOfDay: m.timeOfDay || null,
        maxOccurrences: m.maxOccurrences || null,
    };
    const query = generateInsertSQL('ah_Medication', data) + 'SELECT SCOPE_IDENTITY()';
    return await DBinsertSendID(query);
};

// Mirror a single FW vaccine row → ah_Vaccine. Returns new AH vaccineID.
exports.mirrorVaccineToAH = async function ({ fw_vaccine_row: v, ah_patient_id }) {
    const data = {
        vaccineFor: ah_patient_id,
        VISUrlID: v.VISUrlID || null,
        dateAdministered: v.dateAdministered ? moment(v.dateAdministered).format('YYYY-MM-DD') : null,
        doseNumber: v.doseNumber ? generateSQLText(v.doseNumber, 50, null) : null,
        notes: v.notes ? generateSQLText(v.notes, 512, null) : null,
        addedBy: null, // do not mirror caregiver ID to AH user space
        addedOn: moment().utc().format('YYYY-MM-DDTHH:mm:ss'),
    };
    const query = generateInsertSQL('ah_Vaccine', data) + 'SELECT SCOPE_IDENTITY()';
    return await DBinsertSendID(query);
};

// Mirror a single FW assessment row → ah_Assessment. Returns new AH AssessmentID.
exports.mirrorAssessmentToAH = async function ({ fw_assessment_row: a, ah_patient_id }) {
    const data = {
        PatientID: ah_patient_id,
        PersonCompleting: null, // do not mirror emp ID to AH user space
        DateOfAssessment: a.addedOn ? moment(a.addedOn).utc().format('YYYY-MM-DDTHH:mm:ss') : moment().utc().format('YYYY-MM-DDTHH:mm:ss'),
        AssessmentReason: a.AssessmentReason || null,
        AbilityToHear: a.AbilityToHear || null,
        AbilityToSee: a.AbilityToSee || null,
        HealthLiteracy: a.HealthLiteracy || null,
        CognitiveFunctioning: a.CognitiveFunctioning || null,
        Confused: a.Confused || null,
        Anxious: a.Anxious || null,
        Isolation: a.Isolation || null,
        MemoryDeficit: a.MemoryDeficit || null,
        ImpairedDM: a.ImpairedDM || null,
        VerbalDisruption: a.VerbalDisruption || null,
        PhysicalAggression: a.PhysicalAggression || null,
        DisruptiveBehavior: a.DisruptiveBehavior || null,
        DelusionalBehavior: a.DelusionalBehavior || null,
        RiskForHospitalization: a.RiskForHospitalization || null,
        IncidentID: null,
    };
    const query = generateInsertSQL('ah_Assessment', data) + 'SELECT SCOPE_IDENTITY()';
    return await DBinsertSendID(query);
};

// Mirror a single FW incident row → ah_Unusual_Incident. Returns new AH UnusualIncidentID.
exports.mirrorIncidentToAH = async function ({ fw_incident_row: i, ah_patient_id }) {
    const data = {
        UnusualIncidentType: i.IncidentType || null,
        UnusualIncidentUserID: null,
        UnusualIncidentStartTime: i.IncidentStartTime ? moment(i.IncidentStartTime).utc().format('YYYY-MM-DDTHH:mm:ss') : null,
        UnusualIncidentEndTime: i.IncidentEndTime ? moment(i.IncidentEndTime).utc().format('YYYY-MM-DDTHH:mm:ss') : null,
        PatientID: ah_patient_id,
        createdBy: null, // do not mirror emp ID to AH user space
        createdAt: moment().utc().format('YYYY-MM-DDTHH:mm:ss'),
        show: 1,
    };
    const query = generateInsertSQL('ah_Unusual_Incident', data) + 'SELECT SCOPE_IDENTITY()';
    const ahIncId = await DBinsertSendID(query);
    if (!ahIncId) return null;

    // Mirror comment text → ah_Notes
    if (i.comment_text) {
        const noteText = generateSQLText(i.comment_text, 2000, null);
        if (noteText) {
            await DBSendResponse(
                `INSERT INTO ah_Notes (UnusualIncidentID, NoteText, PatientID, createdAt, show) VALUES (${ahIncId}, N'${noteText}', ${ah_patient_id}, '${moment().utc().format('YYYY-MM-DDTHH:mm:ss')}', 1)`
            );
        }
    }

    // Mirror audio blob → ah_Voice_Notes
    if (i.audio_note) {
        const hex = Buffer.isBuffer(i.audio_note) ? i.audio_note.toString('hex') : null;
        if (hex) {
            await DBSendResponse(
                `INSERT INTO ah_Voice_Notes (UnusualIncidentID, VoiceNote, PatientID, createdAt, show) VALUES (${ahIncId}, 0x${hex}, ${ah_patient_id}, '${moment().utc().format('YYYY-MM-DDTHH:mm:ss')}', 1)`
            );
        }
    }

    // Mirror artifact URL → ah_Artifacts
    if (i.artifact_url) {
        const url = generateSQLText(i.artifact_url, 2000, null);
        if (url) {
            await DBSendResponse(
                `INSERT INTO ah_Artifacts (UnusualIncidentID, ArtifactURL, ArtifactName, PatientID, createdAt, show) VALUES (${ahIncId}, N'${url}', NULL, ${ah_patient_id}, '${moment().utc().format('YYYY-MM-DDTHH:mm:ss')}', 1)`
            );
        }
    }

    return ahIncId;
};

// Mirror FW ADL row → UPDATE ah_Patient ADL columns.
exports.mirrorADLToAH = async function ({ fw_adl_row: adl, ah_patient_id }) {
    const fields = [
        'Grooming', 'DressUpperBody', 'DressLowerBody', 'Bathing',
        'ToiletTransferring', 'ToiletHygiene', 'Transferring', 'Ambulation',
        'MoneyManagement', 'HouseholdManagement', 'HealthManagement',
        'MealPreparation', 'Communication', 'Transportation', 'Shopping',
    ];
    const setParts = fields
        .map(f => adl[f] != null ? `${f} = N'${generateSQLText(adl[f], 255, null) || ''}'` : null)
        .filter(Boolean);
    if (setParts.length === 0) return;
    await DBSendResponse(
        `UPDATE ah_Patient SET ${setParts.join(', ')} WHERE PatientID = ${ah_patient_id}`
    );
};
