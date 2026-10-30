const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const { addTaskAndReturnId } = require('../queries/dependantQueries');
const axios = require('axios');
const moment = require('moment-timezone');
const { env, Auth0_Domain, Auth0_Audience, Auth0_Management_API_Client_ID, Auth0_Management_API_Client_Secret } = require('../config.js');
const ahSync = require('./ah_sync');

exports.inviteToAbilityHub = async function (req, res) {
  try {
    const { empEmail, empName, cusEmail, cusName, conEmail, conName, inviteType, compName, customer_id } = req.body;

    // Get Auth0 Access Token
    const accessToken = await getAuth0AccessToken();
    if (!accessToken) return res.status(500).json({ message: 'Failed to get Auth0 access token' });

    // Auth0 API headers
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    };

    // Get users from AH
    const [employee, customer, contact] = await Promise.all([
      getUserFromAH(empEmail, accessToken, headers),
      getUserFromAH(cusEmail, accessToken, headers),
      getUserFromAH(conEmail, accessToken, headers)
    ]);

    const employeeAH_UserID = employee?.UserID || await createAH_User(empEmail, empName, 'Caregiver', headers);
    const employeeName = employee?.UserName || empName;

    const patientID = await ensurePatientExists(customer, cusEmail, cusName, headers);
    if (!patientID) return res.status(500).json({ message: 'Could not create or retrieve patient' });

    // Invite Customer
    if (inviteType === 'Customer' || inviteType === 'Contact') {
      await inviteUser({
        inviterId: employeeAH_UserID,
        inviterName: employeeName,
        userName: cusName,
        userEmail: cusEmail,
        userType: 'Patient',
        patientID,
        patientName: cusName,
        headers,
        compName: compName
      });
    }

    // Invite Contact
    if (inviteType === 'Contact') {
      const contactID = contact?.UserID || await createAH_User(conEmail, conName, 'Contact', headers);
      await inviteUser({
        inviterId: employeeAH_UserID,
        inviterName: employeeName,
        userName: conName,
        userEmail: conEmail,
        userType: 'Contact',
        patientID,
        patientName: cusName,
        headers,
        compName: compName
      });
    }

    // Create sync record so we can track consent later
    if (customer_id && patientID) {
      try {
        const ahUserId = customer?.UserID || null;
        await ahSync.createSyncRecord({ customer_id: parseInt(customer_id), ah_patient_id: patientID, ah_user_id: ahUserId });
      } catch (e) {
        console.log('Failed to create AH sync record (non-blocking):', e);
      }
    }

    return res.status(200).json({ message: 'User invited successfully' });
  } catch (err) {
    req.log.error(err, 'Error inviting to AbilityHub');
    return res.status(500).json({ message: 'An unexpected error occurred' });
  }
};

const getAuth0AccessToken = async () => {
  try {
    const response = await axios.post(`${Auth0_Domain}/oauth/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: Auth0_Management_API_Client_ID,
        client_secret: Auth0_Management_API_Client_Secret,
        audience: Auth0_Audience
      }),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' } }
    );
    return response.data.access_token;
  } catch (error) {
    console.error('Auth0 token error:', error);
    return null;
  }
};

const getUserFromAH = async (email, accessToken, headers) => {
  if (!email) return null;
  try {
    const response = await axios.get(`${Auth0_Audience}api/ah_fieldworker/user`, {
      params: { UserAuth0Email: email },
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!Array.isArray(response.data) || !response.data.length) {
      console.warn('User not found for email:', email);
      return null;
    }

    const user = response.data[0];

    await axios.put(`${Auth0_Audience}api/ah_fieldworker/user`,
      {
        UserID: user.UserID,
        UserName: user.UserName,
        UserEMail: user.UserEMail,
        UserAddress1: user.UserAddress1,
        UserAddress2: user.UserAddress2,
        UserCity: user.UserCity,
        UserCounty: user.UserCounty,
        UserState: user.UserState,
        UserZIP: user.UserZIP,
        UserPhone: user.UserPhone,
        UserType: user.UserType,
        UserSSN: user.UserSSN,
        UserDOB: user.UserDOB,
        acquisitionSource: 'FieldWorker',
      },
      { headers });

    return user || null;
  } catch (error) {
    console.error('Get user error:', error);
    return null;
  }
};

const createAH_User = async (email, name, type, headers) => {
  try {
    const response = await axios.post(`${Auth0_Audience}api/ah_fieldworker/user`, {
      UserAuth0Email: email,
      UserEMail: email,
      UserName: name,
      UserType: type,
      acquisitionSource: 'FieldWorker'
    }, { headers });
    return response.data.id;
  } catch (error) {
    console.error(`Create ${type} error:`, error);
    return null;
  }
};

const ensurePatientExists = async (customer, email, name, headers) => {
  if (customer) {
    const patientID = await getUserPatient(customer.UserID, headers);
    return patientID;
  } else {
    const userID = await createAH_User(email, name, 'Patient', headers);
    if (!userID) return null;
    return await createPatient(userID, name, headers);
  }
};

const getUserPatient = async (userID, headers) => {
  try {
    const response = await axios.get(`${Auth0_Audience}api/ah_fieldworker/patient`, {
      params: { patientUserID: userID },
      headers
    });
    return response.data[0]?.PatientID;
  } catch (error) {
    console.error('Get patient error:', error);
    return null;
  }
};

const createPatient = async (userID, name, headers) => {
  try {
    const response = await axios.post(`${Auth0_Audience}api/ah_fieldworker/patient`, {
      userId: userID,
      PatientName: name
    }, { headers });
    return response.data.id;
  } catch (error) {
    console.error('Create patient error:', error);
    return null;
  }
};

const inviteUser = async ({ inviterId, inviterName, userName, userEmail, userType, patientID, patientName, headers, compName }) => {
  try {
    const response = await axios.post(`${Auth0_Audience}api/ah_fieldworker/invite`, {
      UserName: userName,
      UserEMail: userEmail,
      UserType: userType,
      patientId: patientID,
      patientName,
      status: 1,
      roleId: userType === 'Patient' ? 2 : 1,
      inviterId,
      inviterName
    }, { headers });

    await axios.post(`${Auth0_Audience}api/ah_fieldworker/post`,
      {
        description: `Hi ${patientName}! ${inviterName} from ${compName} has joined your circle of care!`,
        userId: inviterId,
        patientId: patientID,
        type: 1,
      },
      { headers });

    return response.data;
  } catch (error) {
    console.error(`Invite ${userType} error:`, error);
    return null;
  }
};

exports.getInvites = async function (req, res) {
  try {
    const getInvitesQuery = `
    SELECT u.UserID, u.UserName, u.UserType, u.UserAuth0Email, r.*, p.PatientID, p.PatientName, p.userId, patientUser.UserID AS patientUserID, patientUser.UserName AS patientUserName, patientUser.UserAuth0Email AS patientUserEmail,
      (
        SELECT cp.permissionId, cp.permission, cp.granted
          FROM ah_Caregiver_Permissions cp
        WHERE cp.userId = u.UserID AND cp.patientId = p.PatientID
        FOR JSON PATH
      ) AS permissions
      FROM ah_User u
      JOIN ah_Relationships r ON r.userId = u.UserID
      JOIN ah_Patient p ON p.PatientID = r.patientId
      JOIN ah_User patientUser ON patientUser.UserID = p.userId
    WHERE u.UserAuth0Email = '${req.query.userEmail}' AND u.acquisitionSource = 'FieldWorker' AND patientUser.acquisitionSource = 'FieldWorker'
    `;

    const invites = env === 'test' ? [] : await DBSendResponse(getInvitesQuery);

    return res.status(200).json(invites);
  } catch (err) {
    console.log('QUERY FAILURE | getInvites Query Failed:');
    console.log(err);
    return res.status(400).json({
      message: 'An unexpected error occured',
    });
  }
};

// Resolve the AbilityHub circle-of-care relationship between a field-worker and a client
// from their two emails. Returns the matching row, or null when the pair are not related.
const findAhRelationship = async function (userEmail, custEmail) {
  // status = 2 is an accepted relationship; a pending invite (1) is not yet a circle-of-care member.
  const relationshipQuery = `
    SELECT TOP 1 r.relationshipId, u.UserID AS callerUserID, p.PatientName
      FROM ah_User u
      JOIN ah_Relationships r ON r.userId = u.UserID
      JOIN ah_Patient p ON p.PatientID = r.patientId
      JOIN ah_User patientUser ON patientUser.UserID = p.userId
    WHERE u.UserAuth0Email = '${generateSQLText(userEmail, 255, '')}' AND u.acquisitionSource = 'FieldWorker'
      AND patientUser.UserAuth0Email = '${generateSQLText(custEmail, 255, '')}' AND patientUser.acquisitionSource = 'FieldWorker'
      AND r.status = 2
    `;

  const rows = env === 'test' ? [] : await DBSendResponse(relationshipQuery);

  return rows && rows.length > 0 ? rows[0] : null;
};

// Start a video call between the logged-in field-worker and one of their customers.
// POST /ability_hub/videocall/room  body: { userEmail, custEmail }
exports.startVideoCall = async function (req, res) {
  try {
    const { userEmail, custEmail } = req.body;
    if (!userEmail || !custEmail) {
      return res.status(400).json({ message: 'userEmail and custEmail are required' });
    }

    const relationship = await findAhRelationship(userEmail, custEmail);

    if (!relationship) {
      return res.status(403).json({ message: 'You are not in this client\'s circle of care' });
    }

    const { relationshipId, callerUserID, PatientName } = relationship;

    const accessToken = await getAuth0AccessToken();
    if (!accessToken) return res.status(500).json({ message: 'Failed to get Auth0 access token' });

    const response = await axios.post(`${Auth0_Audience}api/ah_fieldworker/videocall/room`,
      { relationshipId, userId: callerUserID },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

    return res.status(200).json({ roomName: response.data.roomName, subject: PatientName });
  } catch (err) {
    // Surface AH's own refusals (e.g. 409 when the client has no AH account yet) instead
    // of flattening them into a generic 500.
    const status = err.response?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ message: err.response.data?.message || 'Could not start the video call' });
    }
    req.log.error(err, 'Error starting AbilityHub video call');
    return res.status(500).json({ message: 'An unexpected error occurred' });
  }
};

// Record a finished AbilityHub video call as a completed task.
// POST /ability_hub/videocall/log
// body: { userEmail, custEmail, cus_id, comp_id, emp_id, pro_id, isBillable, timezone, startedAt, endedAt }
exports.logVideoCall = async function (req, res) {
  try {
    const { userEmail, custEmail, timezone, startedAt, endedAt, isBillable } = req.body;

    if (!userEmail || !custEmail || !startedAt || !endedAt) {
      return res.status(400).json({ message: 'userEmail, custEmail, startedAt and endedAt are required' });
    }

    const companyId = parseInt(req.body.comp_id, 10);
    const employeeId = parseInt(req.body.emp_id, 10);
    const customerId = parseInt(req.body.cus_id, 10);
    const projectId = parseInt(req.body.pro_id, 10);

    if (!Number.isInteger(companyId) || !Number.isInteger(employeeId) || !Number.isInteger(customerId)) {
      return res.status(400).json({ message: 'comp_id, emp_id and cus_id must be numeric' });
    }

    // The browser flushes calls interrupted by a tab close via navigator.sendBeacon, which
    // can only use form encoding (a JSON content-type would need a CORS preflight it cannot
    // perform), so booleans arrive as strings on that path.
    const billable = !(isBillable === false || isBillable === 'false' || isBillable === 0 || isBillable === '0');

    const start = moment(startedAt);
    const end = moment(endedAt);

    if (!start.isValid() || !end.isValid() || end.isBefore(start)) {
      return res.status(400).json({ message: 'startedAt and endedAt must be valid timestamps, and endedAt must not precede startedAt' });
    }

    const relationship = await findAhRelationship(userEmail, custEmail);

    if (!relationship) {
      return res.status(403).json({ message: 'You are not in this client\'s circle of care' });
    }

    const customerName = relationship.PatientName;

    const zone = timezone && moment.tz.zone(timezone) ? timezone : 'UTC';
    const startLocal = start.tz(zone);
    const endLocal = end.tz(zone);
    const durationMins = Math.max(0, Math.round(moment.duration(end.diff(start)).asMinutes()));

    const taskId = await addTaskAndReturnId({
      tTitle: `Video Call with ${customerName}`,
      tDesc: `Video call with ${customerName} lasting ${durationMins} minute${durationMins === 1 ? '' : 's'}.`,
      tType: `Video Call`,
      tStrtDate: startLocal.format('YYYY-MM-DD'),
      tEndDate: endLocal.format('YYYY-MM-DD'),
      tStartTime: startLocal.format('YYYY-MM-DDTHH:mm:ss'),
      tEndTime: endLocal.format('YYYY-MM-DDTHH:mm:ss'),
      tPriority: 'Med',
      tIsBillable: billable,
      tActive: 1,
      tProject: Number.isInteger(projectId) ? projectId : 'NULL',
      tAssTo: employeeId,
      tLoc: 'NULL',
      user_id: employeeId,
      company_id: companyId,
      task_emp_timezone: zone,
      cus_id: customerId,
    }, { skipNotification: true });

    return res.status(200).json({ id: taskId, message: 'Video call logged' });
  } catch (err) {
    req.log.error(err, 'Error logging AbilityHub video call');
    return res.status(500).json({ message: 'An unexpected error occurred' });
  }
};

// Shared check: does the field-worker (userEmail) have a relationship to the
// customer/patient (custEmail) with the "Health" permission granted? Returns the
// AH patient user id needed to fetch Blue Button data.
const checkHealthAccess = async (userEmail, custEmail) => {
  const relationshipQuery = `
    SELECT TOP 1 p.PatientID, patientUser.UserID AS patientUserID,
      (
        SELECT cp.permission, cp.granted
          FROM ah_Caregiver_Permissions cp
        WHERE cp.userId = u.UserID AND cp.patientId = p.PatientID
        FOR JSON PATH
      ) AS permissions
      FROM ah_User u
      JOIN ah_Relationships r ON r.userId = u.UserID
      JOIN ah_Patient p ON p.PatientID = r.patientId
      JOIN ah_User patientUser ON patientUser.UserID = p.userId
    WHERE u.UserAuth0Email = '${userEmail}' AND u.acquisitionSource = 'FieldWorker'
      AND patientUser.UserAuth0Email = '${custEmail}' AND patientUser.acquisitionSource = 'FieldWorker'
  `;

  const rows = env === 'test' ? [] : await DBSendResponse(relationshipQuery);

  if (!rows || rows.length === 0) {
    return { hasAccess: false, reason: 'no_relationship', ahUserId: null };
  }

  const row = rows[0];
  let permissions = [];
  try {
    permissions = row.permissions ? JSON.parse(row.permissions) : [];
  } catch (e) {
    permissions = [];
  }

  const healthGranted = permissions.some(
    (pm) => pm.permission === 'Health' && (pm.granted === 1 || pm.granted === true)
  );

  if (!healthGranted) {
    return { hasAccess: false, reason: 'no_health_permission', ahUserId: row.patientUserID };
  }

  return { hasAccess: true, ahUserId: row.patientUserID };
};

// Proxy the patient's Medicare (Blue Button) data from the AbilityHub API after
// verifying the field-worker has Health permission for the customer.
// GET /ability_hub/medicare?userEmail=<empEmail>&custEmail=<customerEmail>
exports.getMedicareData = async function (req, res) {
  try {
    const { userEmail, custEmail } = req.query;
    if (!userEmail || !custEmail) {
      return res.status(400).json({ message: 'userEmail and custEmail are required' });
    }

    const access = await checkHealthAccess(userEmail, custEmail);
    if (!access.hasAccess) {
      return res.status(403).json({ hasAccess: false, reason: access.reason });
    }

    if (!access.ahUserId) {
      return res.status(200).json({ hasAccess: true, connected: false });
    }

    // AHAPI (Azure) requires an Auth0 bearer token at the platform level.
    const accessToken = await getAuth0AccessToken();
    if (!accessToken) return res.status(500).json({ message: 'Failed to get Auth0 access token' });

    try {
      const bbResponse = await axios.get(`${Auth0_Audience}api/ah_fieldworker/bb-data/all`, {
        params: { userId: access.ahUserId },
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return res.status(200).json({ hasAccess: true, connected: true, data: bbResponse.data?.data || null });
    } catch (bbErr) {
      // 401 from Blue Button means the patient has not connected Medicare yet.
      if (bbErr.response?.status === 401) {
        return res.status(200).json({ hasAccess: true, connected: false });
      }
      const upstreamStatus = bbErr.response?.status || null;
      const upstreamBody = bbErr.response?.data;
      const detail = (upstreamBody && (upstreamBody.error || upstreamBody.message)) || bbErr.code || bbErr.message;
      console.log('Medicare proxy error | status:', upstreamStatus, '| detail:', detail, '| body:', upstreamBody);
      return res.status(502).json({ hasAccess: true, connected: true, error: 'Failed to fetch Medicare data', upstreamStatus, detail });
    }
  } catch (err) {
    console.log('QUERY FAILURE | getMedicareData Failed:');
    console.log(err);
    return res.status(400).json({ message: 'An unexpected error occured' });
  }
};

// Proxy a single Medicare claim (ExplanationOfBenefit) detail, re-verifying access.
// GET /ability_hub/medicare/claim/:claimId?userEmail=<empEmail>&custEmail=<customerEmail>
exports.getMedicareClaim = async function (req, res) {
  try {
    const { userEmail, custEmail } = req.query;
    const { claimId } = req.params;
    if (!userEmail || !custEmail || !claimId) {
      return res.status(400).json({ message: 'userEmail, custEmail and claimId are required' });
    }

    const access = await checkHealthAccess(userEmail, custEmail);
    if (!access.hasAccess || !access.ahUserId) {
      return res.status(403).json({ hasAccess: false });
    }

    // AHAPI (Azure) requires an Auth0 bearer token at the platform level.
    const accessToken = await getAuth0AccessToken();
    if (!accessToken) return res.status(500).json({ message: 'Failed to get Auth0 access token' });

    try {
      const bbResponse = await axios.get(
        `${Auth0_Audience}api/ah_fieldworker/bb-data/claim/${claimId}`,
        { params: { userId: access.ahUserId }, headers: { Authorization: `Bearer ${accessToken}` } }
      );
      return res.status(200).json(bbResponse.data);
    } catch (bbErr) {
      const status = bbErr.response?.status || 502;
      const detail = bbErr.response?.data?.message || bbErr.response?.data?.error || bbErr.code || bbErr.message;
      console.log('Medicare claim proxy error | status:', bbErr.response?.status, '| detail:', detail);
      return res.status(status).json(bbErr.response?.data || { message: 'Failed to fetch claim details', detail });
    }
  } catch (err) {
    console.log('QUERY FAILURE | getMedicareClaim Failed:');
    console.log(err);
    return res.status(400).json({ message: 'An unexpected error occured' });
  }
};

exports.getArtifacts = async function (req, res) {
  try {
    const checkRelationshipQuery = `
    SELECT *
      FROM ah_User u
      JOIN ah_Relationships r ON r.userId = u.UserID
      JOIN ah_Patient p ON p.PatientID = r.patientId
      JOIN ah_User patientUser ON patientUser.UserID = p.userId
    WHERE u.UserAuth0Email = '${req.query.userEmail}' AND u.acquisitionSource = 'FieldWorker' 
      AND patientUser.UserAuth0Email = '${req.query.custEmail}' AND patientUser.acquisitionSource = 'FieldWorker'
    `;

    const relationship = env === 'test' ? [] : await DBSendResponse(checkRelationshipQuery);

    if (relationship.length === 0) {
      return res.status(403).json([]);
    }

    const getArtifactsQuery = `
    SELECT a.ArtifactID, a.ArtifactName, a.ArtifactURL, a.createdAt, a.show, artUser.UserName
      FROM ah_Artifacts a
      JOIN ah_Patient p ON p.PatientID = a.PatientID
      JOIN ah_User u ON u.UserID = p.userId
      LEFT JOIN ah_User artUser ON artUser.UserID = a.createdBy
    WHERE u.UserAuth0Email = '${req.query.custEmail}' AND u.acquisitionSource = 'FieldWorker' AND a.show = 1
    `;

    const artifacts = env === 'test' ? [] : await DBSendResponse(getArtifactsQuery);

    return res.status(200).json(artifacts);
  } catch (err) {
    console.log('QUERY FAILURE | getArtifacts Query Failed:');
    console.log(err);
    return res.status(400).json({
      message: 'An unexpected error occured',
    });
  }
};