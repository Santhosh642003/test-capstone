const jwt_decode = require('../utils/tokenDecoder.js');
const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { addTask,addTaskAndReturnId } = require('../queries/dependantQueries');
const { parseSQLText, generateSQLText } = require('../utils/validation.js');
const moment = require('moment');


exports.getTasks = async function (req, res) {
  try {
    const { company_id, task_id, employee_id, project_id, customer_id } = req.query;

    // Validate: at least one parameter is required
    if (!company_id && !task_id && !employee_id && !project_id && !customer_id) {
      return res.status(400).json({
        message: 'At least one query parameter is required: company_id, task_id, employee_id, project_id, or customer_id'
      });
    }

    // Build WHERE clause dynamically
    const conditions = [];

    if (task_id) {
      if (isNaN(parseInt(task_id))) {
        return res.status(400).json({
          message: 'task_id must be a valid number'
        });
      }
      conditions.push(`task.tas_id = ${parseInt(task_id)}`);
    }

    if (company_id) {
      if (isNaN(parseInt(company_id))) {
        return res.status(400).json({
          message: 'company_id must be a valid number'
        });
      }
      conditions.push(`task.tas_com_id = ${parseInt(company_id)}`);
    }

    if (employee_id) {
      if (isNaN(parseInt(employee_id))) {
        return res.status(400).json({
          message: 'employee_id must be a valid number'
        });
      }
      conditions.push(`task.tas_emp_id = ${parseInt(employee_id)}`);
    }

    if (project_id) {
      if (isNaN(parseInt(project_id))) {
        return res.status(400).json({
          message: 'project_id must be a valid number'
        });
      }
      conditions.push(`task.tas_pro_id = ${parseInt(project_id)}`);
    }

    if (customer_id) {
      if (isNaN(parseInt(customer_id))) {
        return res.status(400).json({
          message: 'customer_id must be a valid number'
        });
      }
      conditions.push(`project.pro_customer_id = ${parseInt(customer_id)}`);
    }

    const whereClause = conditions.join(' AND ');

    // Query with project join if customer_id is provided
    const query = customer_id 
      ? `SELECT task.* 
         FROM task 
         INNER JOIN project ON task.tas_pro_id = project.pro_id 
         WHERE ${whereClause}`
      : `SELECT task.* 
         FROM task 
         ${project_id ? 'LEFT JOIN project ON task.tas_pro_id = project.pro_id' : ''} 
         WHERE ${whereClause}`;

    const tasks = await DBSendResponse(query);

    res.status(200).json({
      message: 'Tasks retrieved successfully',
      tasks: tasks || [],
      count: tasks?.length || 0
    });
  } catch (err) {
    console.log('ERROR | getTasks failed:');
    console.log(err);
    res.status(500).json({
      message: 'An error occurred while retrieving tasks'
    });
  }
};