const db = require('../models/indexSQL.js');
const {
  DBUpdate,
  generateInsertSQL,
  generateUpdateSQL,
  DBSendResponse
} = require('../queries/commonQueries.js');
const csv = require('csvtojson');
const axios = require('axios');
const validators = require('./validators.js');
const configOptions = require('../config.js');
const moment = require('moment');
const { parseSQLText } = require('../utils/validation.js');

const onboardURL = (configOptions.env == 'prod') ? 'https://fieldworkeronboardprod.azurewebsites.net/api/fieldworker/onboard/initaddEmployee' : 
  (configOptions.env == 'test') ? 'https://fieldworkeronboard.azurewebsites.net/api/fieldworker/onboard/initaddEmployee' : 
    'https://fwonboardapp.azurewebsites.net/api/fieldworker/onboard/initaddEmployee';
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');

const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

const FormData = require('form-data');

exports.startSync = async function (req, res) {
  try {
    if (!req.file) {
      res.status(400).json({
        message: 'File not present or missed while uploading.'
      });
      return;
    }

    const newApiUrl = (configOptions.env == 'prod') 
      ? `https://fieldworkeronboardprod.azurewebsites.net/api/fieldworker/bulk/DDDSync?${new URLSearchParams(req.query).toString()}`
      : (configOptions.env == 'test') 
        ? `https://fieldworkeronboard.azurewebsites.net/api/fieldworker/bulk/DDDSync?${new URLSearchParams(req.query).toString()}`
        : `https://fwonboardapp.azurewebsites.net/api/fieldworker/bulk/DDDSync?${new URLSearchParams(req.query).toString()}`;

    const form = new FormData();
    form.append('filecontent', req.file.buffer, req.file.originalname);

    const response = await axios.post(newApiUrl, form, {
      headers: {
        ...form.getHeaders(),
      }
    });

    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Error forwarding request to new API:', error);

    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
      res.status(500).json({ message: 'No response received from the new API' });
    } else {
      res.status(500).json({ message: 'Error setting up request to the new API' });
    }
  }
};