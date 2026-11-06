// To hit a locally running MIS API instead of Azure, set LOCAL_OVERRIDE to the
// environment you want redirected ('dev' | 'test' | 'prod'). Leave '' for normal use.
const LOCAL_OVERRIDE = '';
const LOCAL_MIS_APIURL = 'http://localhost:4000/api/fieldworker';

const misApiUrl = (envName, url) => (LOCAL_OVERRIDE === envName ? LOCAL_MIS_APIURL : url);

// MIS backend per environment. The active one is chosen at runtime by the
// in-app environment toggle (see ToggleMIS).
const MIS_APIURL = {
  dev: misApiUrl('dev', process.env.REACT_APP_APIURL1),
  test: misApiUrl('test', process.env.REACT_APP_APIURL2),
  prod: misApiUrl('prod', process.env.REACT_APP_APIURL3),
};

// Onboarding API (provisions a new company + its Azure AD users), per environment.
const ONBOARD_APIURL = {
  dev: 'https://fwonboardapp.azurewebsites.net/api/fieldworker/onboard',
  test: 'https://fieldworkeronboard.azurewebsites.net/api/fieldworker/onboard',
  prod: 'https://fieldworkeronboardprod.azurewebsites.net/api/fieldworker/onboard',
};

// Main Fieldworker API + Azure AD app registration. Always prod — used for
// login and resolving the signed-in user, regardless of the MIS env toggle.
const APIURL = process.env.REACT_APP_APIURL_PROD;
const SCOPE = process.env.REACT_APP_SCOPE_PROD;
const CLIENT_ID = process.env.REACT_APP_CLIENT_ID_PROD;
const MSTENANT = process.env.REACT_APP_MSTENANT;

const MUI_KEY = process.env.REACT_APP_MATERIAL_UI_LICENSE_KEY;

// FWAPI (task_form routes: AI import, publish, packs) per environment. Dev/prod URLs come from .env; test falls back to the
// known test server. NOTE: FWAPI verifies the caller's Azure AD token against ITS OWN app registration (msalAuth.js),
// so the access token must be issued for the selected environment's scope.
const FW_APIURL = {
  dev: process.env.REACT_APP_APIURL_DEV,
  test: process.env.REACT_APP_APIURL_TEST || 'https://fieldworkertestserver.azurewebsites.net/api/fieldworker',
  prod: process.env.REACT_APP_APIURL_PROD,
};

export { FW_APIURL, MIS_APIURL, ONBOARD_APIURL, APIURL, SCOPE, CLIENT_ID, MSTENANT, MUI_KEY };
// Demo mode: skips Azure AD login and serves import / pack data from an in-browser mock
// (see services/formsApi.js). Start with `npm run start:demo`.
const DEMO_MODE = process.env.REACT_APP_DEMO === '1';
// Feature flag for the Import Form and Form Packs pages (brief §6).
const IMPORT_FORM_ENABLED = DEMO_MODE || process.env.REACT_APP_IMPORT_FORM_ENABLED === 'true';

// Demo + live: PDFs the user DROPS are sent to this local import API (backend: `npm run serve:import`) and converted by the
// real model. The bundled-sample buttons keep replaying saved drafts. Empty = no live model in demo mode.
const LIVE_API = DEMO_MODE ? (process.env.REACT_APP_LIVE_API || '') : '';

export { DEMO_MODE, IMPORT_FORM_ENABLED, LIVE_API };
