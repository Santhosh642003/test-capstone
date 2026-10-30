const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries.js');
const moment = require('moment');
const { deleteOne } = require('./delete.js');
const { env } = require('../config.js');

exports.healthCheck = async function (req, res) {
  const dbResponse = await DBSendResponse(`select * from company where com_id='${env == 'prod' ? 2000 : env == 'test' ? 2002 : 2004}'`);
  res.json({
    AnalytiqCompanyInfo: dbResponse,
    timestamp: moment().format('YYYY-MM-DDThh:mm:ss'),
    environment: env
  });
};

exports.triggerCrash = async function (req, res) {
  throw new Error('This is a test error');
};

exports.triggerDatabaseError = async function (req, res) {
  const dbBadResponse = await DBSendResponse(`select * from company123 where com_id='${env == 'prod' ? 2000 : env == 'test' ? 2002 : 2004}1'`);
  res.json({
    AnalytiqCompanyInfo: dbBadResponse,
    timestamp: moment().format('YYYY-MM-DDThh:mm:ss'),
    environment: env
  });
};

exports.trigger500 = async function (req, res) {
  res.send(500);
  return;
};

exports.trigger400 = async function (req, res) {
  res.send(400);
  return;
};

exports.trigger300 = async function (req, res) {
  res.send(300);
  return;
};

exports.trigger200 = async function (req, res) {
  res.send(200);
  return;
};