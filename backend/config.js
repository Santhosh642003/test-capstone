const env = process.env.FW_ENV || 'prod';
// FW_LOGGING_METHOD overrides the default; the form-ingestion scripts (smoke:model, eval:forms, e2e:import) and tests set it to 'console'
// so that running them never uploads or deletes anything in the log blob container.
const loggingMethod = process.env.FW_LOGGING_METHOD || 'blob'; //'blob' for azure cloud storage, 'local' for local file storage to /logs, or 'console' to print to console
const loggingLevel = process.env.LOGGING_LEVEL || 'info';

let APIDB;
let CONTAINER_NAME;
const DB_USERNAME =
  env === 'prod' ? process.env.DB_USERNAME_PROD : process.env.DB_USERNAME_DEV;
const DB_PWD =
  env === 'prod' ? process.env.DB_PWD_PROD : process.env.DB_PWD_DEV;
const DB_SERVER =
  env === 'prod' ? process.env.DB_SERVER_PROD : process.env.DB_SERVER_DEV;
const BLOB_KEY = process.env.BLOB_KEY;
const API_KEY = process.env.BING_API;
const AUTH_POLICY_URL = process.env.AUTH_POLICY_REPO_URL;
if (env === 'prod') {
  APIDB = process.env.APIDB_PROD;
  CONTAINER_NAME = process.env.CONTAINER_NAME_PROD;
} else if (env === 'test') {
  APIDB = process.env.APIDB_TEST;
  CONTAINER_NAME = process.env.CONTAINER_NAME_TEST;
} else {
  APIDB = process.env.APIDB_DEV;
  CONTAINER_NAME = process.env.CONTAINER_NAME_DEV;
}

var SEGMENT_API_KEY =
  env === 'prod'
    ? process.env.REACT_APP_SEGMENTAPIKEY_PROD
    : process.env.REACT_APP_SEGMENTAPIKEY_DEVTEST;

var EVV_API_BASE_URL =
  env === 'prod'
    ? 'https://cloud.hhaexchange.com'
    : 'https://implementation.hhaexchange.com';
var EVV_API_CLIENT_ID =
  env === 'prod'
    ? '0195cf00-c0a1-4d05-9d5d-6b66aa66f82f'
    : '4ea6f186-2780-4266-8355-8290347461e6';
var EVV_API_CLIENT_SECRET =
  env === 'prod'
    ? '9d4abbe3-9cf1-47c3-9adc-86d363789f29'
    : 'cb968cf4-adf7-4807-9b56-31e9e1fd835f';

var AZ_EVV_API_BASE_URL =
  env === 'prod'
    ? 'https://api.sandata.com/interfaces/intake/'
    : 'https://uat-api.sandata.com/interfaces/intake/';

var CUSTOMERIO_API_KEY =
  env === 'prod'
    ? process.env.REACT_APP_CUSTOMERIOAPIKEY_PROD
    : process.env.REACT_APP_CUSTOMERIOAPIKEY_DEVTEST;

var IN_APP_MESSAGE_MT_SUBMISSION_ID =
  env === 'prod'
    ? process.env.IN_APP_MESSAGE_MT_SUBMISSION_ID_PROD
    : process.env.IN_APP_MESSAGE_MT_SUBMISSION_ID_DEVTEST;

var IN_APP_MESSAGE_TIMESHEET_SUBMISSION_ID =
  env === 'prod'
    ? process.env.IN_APP_MESSAGE_TIMESHEET_SUBMISSION_ID_PROD
    : process.env.IN_APP_MESSAGE_TIMESHEET_SUBMISSION_ID_DEVTEST;

var IN_APP_MESSAGE_MT_STATUS_ID =
  env === 'prod'
    ? process.env.IN_APP_MESSAGE_MT_STATUS_ID_PROD
    : process.env.IN_APP_MESSAGE_MT_STATUS_ID_DEVTEST;

var IN_APP_MESSAGE_MISSED_CLOCK_IN_ID =
  env === 'prod'
    ? process.env.IN_APP_MESSAGE_MISSED_CLOCK_IN_ID_PROD
    : process.env.IN_APP_MESSAGE_MISSED_CLOCK_IN_ID_DEVTEST;

var IN_APP_MESSAGE_SHIFT_BROADCAST_ID =
  env === 'prod'
    ? process.env.IN_APP_MESSAGE_SHIFT_BROADCAST_ID_PROD
    : process.env.IN_APP_MESSAGE_SHIFT_BROADCAST_ID_DEVTEST;

var IN_APP_MESSAGE_MISSED_CLOCK_OUT_ID =
  env === 'prod'
    ? process.env.IN_APP_MESSAGE_MISSED_CLOCK_OUT_ID_PROD
    : process.env.IN_APP_MESSAGE_MISSED_CLOCK_OUT_ID_DEVTEST;

var IN_APP_MESSAGE_APPROVAL_REJECTED_ID =
  env === 'prod'
    ? process.env.IN_APP_MESSAGE_APPROVAL_REJECTED_ID_PROD
    : process.env.IN_APP_MESSAGE_APPROVAL_REJECTED_ID_DEVTEST;

var CLAIM_MD_API_KEY = env === 'prod' ? process.env.CLAIM_MD_API_KEY_PROD : process.env.CLAIM_MD_API_KEY_TEST;

var Auth0_Audience =
  env === 'prod'
    ? process.env.AUTH0_AUDIENCE_PROD
    : process.env.AUTH0_AUDIENCE_DEV;

var Auth0_Domain =
  env === 'prod'
    ? process.env.AUTH0_DOMAIN_PROD
    : process.env.AUTH0_DOMAIN_DEV;

var Auth0_Management_API_Client_ID =
  env === 'prod'
    ? process.env.Auth0_Management_API_Client_ID_PROD
    : process.env.Auth0_Management_API_Client_ID_DEV;

var Auth0_Management_API_Client_Secret =
  env === 'prod'
    ? process.env.Auth0_Management_API_Client_Secret_PROD
    : process.env.Auth0_Management_API_Client_Secret_DEV;

var AH_CUSTOMERIO_PUSH_KEY = process.env.REACT_APP_CUSTOMERIOAPIKEY_DEVTEST;

const FOUNDRY_API_KEY = process.env.FOUNDRY_API_KEY;
const PG_URL = env === 'prod' ? process.env.PG_PROD_URL : process.env.PG_DEV_URL;
const FOUNDRY_URL = process.env.FOUNDRY_URL;
const FOUNDRY_EMBEDDING_MODEL = process.env.FOUNDRY_EMBEDDING_MODEL;
const FOUNDRY_LLM_MODEL = process.env.FOUNDRY_LLM_MODEL;

exports.env = env;
exports.APIDB = APIDB;
exports.LOGGING_METHOD = loggingMethod;
exports.LOGGING_LEVEL = loggingLevel;
exports.CONTAINER_NAME = CONTAINER_NAME;
exports.DB_USERNAME = DB_USERNAME;
exports.DB_PWD = DB_PWD;
exports.DB_SERVER = DB_SERVER;
exports.BLOB_KEY = BLOB_KEY;
exports.EVV_API_BASE_URL = EVV_API_BASE_URL;
exports.EVV_API_CLIENT_ID = EVV_API_CLIENT_ID;
exports.EVV_API_CLIENT_SECRET = EVV_API_CLIENT_SECRET;
exports.BING_API_KEY = API_KEY;
exports.DOCUMENTS_CONTAINER_NAME = process.env.DOCUMENTS_CONTAINER_NAME;
exports.GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
exports.AZ_EVV_API_BASE_URL = AZ_EVV_API_BASE_URL;
exports.SEGMENT_API_KEY = SEGMENT_API_KEY;
exports.CUSTOMERIO_API_KEY = CUSTOMERIO_API_KEY;
exports.IN_APP_MESSAGE_MT_SUBMISSION_ID = IN_APP_MESSAGE_MT_SUBMISSION_ID;
exports.IN_APP_MESSAGE_TIMESHEET_SUBMISSION_ID = IN_APP_MESSAGE_TIMESHEET_SUBMISSION_ID;
exports.IN_APP_MESSAGE_MT_STATUS_ID = IN_APP_MESSAGE_MT_STATUS_ID;
exports.IN_APP_MESSAGE_MISSED_CLOCK_IN_ID = IN_APP_MESSAGE_MISSED_CLOCK_IN_ID;
exports.IN_APP_MESSAGE_SHIFT_BROADCAST_ID = IN_APP_MESSAGE_SHIFT_BROADCAST_ID;
exports.IN_APP_MESSAGE_MISSED_CLOCK_OUT_ID = IN_APP_MESSAGE_MISSED_CLOCK_OUT_ID;
exports.IN_APP_MESSAGE_APPROVAL_REJECTED_ID = IN_APP_MESSAGE_APPROVAL_REJECTED_ID;
exports.CLAIM_MD_API_KEY = CLAIM_MD_API_KEY;
exports.Auth0_Domain = Auth0_Domain;
exports.Auth0_Audience = Auth0_Audience;
exports.Auth0_Management_API_Client_ID = Auth0_Management_API_Client_ID;
exports.Auth0_Management_API_Client_Secret = Auth0_Management_API_Client_Secret;
exports.AUTH_POLICY_REPO_URL = AUTH_POLICY_URL;
exports.AH_CUSTOMERIO_PUSH_KEY = AH_CUSTOMERIO_PUSH_KEY;
exports.FOUNDRY_API_KEY = FOUNDRY_API_KEY;
exports.PG_URL = PG_URL;
exports.FOUNDRY_URL = FOUNDRY_URL;
exports.FOUNDRY_EMBEDDING_MODEL = FOUNDRY_EMBEDDING_MODEL;
exports.FOUNDRY_LLM_MODEL = FOUNDRY_LLM_MODEL;
// Form ingestion (project 05): blank state PDFs uploaded in MIS are kept in a dedicated, restricted container.
exports.FORM_IMPORT_CONTAINER_NAME = process.env.FORM_IMPORT_CONTAINER_NAME;
// Only employees of this company (ANALYTIQ, the MIS operator) may import forms or curate packs.
exports.MIS_COMPANY_ID = Number(process.env.MIS_COMPANY_ID || 2000);
