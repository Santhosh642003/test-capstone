const db = require('../models/indexSQL.js');
const { DBSendResponse } = require('../queries/commonQueries');
const moment = require('moment');

exports.insertShiftActionLog = async (req, res) => {
  const start = performance.now();
  try {
    const { schedule_id, shift_emp_id, action, notes, action_by, company_id } = req.body;
    const action_at = moment().utc().format('YYYY-MM-DDTHH:mm:ss');

    const query = `INSERT INTO shift_action_log (schedule_id, shift_emp_id, action, notes, action_by, action_at, company_id)
      VALUES (${schedule_id}, ${shift_emp_id}, '${action}', '${notes ? notes.replace(/'/g, "''") : ''}', ${action_by}, '${action_at}', ${company_id})`;

    await DBSendResponse(query);

    req.log.debug(`/api/fieldworker/shift_action_log POST TIMETAKEN: ${performance.now() - start} MS`);
    res.json({ code: 200, message: 'Ok!' });
  } catch (error) {
    req.log.debug(`/api/fieldworker/shift_action_log POST ERROR: ${error.message}`);
    req.log.error(error);
    res.status(400).json({ error: 'Server error occurred', message: error.message });
  }
};
