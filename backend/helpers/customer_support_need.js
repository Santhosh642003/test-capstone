const db = require('../models/indexSQL.js')
const { DBSendResponse } = require('../queries/commonQueries')

exports.getSupportNeedByCustomerId = async (req, res) => {
    try {
        const query = `SELECT * FROM customer_support_need WHERE customer_id = ${req.params.customer_id}`
        let need = await DBSendResponse(query)
        res.status(200).json(need)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.deleteSupportNeedByCustomerId = async (req, res) => {
    try {
        const query = `DELETE FROM customer_support_need WHERE customer_id = ${req.params.customer_id}`
        await DBSendResponse(query)
        res.status(204).send()
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.createSupportNeed = async (req, res) => {
    try {
        const { customer_id, behavior, mobility, religious_cultural, support_settings } = req.body
        const query = `INSERT INTO customer_support_need (customer_id, behavior, mobility, religious_cultural, support_settings, create_date, update_date)
                       VALUES (${customer_id}, '${behavior}', '${mobility}', '${religious_cultural}', '${support_settings}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
        let need = await DBSendResponse(query)
        res.status(201).json(need)
    } catch (error) {
        res.status(500).json(error)
    }
}

exports.updateSupportNeedByCustomerId = async (req, res) => {
    try {
        const { behavior, mobility, religious_cultural, support_settings } = req.body
        const query = `UPDATE customer_support_need
                       SET behavior = '${behavior}', mobility = '${mobility}', religious_cultural = '${religious_cultural}', support_settings = '${support_settings}', update_date = CURRENT_TIMESTAMP
                       WHERE customer_id = ${req.params.customer_id}`
        await DBSendResponse(query)
        res.status(200).send()
    } catch (error) {
        res.status(500).json(error)
    }
}
