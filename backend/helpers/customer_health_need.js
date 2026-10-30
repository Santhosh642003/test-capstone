const db = require('../models/indexSQL.js')
const { DBSendResponse } = require('../queries/commonQueries')

exports.getHealthNeedByCustomerId = async (req, res) => {
    try {
        const query = `SELECT * FROM customer_health_need WHERE customer_id = ${req.params.customer_id}`
        let need = await DBSendResponse(query)
        res.status(200).json(need)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.deleteHealthNeedByCustomerId = async (req, res) => {
    try {
        const query = `DELETE FROM customer_health_need WHERE customer_id = ${req.params.customer_id}`
        await DBSendResponse(query)
        res.status(204).send()
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.createHealthNeed = async (req, res) => {
    try {
        const { customer_id, allergies, dietary, health_hazards, self_care } = req.body
        const query = `INSERT INTO customer_health_need (customer_id, allergies, dietary, health_hazards, self_care, create_date, update_date)
                       VALUES (${customer_id}, '${allergies}', '${dietary}', '${health_hazards}', '${self_care}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        let need = await DBSendResponse(query)
        res.status(201).json(need)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.updateHealthNeedByCustomerId = async (req, res) => {
    try {
        const { allergies, dietary, health_hazards, self_care } = req.body
        const query = `UPDATE customer_health_need
                       SET allergies = '${allergies}', dietary = '${dietary}', health_hazards = '${health_hazards}', self_care = '${self_care}', update_date = CURRENT_TIMESTAMP
                       WHERE customer_id = ${req.params.customer_id}`
        await DBSendResponse(query)
        res.status(200).send()
    } catch (error) {
        res.status(500).json(error)
    }
}
