const db = require('../models/indexSQL.js');
const { LOGGING_LEVEL } = require('../config');
const { defaultLogger } = require('../logger');
const { getCurrentRequestLogger } = require('../loggerContext');

exports.DBinsertSendResponse = async function (query) {
  const log = getCurrentRequestLogger();
  const ResultList = [];

  log.database('DBinsertSendResponse Query: ' + query);
  if(LOGGING_LEVEL === 'database') {
    console.log('DBinsertSendResponse Query:', query);
  }
  
  try {
    const request = new db.Request();
    const res = await request.query(query).then((result) => {
      return result;
    }).catch((err) => {
      err.query = query;
      log.error(err, 'An error occurred during a \'DBinsertSendResponse\' query');
    });

    res?.recordset.forEach(function (element) {
      ResultList.push(element);
    });
  } catch (err) {
    log.error(err, 'Caught error in DBinsertSendResponse() function');
  }

  return ResultList;
};

exports.DBinsertSendID = async function (query) {
  const log = getCurrentRequestLogger();
  const request = new db.Request();

  log.database('DBinsertSendID Query: ' + query);
  if(LOGGING_LEVEL === 'database') {
    console.log('DBinsertSendID Query:', query);
  }

  const res = await request.query(query).then((result) => {
    return result;
  }).catch((err) => {
    err.query = query;
    log.error(err, 'An error occurred during a \'DBinsertSendID\' query');
  });

  try {
    return res?.recordset[0][''];
  } catch (err) {
    log.error(err, 'Caught error in DBinsertSendID() function');
  }
};

exports.DBinsert = async function (res, query) {
  const log = getCurrentRequestLogger();
  const request = new db.Request();

  log.database('DBinsert Query: ' + query);
  if(LOGGING_LEVEL === 'database') {
    console.log('DBinsert Query:', query);
  }

  request.query(query, function (err, recordset) {
    if (err) {
      err.query = query;
      log.error(err, 'An error occurred during a \'DBinsert\' query');
      res.send({ code: 500, message: 'Error!! Try Again' });
    } else {
      res.send({ code: 200, message: 'Successfully saved Record', id: recordset.recordset[0][''] });
    }
  });
};

exports.DBInsertAndReturn = async function (query) {
  const log = getCurrentRequestLogger();
  log.database('DBInsertAndReturn Query: ' + query);
  if(LOGGING_LEVEL === 'database') {
    console.log('DBInsertAndReturn Query:', query);
  }

  const request = new db.Request();

  return response = await request.query(query).then((recordset) => {
    return {
      code: 200,
      message: 'Successfully saved Record',
      id: recordset.recordset[0]['']
    };
  }).catch((err) => {
    err.query = query;
    log.error(err, 'An error occurred during a \'DBInsertAndReturn\' query');
    return {
      code: 500,
      message: 'Error!! Try Again'
    };
  });
};

exports.DBUpdate = async function (query) {
  const log = getCurrentRequestLogger();
  const request = new db.Request();
  log.database('DBUpdate Query: ' + query);
  if(LOGGING_LEVEL === 'database') {
    console.log('DBUpdate Query:', query); 
  }

  try {
    const result = await request.query(query);
    return result?.rowsAffected[0];
  } catch (err) {
    err.query = query;
    log.error(err, 'An error occurred during a \'DBUpdate\' query');
  }
};

exports.DBSendResponse = async function (query) {
  const log = getCurrentRequestLogger();
  
  const request = new db.Request();
  log.database('DBSendResponse Query: ' + query);
  if(LOGGING_LEVEL === 'database') {
    console.log('DBSendResponse Query:', query);
  }

  try {
    const result = await request.query(query);
    return Array.isArray(result.recordset) ? result.recordset : [];
  } catch (err) {
    err.query = query;
    log.error(err, 'An error occurred during a \'DBSendResponse\' query');
    return [];
  }
};

// Utility functions to generate SQL queries

exports.generateUpdateSQL = function(table, data, condition) {
  let sql = `UPDATE ${table} SET `;
  const keys = Object.keys(data);
  const values = Object.values(data);
    
  for (let i = 0; i < keys.length; i++) {
    const value = values[i] !== null && values[i] !== undefined ? `'${values[i]}'` : 'NULL';
    sql += `${keys[i]} = ${value}`;
    if (i !== keys.length - 1) {
      sql += ', ';
    }
  }
    
  if (condition) {
    sql += ` WHERE ${condition}`;
  }
    
  return sql;
};

exports.generateInsertSQL = function(tableName, data) {
  const columns = Object.keys(data).join(', ');
  const values = Object.values(data).map(val => {
    if (typeof val === 'string') {
      return `'${val}'`;
    } else if (typeof val === 'boolean') {
      return val ? 1 : 0;
    } else if( val == undefined || val == null){
      return 'NULL';
    } else {
      return val;
    }
  }).join(', ');
  return `INSERT INTO ${tableName} (${columns}) VALUES (${values});`;
};


// Parameterized SELECT — returns recordset array.
// Usage: await DBSendResponseParam('SELECT * FROM t WHERE col=@val', { val: 'x' })
exports.DBSendResponseParam = async function (query, params = {}) {
  const log = getCurrentRequestLogger();
  
  log.database('DBSendResponseParam Query:', query);
  log.database('DBSendResponseParam Params:', params);
  if(LOGGING_LEVEL === 'database') {
    console.log('DBSendResponseParam Query:', query);
    console.log('DBSendResponseParam Params:', params);
  }

  try {
    const request = new db.Request();

    // Add parameters to the request
    for (const [key, param] of Object.entries(params)) {
      if (param && typeof param === 'object' && 'type' in param && 'value' in param) {
        request.input(key, param.type, param.value);
      } else {
        request.input(key, param);
      }
    }

    const result = await request.query(query);
    return result.recordset;
  } catch (err) {
    err.query = query;
    log.error('Error in executing query in DBSendResponse:');
    log.error(err);
    throw err;
  }
};

// Parameterized UPDATE — returns rowsAffected count.
// Usage: await DBUpdateParam('UPDATE t SET col=@val WHERE id=@id', { val: 'x', id: 1 })
exports.DBUpdateParam = async function (query, params = {}) {
  const log = getCurrentRequestLogger();

  log.database('DBUpdateParam Query:', query);
  log.database('DBUpdateParam Params:', params);
  if (LOGGING_LEVEL === 'database') {
    console.log('DBUpdateParam Query:', query);
    console.log('DBUpdateParam Params:', params);
  }

  try {
    const request = new db.Request();

    for (const [key, param] of Object.entries(params)) {
      if (param && typeof param === 'object' && 'type' in param && 'value' in param) {
        request.input(key, param.type, param.value);
      } else {
        request.input(key, param);
      }
    }

    const result = await request.query(query);
    return result?.rowsAffected[0];
  } catch (err) {
    err.query = query;
    log.error(err, 'An error occurred during a \'DBUpdateParam\' query');
    throw err;
  }
};

// Parameterized INSERT — returns the new row's identity (SCOPE_IDENTITY).
// The query must end with: ; SELECT SCOPE_IDENTITY()
// Usage: await DBinsertSendIDParam('INSERT INTO t (col) VALUES (@val); SELECT SCOPE_IDENTITY()', { val: 'x' })
exports.DBinsertSendIDParam = async function (query, params = {}) {
  const log = getCurrentRequestLogger();

  log.database('DBinsertSendIDParam Query:', query);
  log.database('DBinsertSendIDParam Params:', params);
  if (LOGGING_LEVEL === 'database') {
    console.log('DBinsertSendIDParam Query:', query);
    console.log('DBinsertSendIDParam Params:', params);
  }

  try {
    const request = new db.Request();

    for (const [key, param] of Object.entries(params)) {
      if (param && typeof param === 'object' && 'type' in param && 'value' in param) {
        request.input(key, param.type, param.value);
      } else {
        request.input(key, param);
      }
    }

    const result = await request.query(query);
    return result?.recordset[0][''];
  } catch (err) {
    err.query = query;
    log.error(err, 'An error occurred during a \'DBinsertSendIDParam\' query');
    throw err;
  }
};

// Parameterized INSERT — returns { code, message, id } structured response.
// The query must end with: ; SELECT SCOPE_IDENTITY()
// Usage: await DBInsertAndReturnParam('INSERT INTO t (col) VALUES (@val); SELECT SCOPE_IDENTITY()', { val: 'x' })
exports.DBInsertAndReturnParam = async function (query, params = {}) {
  const log = getCurrentRequestLogger();

  log.database('DBInsertAndReturnParam Query:', query);
  log.database('DBInsertAndReturnParam Params:', params);
  if (LOGGING_LEVEL === 'database') {
    console.log('DBInsertAndReturnParam Query:', query);
    console.log('DBInsertAndReturnParam Params:', params);
  }

  try {
    const request = new db.Request();

    for (const [key, param] of Object.entries(params)) {
      if (param && typeof param === 'object' && 'type' in param && 'value' in param) {
        request.input(key, param.type, param.value);
      } else {
        request.input(key, param);
      }
    }

    const result = await request.query(query);
    return {
      code: 200,
      message: 'Successfully saved Record',
      id: result.recordset[0][''],
    };
  } catch (err) {
    err.query = query;
    log.error(err, 'An error occurred during a \'DBInsertAndReturnParam\' query');
    return {
      code: 500,
      message: 'Error!! Try Again',
    };
  }
};