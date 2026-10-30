const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { addNotif } = require('../helpers/notifications');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');

const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
const { sendCalendarEmail } = require('../helpers/calendar-link.js');
const { parseSQLText } = require('../utils/validation.js');
const { CUSTOMERIO_API_KEY, env } = require('../config.js');
const { APIClient, SendPushRequest } = require('customerio-node');
const moment = require('moment-timezone');

const client = new APIClient(CUSTOMERIO_API_KEY);

exports.addlocation = async function (req, res, sendId = false, address = {}) {
  console.log('Checking for location add ', sendId);
  console.log(req.body);
  // Escape single quotes — addresses like "Sidi M'Hamed" otherwise break the INSERT
  const esc = (value) => String(value).replace(/'/g, "''");
  const query = 'insert into location(loc_addr_line1,loc_addr_line2,loc_city,loc_state,loc_zip,' +
		'loc_lat,loc_lon,loc_type,' +
		'loc_status,loc_county,loc_association_date,loc_phone_number,loc_company_id,loc_is_active) values ' +
		'(\'' + esc(!sendId ? req.body.address_line_1 : address.address_line_1) + '\',' +
		'\'' + esc(!sendId ? req.body.address_line_2 : address.address_line_2) + '\',' +
		'\'' + esc(!sendId ? req.body.city : address.city) + '\',' +
		'\'' + esc(!sendId ? req.body.state : address.state) + '\',' +
		'\'' + esc(!sendId ? req.body.zip : address.zip) + '\',' +
		'\'' + esc(!sendId ? (req.body.latitude ? req.body.latitude : '0') : (address.latitude ? address.latitude : '0')) + '\',' +
		'\'' + esc(!sendId ? (req.body.longitude ? req.body.longitude : '0') : (address.longitude ? address.longitude : '0')) + '\',' +
		'\'' + esc(!sendId ? (req.body.location_type ? req.body.location_type : 'Customer Location') : 'Customer Location') + '\',' +
		'\'' + esc(!sendId ? (req.body.location_status ? req.body.location_status : 'Personal') : 'Personal') + '\',' +
		'\'' + esc(!sendId ? (req.body.country ? req.body.country : 'United States') : 'United States') + '\',' +
		(!sendId ? '' : '') +
		 (!sendId ? (req.body.association_date ? '\'' + esc(req.body.association_date) + '\'' : 'GETDATE()') : 'GETDATE()') +
		(!sendId ? ',' : ',') +
		'\'' + esc(req.body.phone ? req.body.phone : '') + '\',' +
		'' + req.body.company_id + ',\'true\'); SELECT SCOPE_IDENTITY();';
  console.log(query);
  let exists = false;
  const checkQuery = `Select * from location where loc_lat='${!sendId ? req.body.latitude : address.latitude}' and loc_lon='${!sendId ? req.body.longitude : address.longitude}' and loc_company_id=${req.body.company_id}`;
  let resp = await DBSendResponse(checkQuery);
  // console.log('location debugging');
  // console.log(checkQuery);
  // console.log(req?.body?.latitude);
  // console.log(address?.latitude);
  // console.log(resp);
  // console.log(resp?.length);
  // console.log(exists);
  // console.log(sendId);
  if (resp.length !== 0) {
    exists = true;
    console.log('Location already exists');
  }
  if (!sendId) {
    DBinsert(res, query);
  } else {
    if (exists) {
      return resp[0].loc_id;
    } else {
      const locId = await DBinsertSendID(query);
      console.log('dependent query', locId);
      return locId;
    }
  }
};

exports.addcompany = async function (req, res) {
  const query = 'insert into company(com_name,com_is_active) values ' +
		'(\'' + (req.body.com_name) + '\',' +
		'\'' + (req.body.com_is_active) + '\'); SELECT SCOPE_IDENTITY();';

  DBinsert(res, query);
};

const toFloatSql = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return 'NULL';
  const n = Number(value);
  return Number.isFinite(n) ? n : 'NULL';
};

exports.addProject = async function (req, res) {
  let title = '';
  let name = '';
  const programId = Number(req.body.pro_program_id);
  const programIdSql = Number.isInteger(programId) && programId > 0 ? programId : 'NULL';
  console.log('42..', req.body);
  if (!sendId) {
    title = req.body.pTitle;
    title = parseSQLText(title, 100);
  } else {
    name = req.body.name;
    name = name.replace('\'', '\'\'');
  }

  const currPlanVersionSql = toFloatSql(req.body.curr_plan_version);
  const query = 'insert into project (DDD_ID,active_plan_version,pro_title, pro_description, pro_customer_id, pro_sponsors_id,' +
		'pro_contact_id, pro_manager_id, pro_starts_on, pro_ends_on, pro_price, pro_currency,pro_is_active,pro_created_at,pro_created_by,pro_com_id, pro_self_pay, pro_primary_payer, pro_secondary_payer, pro_program_id, curr_plan_version)' +
		'VALUES (' +
		'' + (req.body.ddd_id ? '\'' + parseSQLText(req.body.ddd_id, 10) + '\'' : 'NULL') + ',' +
		'\'' + parseSQLText(req.body.active_plan_version, 20) + '\',' +
		'\'' + (!sendId ? title : 'Project for '.concat(name)) + '\',' +
		'\'' + (!sendId ? parseSQLText(req.body.pDesc, 250) : 'Support Coordination') + '\',' +
		'' + (!sendId ? req.body.pCustomer : (req.body.cusId ? req.body.cusId : cusId)) + ',' +
		'' + (!sendId ? req.body.pSponsor : 'NULL') + ',' +
		'' + (!sendId ? req.body.pContact ? req.body.pContact : 'NULL' : 'NULL') + ',' +
		'' + (req.body.pManager ? req.body.pManager : 'NULL') + ',' +
		(!sendId ? '\'' : '') +
		(!sendId ? req.body.pstrtDate : 'CURRENT_TIMESTAMP') +
		(!sendId ? '\',' : ',') +
		(!sendId ? '\'' : '') +
		(!sendId ? req.body.pEndDate : 'DATEADD(year, 1, CURRENT_TIMESTAMP)') +
		(!sendId ? '\',' : ',') +
		'' + (!sendId ? req.body.pPrice : 0) + ',' +
		'\'' + (!sendId ? req.body.pCurrency : 'USD') + '\',' +
		'\'true\',CURRENT_TIMESTAMP,' +
		'' + (req.body.user_id?req.body.user_id:'NULL') + ',' +
		'' + req.body.company_id + ',' +
		'' + (req.body.pro_self_pay ? `'${req.body.pro_self_pay}'` : 0) + ',' +
		'' + (req.body.pro_primary_payer ? req.body.pro_primary_payer :'NULL') + ',' +
		'' + (req.body.pro_secondary_payer ? req.body.pro_secondary_payer :'NULL') + ',' +
		'' + programIdSql + ',' +
		'' + currPlanVersionSql + '' +
		'); SELECT SCOPE_IDENTITY()';
  const request = new db.Request();
  console.log(query);
  const proj_id = await request.query(query).then(async (recordset) => {
    const project_id = recordset.recordset[0][''];

    let empList;
    if (!sendId) { empList = req.body.selectedEmp; } else { empList = [{ empId: req.body.pManager }]; }
    empList.map(elem => {
      const projectEmpAssign = 'insert into projectEmployeeAssignment (pea_pro_id, pea_emp_id, pea_status,' +
				'pea_bill_rate, pea_currency, pea_frequency, pea_associate_from, pea_associate_to,pea_is_active,pea_created_at) ' +
				'VALUES (' +
				'' + project_id + ',' +
				'' + elem.empId + ',' +
				'\'' + (!sendId ? elem.pEmpStatus : 'Full Time') + '\',' +
				'' + (!sendId ? elem.pEmpBillRate : 11) + ',' +
				'\'' + (!sendId ? elem.pEmpCurrency : 'USD') + '\',' +
				'\'' + (!sendId ? elem.pEmpFrequency : 'Hourly') + '\',' +
				(!sendId ? '\'' : '') +
				(!sendId ? elem.pEmpAssFromDate : 'CURRENT_TIMESTAMP') +
				(!sendId ? '\',' : ',') +
				(!sendId ? '\'' : '') +
				(!sendId ? elem.pEmpAssToDate : 'DATEADD(year, 1, CURRENT_TIMESTAMP)') +
				(!sendId ? '\',' : ',') +
				'\'true\',CURRENT_TIMESTAMP' +
				');';
      request.query(projectEmpAssign, (err, recordset) => {
        if (err) {
          console.log(err);
          res.json({ code: 500, message: 'Insert Failed' });
        }
      });
    });

    let notificationList = await Promise.all(empList.map(async (data)=> {
      let notifPayload = {
        send_id: req.body.user_id,
        rec_id: data.empId,
        text: 'New Project Assigned',
        emp_id: data.empId,
        pro_id: project_id,
        // tas_id: taskId,
		  };
		  let notif = await addNotif({ params: { notif_type: 'project' },body: notifPayload }, res,notifSendId=true);
		  console.log(notif);
		  return notif; 
    }));
    console.log(notificationList);
		  
    let locList;
    if (!sendId) { locList = req.body.pLoc; } else {
      locList = (req.body.locarrId ? req.body.locarrId : locarrId);
    }
    locList.forEach(function (loc) {
      const PlocatioQuery = 'insert into projectLocation(ploc_pro_id,ploc_loc_id) values(' + project_id + ',' + (!sendId ? loc.locId : loc) + ');';
      request.query(PlocatioQuery, (err, recordset) => {
        if (err) {
          console.log(err);
          res.json({ code: 500, message: 'Insert Failed' });
        }
      });
    });
    let com_id = req.body.company_id, emp_id = req.body.user_id;
    if (com_id && emp_id && title) {
      analytics.track({
        userId: String(emp_id),
        event: 'Project added',
        context: {
          groupId: String(com_id),
        },
        properties: {
			  projectName: title,
			  projectId: project_id,
        }
      });
      console.log('logged to segment successfully');
    }
    if (!sendId) { res.json({ code: 200, id: project_id, message: 'success' }); } else {
      // console.log("113 dependent project",project_id)
      return project_id;
    }
  }).catch((err) => { console.log('is this the error', err); });
  return proj_id;
};

// options.skipNotification suppresses the "New Task Assigned" notification. Used when the
// task is created already-completed as a record of something that just happened (e.g. an
// auto-logged video call), where telling the worker it was "assigned" to them is noise.
exports.addTaskAndReturnId = async function (data, options = {}) {
  console.log(data);
  const query = 'insert into task (tas_title, tas_description,tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time,tas_priority, ' +
		  'tas_billable_by_default,tas_notes,tas_is_active,tas_created_at, tas_pro_id,tas_emp_id,tas_loc_id,tas_prequisites_task,tas_created_by,tas_com_id, task_emp_timezone, tas_cus_id, tas_travel_time, tas_expenses, tas_oloc_id) ' +
		  'values(' +
		  '\'' + (data.tTitle?.replaceAll('\'', '\'\'') || '') + '\',' +
		  '\'' + (data.tDesc?.replaceAll('\'', '\'\'') || '') + '\',' +
		  '\'' + (data.tType) + '\',' +
		  ('\'' ) + (data.tStrtDate ) + ('\',' ) +
		  ('\'' ) +(data.tEndDate ) +('\',') +
		  '\'' + (data.tStartTime ) + '\',' +
		  '\'' + (data.tEndTime ) + '\',' +
		  '\'' + (data.tPriority ) + '\',' +
		  '\'' + (data.tIsBillable ?? true) + '\',' +
		  '\'' + (data.tNotes?.replaceAll('\'', '\'\'') || 'NULL') + '\',' +
		  (data.tActive || 0) + ',' +
		  'CURRENT_TIMESTAMP,' +
		  '' + (data.tProject ) + ',' +
		  '' + (data.tAssTo ) + ',' +
		  '' + (data.tLoc ) + ',' +
		  '' + (data.tPreReq || 'NULL') + ',' +
		  '' + (data.user_id || 'NULL') + ',' +
		  '' + data.company_id + ',' +
      '\'' + (data.task_emp_timezone || 'NULL') + '\',' +
		  '' + (data.cus_id || 'NULL') + ',' +
		  '' + (data.tTravelTime || 'NULL') + ',' +
		  '' + (data.tExpenses || 'NULL') + ',' +
		  '' + (data.tOloc || 'NULL') + '); SELECT SCOPE_IDENTITY();';
  console.log(query);
	  const taskId = await DBinsertSendID(query);
	  let notifPayload = {
    send_id: data.user_id || null,
    rec_id: data.tAssTo,
    text: 'New Task Assigned',
    emp_id: data.tAssTo,
    pro_id: data.tProject,
    tas_id: taskId,
	  };

  if (!options.skipNotification) {
    try{
      let notif = await addNotif({ params: { notif_type: 'task' },body: notifPayload }, sendId=true);
	        console.log(notif, '- Notificaiton ID Recurr');
    } catch(error){
      console.log(error);
    }
  }
      
	  return taskId;
};
  

exports.addTask = async function (req, res) {
  console.log(req.body);
  console.log(req.body.tTitle);
  console.log(req.body.tTitle.replaceAll('\'', '\'\''));
  const query = 'insert into task (tas_title, tas_description,tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time,tas_priority, ' +
		'tas_billable_by_default,tas_notes,tas_is_active,tas_created_at, tas_pro_id,tas_emp_id,tas_loc_id,tas_loc1_id,tas_loc2_id,tas_prequisites_task,tas_created_by,tas_com_id,tas_mm_id,tas_required_sig, task_emp_timezone, tas_cus_id, tas_travel_time, tas_expenses, tas_oloc_id) ' +
		'values(' +
		'\'' + (!sendId ? req.body.tTitle?.replaceAll('\'', '\'\'') : task.tas_name) + '\',' +
		'\'' + (!sendId ? req.body.tDesc?.replaceAll('\'', '\'\'') : task.tas_desc) + '\',' +
		'\'' + (!sendId ? req.body.tType : task.tas_type) + '\',' +
		(!sendId ? '\'' : '') +
		(!sendId ? req.body.tStrtDate : task.tas_mon) +
		(!sendId ? '\',' : ',') +
		(!sendId ? '\'' : '') +
		(!sendId ? req.body.tEndDate : task.tas_mon) +
		(!sendId ? '\',' : ',') +
		'\'' + (!sendId ? req.body.tStartTime : '9 AM') + '\',' +
		'\'' + (!sendId ? req.body.tEndTime : '5 PM') + '\',' +
		'\'' + (!sendId ? req.body.tPriority : task.tas_priority) + '\',' +
		'\'' + (!sendId ? req.body.tIsBillable : true) + '\',' +
		'\'' + (!sendId ? req.body.tNotes?.replaceAll('\'', '\'\'') : task.tas_note) + '\',' +
		(req.body.tActive || 0) + ',' +
		'CURRENT_TIMESTAMP,' +
		'' + (!sendId ? req.body.tProject : proj) + ',' +
		'' + (!sendId ? req.body.tAssTo : req.body.pManager) + ',' +
		'' + (!sendId && req.body.tLoc ? req.body.tLoc : 'NULL') + ',' +
		'' + (!sendId && req.body.tLoc1 ? req.body.tLoc1 : 'NULL') + ',' +
		'' + (!sendId && req.body.tLoc2 ? req.body.tLoc2 : 'NULL') + ',' +
		'' + (!sendId ? req.body.tPreReq : 'NULL') + ',' +
		'' + (!sendId ? req.body.user_id?req.body.user_id:(req.body.empId ? req.body.empId : 'NULL') : 'NULL') + ',' +
		'' + req.body.company_id + ',' +
		'' + (req.body.tas_mm_id !== undefined && req.body.tas_mm_id !== null ? req.body.tas_mm_id : 'NULL') + ',' +
    '' + (req.body.tas_required_sig ? req.body.tas_required_sig : 0) + ',' +
    '\'' + (req.body.task_emp_timezone || 'NULL') + '\',' +
		'' + (req.body.cus_id || 'NULL') + ',' +
		'' + (req.body.tTravelTime || 'NULL') + ',' +
		'' + (req.body.tExpenses || 'NULL') + ',' +
		'' + (req.body.tOloc || 'NULL') + '); SELECT SCOPE_IDENTITY();';
  console.log(query);
  const taskId = await DBinsertSendID(query);

  if(taskId) {
    let contactQuery = 'insert into task_contact (task_id, contact_id, created_on) values ';

    if(req.body.tContacts && req.body.tContacts?.length > 0){
      req.body.tContacts.map((contact, index) => {
        contactQuery += `(${taskId}, ${contact.id}, CURRENT_TIMESTAMP)`;
        if(index < req.body.tContacts.length - 1){
          contactQuery += ',';
        }
      });
    }

    if(req.body.tContacts && req.body.tContacts?.length > 0){
      console.log(contactQuery);
      DBSendResponse(contactQuery);
    }

  }
  
  //Calendar Notification
  if(req.body.tDesc!=='Time Sheet Entry' && req.body.tDesc!=='Session Task' && req.body.tLoc!==null && req.body.tLoc!==undefined){
    console.log('GOT TO CALENDAR');
    await sendCalendarEmail(taskId);
  }
  
  console.log(taskId);
  if(taskId){
    let empId = req.body.user_id ? req.body.user_id : req.body.empId, taskName = req.body.tTitle, empName = req.body.empName, projectId = req.body.tProject;
    console.log(empId, taskName, empName, projectId, req.body.company_id, taskId, moment().isBefore(moment(req.body.tStartTime,'YYYY-MM-DDTHH:mm:ss').subtract(1, 'hours')));
    if(req.body.tDesc !== 'Time Sheet Entry' && empId && taskName && empName && projectId && req.body.company_id && taskId) {

      let settings = await DBSendResponse(`SELECT * FROM settings WHERE company_id = ${req.body.company_id}`);
      let isSecureCommunicaion = settings.find(setting => setting.feature_id === 21);
      let isTaskReminder = settings.find(setting => (setting.feature_id === 63 && setting.feature_value === 'true'));
      let individualSettings = await DBSendResponse(`SELECT * FROM individual_settings WHERE emp_id = ${empId}`);
      let isTaskReminderEmployee = individualSettings.find(setting => setting.feature_id === 4 && setting.feature_value === 'true');
      console.log(moment.tz('America/New_York'), moment().tz('America/New_York'));

      if (isSecureCommunicaion && isTaskReminder && isTaskReminderEmployee && moment.tz('America/New_York').isBefore(moment.tz(req.body.tStartTime,'YYYY-MM-DDTHH:mm:ss','America/New_York').subtract(1, 'hours'))) {

        const request = new SendPushRequest({
          transactional_message_id: 'task_status',
          message_data: {
				  status: 'check-in',
				  taskTitle: `${req.body.tTitle}`,
				  time: moment.tz(req.body.tStartTime,'YYYY-MM-DDTHH:mm:ss','America/New_York').format('DD MMM, YYYY hh:mm A'),
          },
          identifiers: {
				  id: empId,
          },
          send_at: Number(moment.tz(req.body.tStartTime, 'YYYY-MM-DDTHH:mm:ss', 'America/New_York').subtract(1, 'hours').format('X'))
        });

			
        console.log({
          transactional_message_id: 'task_status',
          message_data: {
				  status: 'check-in',
				  taskTitle: `${req.body.tTitle}`,
				  time: moment.tz(req.body.tStartTime,'YYYY-MM-DDTHH:mm:ss','America/New_York').format('DD MMM, YYYY hh:mm A'),
          },
          identifiers: {
				  id: empId,
          },
          send_at: Number(moment.tz(req.body.tStartTime, 'YYYY-MM-DDTHH:mm:ss', 'America/New_York').subtract(1, 'hours').format('X'))
        });
        await client.sendPush(request).then((res) => console.log(res)).catch((err) => {
          console.log('error');
          console.log(err.statusCode, err.message); 
        });

      }
		
      analytics.track({
        userId: String(empId),
        event: 'Task added',
        context: {
          groupId: String(req.body.company_id),
        },
        properties: {
			  taskName: taskName,
			  addedBy: empName,
			  projectId: projectId,
			  companyId: String(req.body.company_id),
			  taskId: String(taskId)
        }
      });
      console.log('logged to segment successfully');
    }
    let notifPayload = {
      send_id: req.body.user_id,
      rec_id: req.body.tAssTo,
      text: 'New Task Assigned',
      emp_id: req.body.tAssTo,
      pro_id: req.body.tProject,
      tas_id: taskId,
	  };
	  let notif = req.body.notifType === 'attendance' ? null : await addNotif({ params: { notif_type: 'task' },body: notifPayload }, res,notifSendId=true);	 
	  console.log(notif);
    if (!sendId) {
      // DBinsert(res, query)
      res.send({ code: 200, message: 'Successfully saved Task',notif_id:notif, id: taskId });
    } else {
      // const taskId = await DBinsertSendID(query)
      return taskId;
    }
  }else{
    if (!sendId) {
      res.send({ code: 500, message: 'Error!! Try Again' });
    }else{return null;}
  }
};
