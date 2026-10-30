const axios = require('axios');
const https = require('https');
const httpsAgent = new https.Agent({ maxVersion: 'TLSv1.2',minVersion: 'TLSv1.2', keepAlive: true });
var { EVV_API_CLIENT_ID, EVV_API_CLIENT_SECRET, EVV_API_BASE_URL } = require('../config');
const { DBSendResponse } = require('../queries/commonQueries');

// Cache for company credentials to avoid repeated DB queries
const credentialsCache = new Map();

// Helper function to get company-specific EVV credentials
async function getCompanyCredentials(company_id) {
  // Check cache first
  if (credentialsCache.has(company_id)) {
    return credentialsCache.get(company_id);
  }

  // If no company_id provided, use default org-level credentials
  if (!company_id) {
    return {
      client_id: EVV_API_CLIENT_ID,
      client_secret: EVV_API_CLIENT_SECRET,
      base_url: EVV_API_BASE_URL
    };
  }

  try {
    // Query database for company-specific credentials
    const query = `SELECT evv_client_id, evv_client_secret FROM company WHERE com_id = ${company_id}`;
    const result = await DBSendResponse(query);
    
    const credentials = {
      client_id: result[0]?.evv_client_id || EVV_API_CLIENT_ID,
      client_secret: result[0]?.evv_client_secret || EVV_API_CLIENT_SECRET,
      base_url: EVV_API_BASE_URL // Base URL remains the same for all companies
    };

    // Cache the credentials
    credentialsCache.set(company_id, credentials);
    
    return credentials;
  } catch (error) {
    console.error(`Error fetching EVV credentials for company ${company_id}:`, error);
    // Fall back to default credentials on error
    return {
      client_id: EVV_API_CLIENT_ID,
      client_secret: EVV_API_CLIENT_SECRET,
      base_url: EVV_API_BASE_URL
    };
  }
}

// Function to clear credentials cache (useful if credentials are updated)
function clearCredentialsCache(company_id = null) {
  if (company_id) {
    credentialsCache.delete(company_id);
  } else {
    credentialsCache.clear();
  }
}

exports.evvAPI = {
  'caregiver': async function (data, company_id = null) {
    const credentials = await getCompanyCredentials(company_id);
    console.log(`[EVV API - caregiver] Using credentials - Company ID: ${company_id || 'default'}, Client ID: ${credentials.client_id}, Base URL: ${credentials.base_url}`);
    let access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
    
    if(access_token == 'Unable to obtain token'){
      return 'Unable to obtain token';
    }
    
    return await caregiver(data, access_token, credentials.base_url).catch(async function (err) {
      if (err.response.status === 401 || err.response.status === 500) {
        access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
        if(access_token=='Unable to obtain token'){
          return 'Unable to obtain token';
        }
        return await caregiver(data, access_token, credentials.base_url).catch((err) => { return err.response; });
      } else {
        return err.response;
      }
    });
  },
  
  'addVisits': async function (data, company_id = null) {
    const credentials = await getCompanyCredentials(company_id);
    console.log(`[EVV API - addVisits] Using credentials - Company ID: ${company_id || 'default'}, Client ID: ${credentials.client_id}, Base URL: ${credentials.base_url}`);
    let access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
    
    if(access_token == 'Unable to obtain token'){
      return 'Unable to obtain token';
    }
    
    return await addVisits(data, access_token, credentials.base_url).catch(async function (err) {
      if (err.response.status === 401 || err.response.status === 500) {
        access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
        if(access_token=='Unable to obtain token'){
          return 'Unable to obtain token';
        }
        return await addVisits(data, access_token, credentials.base_url).catch((err) => { console.log(err.response.data.errors); });
      } else {
        console.log(err.response.data.errors);
      }
    });
  },
  
  'updateVisit': async function (data, evvmsid, company_id = null) {
    const credentials = await getCompanyCredentials(company_id);
    console.log(`[EVV API - updateVisit] Using credentials - Company ID: ${company_id || 'default'}, Client ID: ${credentials.client_id}, Base URL: ${credentials.base_url}`);
    let access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
    
    if(access_token == 'Unable to obtain token'){
      return 'Unable to obtain token';
    }
    
    return await updateVisit(data, evvmsid, access_token, credentials.base_url).catch(async function (err) {
      if (err.response.status === 401 || err.response.status === 500) {
        access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
        return await updateVisit(data, evvmsid, access_token, credentials.base_url).catch((err) => { console.log(err.response.data.errors); });
      } else {
        console.log(err.response.data.errors);
      }
    });
  },
  
  'deleteVisit': async function (evvmsid, company_id = null) {
    const credentials = await getCompanyCredentials(company_id);
    console.log(`[EVV API - deleteVisit] Using credentials - Company ID: ${company_id || 'default'}, Client ID: ${credentials.client_id}, Base URL: ${credentials.base_url}`);
    let access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
    
    if(access_token == 'Unable to obtain token'){
      return 'Unable to obtain token';
    }
    
    return await deleteVisit(evvmsid, access_token, credentials.base_url).catch(async function (err) {
      if (err.response.status === 401 || err.response.status === 500) {
        access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
        return await deleteVisit(evvmsid, access_token, credentials.base_url).catch((err) => { console.log(err.response.data.errors); });
      } else {
        console.log(err.response.data.errors);
      }
    });
  },
  
  'getTransactionStatus': async function (transactionId, company_id = null) {
    const credentials = await getCompanyCredentials(company_id);
    console.log(`[EVV API - getTransactionStatus] Using credentials - Company ID: ${company_id || 'default'}, Client ID: ${credentials.client_id}, Base URL: ${credentials.base_url}`);
    let access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
    
    if(access_token == 'Unable to obtain token'){
      return 'Unable to obtain token';
    }
    
    return await getTransactionStatus(transactionId, access_token, credentials.base_url).catch(async function (err) {
      try{
        if (err.response.status === 401 || err.response.status === 500) {
          access_token = await getToken(credentials.client_id, credentials.client_secret, credentials.base_url);
          return await getTransactionStatus(transactionId, access_token, credentials.base_url).catch((err) => { console.log(err.response.data.errors); });
        } else {
          console.log(err.response.data.errors);
        }
      } catch(err){
        console.log('| ERROR | Error occured when trying to check EVV transaction status:');
        console.log(err);
      }
    });
  },
  
  'clearCache': clearCredentialsCache
};

async function getToken(client_id, client_secret, base_url) {
  try {
    const response = await axios({
      method: 'post',
      url: base_url + '/identity/connect/token',
      data: `client_id=${client_id}&client_secret=${client_secret}&grant_type=client_credentials&scope=write:aggregator`,
      httpsAgent
    });
    return response.data.access_token;
  } catch (error) {
    console.error(error);
    return('Unable to obtain token');
  }
}

async function caregiver(data, access_token, base_url) {
  const response = await axios({
    method: 'post',
    url: base_url + '/api/v2/caregivers',
    headers: { authorization: `Bearer ${access_token}` },
    data: data,
    httpsAgent
  });
  return response;
}

async function addVisits(data, access_token, base_url) {
  const response = await axios({
    method: 'post',
    url: base_url + '/api/v2/visits',
    headers: { authorization: `Bearer ${access_token}` },
    data: data,
    httpsAgent
  });
  return response;
}

async function updateVisit(data, evvmsid, access_token, base_url) {
  const response = await axios({
    method: 'put',
    url: base_url + `/api/v2/visits/${evvmsid}`,
    headers: { authorization: `Bearer ${access_token}` },
    data: data,
    httpsAgent
  });
  return response;
}

async function deleteVisit(evvmsid, access_token, base_url) {
  const response = await axios({
    method: 'delete',
    url: base_url + `/api/v2/visits/${evvmsid}`,
    headers: { authorization: `Bearer ${access_token}` },
    httpsAgent
  });
  return response;
}

async function getTransactionStatus(transactionID, access_token, base_url) {
  const response = await axios({
    method: 'get',
    url: base_url + `/api/v2/visits/transactions/${transactionID}`,
    headers: { authorization: `Bearer ${access_token}` },
    httpsAgent
  });
  return response;
}
