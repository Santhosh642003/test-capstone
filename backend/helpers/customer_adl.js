const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const moment = require('moment');
const ahSync = require('./ah_sync');

exports.getADLByCustomerId = async (req, res) => {
    try {
        const customer_id = parseInt(req.params.customer_id);
        if (isNaN(customer_id)) return res.status(400).json({ message: 'Invalid customer_id' });
        const query = `SELECT * FROM customer_adl WHERE customer_id = ${customer_id}`;
        const result = await DBSendResponse(query);
        res.status(200).json(result);
    } catch (err) {
        console.log('QUERY FAILURE | getADLByCustomerId Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

exports.createADL = async (req, res) => {
    try {
        const data = {
            customer_id: isNaN(parseInt(req.body.customer_id)) ? null : parseInt(req.body.customer_id),
            Grooming: generateSQLText(req.body.Grooming, 255, null),
            DressUpperBody: generateSQLText(req.body.DressUpperBody, 255, null),
            DressLowerBody: generateSQLText(req.body.DressLowerBody, 255, null),
            Bathing: generateSQLText(req.body.Bathing, 255, null),
            ToiletTransferring: generateSQLText(req.body.ToiletTransferring, 255, null),
            ToiletHygiene: generateSQLText(req.body.ToiletHygiene, 255, null),
            Transferring: generateSQLText(req.body.Transferring, 255, null),
            Ambulation: generateSQLText(req.body.Ambulation, 255, null),
            MoneyManagement: generateSQLText(req.body.MoneyManagement, 255, null),
            HouseholdManagement: generateSQLText(req.body.HouseholdManagement, 255, null),
            HealthManagement: generateSQLText(req.body.HealthManagement, 255, null),
            MealPreparation: generateSQLText(req.body.MealPreparation, 255, null),
            Communication: generateSQLText(req.body.Communication, 255, null),
            Transportation: generateSQLText(req.body.Transportation, 255, null),
            Shopping: generateSQLText(req.body.Shopping, 255, null),
            addedBy: isNaN(parseInt(req.body.addedBy)) ? null : parseInt(req.body.addedBy),
            addedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateInsertSQL('customer_adl', data) + 'SELECT SCOPE_IDENTITY()';
        const newId = await DBinsertSendID(query);

        // Mirror to AH (non-blocking)
        try {
            const sync = await ahSync.getAHPatientIdForCustomer(data.customer_id);
            if (sync && sync.sync_adl) {
                await ahSync.mirrorADLToAH({ fw_adl_row: data, ah_patient_id: sync.ah_patient_id });
            }
        } catch (e) { console.log('AH sync failed (non-blocking):', e); }

        res.status(200).json({ id: newId });
    } catch (err) {
        console.log('QUERY FAILURE | createADL Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.updateADLByCustomerId = async (req, res) => {
    try {
        const customer_id = parseInt(req.params.customer_id);
        if (isNaN(customer_id)) return res.status(400).json({ message: 'Invalid customer_id' });

        const data = {
            Grooming: generateSQLText(req.body.Grooming, 255, null),
            DressUpperBody: generateSQLText(req.body.DressUpperBody, 255, null),
            DressLowerBody: generateSQLText(req.body.DressLowerBody, 255, null),
            Bathing: generateSQLText(req.body.Bathing, 255, null),
            ToiletTransferring: generateSQLText(req.body.ToiletTransferring, 255, null),
            ToiletHygiene: generateSQLText(req.body.ToiletHygiene, 255, null),
            Transferring: generateSQLText(req.body.Transferring, 255, null),
            Ambulation: generateSQLText(req.body.Ambulation, 255, null),
            MoneyManagement: generateSQLText(req.body.MoneyManagement, 255, null),
            HouseholdManagement: generateSQLText(req.body.HouseholdManagement, 255, null),
            HealthManagement: generateSQLText(req.body.HealthManagement, 255, null),
            MealPreparation: generateSQLText(req.body.MealPreparation, 255, null),
            Communication: generateSQLText(req.body.Communication, 255, null),
            Transportation: generateSQLText(req.body.Transportation, 255, null),
            Shopping: generateSQLText(req.body.Shopping, 255, null),
        };

        const query = generateUpdateSQL('customer_adl', data, `customer_id = ${customer_id}`);
        await DBSendResponse(query);

        // Mirror to AH (non-blocking)
        try {
            const sync = await ahSync.getAHPatientIdForCustomer(customer_id);
            if (sync && sync.sync_adl) {
                await ahSync.mirrorADLToAH({ fw_adl_row: { ...data, customer_id }, ah_patient_id: sync.ah_patient_id });
            }
        } catch (e) { console.log('AH sync failed (non-blocking):', e); }

        res.status(200).json({ message: 'ADL updated successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | updateADLByCustomerId Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};
