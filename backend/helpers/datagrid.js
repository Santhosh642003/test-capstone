const { DBinsertSendID, DBInsertAndReturn, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');

exports.getDataGridSettings = async function (req, res) {
  const start = performance.now();
  try {
    const query = `SELECT * FROM fwdatagrid WHERE user_id=${req.query.user_id} AND report_id=${req.query.report_id}`;
    const result = await DBSendResponse(query);
    console.log(`/api/fieldworker/datagrid GET TIMETAKEN: ${performance.now() - start} MS`);
    res.json(result);
  } catch (error) {
    console.log(`/api/fieldworker/datagrid GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/datagrid GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};

exports.addDataGridSettings = async function (req, res) {
  console.log('addDataGridSettings - user_id:', req.body.user_id, 'report_id:', req.body.report_id);
  
  try {
    // First check if a record already exists
    const checkQuery = `SELECT COUNT(*) as count FROM fwdatagrid WHERE user_id = ${req.body.user_id} AND report_id = ${req.body.report_id}`;
    console.log('addDataGridSettings - checkQuery:', checkQuery);
    const existing = await DBSendResponse(checkQuery);
    console.log('addDataGridSettings - existing count:', existing);
    
    if (existing && existing.length > 0 && existing[0].count > 0) {
      // Record exists, use update instead
      console.log('addDataGridSettings - record exists, redirecting to update');
      return exports.updateDataGridSettings(req, res);
    }
    
    // Escape single quotes in settings JSON
    const escapedSettings = req.body.settings.replace(/'/g, '\'\'');
    
    // Use DBInsertAndReturn which has better error handling
    const insertQuery = `INSERT INTO fwdatagrid (user_id, report_id, settings, added_on) VALUES (${req.body.user_id}, ${req.body.report_id}, '${escapedSettings}', GETDATE()); SELECT SCOPE_IDENTITY() AS id`;
    console.log('addDataGridSettings - insertQuery:', insertQuery.substring(0, 200) + '...');
    
    const result = await DBInsertAndReturn(insertQuery);
    console.log('addDataGridSettings - result:', JSON.stringify(result));
    
    if (result.code === 200) {
      res.json({ success: true, id: result.id });
    } else {
      res.status(500).json({ error: result.message });
    }
  } catch (err) {
    console.error('addDataGridSettings - ERROR:', err);
    res.status(500).json({ error: err.message || 'Unknown error' });
  }
};

exports.updateDataGridSettings = async function (req, res) {
  console.log('updateDataGridSettings - user_id:', req.body.user_id, 'report_id:', req.body.report_id);
  // Escape single quotes in settings JSON
  const escapedSettings = req.body.settings.replace(/'/g, '\'\'');
  const query = `UPDATE fwdatagrid SET settings='${escapedSettings}' WHERE user_id=${req.body.user_id} AND report_id=${req.body.report_id}`;
  try {
    const result = await DBUpdate(query);
    console.log('updateDataGridSettings - rows affected:', result);
    res.json(result);
  } catch (err) {
    console.error('updateDataGridSettings - ERROR:', err);
    res.status(500).json({ error: err.message });
  }
};

exports.deleteDataGridSettings = async function (req, res) {
  const query = `DELETE FROM fwdatagrid WHERE user_id=${req.body.user_id} AND report_id=${req.body.report_id}`;
  const result = await DBUpdate(query);
  res.json(result);
};