const jwt_decode = require('../utils/tokenDecoder.js')
const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')
const { google, outlook, office365, ics } = require('calendar-link')
const moment = require('moment-timezone')
const nodemailer = require('nodemailer')
const res = require('express/lib/response.js')
const { CUSTOMERIO_API_KEY } = require('../config.js')
const { APIClient, SendEmailRequest } = require("customerio-node");
const client = new APIClient(CUSTOMERIO_API_KEY);

exports.sendCalendarEmail = async function (task_id){
  let taskList
  if (task_id) {
    taskList = await getOneTask(task_id)
  }

  const task_title = taskList[0].tas_title
  const task_description = taskList[0].tas_description
  const task_start_date = taskList[0].tas_start_date
  const task_start_time = moment(taskList[0].tas_start_time).format('LT')
  const task_end_date = taskList[0].tas_end_date
  const task_end_time = moment(taskList[0].tas_end_time).format('LT')
  const emp_id = taskList[0].tas_emp_id   //employee id
  const loc_id = taskList[0].tas_loc_id

  const loc_ids = []
  if (taskList[0].tas_loc_id) {
    loc_ids.push(taskList[0].tas_loc_id)
  }
  if (taskList[0].tas_loc1_id) {
    loc_ids.push(taskList[0].tas_loc1_id)
  }
  if (taskList[0].tas_loc2_id) {
    loc_ids.push(taskList[0].tas_loc2_id)
  }

  const query = `SELECT * FROM location where loc_id in (${loc_ids.join(",")})`
  const location = await DBSendResponse(query)

  let settings = await DBSendResponse(`SELECT * FROM settings WHERE company_id = ${taskList[0].tas_com_id}`);
  let isSecureCommunicaion = settings.find(setting => setting.feature_id === 21);
  let isTaskAssignment = settings.find(setting => (setting.feature_id === 63 && setting.feature_value === 'true'));
  let individualSettings = await DBSendResponse(`SELECT * FROM individual_settings WHERE emp_id = ${emp_id}`);
  let isTaskAssignmentEmployee = individualSettings.find(setting => setting.feature_id === 4 && setting.feature_value === 'true');

  console.log(isSecureCommunicaion, isTaskAssignment, isTaskAssignmentEmployee, "feature check")

  if (!isSecureCommunicaion || !isTaskAssignment || !isTaskAssignmentEmployee) {
    return true;
  }

  const addresses = location.map((loc) => {
    return `<li style="font-size: 14px;">${loc.loc_addr_line1}, ${loc.loc_addr_line2}, ${loc.loc_city}, ${loc.loc_state}, ${loc.loc_zip}</li>`
  })

  const loc_addr_line1 = location[0].loc_addr_line1
  const loc_addr_line2 = location[0].loc_addr_line2
  const loc_city = location[0].loc_city
  const loc_state = location[0].loc_state
  const loc_zip = location[0].loc_zip
  const com_id = location[0].loc_company_id    ///company id
  const loc=loc_addr_line1+"\n"+loc_addr_line2+"\n"+loc_city+"\n"+loc_state+' '+loc_zip

  const dateS = task_start_date
  const timeS = task_start_time
  const dateE = task_end_date
  const timeE = task_end_time

  console.log(dateS, timeS, dateE, timeE);

  const dateTimeS = moment.utc(dateS).format('MMM DD, YYYY') + ` at ${timeS}`
  const dateTimeE = moment.utc(dateE).format('MMM DD, YYYY') + ` at ${timeE}`
  console.log(dateTimeS, dateTimeE);
  const event = {
    title: task_title,
    description: task_description,
    location: loc,
    start: moment.tz(taskList[0].tas_start_time, 'YYYY-MM-DDTHH:mm:ss','America/New_York').toISOString(),
    end: moment.tz(taskList[0].tas_end_time, 'YYYY-MM-DDTHH:mm:ss','America/New_York').toISOString()
  }
  console.log(event);

  var googleL = google(event)
  var outlookL = outlook(event)
  var office365L = office365(event)
  var icsL = ics(event)

  // employee name and employee email
  const queryEmp = `SELECT * FROM employee WHERE emp_company_id = ${com_id} and emp_id = ${emp_id}`
  let empList = await DBSendResponse(queryEmp)
  //const emp_first_name = empList[0].emp_first_name
  const emp_Email = empList[0].sec_email

  console.log("sending CustomerIO Email")

  const request = new SendEmailRequest({
    transactional_message_id: "calender",
    message_data: {
      task_title: task_title,
      task_description: task_description,
      dateTimeS: dateTimeS,
      dateTimeE: dateTimeE,
      loc_addr_line1: loc_addr_line1,
      loc_addr_line2: loc_addr_line2,
      addresses: addresses.join(""),
      loc_city: loc_city,
      loc_state: loc_state,
      loc_zip: loc_zip,
      googleL: googleL,
      outlookL: outlookL,
      office365L: office365L,
      icsL: icsL,
    },
    "attachments": {
      "receipt.txt" : "MTIzNA=="
    },
    identifiers: {
      id: emp_id
    },
    to: emp_Email,
  });

  console.log({
    transactional_message_id: "calender",
    message_data: {
      task_title: task_title,
      task_description: task_description,
      dateTimeS: dateTimeS,
      dateTimeE: dateTimeE,
      loc_addr_line1: loc_addr_line1,
      loc_addr_line2: loc_addr_line2,
      addresses: addresses.join(""),
      loc_city: loc_city,
      loc_state: loc_state,
      loc_zip: loc_zip,
      googleL: googleL,
      outlookL: outlookL,
      office365L: office365L,
      icsL: icsL,
    },
    "attachments": {
      "receipt.txt" : "MTIzNA=="
    },
    identifiers: {
      id: emp_id
    },
    to: emp_Email,
  });

  const icsLString = (icsL.split(',')[1]).replace(/%0A/g, '\n').replace(/%20/g, ' ').replace(/%5Cn/g, '\n');
  var buffer = Buffer.from(icsLString, 'utf8');
  request.attach("task.ics", buffer);

  client.sendEmail(request).then((response) => {
      console.log(response)
      return true
    }
  ).catch((error) => {
      console.log(error)
      return false
    }
  );
} 

exports.getAllTask = async function (req, res) {
    let response = await sendCalendarEmail(req.query.taskId)
    response ? res.json({ code: 200, message: "Calendar Email Sent" }) : res.json({ code: 500, message: "Calendar Email Failed" })
}

async function getOneTask (task_id) {
  const query = `SELECT * FROM task where tas_id=${task_id}`
  const taskList = await DBSendResponse(query)
  return taskList
}

exports.sendHelpEmail = async function (req, res) {
  const request = new SendEmailRequest({
    transactional_message_id: "help_email",
    message_data: {
      body: req.body.body,
      emp_name: req.body.emp_name,
      emp_id: req.body.emp_id,
      com_name: req.body.com_name,
      com_id: req.body.com_id,
      emp_email: req.body.emp_sec_email,
    },
    identifiers: {
      id: req.body.emp_id,
    },
    to: "support@fieldworker.ai",
    subject: req.body.subject,
  });

  for (let key of Object.keys(req.body.attachments)) {
    request.attach(key,Buffer.from(req.body.attachments[key], 'base64'));
  }

  let err, status;

  await client.sendEmail(request).then((response) => {
      console.log(response)
      status = true;
      return true
    }
  ).catch((error) => {
      status = false;
      err = error;
      return false
    }
  );

  return res.json({
    sent:status,
    err: status ? undefined: err,
  })
}
