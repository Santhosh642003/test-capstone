const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries.js')
const moment = require('moment')


exports.getBillingRates = async function (req, res) {
  try {

  } catch (error) {

  }
}

exports.getMappedBillingRates = async function (req, res) {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ message: 'Company ID is required' });
    }

    // 1. Get all TaskProcCodeMapping entries for the company
    const mappingQuery = `SELECT * FROM [dbo].[TaskProcCodeMapping] WHERE comp_id = ${company_id}`;
    const mappings = await DBSendResponse(mappingQuery);

    if (!mappings.length) {
      return res.json([]);
    }

    // 2. Get all relevant procedure_code entries
    const procCodeIds = mappings.map(m => m.procedure_code_id).filter(Boolean);
    if (!procCodeIds.length) {
      return res.json([]);
    }
    const procCodeQuery = `SELECT * FROM procedure_code WHERE procCode_id IN (${procCodeIds.join(',')})`;
    const procCodes = await DBSendResponse(procCodeQuery);

    // 3. Get all billingrates where procProcCode matches any from procedure_code
    const procProcCodes = procCodes.map(pc => `'${pc.procProcCode}'`).join(',');
    if (!procProcCodes.length) {
      return res.json([]);
    }

    console.log(procProcCodes)

    // Use direct string interpolation as requested
    const query = `SELECT * FROM billingrates WHERE procProcCode IN (${procProcCodes})`;
    const billingRatesList = await DBSendResponse(query);

    res.json(billingRatesList);
  } catch (error) {
    console.error('Error fetching mapped billing rates:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}