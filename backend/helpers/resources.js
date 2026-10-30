const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries')

const getProgramIdFromReq = (req) => {
    const parsed = parseInt(req.query.program_id, 10);
    return Number.isInteger(parsed) ? parsed : null;
};


exports.getResourceById = async (req, res) => {
    try {
        const query = `SELECT * FROM resources WHERE resource_id = ${req.params.id}`
        let resource = await DBSendResponse(query)
        res.status(200).json(resource)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.deleteResourceById = async (req, res) => {
    try {
        const query = `UPDATE resources SET resource_is_active = 0 WHERE resource_id = ${req.params.id}`
        await DBSendResponse(query)
        res.status(204).send()
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.getResourcesByCompany = async (req, res) => {
    try {
        const programId = getProgramIdFromReq(req);
        const programFilter = programId
            ? ` AND EXISTS (SELECT 1 FROM program_association pa WHERE pa.entity_type = 'location' AND pa.program_id = ${programId} AND pa.entity_id = CAST(l.loc_id AS NVARCHAR(16)))`
            : '';
        const query = `SELECT * FROM resources r INNER JOIN location l ON r.location_id = l.loc_id LEFT JOIN contact c ON c.con_id=r.contact_id WHERE l.loc_company_id = ${req.params.id}${programFilter}`
        let resources = await DBSendResponse(query)
        res.status(200).json(resources)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.postResource = async (req, res) => {
    try {
        const query = `INSERT INTO resources (resource_name, capacity, notes, location_id, contact_id,resource_is_active) VALUES ('${req.body.resource_name.replaceAll("'", "''")}', ${req.body.capacity}, '${req.body.notes.replaceAll("'", "''")}', ${req.body.location_id},${req.body.contact_id}, 1); SELECT SCOPE_IDENTITY();`
        let resource = await DBinsertSendID(query)
        res.status(200).json(resource)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.updateResourceById = async (req, res) => {
    try {
        const query = `UPDATE resources SET resource_name = '${req.body.resource_name.replaceAll("'", "''")}', capacity = ${req.body.capacity}, notes = '${req.body.notes.replaceAll("'", "''")}', location_id = ${req.body.location_id}, contact_id = ${req.body.contact_id} WHERE resource_id = ${req.params.id}`
        await DBSendResponse(query)
        res.status(204).send()
    } catch (error) {
        res.status(500).json(error)
    }
}
