// Verifies the frontend's MSAL access token server-side and resolves it to
// a trusted { companyId, employeeId } pair. Used only by
// routes/caseSummaryChat.js -- does not fix or wire into the app-wide auth
// gap on every other route (those still take unverified
// company_id/employee_id query params, unchanged, by design).
//
// This app registration issues v1.0 tokens (`sts.windows.net` issuer form,
// not `login.microsoftonline.com/{tenant}/v2.0`), confirmed against a real
// token. Client IDs/scopes differ per FW_ENV (dev/test/prod, including
// test/prod's own "/user_impersanation" typo in FieldWrkrAnalytiQ/.env --
// preserved verbatim below since it's the actual configured value).
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { DBSendResponseParam } = require('../queries/commonQueries');
const { defaultLogger: logger } = require('../logger');
const config = require('../config');

const TENANT_ID = process.env.MSAL_TENANT_ID || '03136e71-81ec-40e3-b5fa-efc07d831a5b';
const ISSUER = `https://sts.windows.net/${TENANT_ID}/`;
// JWKS endpoint is shared across v1/v2 tokens for a given tenant.
const JWKS_URI = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

const FW_ENV = process.env.FW_ENV || 'dev';

// Per-environment client id / scope, copied verbatim from
// FieldWrkrAnalytiQ/.env (including its test/prod "impersanation" typo --
// that's the literal string Azure issued the token against, so the audience
// check must match it exactly).
const ENV_CONFIG = {
  dev: {
    clientId: process.env.MSAL_CLIENT_ID_DEV || 'a054a549-6431-4dc0-8f8e-f5c67dced49e',
    scope: process.env.MSAL_SCOPE_DEV || 'https://fieldworker4.azurewebsites.net/user_impersonation',
  },
  test: {
    clientId: process.env.MSAL_CLIENT_ID_TEST || '41740536-248d-40b2-8aeb-ca136e20e05a',
    scope: process.env.MSAL_SCOPE_TEST || 'https://fieldworkertestserver.azurewebsites.net/user_impersanation',
  },
  prod: {
    clientId: process.env.MSAL_CLIENT_ID_PROD || '47ce4d13-5286-4c19-b842-75ccdd41b7f6',
    scope: process.env.MSAL_SCOPE_PROD || 'https://fieldworkerserver.azurewebsites.net/user_impersanation',
  },
};

const { clientId: EXPECTED_CLIENT_ID, scope: SCOPE } = ENV_CONFIG[FW_ENV] || ENV_CONFIG.dev;

/**
 * Strips a scope string's trailing scope-name segment to get the App ID URI
 * that Azure puts in the token's `aud` claim
 * ("https://host/user_impersonation" -> "https://host").
 *
 * Deliberately generic: the scope names are not spelled consistently across
 * environments ("user_impersonation" in dev, "user_impersanation" in
 * test/prod), so matching the scope name itself silently breaks whichever
 * environments don't match the pattern.
 *
 * @param {string} scope
 * @returns {string} App ID URI, or the scope unchanged if it has no path.
 */
function appIdUriFromScope(scope) {
  const schemeEnd = scope.indexOf('://');
  const lastSlash = scope.lastIndexOf('/');
  // No path segment beyond the scheme's "//" -- nothing to strip.
  if (schemeEnd === -1 || lastSlash <= schemeEnd + 2) return scope;
  return scope.slice(0, lastSlash);
}

// Confirmed against a real token: `aud` is the bare App ID URI (scope minus
// its trailing scope-name segment). Kept SCOPE/clientId forms as fallback
// matches too, in case token shape differs by environment.
const APP_ID_URI = appIdUriFromScope(SCOPE);
const ACCEPTED_AUDIENCES = [APP_ID_URI, SCOPE, EXPECTED_CLIENT_ID, `api://${EXPECTED_CLIENT_ID}`];
logger.info({ authEnv: FW_ENV, dbEnv: config.env, acceptedAudiences: ACCEPTED_AUDIENCES }, 'msalAuth: token audience configuration');

const client = jwksClient({
  jwksUri: JWKS_URI,
  cache: true,
  cacheMaxAge: 12 * 60 * 60 * 1000, // 12h -- Microsoft rotates signing keys infrequently
  rateLimit: true,
});

function getSigningKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}

class MsalTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MsalTokenError';
  }
}

/**
 * Thrown when a verified email owns several active employee records and the
 * request did not say which one it is acting as. There is no safe default:
 * each record is a different company with a different caseload, so guessing
 * answers confidently about someone else's clients.
 */
class AmbiguousIdentityError extends Error {
  constructor(email, ownedEmployeeIds) {
    super('Caller owns multiple active employee records; empId is required.');
    this.name = 'AmbiguousIdentityError';
    this.email = email;
    this.ownedEmployeeIds = ownedEmployeeIds;
  }
}

/**
 * Verifies an MSAL access token's signature, issuer, and audience against
 * this app's Azure AD tenant/registration, and extracts the caller's email.
 *
 * @param {string} bearerToken - Raw JWT (no "Bearer " prefix).
 * @returns {Promise<{email: string, claims: object}>}
 * @throws {MsalTokenError} on any verification failure or missing email claim.
 */
function verifyMsalAccessToken(bearerToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      bearerToken,
      getSigningKey,
      {
        algorithms: ['RS256'],
        issuer: ISSUER,
        audience: ACCEPTED_AUDIENCES,
      },
      (err, claims) => {
        if (err) {
          return reject(new MsalTokenError(`MSAL token verification failed: ${err.message}`));
        }
        const email = claims.preferred_username || claims.upn || claims.email;
        if (!email || typeof email !== 'string') {
          return reject(new MsalTokenError('MSAL token verified but has no usable email claim (checked preferred_username, upn, email).'));
        }
        resolve({ email, claims });
      },
    );
  });
}

/**
 * Reads the caller's requested employee record id off a request.
 *
 * One email can own several employee records (see resolveCallerIdentity), so
 * the client has to say which one this request is acting as -- POSTs carry it
 * in the body, GETs in the query string.
 *
 * @param {Object} req
 * @returns {{ok: true, employeeId: number|null} | {ok: false}} employeeId is
 *   null when the client sent nothing at all; ok:false means it sent something
 *   that is not a positive integer.
 */
function readRequestedEmployeeId(req) {
  const raw = req.body?.empId ?? req.query?.emp_id;
  if (raw === undefined || raw === null || raw === '') return { ok: true, employeeId: null };

  const employeeId = Number(raw);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return { ok: false };
  return { ok: true, employeeId };
}

/**
 * Resolves a verified email to this app's { companyId, employeeId }.
 * Read-only, parameterized (email originates from a verified JWT claim but
 * is still external input). Deliberately independent of helpers/auth.js's
 * getUsers (that function does analytics tracking + subscription-date
 * gating irrelevant here).
 *
 * Emails are NOT unique across companies -- the same person routinely has an
 * active employee record in several of them, which is why the frontend shows
 * UserSelectionDialog at login. So the caller passes the employee record they
 * picked and this function only honours it if the verified email actually owns
 * it. The token stays the trust anchor: requestedEmployeeId can pick among
 * that email's own records, never reach outside them.
 *
 * @param {string} email
 * @param {number|null} [requestedEmployeeId] - emp_id the caller is acting as.
 * @returns {Promise<{companyId: number, employeeId: number} | null>} null if no
 *   active employee matches, or the requested one is not the caller's -- fail
 *   closed, caller maps this to 401.
 * @throws {AmbiguousIdentityError} if the email owns several active records
 *   and no selection was sent -- caller maps this to 400.
 */
async function resolveCallerIdentity(email, requestedEmployeeId = null) {
  const rows = await DBSendResponseParam(
    "SELECT emp_id, emp_company_id FROM employee WHERE empEmail = @email AND emp_is_active = 'true' ORDER BY emp_id",
    { email },
  );
  if (!rows || rows.length === 0) return null;

  if (requestedEmployeeId !== null) {
    const requested = rows.find((row) => Number(row.emp_id) === Number(requestedEmployeeId));
    if (!requested) {
      logger.warn(
        { email, requestedEmployeeId, ownedEmployeeIds: rows.map((row) => row.emp_id) },
        'resolveCallerIdentity: requested employee record is not owned by this email, denying',
      );
      return null;
    }
    return { companyId: requested.emp_company_id, employeeId: requested.emp_id };
  }

  // No selection sent. One record is unambiguous. Several is a client that has
  // not been updated to send empId, and this used to default to whichever
  // record sorted first -- which silently scoped the request to a different
  // company. That reads as an answer, not as an error: an admin asking about
  // "all my patients" got a fluent review of a caseload that was not theirs,
  // and only noticed when the arbitrary company happened to be empty. Refuse
  // instead, and name the records the client may choose between.
  if (rows.length > 1) {
    logger.warn(
      { email, ownedEmployeeIds: rows.map((row) => row.emp_id) },
      'resolveCallerIdentity: email owns multiple active employee records but request sent no empId, refusing to guess',
    );
    throw new AmbiguousIdentityError(email, rows.map((row) => Number(row.emp_id)));
  }
  return { companyId: rows[0].emp_company_id, employeeId: rows[0].emp_id };
}

/**
 * Express middleware. Verifies the request's MSAL bearer token and attaches
 * `req.callerIdentity = { companyId, employeeId }`. Responds 401 and does
 * NOT call next() on any failure. Mount only on routes that need it -- never
 * globally in index.js.
 *
 * Callers whose email owns employee records in more than one company must send
 * the one they are acting as: `empId` in the body (POST) or `emp_id` in the
 * query string (GET). It is checked against the token's own records, so it
 * selects an identity rather than asserting one.
 */
async function requireMsalIdentity(req, res, next) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ message: 'Missing or malformed Authorization header.' });
  }

  const requested = readRequestedEmployeeId(req);
  if (!requested.ok) {
    return res.status(400).json({ message: 'empId must be a positive integer.' });
  }

  let email;
  try {
    ({ email } = await verifyMsalAccessToken(match[1]));
  } catch (err) {
    // Log the rejected token's own aud/iss (decoded, NOT trusted -- for
    // diagnosis only) so an environment misconfiguration is visible from the
    // logs instead of looking like a generic expired-token failure.
    let presented = null;
    try {
      const decoded = jwt.decode(match[1]);
      presented = { aud: decoded?.aud, iss: decoded?.iss };
    } catch (_) { /* undecodable token -- nothing extra to report */ }
    logger.warn({ err, presented, expected: { audiences: ACCEPTED_AUDIENCES, issuer: ISSUER } }, 'requireMsalIdentity: token verification failed');
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }

  let identity;
  try {
    identity = await resolveCallerIdentity(email, requested.employeeId);
  } catch (err) {
    if (err instanceof AmbiguousIdentityError) {
      return res.status(400).json({
        message: 'This account exists in more than one company. Reload the page and sign in again to pick which one to use.',
        code: 'EMP_ID_REQUIRED',
        employeeIds: err.ownedEmployeeIds,
      });
    }
    logger.error(err, 'requireMsalIdentity: identity lookup failed');
    return res.status(401).json({ message: 'Could not resolve caller identity.' });
  }

  if (!identity) {
    logger.warn({ email, requestedEmployeeId: requested.employeeId }, 'requireMsalIdentity: token verified but no matching active employee found for this email');
    return res.status(401).json({ message: 'No active account found for this identity.' });
  }

  req.callerIdentity = identity;
  next();
}

module.exports = {
  requireMsalIdentity,
  verifyMsalAccessToken,
  resolveCallerIdentity,
  readRequestedEmployeeId,
  MsalTokenError,
  AmbiguousIdentityError,
};
