const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const moment = require('moment');
const ahSync = require('./ah_sync');

exports.getMedicationSuggestions = async (req, res) => {
    try {
        const searchTerm = generateSQLText(req.query.searchTerm, 100, null);
        if (!searchTerm || searchTerm.length < 3) return res.status(200).json([]);
        const query = `
            SELECT TOP 20 id, manufacturer_name, brand_name
            FROM drug_products
            WHERE CONTAINS(brand_name, '"*${req.query.searchTerm}*"')`;
        const result = await DBSendResponse(query);
        res.status(200).json(result);
    } catch (err) {
        console.log('QUERY FAILURE | getMedicationSuggestions Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

exports.getMedicationsByCustomerId = async (req, res) => {
    try {
        const customer_id = parseInt(req.params.customer_id);
        if (isNaN(customer_id)) return res.status(400).json({ message: 'Invalid customer_id' });
        const query = `
            SELECT cm.*, dp.brand_name, dp.generic_name
            FROM customer_medication cm
            LEFT JOIN drug_products dp ON cm.drugID = dp.id
            WHERE cm.customer_id = ${customer_id}
            ORDER BY cm.addedOn DESC`;
        const result = await DBSendResponse(query);
        res.status(200).json(result);
    } catch (err) {
        console.log('QUERY FAILURE | getMedicationsByCustomerId Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

exports.createMedication = async (req, res) => {
    try {
        const data = {
            customer_id: isNaN(parseInt(req.body.customer_id)) ? null : parseInt(req.body.customer_id),
            drugID: isNaN(parseInt(req.body.drugID)) ? null : parseInt(req.body.drugID),
            dosage: generateSQLText(req.body.dosage, 256, null),
            condition: generateSQLText(req.body.condition, 256, null),
            notes: generateSQLText(req.body.notes, 512, null),
            startDate: req.body.startDate ? req.body.startDate : null,
            endDate: req.body.endDate ? req.body.endDate : null,
            repeatUnit: generateSQLText(req.body.repeatUnit, 255, null),
            repeatEvery: isNaN(parseInt(req.body.repeatEvery)) ? null : parseInt(req.body.repeatEvery),
            repeatOn: generateSQLText(req.body.repeatOn, 255, null),
            timeOfDay: generateSQLText(req.body.timeOfDay, 255, null),
            maxOccurrences: isNaN(parseInt(req.body.maxOccurrences)) ? null : parseInt(req.body.maxOccurrences),
            addedBy: isNaN(parseInt(req.body.addedBy)) ? null : parseInt(req.body.addedBy),
            addedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateInsertSQL('customer_medication', data) + 'SELECT SCOPE_IDENTITY()';
        const newId = await DBinsertSendID(query);

        // Mirror to AH (non-blocking)
        try {
            const sync = await ahSync.getAHPatientIdForCustomer(data.customer_id);
            if (sync && sync.sync_medication) {
                const ahMedId = await ahSync.mirrorMedicationToAH({ fw_medication_row: { ...data, customer_medication_id: newId }, ah_patient_id: sync.ah_patient_id });
                if (ahMedId) {
                    await DBSendResponse(`UPDATE customer_medication SET ah_medication_id = ${ahMedId} WHERE customer_medication_id = ${newId}`);
                    await DBSendResponse(`UPDATE ah_Medication SET fw_medication_id = ${newId} WHERE medicationID = ${ahMedId}`);
                }
            }
        } catch (e) { console.log('AH sync failed (non-blocking):', e); }

        res.status(200).json({ id: newId });
    } catch (err) {
        console.log('QUERY FAILURE | createMedication Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.updateMedication = async (req, res) => {
    try {
        const customer_medication_id = parseInt(req.params.customer_medication_id);
        if (isNaN(customer_medication_id)) return res.status(400).json({ message: 'Invalid customer_medication_id' });

        const data = {
            drugID: isNaN(parseInt(req.body.drugID)) ? null : parseInt(req.body.drugID),
            dosage: generateSQLText(req.body.dosage, 256, null),
            condition: generateSQLText(req.body.condition, 256, null),
            notes: generateSQLText(req.body.notes, 512, null),
            startDate: req.body.startDate ? req.body.startDate : null,
            endDate: req.body.endDate ? req.body.endDate : null,
            repeatUnit: generateSQLText(req.body.repeatUnit, 255, null),
            repeatEvery: isNaN(parseInt(req.body.repeatEvery)) ? null : parseInt(req.body.repeatEvery),
            repeatOn: generateSQLText(req.body.repeatOn, 255, null),
            timeOfDay: generateSQLText(req.body.timeOfDay, 255, null),
            maxOccurrences: isNaN(parseInt(req.body.maxOccurrences)) ? null : parseInt(req.body.maxOccurrences),
        };

        const query = generateUpdateSQL('customer_medication', data, `customer_medication_id = ${customer_medication_id}`);
        await DBSendResponse(query);

        // Mirror update to AH (non-blocking)
        try {
            const fwRow = await DBSendResponse(`SELECT * FROM customer_medication WHERE customer_medication_id = ${customer_medication_id}`);
            if (fwRow && fwRow.length > 0 && fwRow[0].ah_medication_id) {
                const ahUpdateData = {
                    drugID: data.drugID,
                    dosage: data.dosage,
                    condition: data.condition,
                    notes: data.notes,
                    startDate: data.startDate,
                    endDate: data.endDate,
                    repeatUnit: data.repeatUnit,
                    repeatEvery: data.repeatEvery,
                    repeatOn: data.repeatOn,
                    timeOfDay: data.timeOfDay,
                    maxOccurrences: data.maxOccurrences,
                };
                const ahUpdateQuery = generateUpdateSQL('ah_Medication', ahUpdateData, `medicationID = ${fwRow[0].ah_medication_id}`);
                await DBSendResponse(ahUpdateQuery);
            }
        } catch (e) { console.log('AH sync update failed (non-blocking):', e); }

        res.status(200).json({ message: 'Medication updated successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | updateMedication Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.deleteMedication = async (req, res) => {
    try {
        const customer_medication_id = parseInt(req.params.customer_medication_id);
        if (isNaN(customer_medication_id)) return res.status(400).json({ message: 'Invalid customer_medication_id' });
        // Fetch AH cross-ref before deleting
        let ahMedId = null;
        try {
            const fwRow = await DBSendResponse(`SELECT ah_medication_id FROM customer_medication WHERE customer_medication_id = ${customer_medication_id}`);
            if (fwRow && fwRow.length > 0) ahMedId = fwRow[0].ah_medication_id;
        } catch (e) { console.log('AH sync pre-delete lookup failed (non-blocking):', e); }

        const query = `DELETE FROM customer_medication WHERE customer_medication_id = ${customer_medication_id}`;
        await DBSendResponse(query);

        // Mirror delete to AH (non-blocking)
        if (ahMedId) {
            try {
                await DBSendResponse(`DELETE FROM ah_Medication WHERE medicationID = ${ahMedId}`);
            } catch (e) { console.log('AH sync delete failed (non-blocking):', e); }
        }

        res.status(200).json({ message: 'Medication deleted successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | deleteMedication Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};
