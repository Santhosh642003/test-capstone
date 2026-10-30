const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const moment = require('moment');
const ahSync = require('./ah_sync');

exports.getIncidentsByCustomerId = async (req, res) => {
    try {
        const customer_id = parseInt(req.params.customer_id);
        if (isNaN(customer_id)) return res.status(400).json({ message: 'Invalid customer_id' });
        const query = `
            SELECT
                ci.*,
                c.comment_text,
                an.audio_note,
                art.url  AS artifact_url,
                art.file_name AS artifact_file_name
            FROM customer_incident ci
            LEFT JOIN comments    c   ON ci.IncidentCommentID   = c.comment_id
            LEFT JOIN audio_notes an  ON ci.IncidentAudioNoteID = an.id
            LEFT JOIN artifacts   art ON ci.IncidentArtifactID  = art.id
            WHERE ci.customer_id = ${customer_id}
            ORDER BY ci.addedOn DESC
        `;
        const result = await DBSendResponse(query);
        res.status(200).json(result);
    } catch (err) {
        console.log('QUERY FAILURE | getIncidentsByCustomerId Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};

exports.createIncident = async (req, res) => {
    try {
        const data = {
            customer_id: isNaN(parseInt(req.body.customer_id)) ? null : parseInt(req.body.customer_id),
            IncidentType: generateSQLText(req.body.IncidentType, 255, null),
            IncidentStartTime: req.body.IncidentStartTime ? req.body.IncidentStartTime : null,
            IncidentEndTime: req.body.IncidentEndTime ? req.body.IncidentEndTime : null,
            addedBy: isNaN(parseInt(req.body.addedBy)) ? null : parseInt(req.body.addedBy),
            addedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateInsertSQL('customer_incident', data) + 'SELECT SCOPE_IDENTITY()';
        const newId = await DBinsertSendID(query);

        // Mirror to AH (non-blocking)
        try {
            const sync = await ahSync.getAHPatientIdForCustomer(data.customer_id);
            if (sync && sync.sync_incident) {
                const ahIncId = await ahSync.mirrorIncidentToAH({ fw_incident_row: { ...data, customer_incident_id: newId }, ah_patient_id: sync.ah_patient_id });
                if (ahIncId) {
                    await DBSendResponse(`UPDATE customer_incident SET ah_incident_id = ${ahIncId} WHERE customer_incident_id = ${newId}`);
                    await DBSendResponse(`UPDATE ah_Unusual_Incident SET fw_incident_id = ${newId} WHERE UnusualIncidentID = ${ahIncId}`);
                }
            }
        } catch (e) { console.log('AH sync failed (non-blocking):', e); }

        res.status(200).json({ id: newId });
    } catch (err) {
        console.log('QUERY FAILURE | createIncident Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.updateIncidentIds = async (req, res) => {
    try {
        const customer_incident_id = parseInt(req.params.customer_incident_id);
        if (isNaN(customer_incident_id)) return res.status(400).json({ message: 'Invalid customer_incident_id' });

        const data = {};
        if (req.body.IncidentCommentID != null) data.IncidentCommentID = isNaN(parseInt(req.body.IncidentCommentID)) ? null : parseInt(req.body.IncidentCommentID);
        if (req.body.IncidentAudioNoteID != null) data.IncidentAudioNoteID = isNaN(parseInt(req.body.IncidentAudioNoteID)) ? null : parseInt(req.body.IncidentAudioNoteID);
        if (req.body.IncidentArtifactID != null) data.IncidentArtifactID = isNaN(parseInt(req.body.IncidentArtifactID)) ? null : parseInt(req.body.IncidentArtifactID);

        if (Object.keys(data).length === 0) return res.status(400).json({ message: 'Nothing to update' });

        const query = generateUpdateSQL('customer_incident', data, `customer_incident_id = ${customer_incident_id}`);
        await DBSendResponse(query);

        // Mirror newly-linked attachments to AH (non-blocking)
        try {
            const fwRow = await DBSendResponse(`SELECT * FROM customer_incident WHERE customer_incident_id = ${customer_incident_id}`);
            const row = fwRow?.[0];
            if (row?.ah_incident_id) {
                const ahIncId = row.ah_incident_id;
                const now = moment().utc().format('YYYY-MM-DDTHH:mm:ss');

                const syncRecord = await DBSendResponse(`SELECT ah_patient_id FROM customer_ah_sync WHERE customer_id = ${row.customer_id}`);
                const ahPatientId = syncRecord?.[0]?.ah_patient_id ?? null;

                if (data.IncidentCommentID) {
                    const existing = await DBSendResponse(`SELECT 1 AS n FROM ah_Notes WHERE UnusualIncidentID = ${ahIncId}`);
                    if (!existing?.length) {
                        const comment = await DBSendResponse(`SELECT comment_text FROM comments WHERE comment_id = ${data.IncidentCommentID}`);
                        const noteText = comment?.[0]?.comment_text ? generateSQLText(comment[0].comment_text, 2000, null) : null;
                        if (noteText) {
                            await DBSendResponse(`INSERT INTO ah_Notes (UnusualIncidentID, NoteText, PatientID, createdAt, show) VALUES (${ahIncId}, N'${noteText}', ${ahPatientId ?? 'NULL'}, '${now}', 1)`);
                        }
                    }
                }

                if (data.IncidentAudioNoteID) {
                    const existing = await DBSendResponse(`SELECT 1 AS n FROM ah_Voice_Notes WHERE UnusualIncidentID = ${ahIncId}`);
                    if (!existing?.length) {
                        const audio = await DBSendResponse(`SELECT audio_note FROM audio_notes WHERE id = ${data.IncidentAudioNoteID}`);
                        if (audio?.[0]?.audio_note) {
                            const hex = Buffer.isBuffer(audio[0].audio_note) ? audio[0].audio_note.toString('hex') : null;
                            if (hex) {
                                await DBSendResponse(`INSERT INTO ah_Voice_Notes (UnusualIncidentID, VoiceNote, PatientID, createdAt, show) VALUES (${ahIncId}, 0x${hex}, ${ahPatientId ?? 'NULL'}, '${now}', 1)`);
                            }
                        }
                    }
                }

                if (data.IncidentArtifactID) {
                    const existing = await DBSendResponse(`SELECT 1 AS n FROM ah_Artifacts WHERE UnusualIncidentID = ${ahIncId}`);
                    if (!existing?.length) {
                        const artifact = await DBSendResponse(`SELECT url, file_name FROM artifacts WHERE id = ${data.IncidentArtifactID}`);
                        const url = artifact?.[0]?.url ? generateSQLText(artifact[0].url, 2000, null) : null;
                        if (url) {
                            const fileName = artifact[0].file_name ? generateSQLText(artifact[0].file_name, 255, null) : null;
                            await DBSendResponse(`INSERT INTO ah_Artifacts (UnusualIncidentID, ArtifactURL, ArtifactName, PatientID, createdAt, show) VALUES (${ahIncId}, N'${url}', ${fileName ? `N'${fileName}'` : 'NULL'}, ${ahPatientId ?? 'NULL'}, '${now}', 1)`);
                        }
                    }
                }
            }
        } catch (e) { console.log('AH attachment sync failed (non-blocking):', e); }

        res.status(200).json({ message: 'Incident updated successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | updateIncidentIds Query Failed:');
        console.log(err);
        res.status(400).json({ message: 'An unexpected error occurred' });
    }
};

exports.deleteIncident = async (req, res) => {
    try {
        const customer_incident_id = parseInt(req.params.customer_incident_id);
        if (isNaN(customer_incident_id)) return res.status(400).json({ message: 'Invalid customer_incident_id' });
        let ahIncId = null;
        try {
            const fwRow = await DBSendResponse(`SELECT ah_incident_id FROM customer_incident WHERE customer_incident_id = ${customer_incident_id}`);
            if (fwRow && fwRow.length > 0) ahIncId = fwRow[0].ah_incident_id;
        } catch (e) { console.log('AH sync pre-delete lookup failed (non-blocking):', e); }

        const query = `DELETE FROM customer_incident WHERE customer_incident_id = ${customer_incident_id}`;
        await DBSendResponse(query);

        if (ahIncId) {
            try {
                await DBSendResponse(`DELETE FROM ah_Unusual_Incident WHERE UnusualIncidentID = ${ahIncId}`);
            } catch (e) { console.log('AH sync delete failed (non-blocking):', e); }
        }

        res.status(200).json({ message: 'Incident deleted successfully' });
    } catch (err) {
        console.log('QUERY FAILURE | deleteIncident Query Failed:');
        console.log(err);
        res.status(500).json({ message: 'An unexpected error occurred' });
    }
};
