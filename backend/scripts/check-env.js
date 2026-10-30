// Preflight: reports which environment variables the form-ingestion backend needs are set or missing.
//   npm run check:env                 # everything
//   npm run check:env -- --json       # machine-readable
// Prints names and set/missing ONLY, never values. Reads .env from the fieldworker folder. Connects to nothing.
const fs = require('fs');
const path = require('path');

// effective FW_ENV exactly as config.js resolves it (unset => prod!)
const envSuffix = (e) => (e === 'prod' ? 'PROD' : e === 'test' ? 'TEST' : 'DEV');

/**
 * Variable spec. needs: 'smoke' = required for smoke:model and eval:forms (Azure OpenAI only);
 * 'api' = required for the full API / publishing / packs; 'opt' = optional (has a default or only enables a feature).
 */
const buildSpec = (env) => {
  const sfx = envSuffix(env);
  return [
    { group: 'Azure OpenAI', name: 'FOUNDRY_API_KEY', needs: 'smoke', note: 'key of the Azure OpenAI resource' },
    { group: 'Azure OpenAI', name: 'FOUNDRY_URL', needs: 'smoke', note: 'base ending in /openai/v1 (code appends /chat/completions)' },
    { group: 'Azure OpenAI', name: 'FOUNDRY_LLM_MODEL', needs: 'opt', note: 'DEPLOYMENT name; defaults to gpt-4.1' },
    { group: 'SQL Server', name: `DB_SERVER_${sfx === 'TEST' ? 'DEV' : sfx}`, needs: 'api', note: `for FW_ENV=${env}` },
    { group: 'SQL Server', name: `DB_USERNAME_${sfx === 'TEST' ? 'DEV' : sfx}`, needs: 'api', note: '' },
    { group: 'SQL Server', name: `DB_PWD_${sfx === 'TEST' ? 'DEV' : sfx}`, needs: 'api', note: '' },
    { group: 'SQL Server', name: `APIDB_${sfx}`, needs: 'api', note: 'target database name' },
    { group: 'Blob', name: 'BLOB_KEY', needs: 'api', note: 'base64 storage key; also needed to store source PDFs' },
    { group: 'Blob', name: `CONTAINER_NAME_${sfx}`, needs: 'api', note: 'log container used by the API logger' },
    { group: 'Form import', name: 'FORM_IMPORT_CONTAINER_NAME', needs: 'opt', note: 'source-PDF container; if unset PDFs are simply not stored' },
    { group: 'Form import', name: 'MIS_COMPANY_ID', needs: 'opt', note: 'defaults to 2000' },
    { group: 'Auth', name: 'FW_ENV', needs: 'api', note: 'dev | test | prod. UNSET MEANS PROD in config.js' },
    { group: 'Auth', name: 'MSAL_TENANT_ID', needs: 'opt', note: 'has a built-in default' },
    { group: 'Auth', name: `MSAL_CLIENT_ID_${envSuffix(env)}`, needs: 'opt', note: 'has a built-in default per environment' },
    { group: 'Auth', name: `MSAL_SCOPE_${envSuffix(env)}`, needs: 'opt', note: 'has a built-in default per environment' },
    { group: 'Auth', name: 'DEV_AUTH_BYPASS', needs: 'opt', note: 'local e2e only; REFUSED when NODE_ENV=production or FW_ENV=prod' },
  ];
};

const isPlaceholder = (v) => /^<.*>$/.test(String(v).trim()) || /^(changeme|todo|xxx+)$/i.test(String(v).trim());

/**
 * Pure function (unit-tested): takes an env object, returns { env, rows, smokeReady, apiReady, warnings }.
 * Each row: { group, name, needs, note, state: 'set' | 'missing' | 'placeholder' }. Values are never copied out.
 */
const checkEnv = (env) => {
  const fwEnv = env.FW_ENV || 'prod';
  const rows = buildSpec(fwEnv).map((r) => {
    const v = env[r.name];
    const state = v === undefined || String(v).trim() === '' ? 'missing' : isPlaceholder(v) ? 'placeholder' : 'set';
    return { ...r, state };
  });
  const bad = (r) => r.state !== 'set';
  const smokeReady = rows.filter((r) => r.needs === 'smoke').every((r) => !bad(r));
  const apiReady = rows.filter((r) => r.needs === 'smoke' || r.needs === 'api').every((r) => !bad(r));

  const warnings = [];
  if (!env.FW_ENV) warnings.push('FW_ENV is unset: config.js then defaults to PROD (prod database and container settings). Set FW_ENV=dev for local runs.');
  const url = String(env.FOUNDRY_URL || '');
  if (url && !/^https:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(url)) warnings.push('FOUNDRY_URL should start with https://');
  if (/\/chat\/completions\/?$/i.test(url)) warnings.push('FOUNDRY_URL must be the BASE (…/openai/v1); the code appends /chat/completions itself.');
  if (url && !/\/openai\/v1\/?$/i.test(url) && /openai\.azure\.com|services\.ai\.azure\.com/i.test(url)) warnings.push('FOUNDRY_URL does not end in /openai/v1; the other FieldWorker AI features use that form.');
  if (env.BLOB_KEY && !/^[A-Za-z0-9+/]+={0,2}$/.test(String(env.BLOB_KEY).trim())) warnings.push('BLOB_KEY does not look like base64 (the logger fails to start with an invalid key).');
  if (String(env.DEV_AUTH_BYPASS || '').toLowerCase() === 'true' && (env.NODE_ENV === 'production' || fwEnv === 'prod')) warnings.push('DEV_AUTH_BYPASS=true with NODE_ENV=production / FW_ENV=prod: the API will refuse to start. Remove it.');
  if (env.FOUNDRY_API_KEY && String(env.FOUNDRY_API_KEY).length < 20 && !isPlaceholder(env.FOUNDRY_API_KEY)) warnings.push('FOUNDRY_API_KEY is unusually short.');
  return { env: fwEnv, rows, smokeReady, apiReady, warnings };
};

const migrationCommand = (env) => {
  const fwEnv = env.FW_ENV || 'prod';
  const sfx = envSuffix(fwEnv);
  const dbSfx = sfx === 'TEST' ? 'DEV' : sfx;
  const server = env[`DB_SERVER_${dbSfx}`] || `<DB_SERVER_${dbSfx}>`;
  const db = env[`APIDB_${sfx}`] || `<APIDB_${sfx}>`;
  return { server, database: db, command: `sqlcmd -S ${server} -d ${db} -U "$DB_USERNAME_${dbSfx}" -P "$DB_PWD_${dbSfx}" -i db/mssql/002_form_packs.sql` };
};

const main = () => {
  // dotenv does not override variables that are already exported in the shell
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });  
  const res = checkEnv(process.env);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(res, null, 2)); process.exit(res.smokeReady ? 0 : 1); }
  const hasFile = fs.existsSync(path.join(__dirname, '..', '.env'));
  console.log(`check:env  (FW_ENV=${res.env}${process.env.FW_ENV ? '' : ' [unset -> prod default]'}; .env file ${hasFile ? 'found' : 'NOT found'}; secret values are never printed)\n`);
  let group = '';
  res.rows.forEach((r) => {
    if (r.group !== group) { group = r.group; console.log(`${group}`); }
    const need = r.needs === 'smoke' ? 'REQUIRED: smoke test + API' : r.needs === 'api' ? 'required: full API' : 'optional';
    const mark = r.state === 'set' ? 'set        ' : r.state === 'placeholder' ? 'PLACEHOLDER' : r.needs === 'opt' ? 'not set    ' : 'MISSING    ';
    console.log(`  ${mark} ${r.name.padEnd(28)} ${need}${r.note ? `  - ${r.note}` : ''}`);
  });
  console.log('');
  res.warnings.forEach((w) => console.log(`WARNING: ${w}`));
  console.log(`\nModel smoke test / eval (needs only Azure OpenAI vars): ${res.smokeReady ? 'READY' : 'NOT READY'}`);
  console.log(`Full API (SQL + blob + auth too):                       ${res.apiReady ? 'READY' : 'NOT READY'}`);
  const m = migrationCommand(process.env);
  console.log(`\nDatabase migration (NOT run by any script). To apply it yourself, confirm the target first:\n  server:   ${m.server}\n  database: ${m.database}\n  command:  ${m.command}`);
  process.exit(res.smokeReady ? 0 : 1);
};

if (require.main === module) main();
module.exports = { checkEnv, buildSpec, migrationCommand };
