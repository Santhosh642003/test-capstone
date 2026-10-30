const { DBInsertAndReturn, DBSendResponse } = require("../queries/commonQueries.js");

exports.getAudioNotes = async function (req, res) {
    let query = `SELECT *, (select * from audio_notes aud where aud.id = an.id for JSON PATH) as audioNote 
    FROM audio_notes an
    LEFT JOIN [dbo].[project] p ON p.pro_id = an.project_id
    LEFT JOIN [dbo].[task] t ON t.tas_id = an.task_id
    LEFT JOIN [dbo].[customer] c ON c.cus_id = an.customer_id
    LEFT JOIN [dbo].[employee] e on e.emp_id = an.employee_id
    WHERE show = 'True' `;

    if (req.query.emp_id) {
        query += `AND an.employee_id = ${req.query.emp_id}`
    } else if (req.query.customer_id) {
        query += `AND an.customer_id = ${req.query.customer_id}`
    } else if (req.query.project_id) {
        query += `AND an.project_id = ${req.query.project_id}`
    }

    let audioNoteList = await DBSendResponse(query);
    audioNoteList = audioNoteList.map((audioInfo) => {
        const audioDetails = audioInfo;
        audioDetails.audioNote = JSON.parse(audioInfo.audioNote);

        return audioDetails;
    })
    res.json(audioNoteList);
};

exports.addAudioNote = async (req, res) => {
    try {
        let audioNote = req.file.buffer;

        let query = `INSERT into audio_notes (
                      audio_note,
                      project_id,
                      task_id,
                      employee_id,
                      customer_id,
                      show,
                      submitted,
                      note_title
                    ) 
                    Values (
                      0x${audioNote.toString('hex')},
                      ${req.body.project_id ? `'${req.body.project_id}'` : 'NULL'},
                      ${req.body.task_id ? `'${req.body.task_id}'` : 'NULL'},
                      ${req.body.emp_id},
                      ${req.body.customer_id ? `'${req.body.customer_id}'` : 'NULL'},
                      1,
                      CURRENT_TIMESTAMP,
                      '${String(req.body.note_title).replaceAll("'", "''")}'
                    ); Select SCOPE_IDENTITY();`

        const resp = await DBSendResponse(query);

        return res.json({
            data: resp,
        })
    } catch (err) {
        console.log(err)
        res.status(500).json({ message: "Failed to add audio note, please try again" });
    }
};