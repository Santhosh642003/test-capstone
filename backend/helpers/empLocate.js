const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries');
const moment = require('moment-timezone');
const axios = require('axios');
const { BING_API_KEY } = require('../config');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
const { CUSTOMERIO_API_KEY, env } = require('../config.js');
const { APIClient, SendPushRequest } = require('customerio-node');
const client = new APIClient(CUSTOMERIO_API_KEY);


exports.getEmpLoc = function (req, res) {
  const query = `SELECT empLocId,pro_title,emp_first_name,emp_last_name,tas_pro_id,tas_emp_id,tas_title,tas_start_time,tas_end_time,task_emp_timezone,tas_start_date,tas_is_active,tas_com_id,loc_addr_line1,loc_addr_line2,loc_city,loc_state,loc_zip,loc_lat,loc_lon,emploc_lat,emploc_lon,UpdatedTime,tas_id,empLocdate,checkoutEmpDate,empLocate_timezone,checkin
                FROM (SELECT empLocId,projId,pro_title,
                empId,emp_first_name,emp_last_name,tas_pro_id,tas_emp_id,
                taskId,tas_title,tas_start_time,tas_end_time,task_emp_timezone,tas_type,tas_com_id,tas_start_date,tas_is_active,tas_id,checkin,
                locId,loc_addr_line1,loc_addr_line2,loc_city,loc_state,loc_zip,loc_lat,loc_lon,
                emploc_lat,emploc_lon,empLocdate,checkoutEmpDate,empLocate_timezone
                FROM empLocate,task,project,employee,location
                WHERE projId=pro_id AND empId=emp_id AND taskId=tas_id AND locId=loc_id AND (tas_type LIKE '%Visit' OR tas_type = 'In-Person' )) 
                AS empLocDetails INNER JOIN (SELECT empId as id,MAX(empLocdate) as UpdatedTime from empLocate where projId is NOT NULL GROUP BY empId) AS SelectedEmp ON empId=id AND UpdatedTime=empLocdate
                WHERE tas_com_id=${req.query.comp_id}
                ORDER BY UpdatedTime DESC`;
  const request = new db.Request();

  request.query(query)
    .then(async (result) => { 
      for (let i = 0; i < result.recordsets[0].length; i++) {
        const record = result.recordsets[0][i];
        
        const address = [record.loc_addr_line1, record.loc_addr_line2, record.loc_city, record.loc_state, record.loc_zip]
          .filter(Boolean)
          .join(', ') || 'Address Not Available';
        
        result.recordsets[0][i] = { ...result.recordsets[0][i], empAddress: address };
      }
      res.json(result.recordsets[0]); })
    .catch((err) => { 
      console.log(err);
      res.json(err); 
    });
};

// UPDATE FOR EMP LOCATE TOGGLER
exports.getTimeSpent = function (req, res) {
  const query = `SELECT taskId,MAX(empLocdate) as CheckInTime, MAX(checkoutEmpDate) as CheckoutTime from empLocate,task WHERE taskId=tas_id AND projId=${req.query.projId} AND tas_com_id=${req.query.comp_id} GROUP BY taskId`;
  const request = new db.Request();
  request.query(query)
    .then((result) => { res.json(result.recordsets[0]); })
    .catch((err) => { res.json(err); });
};

exports.insertEmpLoc = async function (req, res) {
  const taskUpdateQuery = `UPDATE task SET checkin='true' where tas_id=${req.body.taskId}`;
  const status = await DBUpdate(taskUpdateQuery);
  const cusId = await DBSendResponse(`SELECT pro_customer_id FROM project WHERE pro_id = ${req.body.projId}`);
  console.log(cusId);
  const taskEndTimeResp = await DBSendResponse(`SELECT tas_end_time FROM task WHERE tas_id = ${req.body.taskId}`);
  let taskEndTime = taskEndTimeResp?.[0]?.tas_end_time;
  if (status === 0) {
    res.json({ code: 500, message: 'Error in Task Update' });
    return;
  }
  if (!taskEndTimeResp || !taskEndTimeResp[0]) {
    console.log('Task not found for taskId:', req.body.taskId);
    res.json({ code: 404, message: 'Task not found' });
    return;
  }
  if(req.body.empId && req.body.taskTitle && req.body.empName && req.body.companyId && req.body.taskId && cusId[0].pro_customer_id) {

    let settings = await DBSendResponse(`SELECT * FROM settings WHERE company_id = ${req.body.companyId}`);
    let isSecureCommunicaion = settings.find(setting => setting.feature_id === 21);
    let isTaskReminder = settings.find(setting => (setting.feature_id === 63 && setting.feature_value === 'true'));
    let individualSettings = await DBSendResponse(`SELECT * FROM individual_settings WHERE emp_id = ${req.body.empId}`);
    let isTaskReminderEmployee = individualSettings.find(setting => setting.feature_id === 4 && setting.feature_value === 'true');

    if (isSecureCommunicaion && isTaskReminder && isTaskReminderEmployee && moment.tz('America/New_York').isBefore(moment.tz(taskEndTime,'YYYY-MM-DDTHH:mm:ss','America/New_York').subtract(1, 'hours'))) {

      const request = new SendPushRequest({
        transactional_message_id: 'task_status',
        message_data: {
          status: 'check-out',
          taskTitle: `${req.body.taskTitle}`,
          time: moment.tz(taskEndTime, 'YYYY-MM-DDTHH:mm:ss', 'America/New_York').format('DD MMM, YYYY hh:mm A'),
        },
        identifiers: {
          id: req.body.empId,
        },
        send_at: Number(moment.tz(taskEndTime, 'YYYY-MM-DDTHH:mm:ss', 'America/New_York').subtract(1, 'hours').format('X'))
      });

      await client.sendPush(request).then((res) => console.log(res)).catch((err) => {
        console.log('error');
        console.log(err.statusCode, err.message); 
      });
    }

    analytics.track({
      userId: String(req.body.empId),
      event: 'Task checked in',
      context: {
        groupId: String(req.body.companyId),
      },
      properties: {
        taskTitle: req.body.taskTitle,
        checkedInBy: req.body.empName,
        companyId: String(req.body.companyId),
        taskId: String(req.body.taskId),
        cusId: cusId[0].pro_customer_id,
        checkInTime: moment(req.body.date).format('MM/DD/YYYY HH:mm:ss'),
        locationId: req.body.locId,
        empLocationLat: req.body.emploc_lat,
        empLocationLon: req.body.emploc_lon,
      }
    });
    console.log('logged to segment successfully');
  }
  // var query = "INSERT INTO empLocate VALUES ("+req.body.projId+","+req.body.empId+","+req.body.taskId+","+req.body.locId+","+req.body.emploc_lat+","+req.body.emploc_lon+",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);";
  const query = `INSERT INTO empLocate (projId, empId, taskId, locId, emploc_lat, emploc_lon, empLocdate, checkoutEmpDate, timesheet_status, empLocate_timezone) VALUES (${req.body.projId},${req.body.empId},${req.body.taskId},${req.body.locId},${req.body.emploc_lat},${req.body.emploc_lon},'${req.body.date}','${req.body.date}',0,'${req.body.empLocate_timezone}');`;
  // INSERT INTO empLocate VALUES ("+req.body.projId+","+req.body.empId+","+req.body.taskId+","+req.body.locId+","+req.body.emploc_lat+","+req.body.emploc_lon+",CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
  console.log(query);
  const request = new db.Request();
  request.query(query, function (err, recordset) {
    if (err) {
      console.log(err);
      res.send({ code: 500, message: 'insert Error' });
    } else {
      console.log(recordset);
      res.send({ code: 200, message: 'success' });
    }
  });
};

exports.updateTaskStatusToComplete = function (req, res) {
  const query = 'UPDATE task SET tas_is_active = 1,checkin=\'false\' WHERE tas_id = ' + req.body.taskId;
  // console.log(query)
  const request = new db.Request();
  console.log(req.body);
  request.query(query)
    .then((result) => {
      console.log(result);
      
      let checkoutTimeQuery = `UPDATE empLocate SET checkoutEmpDate='${req.body.date}', checkoutLocId = ${req.body.checkoutLocId} WHERE locId is NOT NULL and taskId=${req.body.taskId}`;

      if(req.body.updated_by){
        checkoutTimeQuery = `UPDATE empLocate 
            SET checkoutEmpDate='${req.body.date}', 
                reason='${req.body.reason}', 
                verification='${req.body.verification}', 
                updated_by='${req.body.updated_by}' 
            WHERE locId IS NOT NULL AND taskId=${req.body.taskId}`;
      }
      console.log(checkoutTimeQuery);
      request.query(checkoutTimeQuery)
        .then((checkoutRes) => {
          request.query(`SELECT pro_customer_id, checkoutLocId, loc_lat, loc_lon FROM empLocate INNER JOIN project ON empLocate.projId = project.pro_id INNER JOIN location ON loc_id = checkoutLocId WHERE taskId = ${req.body.taskId} AND locId IS NOT NULL`)
            .then((info) => {
              console.log(info);
              if(req.body.empId && req.body.taskTitle && req.body.empName && req.body.companyId && req.body.taskId && info.recordset[0]) {
                analytics.track({
                  userId: String(req.body.empId),
                  event: 'Task checked out',
                  context: {
                    groupId: String(req.body.companyId),
                  },
                  properties: {
                    taskTitle: req.body.taskTitle,
                    checkedOutBy: req.body.empName,
                    companyId: String(req.body.companyId),
                    taskId: String(req.body.taskId),
                    checkOutTime: moment(req.body.date).format('MM/DD/YYYY HH:mm:ss'),
                    cusId: info.recordset[0].pro_customer_id,
                    locationId: info.recordset[0].checkoutLocId,
                    empLocationLat: info.recordset[0].loc_lat,
                    empLocationLon: info.recordset[0].loc_lon,
                  }
                });
                console.log('logged to segment successfully');
              }
            });
          console.log(checkoutRes);
          res.json({ code: 200, message: 'Update Success', result: checkoutRes });
        })
        .catch((err) => {
          console.log(err);
          res.json({ code: 500, message: 'Update Error' });
        });
    })
    .catch((err) => {
      res.json({ code: 500, message: 'Update Error' });
      console.log(err);
    });
};

exports.updateTaskStatusToCompleteWithOverlapCheck = async function (req, res) {
  const request = new db.Request();
  console.log(req.body);

  try {
    // First, get the current task's check-in time, project ID, and employee ID
    const currentTaskQuery = `
      SELECT el.empLocdate, t.tas_pro_id, t.tas_emp_id 
      FROM empLocate el
      INNER JOIN task t ON el.taskId = t.tas_id
      WHERE el.taskId = ${req.body.taskId} AND el.locId IS NOT NULL
    `;
    
    const currentTaskResult = await request.query(currentTaskQuery);
    
    if (!currentTaskResult.recordset || currentTaskResult.recordset.length === 0) {
      return res.status(404).json({ code: 404, message: 'Task not found in empLocate' });
    }

    const checkInTime = currentTaskResult.recordset[0].empLocdate;
    const projectId = currentTaskResult.recordset[0].tas_pro_id;
    const employeeId = currentTaskResult.recordset[0].tas_emp_id;
    const checkOutTime = req.body.date;

    // Format dates for SQL Server comparison - treat database times as local, not UTC
    // Don't convert timezone, just format the raw datetime values
    const checkInTimeFormatted = moment.utc(checkInTime).format('YYYY-MM-DD HH:mm:ss');
    const checkOutTimeFormatted = moment.parseZone(checkOutTime).format('YYYY-MM-DD HH:mm:ss');

    // Check for overlapping tasks on the same project and same employee
    // Only check against tasks that have been completed (tas_is_active = 1)
    const overlapQuery = `
      SELECT el.taskId, t.tas_title, el.empLocdate, el.checkoutEmpDate
      FROM empLocate el
      INNER JOIN task t ON el.taskId = t.tas_id
      WHERE t.tas_pro_id = ${projectId}
        AND t.tas_emp_id = ${employeeId}
        AND el.taskId != ${req.body.taskId}
        AND el.locId IS NOT NULL
        AND t.tas_is_active = 1
        AND el.empLocdate != el.checkoutEmpDate
        AND (
          (el.empLocdate <= '${checkOutTimeFormatted}' AND el.checkoutEmpDate >= '${checkInTimeFormatted}')
          OR (el.empLocdate >= '${checkInTimeFormatted}' AND el.empLocdate < '${checkOutTimeFormatted}')
          OR (el.checkoutEmpDate > '${checkInTimeFormatted}' AND el.checkoutEmpDate <= '${checkOutTimeFormatted}')
        )
    `;

    const overlapResult = await request.query(overlapQuery);

    if (overlapResult.recordset && overlapResult.recordset.length > 0) {
      const overlappingTask = overlapResult.recordset[0];
      return res.status(409).json({ 
        code: 409, 
        message: 'Time overlap detected with another task on the same project',
        overlappingTask: {
          taskId: overlappingTask.taskId,
          taskTitle: overlappingTask.tas_title,
          checkIn: moment.utc(overlappingTask.empLocdate).format('YYYY-MM-DDTHH:mm:ss'),
          checkOut: moment.utc(overlappingTask.checkoutEmpDate).format('YYYY-MM-DDTHH:mm:ss')
        }
      });
    }

    // No overlap detected, proceed with the regular update
    exports.updateTaskStatusToComplete(req, res);

  } catch (err) {
    console.log(err);
    res.status(500).json({ code: 500, message: 'Update Error', error: err.message });
  }
};
