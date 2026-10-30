const db = require('../models/indexSQL.js')
const { DBSendResponse } = require('../queries/commonQueries')

exports.getEmploymentNeedByCustomerId = async (req, res) => {
    try {
        const query = `SELECT * FROM customer_empl_need WHERE customer_id = ${req.params.customer_id}`
        let need = await DBSendResponse(query)
        res.status(200).json(need)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.deleteEmploymentNeedByCustomerId = async (req, res) => {
    try {
        const query = `DELETE FROM customer_empl_need WHERE customer_id = ${req.params.customer_id}`
        await DBSendResponse(query)
        res.status(204).send()
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.createEmploymentNeed = async (req, res) => {
    try {
        const { customer_id, employment_first_plan, employment_plan, voting_plan } = req.body
        const query = `INSERT INTO customer_empl_need (customer_id, employment_first_plan, employment_plan, voting_plan, create_date, update_date)
                       VALUES (${customer_id}, '${employment_first_plan}', '${employment_plan}', '${voting_plan}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        let need = await DBSendResponse(query)
        res.status(201).json(need)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.updateEmploymentNeedByCustomerId = async (req, res) => {
    try {
        const { employment_first_plan, employment_plan, voting_plan } = req.body
        const query = `UPDATE customer_empl_need
                       SET employment_first_plan = '${employment_first_plan}', employment_plan = '${employment_plan}', voting_plan = '${voting_plan}', update_date = CURRENT_TIMESTAMP
                       WHERE customer_id = ${req.params.customer_id}`
        await DBSendResponse(query)
        res.status(200).send()
    } catch (error) {
        res.status(500).json(error)
    }
}
