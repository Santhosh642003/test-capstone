const axios = require('axios');
const { DBinsertSendID, DBSendResponse, DBSendResponseParam, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const moment = require('moment');
const ahSync = require('./ah_sync');

// Official CDC IIS "VIS to URL" code set — pipe-delimited flat file, no header.
// Columns (in order): DocTypeDesc | GDTIDocCode | PdfUrl | HtmlUrl
// Source: https://www.cdc.gov/iis/code-sets/vis-url-table.html
const VIS_URL_FLATFILE = 'https://www2.cdc.gov/vaccines/iis/iisstandards/downloads/vis-url.txt';

// Fetch + parse the CDC flat file into row objects.
async function fetchVisRows() {
    const { data } = await axios.get(VIS_URL_FLATFILE, { responseType: 'text', timeout: 30000 });
    return String(data)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const [DocTypeDesc, GDTIDocCode, PdfUrl, HtmlUrl] = line.split('|');
            return {
                DocTypeDesc: (DocTypeDesc || '').trim(),
                GDTIDocCode: (GDTIDocCode || '').trim(),
                PdfUrl: (PdfUrl || '').trim() || null,
                HtmlUrl: (HtmlUrl || '').trim() || null,
            };
        })
        .filter((row) => row.GDTIDocCode);
}

// Upsert one row keyed on GDTIDocCode. Returns 'INSERT' or 'UPDATE'.
async function upsertVisRow(row) {
    const query = `
        MERGE cdc_vaccines AS target
        USING (SELECT @GDTIDocCode AS GDTIDocCode) AS src
        ON target.GDTIDocCode = src.GDTIDocCode
        WHEN MATCHED THEN
            UPDATE SET DocTypeDesc = @DocTypeDesc, PdfUrl = @PdfUrl, HtmlUrl = @HtmlUrl
        WHEN NOT MATCHED THEN
            INSERT (DocTypeDesc, GDTIDocCode, PdfUrl, HtmlUrl)
            VALUES (@DocTypeDesc, @GDTIDocCode, @PdfUrl, @HtmlUrl)
        OUTPUT $action AS action;`;
    const result = await DBSendResponseParam(query, {
        GDTIDocCode: row.GDTIDocCode,
        DocTypeDesc: row.DocTypeDesc,
        PdfUrl: row.PdfUrl,
        HtmlUrl: row.HtmlUrl,
    });
    return result && result[0] ? result[0].action : null;
}

// POST /customer_vaccine/sync — pull the latest CDC VIS->URL data and upsert.
// Trigger from the terminal with:
//   curl -X POST http://localhost:<port>/api/fieldworker/customer_vaccine/sync
exports.syncVaccines = async (req, res) => {
    try {
        const rows = await fetchVisRows();
        let inserted = 0;
        let updated = 0;
        for (const row of rows) {
            const action = await upsertVisRow(row);
            if (action === 'INSERT') inserted += 1;
            else if (action === 'UPDATE') updated += 1;
        }
        res.status(200).json({ message: 'Vaccine data synced from CDC', total: rows.length, inserted, updated });
    } catch (err) {
        console.log('QUERY FAILURE | syncVaccines Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

// GET /customer_vaccine/suggestions?searchTerm=X — type-ahead against the CDC VIS list.
exports.getVaccineSuggestions = async (req, res) => {
    try {
        const searchTerm = generateSQLText(req.query.searchTerm, 100, null);
        if (!searchTerm || searchTerm.length < 3) return res.status(200).json([]);
        const query = `
            SELECT TOP 20 VISUrlID, DocTypeDesc, GDTIDocCode, PdfUrl, HtmlUrl
            FROM cdc_vaccines
            WHERE DocTypeDesc LIKE '%${searchTerm}%'
            ORDER BY DocTypeDesc`;
        const result = await DBSendResponse(query);
        res.status(200).json(result);
    } catch (err) {
        console.log('QUERY FAILURE | getVaccineSuggestions Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

// GET /customer_vaccine/by_customer/:customer_id — vaccines for one customer (with VIS details).
exports.getVaccinesByCustomerId = async (req, res) => {
    try {
        const customer_id = parseInt(req.params.customer_id);
        if (isNaN(customer_id)) return res.status(400).json({ message: 'Invalid customer_id' });
        const query = `
            SELECT cv.*, cdc.DocTypeDesc, cdc.GDTIDocCode, cdc.PdfUrl, cdc.HtmlUrl
            FROM customer_vaccine cv
            LEFT JOIN cdc_vaccines cdc ON cv.VISUrlID = cdc.VISUrlID
            WHERE cv.customer_id = ${customer_id}
            ORDER BY cv.addedOn DESC`;
        const result = await DBSendResponse(query);
        res.status(200).json(result);
    } catch (err) {
        console.log('QUERY FAILURE | getVaccinesByCustomerId Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

exports.createVaccine = async (req, res) => {
    try {
        const data = {
            customer_id: isNaN(parseInt(req.body.customer_id)) ? null : parseInt(req.body.customer_id),
            VISUrlID: isNaN(parseInt(req.body.VISUrlID)) ? null : parseInt(req.body.VISUrlID),
            dateAdministered: req.body.dateAdministered ? req.body.dateAdministered : null,
            doseNumber: generateSQLText(req.body.doseNumber, 50, null),
            notes: generateSQLText(req.body.notes, 512, null),
            addedBy: isNaN(parseInt(req.body.addedBy)) ? null : parseInt(req.body.addedBy),
            addedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateInsertSQL('customer_vaccine', data) + 'SELECT SCOPE_IDENTITY()';
        const newId = await DBinsertSendID(query);

        // Mirror to AH (non-blocking)
        try {
            const sync = await ahSync.getAHPatientIdForCustomer(data.customer_id);
            if (sync && sync.sync_vaccine) {
                const ahVacId = await ahSync.mirrorVaccineToAH({ fw_vaccine_row: { ...data, customer_vaccine_id: newId }, ah_patient_id: sync.ah_patient_id });
                if (ahVacId) {
                    await DBSendResponse(`UPDATE customer_vaccine SET ah_vaccine_id = ${ahVacId} WHERE customer_vaccine_id = ${newId}`);
                    await DBSendResponse(`UPDATE ah_Vaccine SET fw_vaccine_id = ${newId} WHERE vaccineID = ${ahVacId}`);
                }
            }
        } catch (e) { console.log('AH sync failed (non-blocking):', e); }

        res.status(200).json({ id: newId });
    } catch (err) {
        console.log('QUERY FAILURE | createVaccine Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.updateVaccine = async (req, res) => {
    try {
        const customer_vaccine_id = parseInt(req.params.customer_vaccine_id);
        if (isNaN(customer_vaccine_id)) return res.status(400).json({ message: 'Invalid customer_vaccine_id' });

        const data = {
            VISUrlID: isNaN(parseInt(req.body.VISUrlID)) ? null : parseInt(req.body.VISUrlID),
            dateAdministered: req.body.dateAdministered ? req.body.dateAdministered : null,
            doseNumber: generateSQLText(req.body.doseNumber, 50, null),
            notes: generateSQLText(req.body.notes, 512, null),
        };

        const query = generateUpdateSQL('customer_vaccine', data, `customer_vaccine_id = ${customer_vaccine_id}`);
        await DBSendResponse(query);

        // Mirror update to AH (non-blocking)
        try {
            const fwRow = await DBSendResponse(`SELECT * FROM customer_vaccine WHERE customer_vaccine_id = ${customer_vaccine_id}`);
            if (fwRow && fwRow.length > 0 && fwRow[0].ah_vaccine_id) {
                const ahUpdateData = {
                    VISUrlID: data.VISUrlID,
                    dateAdministered: data.dateAdministered,
                    doseNumber: data.doseNumber,
                    notes: data.notes,
                };
                const ahUpdateQuery = generateUpdateSQL('ah_Vaccine', ahUpdateData, `vaccineID = ${fwRow[0].ah_vaccine_id}`);
                await DBSendResponse(ahUpdateQuery);
            }
        } catch (e) { console.log('AH sync update failed (non-blocking):', e); }

        res.status(200).json({ message: 'Vaccine updated successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | updateVaccine Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.deleteVaccine = async (req, res) => {
    try {
        const customer_vaccine_id = parseInt(req.params.customer_vaccine_id);
        if (isNaN(customer_vaccine_id)) return res.status(400).json({ message: 'Invalid customer_vaccine_id' });
        // Fetch AH cross-ref before deleting
        let ahVacId = null;
        try {
            const fwRow = await DBSendResponse(`SELECT ah_vaccine_id FROM customer_vaccine WHERE customer_vaccine_id = ${customer_vaccine_id}`);
            if (fwRow && fwRow.length > 0) ahVacId = fwRow[0].ah_vaccine_id;
        } catch (e) { console.log('AH sync pre-delete lookup failed (non-blocking):', e); }

        const query = `DELETE FROM customer_vaccine WHERE customer_vaccine_id = ${customer_vaccine_id}`;
        await DBSendResponse(query);

        // Mirror delete to AH (non-blocking)
        if (ahVacId) {
            try {
                await DBSendResponse(`DELETE FROM ah_Vaccine WHERE vaccineID = ${ahVacId}`);
            } catch (e) { console.log('AH sync delete failed (non-blocking):', e); }
        }

        res.status(200).json({ message: 'Vaccine deleted successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | deleteVaccine Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};
