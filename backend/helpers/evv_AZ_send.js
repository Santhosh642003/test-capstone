const axios = require("axios");
var { AZ_EVV_API_BASE_URL } = require("../config");
const { logger } = require('../logger');

const checkStatusPatient = async (transactionID, auth, headers) => {
  const { data } = await axios.get(
    `${AZ_EVV_API_BASE_URL}clients/rest/api/v1.1/status?uuid=${transactionID}`,
    { headers: headers, auth: auth }
  );
  return data;
};

const uploadPatientData = async (payload, auth, headers) => {
  const { data } = await axios.post(
    `${AZ_EVV_API_BASE_URL}clients/rest/api/v1.1`,
    payload,
    { headers: headers, auth: auth },
  );
  return data;
};

const checkStatusEmployee = async (transactionID, auth, headers) => {
  const { data } = await axios.get(
    `${AZ_EVV_API_BASE_URL}employees/rest/api/v1.1/status?uuid=${transactionID}`,
    { headers: headers, auth: auth }
  );
  return data;
};

const uploadEmployeeData = async (payload, auth, headers) => {
  const { data } = await axios.post(
    `${AZ_EVV_API_BASE_URL}employees/rest/api/v1.1`,
    payload,
    { headers: headers, auth: auth }
  );
  return data;
};

const checkStatusVisit = async (transactionID, auth, headers) => {
  const { data } = await axios.get(
    `${AZ_EVV_API_BASE_URL}visits/rest/api/v1.1/status?uuid=${transactionID}`,
    { headers: headers, auth: auth }
  );
  return data;
};

const uploadVisitData = async (payload, auth, headers) => {
  const { data } = await axios.post(
    `${AZ_EVV_API_BASE_URL}visits/rest/api/v1.1`,
    payload,
    { headers: headers, auth: auth }
  );
  return data;
};

module.exports = {
  checkStatusPatient,
  uploadPatientData,
  checkStatusEmployee,
  uploadEmployeeData,
  checkStatusVisit,
  uploadVisitData,
};