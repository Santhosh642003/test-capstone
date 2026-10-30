const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const moment = require('moment');
const ahSync = require('./ah_sync');

exports.getAssessmentsByCustomerId = async (req, res) => {
    try {
        const customer_id = parseInt(req.params.customer_id);
        if (isNaN(customer_id)) return res.status(400).json({ message: 'Invalid customer_id' });
        const query = `SELECT * FROM customer_assessment WHERE customer_id = ${customer_id} ORDER BY addedOn DESC`;
        const result = await DBSendResponse(query);
        res.status(200).json(result);
    } catch (err) {
        console.log('QUERY FAILURE | getAssessmentsByCustomerId Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

exports.createAssessment = async (req, res) => {
    try {
        const data = {
            customer_id: isNaN(parseInt(req.body.customer_id)) ? null : parseInt(req.body.customer_id),
            AssessmentReason: generateSQLText(req.body.AssessmentReason, 255, null),
            AbilityToHear: generateSQLText(req.body.AbilityToHear, 255, null),
            AbilityToSee: generateSQLText(req.body.AbilityToSee, 255, null),
            HealthLiteracy: generateSQLText(req.body.HealthLiteracy, 255, null),
            CognitiveFunctioning: generateSQLText(req.body.CognitiveFunctioning, 255, null),
            Confused: generateSQLText(req.body.Confused, 255, null),
            Anxious: generateSQLText(req.body.Anxious, 255, null),
            Isolation: generateSQLText(req.body.Isolation, 255, null),
            MemoryDeficit: generateSQLText(req.body.MemoryDeficit, 255, null),
            ImpairedDM: generateSQLText(req.body.ImpairedDM, 255, null),
            VerbalDisruption: generateSQLText(req.body.VerbalDisruption, 255, null),
            PhysicalAggression: generateSQLText(req.body.PhysicalAggression, 255, null),
            DisruptiveBehavior: generateSQLText(req.body.DisruptiveBehavior, 255, null),
            DelusionalBehavior: generateSQLText(req.body.DelusionalBehavior, 255, null),
            RiskForHospitalization: generateSQLText(req.body.RiskForHospitalization, 255, null),
            addedBy: isNaN(parseInt(req.body.addedBy)) ? null : parseInt(req.body.addedBy),
            addedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateInsertSQL('customer_assessment', data) + 'SELECT SCOPE_IDENTITY()';
        const newId = await DBinsertSendID(query);

        // Mirror to AH (non-blocking)
        try {
            const sync = await ahSync.getAHPatientIdForCustomer(data.customer_id);
            if (sync && sync.sync_assessment) {
                const ahAssessId = await ahSync.mirrorAssessmentToAH({ fw_assessment_row: { ...data, customer_assessment_id: newId }, ah_patient_id: sync.ah_patient_id });
                if (ahAssessId) {
                    await DBSendResponse(`UPDATE customer_assessment SET ah_assessment_id = ${ahAssessId} WHERE customer_assessment_id = ${newId}`);
                    await DBSendResponse(`UPDATE ah_Assessment SET fw_assessment_id = ${newId} WHERE AssessmentID = ${ahAssessId}`);
                }
            }
        } catch (e) { console.log('AH sync failed (non-blocking):', e); }

        res.status(200).json({ id: newId });
    } catch (err) {
        console.log('QUERY FAILURE | createAssessment Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.deleteAssessment = async (req, res) => {
    try {
        const customer_assessment_id = parseInt(req.params.customer_assessment_id);
        if (isNaN(customer_assessment_id)) return res.status(400).json({ message: 'Invalid customer_assessment_id' });
        let ahAssessId = null;
        try {
            const fwRow = await DBSendResponse(`SELECT ah_assessment_id FROM customer_assessment WHERE customer_assessment_id = ${customer_assessment_id}`);
            if (fwRow && fwRow.length > 0) ahAssessId = fwRow[0].ah_assessment_id;
        } catch (e) { console.log('AH sync pre-delete lookup failed (non-blocking):', e); }

        const query = `DELETE FROM customer_assessment WHERE customer_assessment_id = ${customer_assessment_id}`;
        await DBSendResponse(query);

        if (ahAssessId) {
            try {
                await DBSendResponse(`DELETE FROM ah_Assessment WHERE AssessmentID = ${ahAssessId}`);
            } catch (e) { console.log('AH sync delete failed (non-blocking):', e); }
        }

        res.status(200).json({ message: 'Assessment deleted successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | deleteAssessment Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

exports.updateAssessment = async (req, res) => {
    try {
        const customer_assessment_id = parseInt(req.params.customer_assessment_id);
        if (isNaN(customer_assessment_id)) return res.status(400).json({ message: 'Invalid customer_assessment_id' });

        const data = {
            AssessmentReason: generateSQLText(req.body.AssessmentReason, 255, null),
            AbilityToHear: generateSQLText(req.body.AbilityToHear, 255, null),
            AbilityToSee: generateSQLText(req.body.AbilityToSee, 255, null),
            HealthLiteracy: generateSQLText(req.body.HealthLiteracy, 255, null),
            CognitiveFunctioning: generateSQLText(req.body.CognitiveFunctioning, 255, null),
            Confused: generateSQLText(req.body.Confused, 255, null),
            Anxious: generateSQLText(req.body.Anxious, 255, null),
            Isolation: generateSQLText(req.body.Isolation, 255, null),
            MemoryDeficit: generateSQLText(req.body.MemoryDeficit, 255, null),
            ImpairedDM: generateSQLText(req.body.ImpairedDM, 255, null),
            VerbalDisruption: generateSQLText(req.body.VerbalDisruption, 255, null),
            PhysicalAggression: generateSQLText(req.body.PhysicalAggression, 255, null),
            DisruptiveBehavior: generateSQLText(req.body.DisruptiveBehavior, 255, null),
            DelusionalBehavior: generateSQLText(req.body.DelusionalBehavior, 255, null),
            RiskForHospitalization: generateSQLText(req.body.RiskForHospitalization, 255, null),
        };

        const query = generateUpdateSQL('customer_assessment', data, `customer_assessment_id = ${customer_assessment_id}`);
        await DBSendResponse(query);

        // Mirror update to AH (non-blocking)
        try {
            const fwRow = await DBSendResponse(`SELECT ah_assessment_id FROM customer_assessment WHERE customer_assessment_id = ${customer_assessment_id}`);
            if (fwRow && fwRow.length > 0 && fwRow[0].ah_assessment_id) {
                const ahUpdateData = {
                    AssessmentReason: data.AssessmentReason,
                    AbilityToHear: data.AbilityToHear,
                    AbilityToSee: data.AbilityToSee,
                    HealthLiteracy: data.HealthLiteracy,
                    CognitiveFunctioning: data.CognitiveFunctioning,
                    Confused: data.Confused,
                    Anxious: data.Anxious,
                    Isolation: data.Isolation,
                    MemoryDeficit: data.MemoryDeficit,
                    ImpairedDM: data.ImpairedDM,
                    VerbalDisruption: data.VerbalDisruption,
                    PhysicalAggression: data.PhysicalAggression,
                    DisruptiveBehavior: data.DisruptiveBehavior,
                    DelusionalBehavior: data.DelusionalBehavior,
                    RiskForHospitalization: data.RiskForHospitalization,
                };
                await DBSendResponse(generateUpdateSQL('ah_Assessment', ahUpdateData, `AssessmentID = ${fwRow[0].ah_assessment_id}`));
            }
        } catch (e) { console.log('AH sync update failed (non-blocking):', e); }

        res.status(200).json({ message: 'Assessment updated successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | updateAssessment Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};
