var moment = require('moment');
var db = require('../models/indexSQL.js');
const { DBinsertSendID,DBinsert,DBUpdate,DBSendResponse,DBinsertSendResponse,DBInsertAndReturn } = require('../queries/commonQueries.js');
var { evvAPI } = require('../utils/evvAPI.js');
var cron = require('node-cron');
const { max } = require('moment');
const { response, query } = require('express');
const { map } = require('../models/indexSQL.js');
var { SEGMENT_API_KEY } = require('../config.js');
const { Analytics } = require('@segment/analytics-node');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
const schedule = require('node-schedule');
const { getCurrentEVVData } = require('./evv.js');

exports.getEVVNJTaskSummary = async function(req, res) {
  try{
    if (req.query.company_id && req.query.start && req.query.end){
      let counter2 = 0;
      let counter1 = 0;
      const start = moment(req.query.start).format('YYYY-MM-DDTHH:mm:ss');
      const end = moment(req.query.end).format('YYYY-MM-DDTHH:mm:ss');
            
      const taskQuery =
            `SELECT task.*, empLocate.empLocDate, empLocate.checkoutEmpDate, evv.evvmsid, customer.cus_id, customer.cus_name, project.pro_title
            FROM task 
            INNER JOIN empLocate ON task.tas_id = empLocate.taskId 
            LEFT JOIN evv ON task.tas_id = evv.externalVisitId
            INNER JOIN project ON task.tas_pro_id = project.pro_id
            INNER JOIN customer ON project.pro_customer_id = customer.cus_id
            WHERE task.tas_com_id = ${req.query.company_id}
            AND task.tas_type LIKE '%Visit'
            AND task.tas_is_active = 1
            AND task.tas_start_time >= '${start}' 
            AND task.tas_end_time <= '${end}' 
            AND empLocate.checkoutEmpDate IS NOT NULL
            AND empLocate.checkoutEmpDate != empLocate.empLocDate`;
      const taskData = await DBSendResponse(taskQuery);
            
      let tasksWithEvv = taskData.filter(task => task.evvmsid !== null);
      let tasksWithoutEvv = taskData.filter(task => task.evvmsid === null);
      let tasksWithoutEvvUpdated = await tasksWithoutEvv.map(async(data, index) => {
        await new Promise(resolve => setTimeout(resolve, index * 800));
        let result = await getCurrentEVVData(data.tas_id);
        counter1++;
        if(data.tas_id==3083606){
          console.log(result);
        }
        return { ...result, taskData: data };
      });
      tasksWithoutEvv = await Promise.all(tasksWithoutEvvUpdated);

      // Combine tasks with and without EVV data
      const combinedTasks = [...tasksWithEvv, ...tasksWithoutEvv].map(task => {
        const taskData = task.taskData || task;
        console.log('----');
        console.log(taskData.tas_id);
        console.log(taskData.evvmsid);
        console.log(taskData.evv_status);
        console.log(taskData.evvmsid ? 'Success' : (taskData.evv_status ? taskData.evv_status : 'Uknown'));
        return {
          'evv_status': taskData.evvmsid ? 'Success' : (taskData.evv_status ? taskData.evv_status : 'Uknown'),
          'evvmsid': taskData.evvmsid ? taskData.evvmsid : null,
          'evv_logs': [],
          taskData: {
            tas_id: taskData.tas_id,
            tas_emp_id: taskData.tas_emp_id,
            tas_title: taskData.tas_title,
            tas_type: taskData.tas_type,
            scheduled_start_time: taskData.tas_start_time,
            scheduled_end_time: taskData.tas_end_time,
            pro_title: taskData.pro_title,
            pro_id: taskData.tas_pro_id,
            actual_start_time: taskData.empLocDate,
            actual_end_time: taskData.checkoutEmpDate,
            cus_name: taskData.cus_name
          }
        };
      });

      // Get employee names
      const empIdString = combinedTasks.map(task => task.taskData.tas_emp_id).join(',');
      const empQuery = `SELECT emp_id, emp_first_name, emp_last_name FROM employee WHERE emp_id IN (${empIdString})`;
      const empData = await DBSendResponse(empQuery);
      const empDataObject = empData.reduce((acc, emp) => ({ ...acc, [emp.emp_id]: `${emp.emp_first_name} ${emp.emp_last_name}` }), {});
      combinedTasks.forEach(task => {
        counter2++;
        task.emp_name = empDataObject[task.tas_emp_id];
      });

      // Get EVV logs
      const evvLogQuery = `SELECT * FROM evv_log WHERE externalVisitId IN (${combinedTasks.map(task => task.taskData.tas_id).join(',')})`;
      const evvLogData = await DBSendResponse(evvLogQuery);
      const evvLogsMap = evvLogData.reduce((acc, log) => {
        if (!acc[log.externalVisitId]) {
          acc[log.externalVisitId] = [];
        }
        acc[log.externalVisitId].push(log);
        return acc;
      }, {});
      combinedTasks.forEach(task => {
        task.evv_logs = evvLogsMap[task.taskData.tas_id] || [];
      });
            
      res.json(combinedTasks);
      console.log(counter1);
      console.log(counter2);
      return;
    } else {
      res.status(400).json({ message: 'missing required query parameters' });
      return;
    }
  } catch(err){
    res.status(500).json({ message: 'An error occured while trying to get EVV NJ status data' });
    console.log('An error occured while trying to get EVV NJ status data:' + err);
    return;
  }
  return;
};

exports.updateSendEVV = async function(req, res) {
  try{
    if (req.body.task_id && req.body.sendEVV !== null && req.body.sendEVV !== undefined){
      const updateQuery = `UPDATE empLocate SET send_EVV = '${req.body.sendEVV != 'false' && req.body.sendEVV ? '1' : '0'}' WHERE taskId = ${req.body.task_id}`;
      const updateData = await DBUpdate(updateQuery);
      res.json({ message: 'send_EVV data updated successfully' });
      return;
    } else {
      res.status(400).json({ message: 'missing required body parameters' });
      return;
    }
  } catch(err){
    res.status(500).json({ message: 'An error occured while trying to update send_EVV data' });
    return;
  }
  return;

};

exports.getSendEVV = async function(req, res) {
  try{
    if (req.query.task_id){
      const getQuery = `SELECT send_EVV FROM empLocate WHERE taskId = ${req.query.task_id}`;
      const getData = await DBSendResponse(getQuery);
      res.json(getData[0].send_EVV);
      return;
    } else {
      res.status(400).json({ message: 'missing required query parameters' });
      return;
    }
  } catch(err){
    res.status(500).json({ message: 'An error occured while trying to get send_EVV data' });
    return;
  }

};

exports.getNJEVVReadinessData = async function(req, res) {
  console.log('getNJEVVReadinessData called');
  try {
    if (!req.query.company_id) {
      res.status(400).json({ message: 'missing required query parameters: company_id' });
      return;
    }
    
    const companyId = req.query.company_id;

    const employees = await DBSendResponse(`SELECT * FROM employee WHERE emp_company_id = ${companyId} AND emp_is_active = 1`);
    const customers = await DBSendResponse(`SELECT * FROM customer WHERE cus_company_id = ${companyId} AND cus_is_active = 1`);
    const taskTypes = await DBSendResponse(`
      SELECT d.*, t.procedure_code_id, t.dropdown_id
      FROM dropdowns d
      LEFT JOIN TaskProcCodeMapping t ON d.ddID = t.dropdown_id AND t.comp_id = ${companyId}
      WHERE d.CompanyID = ${companyId} AND d.EntityName = 'taskType' AND d.is_Active = 0
    `);

    const employeeIssues = employees.map(emp => {
      const issues = [];
      let severity = 'LOW';

      if (!emp.emp_professionalLicenseNumber) {
        issues.push('Missing professional license number');
        severity = 'HIGH';
      }

      if (!emp.dob) {
        issues.push('Missing date of birth');
        severity = 'HIGH';
      }
      
      if (issues.length === 0) return null;
      return {
        emp_id: emp.emp_id,
        emp_name: `${emp.emp_first_name} ${emp.emp_last_name}`,
        issues,
        severity
      };
    }).filter(issue => issue !== null);

    const customerIssues = customers.map(cus => {
      const issues = [];
      let severity = 'LOW';

      if (!cus.medicaid_id) {
        issues.push('Missing Medicaid ID');
        severity = 'HIGH';
      }

      console.log(cus);

      if (issues.length === 0) return null;
      return {
        cus_id: cus.cus_id,
        cus_name: cus.cus_name,
        issues,
        severity
      };
    }).filter(issue => issue !== null);

    const taskTypeIssues = taskTypes.map(taskType => {
      const issues = [];
      let severity = 'LOW';

      if (!taskType.procedure_code_id) {
        issues.push('Missing procedure code mapping');
        severity = 'MEDIUM';
      }
      
      if (issues.length === 0) return null;
      return {
        task_type_id: taskType.ddID,
        task_type_name: taskType.EntityValue,
        issues,
        severity
      };
    }).filter(issue => issue !== null);

    const response = {
      overall_status: (employeeIssues.length > 0 || customerIssues.length > 0 || taskTypeIssues.length > 0) ? 'Issues Found' : 'Ready',
      summary: {
        employees: {
          total: employees.length,
          with_issues: employeeIssues.length
        },
        customers: {
          total: customers.length,
          with_issues: customerIssues.length
        },
        task_types: {
          total: taskTypes.length,
          with_issues: taskTypeIssues.length
        }
      },
      employee_issues: employeeIssues,
      customer_issues: customerIssues,
      task_type_issues: taskTypeIssues
    };

    res.json(response);
    return;

  } catch(err) {
    console.log('An error occurred while trying to get EVV NJ readiness data: ' + err);
    res.status(500).json({ message: 'An error occurred while trying to get EVV NJ readiness data' });
    return;
  }
};