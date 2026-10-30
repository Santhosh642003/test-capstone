const db = require('../models/indexSQL.js');
const moment = require('moment');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { addcompany } = require('../queries/dependantQueries');
// const {updateLocation} = require('./location')

exports.getCompany = async function (req, res) {
  const query = `select * from company where com_id=${req.query.company_id}`;
  const response = await DBSendResponse(query);
  res.status(200).json(response[0]);
};

exports.updateCompanyBillingInfo = async function (req, res) {
  const query = `update company 
    set NPI='${req.body.NPI}',TaxonomyCode='${req.body.TaxonomyCode}',ZIP9='${req.body.ZIP9}'
    where com_id=${req.query.company_id}`;
  const response = await DBSendResponse(query);
  res.status(200).json(response);
};


exports.searchCompanies = async function (req, res) {
  const q = req.query.q;
  if (!q) return res.status(400).json({ message: 'q is required' });
  const query = `select com_id, com_name, com_guid from company where com_guid is not null and (com_name like '%${q}%' or com_guid like '%${q}%')`;
  const result = await DBSendResponse(query);
  return res.status(200).json(result);
};

