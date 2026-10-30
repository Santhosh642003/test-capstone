const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries.js');
const moment = require('moment');
const { getAssociatedEmployeesAPI } = require('./employees.js');
const { getCustomersAssociatedAPI } = require('./customers.js');
var { SEGMENT_API_KEY } = require('../config.js');
const { Analytics } = require('@segment/analytics-node');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
var cron = require('node-cron');

// GET - Retrieve all custom reports for a company
exports.getCustomReports = async (req, res) => {
  try {
    const company_id = req.query.company_id || req.query.comp_id;
    const employee_id = req.query.employee_id;

    if (!company_id && !employee_id) {
      return res.status(400).json({ message: 'company_id or employee_id is required' });
    }

    let query = 'SELECT * FROM fwcustomreports WHERE 1=1';
    
    if (company_id) {
      query += ` AND company_id = ${parseInt(company_id)}`;
    }
    
    if (employee_id) {
      query += ` AND employee_id = ${parseInt(employee_id)}`;
    }

    query += ' ORDER BY report_name ASC';

    const reports = await DBSendResponse(query);
    res.json(reports);
  } catch (err) {
    console.error('Error fetching custom reports:', err);
    res.status(500).json({ message: 'Error fetching custom reports' });
  }
};

// GET - Retrieve a single custom report by ID
exports.getCustomReportById = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    const query = `SELECT * FROM fwcustomreports WHERE id = ${id}`;
    const reports = await DBSendResponse(query);
    
    if (!reports || reports.length === 0) {
      return res.status(404).json({ message: 'Custom report not found' });
    }
    
    res.json(reports[0]);
  } catch (err) {
    console.error('Error fetching custom report by ID:', err);
    res.status(500).json({ message: 'Error fetching custom report' });
  }
};

// CREATE - Add a new custom report
exports.addCustomReport = async (req, res) => {
  try {
    const employee_id = parseInt(req.body.employee_id);
    const company_id = parseInt(req.body.company_id);
    const report_name = (req.body.report_name || '').replace(/'/g, '\'\'');
    const base_report = (req.body.base_report || '').replace(/'/g, '\'\'');
    const configuration = JSON.stringify(req.body.configuration || {}).replace(/'/g, '\'\'');

    if (!employee_id || !company_id || !report_name || !base_report) {
      return res.status(400).json({ 
        message: 'employee_id, company_id, report_name, and base_report are required' 
      });
    }

    const query = `
      INSERT INTO fwcustomreports (employee_id, company_id, report_name, base_report, configuration)
      OUTPUT Inserted.id
      VALUES (${employee_id}, ${company_id}, '${report_name}', '${base_report}', '${configuration}')
    `;

    const result = await DBSendResponse(query);
    const newId = Array.isArray(result) && result[0]?.id ? result[0].id : null;

    if (!newId) {
      return res.status(500).json({ code: 500, message: 'Failed to create custom report' });
    }

    res.json({ code: 200, message: 'Custom report created successfully', id: newId });
  } catch (err) {
    console.error('Error adding custom report:', err);
    res.status(500).json({ code: 500, message: 'Error adding custom report' });
  }
};

// Get grid settings for a custom report
exports.getCustomReportSettings = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const user_id = parseInt(req.query.user_id);
    
    if (!id || !user_id) {
      return res.status(400).json({ message: 'Report id and user_id are required' });
    }

    const query = `SELECT configuration FROM fwcustomreports WHERE id = ${id} AND employee_id = ${user_id}`;
    const result = await DBSendResponse(query);

    if (!result || result.length === 0) {
      return res.json({ settings: null });
    }

    const config = result[0].configuration;
    const settings = config ? (typeof config === 'string' ? JSON.parse(config) : config) : null;
    
    res.json({ settings });
  } catch (err) {
    console.error('Error getting custom report settings:', err);
    res.status(500).json({ code: 500, message: 'Error getting custom report settings' });
  }
};

// Save grid settings for a custom report
exports.saveCustomReportSettings = async (req, res) => {
  try {
    const id = parseInt(req.body.id);
    const user_id = parseInt(req.body.user_id);
    const settings = req.body.settings;
    
    if (!id || !user_id || !settings) {
      return res.status(400).json({ message: 'Report id, user_id, and settings are required' });
    }

    const escapedSettings = JSON.stringify(settings).replace(/'/g, '\'\'');
    const query = `UPDATE fwcustomreports SET configuration = '${escapedSettings}' WHERE id = ${id} AND employee_id = ${user_id}`;
    
    const result = await DBUpdate(query);

    if (result === 0) {
      return res.status(404).json({ code: 404, message: 'Custom report not found' });
    }

    res.json({ code: 200, message: 'Settings saved successfully' });
  } catch (err) {
    console.error('Error saving custom report settings:', err);
    res.status(500).json({ code: 500, message: 'Error saving custom report settings' });
  }
};

// UPDATE - Update an existing custom report
exports.updateCustomReport = async (req, res) => {
  try {
    const id = parseInt(req.body.id || req.params.id);
    
    if (!id) {
      return res.status(400).json({ message: 'Report id is required' });
    }

    const updates = [];
    
    if (req.body.report_name !== undefined) {
      const report_name = req.body.report_name.replace(/'/g, '\'\'');
      updates.push(`report_name = '${report_name}'`);
    }
    if (req.body.base_report !== undefined) {
      const base_report = req.body.base_report.replace(/'/g, '\'\'');
      updates.push(`base_report = '${base_report}'`);
    }
    if (req.body.configuration !== undefined) {
      const configuration = JSON.stringify(req.body.configuration).replace(/'/g, '\'\'');
      updates.push(`configuration = '${configuration}'`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const query = `UPDATE fwcustomreports SET ${updates.join(', ')} WHERE id = ${id}`;
    const result = await DBUpdate(query);

    if (result === 0) {
      return res.status(404).json({ code: 404, message: 'Custom report not found or no changes made' });
    }

    res.json({ code: 200, message: 'Custom report updated successfully' });
  } catch (err) {
    console.error('Error updating custom report:', err);
    res.status(500).json({ code: 500, message: 'Error updating custom report' });
  }
};

// DELETE - Remove a custom report
exports.deleteCustomReport = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    
    if (!id) {
      return res.status(400).json({ message: 'Report id is required' });
    }

    const query = `DELETE FROM fwcustomreports WHERE id = ${id}`;
    const result = await DBUpdate(query);

    if (result === 0) {
      return res.status(404).json({ code: 404, message: 'Custom report not found' });
    }

    res.json({ code: 200, message: 'Custom report deleted successfully' });
  } catch (err) {
    console.error('Error deleting custom report:', err);
    res.status(500).json({ code: 500, message: 'Error deleting custom report' });
  }
};
