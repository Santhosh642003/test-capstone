const jwt_decode = require('../utils/tokenDecoder.js');
const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
const { addTask,addTaskAndReturnId } = require('../queries/dependantQueries');
const { getTaskList } = require('../queries/entityGetQueries');
const moment = require('moment');
var { SEGMENT_API_KEY, CUSTOMERIO_API_KEY, IN_APP_MESSAGE_MT_SUBMISSION_ID, IN_APP_MESSAGE_MT_STATUS_ID } = require('../config');
const { Analytics } = require('@segment/analytics-node');

const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });
const { APIClient, RegionUS } = require('customerio-node');
const e = require('express');

const api = new APIClient(CUSTOMERIO_API_KEY, { region: RegionUS });
// require('moment/locale/us');

const getProgramIdFromReq = (req) => {
  const parsed = parseInt(req.query.program_id, 10);
  return Number.isInteger(parsed) ? parsed : null;
};

exports.getTaskTime = async function (req, res) {
  let taskList;
  try{
    if(req.query.tas_id){
      const query = `Select tas_id,tas_title,tas_description,tas_type,tas_start_date,tas_end_date,tas_start_time,tas_end_time,tas_priority,tas_billable_by_default,tas_notes,tas_created_at,tas_updated_at,tas_pro_id,tas_emp_id,tas_loc_id,tas_prequisites_task,tas_com_id,tas_is_active,checkin,start_time_actual,end_time_actual,is_timesheet_entry,tas_cus_active,tas_updated_by,tas_created_by,pro_id,pro_customer_id,
            (select empLocId, empLocdate, checkoutEmpDate, emploc_lat, emploc_lon from empLocate where taskId=tas_id for JSON PATH) as empLocateInfo,
            (select cus_id, cus_name from customer where cus_id=pro_customer_id for JSON PATH) as CustomerInfo
            from task, project where tas_pro_id=pro_id AND tas_id=${req.query.tas_id}`;
      taskList = (await DBSendResponse(query))[0];
      taskList.empLocateInfo = JSON.parse(taskList.empLocateInfo);
      taskList.CustomerInfo = JSON.parse(taskList.CustomerInfo);
    } else {
      if(req.query.com_id){
        const query = `Select tas_id,tas_title,tas_description,tas_type,tas_start_date,tas_end_date,tas_start_time,tas_end_time,tas_priority,tas_billable_by_default,tas_notes,tas_created_at,tas_updated_at,tas_pro_id,tas_emp_id,tas_loc_id,tas_prequisites_task,tas_com_id,tas_is_active,checkin,start_time_actual,end_time_actual,is_timesheet_entry,tas_cus_active,tas_updated_by,tas_created_by,pro_id,pro_customer_id,
                (select empLocId, empLocdate, checkoutEmpDate, emploc_lat, emploc_lon from empLocate where taskId=tas_id for JSON PATH) as empLocateInfo,
                (select cus_id, cus_name from customer where cus_id=pro_customer_id for JSON PATH) as CustomerInfo
                from task, project where tas_pro_id=pro_id AND tas_com_id=${req.query.com_id}`;
        taskList = (await DBSendResponse(query));
        taskList.forEach(task => {
          task.empLocateInfo = JSON.parse(task.empLocateInfo);
          task.CustomerInfo = JSON.parse(task.CustomerInfo);
        });
      }
    }
  }
  catch(err){
    res.status(500).json({
      message: 'Unknown Server Error'
    });
  }
  res.json(taskList);
};

exports.updateTaskTime = async function (req, res) {
  let query = 'UPDATE task SET ';
  let setArr = [];
  if(req.body.tas_start_date){
    setArr.push(`tas_start_date='${req.body.tas_start_date}'`);
  }
  if(req.body.tas_end_date){
    setArr.push(`tas_end_date='${req.body.tas_end_date}'`);
  }
  if(req.body.tas_start_time){
    setArr.push(`tas_start_time='${req.body.tas_start_time}'`);
  }
  if(req.body.tas_end_time){
    setArr.push(`tas_end_time='${req.body.tas_end_time}'`);
  }
    
  if(setArr.length === 0){
    res.status(400).json({ message: 'No valid fields to update' });
    return;
  }

  query += setArr.join(', ');
  query += ` WHERE tas_id=${req.body.tas_id}`;
  try{
    const response = await DBSendResponse(query);
    console.log('ZZ', query);
        
    res.json({ code: 200, message: 'Task time updated successfully', data: response });
  } catch (error) {
    console.log(`Error updating task time: ${error.message}`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};
    

exports.getAllTask = async function (req, res) {
  const start = performance.now();
  try {
    await getAllTask(req,res);
    console.log(`/api/fieldworker/task GET TIMETAKEN: ${performance.now() - start} MS`);
  } catch (error) {
    console.log(`/api/fieldworker/task GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/task GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};

async function getAllTask (req,res) {
  let taskList;
  if (req.query.taskId) {
    taskList = await getOneTask(req, res);
  } else if (req.query.pro_id && !req.query.com_id) {
    taskList = await getProjectTasks(req, res);
  } else if (!!req.query.emp_id && !req.query.com_id) {
    taskList = await getTodaysTasks(req, res);
  } else if (req.query.com_id) {
    taskList = await getTasks(req, res);
  } else if (req.query.token) {
    taskList = await getTasksZapier(req, res);
  } else {
    taskList = await getTaskList(req.query.comp_id);
  }
  res.json(taskList);
}

exports.addNewTask = async function (req, res) {
  addTask(req, res, sendId = false);
};

exports.addRecurTask = async function (req, res) {
  addRecurringTask(req, res);
};

exports.updateTask = async function (req, res) {
  updateOneTask(req, res);
};

exports.delTask = async function (req, res) {
  const start = performance.now();
  try {
    await delOneTask(req, res);
    console.log(`/api/fieldworker/task DEL TIMETAKEN: ${performance.now() - start} MS`);
  } catch (error) {
    console.log(`/api/fieldworker/task DEL ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/task DEL TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};

exports.updateLink = async function (req, res) {
  updateLink(req, res);
};

exports.updateStatus = async function (req, res) {
  updateStatus(req, res);
};

exports.updateMMID = async function (req, res) {
  updateMMID(req, res);
};

exports.updateCheckin = async function (req, res) {
  updateCheckin(req, res);
};

exports.updateNotes = async function (req, res) {
  updateNotes(req, res);
};

exports.getSessionTask = async function (req, res) {
  let query;
  if (req.query.session_id) {
    const sessionId = parseInt(req.query.session_id, 10);
    if (isNaN(sessionId)) {
      return res.json({ code: 400, message: 'Invalid session_id' });
    }
    query = `SELECT t.* FROM task t
    INNER JOIN sessions s ON s.task_id = t.tas_id
    WHERE s.session_id = ${sessionId};`;
  } else {
    const escapeApostrophes = (str) => str ? String(str).replace(/'/g, '\'\'') : str;
    const safeTasTitle = escapeApostrophes(req.query.tas_title);
    query = `SELECT * FROM task 
    INNER JOIN project ON tas_pro_id = pro_id
    INNER JOIN customer ON pro_customer_id = cus_id
    WHERE tas_description = 'Session Task' AND tas_title='${safeTasTitle}' AND tas_com_id = ${req.query.tas_com_id} AND tas_start_date = '${req.query.tas_start_date}' AND tas_end_date = '${req.query.tas_end_date}' AND cus_id = ${req.query.cus_id};`;
  }
  
  console.log(query);
  
  const response = await DBSendResponse(query);

  if (response.length === 0) {
    res.json({ code: 500, message: 'No task found' });
  }
  else {
    res.json({ code: 200, data: response[0] });
  }
};

exports.getMMTData = async function (req, res) {
  if( !(!!req.query.emp_id && !!req.query.task_id) ){
    res.json({ code: 500, message: 'Invalid emp_id or task_id' });
    return;
  }

  let query1 = `select t.*, emp.emp_first_name, emp.emp_last_name, p.pro_id, p.Program, p.pro_starts_on, o.com_name, e.checkoutEmpDate,
    c.cus_name, c.DDDID, c.DDD_tier, c.medicaid_eligible, c.MedicaidEndDate, c.NJCATSelfcare, c.NJCATBehavioral, c.NJCATMedical, c.cus_address, c.cus_phone,
    sc_info.assigned_sc_first_name, sc_info.assigned_sc_last_name from task as t 
    INNER JOIN project as p
    ON t.tas_pro_id = p.pro_id
    INNER JOIN customer as c
    ON p.pro_customer_id = c.cus_id
    INNER JOIN projectEmployeeAssignment as pea
    ON p.pro_id = pea.pea_pro_id
    INNER JOIN location as l
    ON t.tas_loc_id = l.loc_id
    INNER JOIN company as o
    ON t.tas_com_id = o.com_id
    INNER JOIN empLocate as e
    ON t.tas_id = e.taskId
    LEFT JOIN employee as emp
    ON t.tas_emp_id = emp.emp_id
    OUTER APPLY (
      SELECT TOP 1 sc_emp.emp_first_name AS assigned_sc_first_name, sc_emp.emp_last_name AS assigned_sc_last_name
      FROM projectEmployeeAssignment sc_pea
      INNER JOIN employee sc_emp ON sc_emp.emp_id = sc_pea.pea_emp_id
      WHERE sc_pea.pea_pro_id = p.pro_id AND sc_pea.assigned_sc = 1
    ) sc_info
    where tas_id=${req.query.task_id}`;
  let response1 = (await DBSendResponse(query1))[0];

  let result = {
    ...response1,
  };

  res.json({ code : 200, data: result });
};

async function getOneTask (req, res) {
  const programId = getProgramIdFromReq(req);
  const query = `SELECT t.* FROM task t INNER JOIN project p ON t.tas_pro_id = p.pro_id WHERE t.tas_id=${req.query.taskId}${programId ? ` AND p.pro_program_id=${programId}` : ''}`;
  const taskList = await DBSendResponse(query);
  return taskList;
}

async function getProjectTasks (req, res) {
  const programId = getProgramIdFromReq(req);
  const query = `SELECT * FROM task INNER JOIN project p ON tas_pro_id = p.pro_id LEFT JOIN empLocate ON taskId = tas_id WHERE tas_pro_id=${req.query.pro_id} AND tas_type != 'Checklist'${programId ? ` AND p.pro_program_id=${programId}` : ''}`;
  const taskList = await DBSendResponse(query);
  return taskList;
}

async function getTasks (req, res) {
  const programId = getProgramIdFromReq(req);
  let queryFilter;
  if (req.query.cust_id) {
    queryFilter = `and pro_customer_id = ${req.query.cust_id}`;
  }
  if (req.query.emp_id) {
    queryFilter = `and tas_emp_id = ${req.query.emp_id}`;
  }
  if (req.query.pro_id) {
    queryFilter = `and pro_id = ${req.query.pro_id}`;
  }
  if (programId) {
    queryFilter = `${queryFilter || ''} and pro_program_id = ${programId}`;
  }

  const query = `Select task.*, pro_id,pro_title,pro_starts_on,pro_ends_on,pro_customer_id,pro_manager_id,
		(select emp_id,emp_first_name,emp_last_name,emp_is_active from employee where (emp_id=tas_emp_id or emp_id=pro_manager_id) for JSON PATH) as empInfo,
		(select * from location where loc_id=tas_loc_id or loc_id=tas_loc1_id or loc_id=tas_loc2_id for JSON PATH) as locInfo,
		(select * from customer where cus_id=pro_customer_id for JSON PATH) as cusInfo,
    (select * from monthlymonitoring where monthly_monitoring_id=tas_mm_id for JSON PATH) as mtInfo,
    (select cf.*, f.form_name, f.json_schema, f.translated_json_schema from customer_form cf inner join fw_forms f on cf.form_type = f.form_id where cf.task_id=tas_id and cf.customer_id=pro_customer_id for JSON PATH) as customerForm,
    (select * from empLocate where taskId=tas_id for JSON PATH) as empLocInfo, 
    (select top 1 id, sig_pad, customer_id from signatures where task_id=tas_id order by id desc for JSON PATH) as signatureDets,
    (select * from audio_notes where task_id=tas_id for JSON PATH) as audioNote,
    (select * from task_contact inner join contact on task_contact.contact_id = contact.con_id where task_contact.task_id=tas_id for JSON PATH) as taskContacts
		from task,project where tas_pro_id=pro_id and tas_com_id=${req.query.com_id} and tas_type!='Checklist' ${queryFilter}`;

  let taskData = await DBSendResponse(query, 'debug');
  taskData = taskData.map((taskInfo) => {
    const taskDetails = taskInfo;
    taskDetails.empInfo = JSON.parse(taskInfo.empInfo);
    taskDetails.locInfo = JSON.parse(taskInfo.locInfo);
    taskDetails.cusInfo = JSON.parse(taskInfo.cusInfo);
    taskDetails.mtInfo = JSON.parse(taskInfo.mtInfo);
    taskDetails.customerForm = JSON.parse(taskInfo.customerForm);
    taskDetails.empLocInfo = JSON.parse(taskInfo.empLocInfo);
    taskDetails.signatureDets = JSON.parse(taskInfo.signatureDets);
    taskDetails.audioNote = JSON.parse(taskInfo.audioNote);
    taskDetails.taskContacts = JSON.parse(taskInfo.taskContacts);
    return taskDetails;
  });

  // if (req.query.emp_id) {
  //   taskData = taskData.filter((task) => !!task.empInfo.find((emp) => emp.emp_id === +req.query.emp_id))
  //   // taskData = taskData.filter((task)=> !!task.empInfo.find((emp)=>emp.emp_id === +req.query.empId))
  // } 
  // if (req.query.pro_id) {
  //   taskData = taskData.filter((task) => !!task.projInfo.find((proj) => proj.pro_id === +req.query.pro_id))
  // } 
  // if (req.query.cust_id) {
  //   taskData = taskData.filter((task) => !!task.projInfo.find((proj) => proj.pro_customer_id === +req.query.cust_id))
  // }  
  // if (req.query.loc_id) {
  //   taskData = taskData.filter((task) => !!task.locInfo.find((loc) => loc.loc_id === +req.query.loc_id))
  // } 
  // if(!req.query.emp_id && !req.query.pro_id && !req.query.cust_id && !req.query.loc_id) {
  //   taskData = taskData
  // }

  // if (!!req.query.lastN && taskData.length > +req.query.lastN) {
  //   taskData = taskData.slice(Math.max(taskData.length - +req.query.lastN, 0))
  // }

  return taskData;
}

exports.getChecklistTasks = async function (req, res) {
  const query = `select * from task t 
  inner join monthlymonitoring m on t.tas_mm_id = m.monthly_monitoring_id
  inner join project p on t.tas_pro_id = p.pro_id
  inner join customer c on p.pro_customer_id = c.cus_id
  inner join projectEmployeeAssignment pea on pea.pea_pro_id = p.pro_id
  inner join employee e on e.emp_id = pea.pea_emp_id
  where t.tas_type='Checklist' and t.tas_is_active=1 and t.checkin=0 and m.created_on >= '${moment().utc().subtract(2, 'months').format('MM/DD/YYYY')}' and 
  pea.pea_emp_id = ${req.query.emp_id} and p.pro_is_active=1 and pea.pea_is_active = 1 and e.emp_company_id=${req.query.comp_id}`;
  // console.log(query)
  let taskData = await DBSendResponse(query);

  res.json(taskData);
};

async function getTasksZapier (req, res) {
  // Find emp_id From access token's Email
  decodedJWT = jwt_decode(req.query.token);
  const emailQuery = `Select * from employee where empEmail=\'${decodedJWT.unique_name}\'`;
  const zapierUser_emp = await DBSendResponse(emailQuery);
  const zapierUser_emp_id = zapierUser_emp[0].emp_id;

  // Find tasks of the given emp_id and return that list
  const taskQuery = `Select tas_id as id,tas_title,tas_description,tas_type,tas_start_date,tas_end_date,tas_start_time,tas_end_time,tas_priority,tas_notes from task where tas_emp_id=${zapierUser_emp_id}`;
  const taskData = await DBSendResponse(taskQuery);
  return taskData;
}

async function getTodaysTasks (req, res) {
  const query = `Select *,
  (select emp_id,emp_first_name,emp_last_name,emp_is_active from employee where (emp_id = tas_emp_id or emp_id = pro_manager_id) for JSON PATH) as empInfo,
  (select * from location where loc_id = tas_loc_id or loc_id = tas_loc1_id or loc_id = tas_loc2_id for JSON PATH) as locInfo,
  (select * from customer where cus_id = pro_customer_id for JSON PATH) as cusInfo
  from task, project where tas_pro_id = pro_id and tas_emp_id = ${req.query.emp_id} and tas_type != 'Checklist'`;

  let taskData = await DBSendResponse(query);
  taskData = taskData.map((taskInfo) => {
    const taskDetails = taskInfo;
    taskDetails.empInfo = JSON.parse(taskInfo.empInfo);
    taskDetails.locInfo = JSON.parse(taskInfo.locInfo);
    taskDetails.cusInfo = JSON.parse(taskInfo.cusInfo);
    return taskDetails;
  });

  return taskData;
}

async function getDatesOfRecurTasks(payload){
  // check for ends on being before project end date
  let tasArr = [];
  let start = payload.taskStart;

  if(payload.opMode === 0){
    console.log(parseInt(moment(payload.endsOn.endDate).format('YYYYMMDD')), parseInt(moment(start).format('YYYYMMDD')) );
    while((parseInt(moment(payload.endsOn.endDate).format('YYYYMMDD')) - parseInt(moment(start).format('YYYYMMDD')) > 0) && (parseInt(moment(payload.projectEndDate).format('YYYYMMDD')) - parseInt(moment(start).format('YYYYMMDD')) > 0)){
      tasArr = [...tasArr, { startDate: moment(start).utc(), endDate: moment(start).utc().add(payload.duration,'m') }];
      start = moment(start).utc().add(payload.operation.repeatsEvery.num, payload.operation.repeatsEvery.option);
    }
    return tasArr;
  }else if (payload.opMode === 1){
    let num = payload.endsOn.numberOfRepeats;
    while(num !== 0 && (parseInt(moment(payload.projectEndDate).format('YYYYMMDD')) - parseInt(moment(start).format('YYYYMMDD')) > 0)){
      tasArr = [...tasArr, { startDate: moment(start).utc(), endDate: moment(start).utc().add(payload.duration,'m') }];
      start = moment(start).utc().add(payload.operation.repeatsEvery.num, payload.operation.repeatsEvery.option);
      num -= 1;
      console.log(num);
    }
    return tasArr;
  }else if (payload.opMode === 2){
    // find the date of selected days 
    console.log(payload.operation.repeatsOn.days,moment(start).format('ddd'));
    console.log((payload.operation.repeatsOn.days.some((a)=> a === moment(start).format('ddd'))));
    let setupStrtDate = start;
    let strtDateArr = payload.operation.repeatsOn.days;
    let tentativeStartDates = [];
    // find the tentative start dates  
    while(strtDateArr.length !== 0){
      if((payload.operation.repeatsOn.days.some((a)=> a === moment(setupStrtDate).format('ddd')))){
        strtDateArr = strtDateArr.filter((sday)=> sday !== moment(setupStrtDate).format('ddd'));
        tentativeStartDates = [...tentativeStartDates, { startDate: moment(setupStrtDate).utc().format(), 
          // endDate: moment(setupStrtDate).utc().add(payload.duration,'m').format()
        }
        ];
      }
      setupStrtDate = moment(setupStrtDate).utc().add(1, 'day').format();
    }
    // iterate through tentative strt date and add the desired gaps for each 
    for(let i = 0 ; i < tentativeStartDates.length; i++){
      start = tentativeStartDates[i].startDate;
      while((parseInt(moment(payload.endsOn.endDate).format('YYYYMMDD')) - parseInt(moment(start).format('YYYYMMDD')) > 0) && (parseInt(moment(payload.projectEndDate).format('YYYYMMDD')) - parseInt(moment(start).format('YYYYMMDD')) > 0)){
        tasArr = [...tasArr, { startDate: moment(start).utc(), endDate: moment(start).utc().add(payload.duration,'m') }];
        start = moment(start).utc().add(payload.operation.repeatsEvery.num, payload.operation.repeatsEvery.option);
      }

    }
    // return sorted 
    console.log(tasArr);
    return tasArr.sort((a,b)=>  a.startDate - b.startDate);
  }else{
    // find the date of selected days 
    console.log('224');
    console.log(payload.operation.repeatsOn.days,moment(start).format('ddd'));
    console.log((payload.operation.repeatsOn.days.some((a)=> a === moment(start).format('ddd'))));
    let setupStrtDate = start;
    let strtDateArr = payload.operation.repeatsOn.days;
    let tentativeStartDates = [];
    // find the tentative start dates  
    while(strtDateArr.length !== 0){
      if((payload.operation.repeatsOn.days.some((a)=> a === moment(setupStrtDate).format('ddd')))){
        strtDateArr = strtDateArr.filter((sday)=> sday !== moment(setupStrtDate).format('ddd'));
        tentativeStartDates = [...tentativeStartDates, { startDate: moment(setupStrtDate).utc().format(), 
          // endDate: moment(setupStrtDate).utc().add(payload.duration,'m').format()
        }
        ];
      }
      setupStrtDate = moment(setupStrtDate).utc().add(1, 'day').format();
    }
    // iterate through tentative strt date and add the desired gaps for each 
    console.log(tentativeStartDates.length);
    for(let i = 0 ; i < tentativeStartDates.length; i++){
      start = tentativeStartDates[i].startDate;
      let num = payload.endsOn.numberOfRepeats;
      while((num !== 0) && (parseInt(moment(payload.projectEndDate).format('YYYYMMDD')) - parseInt(moment(start).format('YYYYMMDD')) > 0)){
        tasArr = [...tasArr, { startDate: moment(start).utc(), endDate: moment(start).utc().add(payload.duration,'m') }];
        start = moment(start).utc().add(payload.operation.repeatsEvery.num, payload.operation.repeatsEvery.option);
        num -= 1;
      }
    }
    // return sorted 
    console.log(tasArr);
    return tasArr.sort((a,b)=>  a.startDate - b.startDate);
  }
}

async function addRecurringTask(req,res) {
  // TBD
  console.log(req.body);
  let payload = {
    opMode : (!!req.body.endsOn && req.body.option !== 'week')? 0:(!req.body.endsOn && req.body.option !== 'week')?1:(!!req.body.endsOn && req.body.option === 'week')?2:3,
    operation:{
      repeatsEvery: { num: req.body.num, option : req.body.option }, //-- option = 'd' || 'w'|| 'm' || 'y'
      repeatsOn:{ days: req.body.days || [] },

    },
    projectEndDate: req.body.projectEndDate || null,
    taskStart:req.body.tStartTime,
    duration: moment.duration(moment(req.body.tEndTime).diff(moment(req.body.tStartTime))).as('minutes'), 
    endsOn:{
      endDate: req.body.endsOn || null,
      numberOfRepeats: req.body.numberOfRepeats || 0
    },

  };
  let resultDates = await getDatesOfRecurTasks(payload);

  // opMode 0 - RE WITH END_DATE
  // opMode 1 - RE WITH NUMBER_OF_REPEATS
  // opMode 2 - RO WITH END_DATE - week 
  // opMode 3 - RO WITH NUMBER_OF_REPEATS - week
  // get task start time and end time of the period the reccurrence occurs and other details(task duration,etc..)
  // create locgic based on type of recurrence - day,week,month,year
  // day,month,year - 
  // * use start time add with numOfDays to generate next task values
  // * check if current task dates are in allignment with the timespan 
  // * add tasks to DB with generated dates 
  // week -  
  // * use start time add with numOfWeeks * 7 to generate next task values
  // * check if current task dates are in allignment with the timespan 
  // * add tasks to DB with generated dates 


  // final steps : iterate through resultDates and add task into DB
  resultDates = resultDates.map((obj) => {
    return {
      startDate: `${moment(obj.startDate).format('YYYY-MM-DDT')}${req.body.tStartTime.split('T')[1]}`,
      endDate: `${moment(obj.endDate).format('YYYY-MM-DDT')}${req.body.tEndTime.split('T')[1]}`
    };
  });
  console.log(resultDates);
  let addedTasks = await Promise.all(resultDates.map(async (taskItem)=> {
    let taskData = { ...req.body, tStrtDate: moment(taskItem.startDate).format(), tEndDate:moment(taskItem.endDate).format() ,tStartTime:taskItem.startDate ,tEndTime:taskItem.endDate  };
    delete taskData.endsOn;
    delete taskData.option;
    delete taskData.numberOfRepeats;
    delete taskData.num;
    delete taskData.days;
    delete taskData.projectEndDate;

    let taskId = await addTaskAndReturnId(taskData);
    return { ...taskData, tas_id: taskId };
  }));
  res.json({ code : 200, tasks: addedTasks,  ...payload });
}

async function updateOneTask (req, res) {
  const query = `UPDATE task 
				SET 
					tas_title='${req.body.tTitle}',
					tas_description='${req.body.tDesc}',
					tas_type='${req.body.tType}',
					tas_start_date='${req.body.tStrtDate}',
					tas_end_date='${req.body.tEndDate}',
					tas_start_time='${req.body.tStartTime}',
					tas_end_time='${req.body.tEndTime}',
					tas_priority='${req.body.tPriority}',
					tas_billable_by_default='${req.body.tIsBillable}',
					tas_notes='${req.body.tNotes}',
					tas_updated_at=CURRENT_TIMESTAMP,
					tas_pro_id=${req.body.tProject},
					tas_emp_id=${req.body.tAssTo},
					tas_loc_id=${req.body.tLoc ? req.body.tLoc : 'NULL'},
          tas_loc1_id=${req.body.tLoc1 ? req.body.tLoc1 : 'NULL'},
          tas_loc2_id=${req.body.tLoc2 ? req.body.tLoc2 : 'NULL'},
					tas_prequisites_task=${req.body.tPreReq},
          tas_updated_by=${req.body.user_id || 'NULL'},
					tas_com_id=${req.body.company_id},
          tas_travel_time=${req.body.tTravelTime || 'NULL'},
          tas_expenses=${req.body.tExpenses || 'NULL'},
          tas_oloc_id=${req.body.tOloc || 'NULL'}
				WHERE tas_id = ${req.body.taskId}`;
  console.log(query);
  const out = await DBUpdate(query);

  let contactQuery = `delete from task_contact where task_id=${req.body.taskId}`;
  await DBUpdate(contactQuery);

  if(req.body.tContacts && req.body.tContacts.length > 0) {
    contactQuery = `insert into task_contact (task_id, contact_id, created_on) values ${req.body.tContacts.map((contact) => `(${req.body.taskId}, ${contact.id}, CURRENT_TIMESTAMP)`).join(',')}`;
    await DBUpdate(contactQuery);
  }

  let empId = req.body.empId, taskName = req.body.tTitle, empName = req.body.empName, projectId = req.body.tProject, assignedEmpID = req.body.tAssTo;
  if(req.body.tDesc !== 'Time Sheet Entry' && empId && taskName && empName && projectId && req.body.company_id && req.body.taskId && assignedEmpID) {
    analytics.track({
      userId: String(empId),
      event: 'Task updated',
      context: {
        groupId: String(req.body.company_id),
      },
      properties: {
        taskName: taskName,
        updatedBy: empName,
        projectId: String(projectId),
        companyId: String(req.body.company_id),
        taskId: String(req.body.taskId),
        assignedTo: assignedEmpID
      }
    });
    console.log('logged to segment successfully');
  }
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success', id: req.body.taskId });
  }
}

async function delOneTask (req, res) {
  // var booleanValue=req.body.bval;
  // console.log('Where am i',req.body.id)
  const id = req.body.id;
  let empId = req.body.empId, taskName = req.body.taskName, empName = req.body.empName, projectId = req.body.projectId;
  if(req.body.timesheetEntry && empId && taskName && empName && projectId && req.body.companyId && req.body.id) {
    let manangerQuery = `select e2.emp_first_name, e2.emp_last_name, e2.emp_id from employee as e2 inner join employee as e1 on e1.emp_manager_id = e2.emp_id where e1.emp_id = ${empId}`;
    const managerResp = await DBSendResponse(manangerQuery);
    let managerName = managerResp.length > 0 ? managerResp[0].emp_first_name + ' ' + managerResp[0].emp_last_name : empName, managerId = managerResp.length > 0 ? managerResp[0].emp_id : empId;
    analytics.track({
      userId: String(empId),
      event: 'Timesheet entry deleted',
      context: {
        groupId: String(req.body.companyId),
      },
      properties: {
        taskName: taskName,
        deletedBy: empName,
        projectId: String(projectId),
        companyId: String(req.body.companyId),
        taskId: String(req.body.id),
        managerName: String(managerName),
        managerId: String(managerId)
      }
    });
    console.log('logged to segment successfully');
  }
  if(!req.body.timesheetEntry && empId && taskName && empName && projectId && req.body.companyId && req.body.id) {
    analytics.track({
      userId: String(empId),
      event: 'Task deleted',
      context: {
        groupId: String(req.body.companyId),
      },
      properties: {
        taskName: taskName,
        deletedBy: empName,
        projectId: String(projectId),
        companyId: String(req.body.companyId),
        taskId: String(req.body.id),
      }
    });
    console.log('logged to segment successfully');
  }
  const query = `UPDATE task SET tas_is_active = 2, tas_mm_id=NULL, tas_mm_status=NULL WHERE tas_id = ${id}`;
  const out = await DBUpdate(query);
  // console.log('Where am i',query,out)
  if (out === 0 || !out) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}

async function updateLink (req, res) {
  let query = '';

  if(req.body.tasks) {
    if(req.body.tasks.filter((t) => t.tas_mm_id !== null).length === 0) {
      if(req.body.empId && req.body.companyId && req.body.task.tas_id && req.body.task.tas_title && req.body.empName) {
        let manangerQuery = `select e2.emp_first_name, e2.emp_last_name, e2.emp_id from employee as e2 inner join employee as e1 on e1.emp_manager_id = e2.emp_id where e1.emp_id = ${req.body.empId}`;
        const managerResp = await DBSendResponse(manangerQuery);
        let managerName = managerResp.length > 0 ? managerResp[0].emp_first_name + ' ' + managerResp[0].emp_last_name : req.body.empName, managerId = managerResp.length > 0 ? managerResp[0].emp_id : req.body.empId;
        analytics.track({
          userId: String(req.body.empId),
          event: 'MT Initiated',
          context: {
            groupId: String(req.body.companyId),
          },
          properties: {
            taskName: req.body.task.tas_title,
            initiatedBy: req.body.empName,
            companyId: String(req.body.companyId),
            taskId: String(req.body.task.tas_id),
            customerId: String(req.body.task.pro_customer_id),
            customerName: String(req.body.cus_name),
            managerName: String(managerName),
            managerId: String(managerId)
          }
        });
        console.log('logged to segment successfully');
      }
    }
    else {
      if(req.body.empId && req.body.companyId && req.body.task.tas_id && req.body.task.tas_title && req.body.empName) {
        let manangerQuery = `select e2.emp_first_name, e2.emp_last_name, e2.emp_id from employee as e2 inner join employee as e1 on e1.emp_manager_id = e2.emp_id where e1.emp_id = ${req.body.empId}`;
        const managerResp = await DBSendResponse(manangerQuery);
        let managerName = managerResp.length > 0 ? managerResp[0].emp_first_name + ' ' + managerResp[0].emp_last_name : req.body.empName, managerId = managerResp.length > 0 ? managerResp[0].emp_id : req.body.empId;
        analytics.track({
          userId: String(req.body.empId),
          event: 'MT Task Switched',
          context: {
            groupId: String(req.body.companyId),
          },
          properties: {
            taskName: req.body.task.tas_title,
            switchedBy: req.body.empName,
            companyId: String(req.body.companyId),
            taskId: String(req.body.task.tas_id),
            customerId: String(req.body.task.pro_customer_id),
            customerName: String(req.body.cus_name),
            managerName: String(managerName),
            managerId: String(managerId)
          }
        });
        console.log('logged to segment successfully');
      }
    }
    req.body.tasks.forEach(task => {
      if(task.tas_id === req.body.task.tas_id) {
        // Reset tas_mm_id AND tas_mm_status so the stale approval/rejection status from a
        // previously linked MT form does not carry forward to the newly linked one.
        query += `UPDATE task SET tas_mm_id = 0, tas_mm_status = NULL WHERE tas_id = ${task.tas_id};`;
  
      } else {
        query += `UPDATE task SET tas_mm_id = NULL, tas_mm_status = NULL WHERE tas_id = ${task.tas_id};`;
      }
    });
  } else {
    // Unlinking: clear both tas_mm_id and the stale MT status.
    query = `UPDATE task SET tas_mm_id = NULL, tas_mm_status = NULL WHERE tas_id = ${req.body.task.tas_id};`;
  }
  
  const response = await DBUpdate(query);

  if (response === 0 || !response) {
    res.json({ code: 500, message: 'Update failed', query: query });
  } else {
    res.json({ code: 200, message: 'Update Success', query: query });
  }

}

async function updateStatus(req, res) {
  try {
  
    // Guard: prevent setting terminal MT statuses if the linked MM row is not in the
    // expected state. This catches cases where a task's status diverged from its MM
    // (e.g. a second initiateMT created a default MM row that was never filled out).
    if (req.body.tas_mm_status === 'Waiting For Approval' || req.body.tas_mm_status === 'Approved') {
      const mmCheckQuery = `
        SELECT m.submitted, m.approved
        FROM monthlymonitoring m
        INNER JOIN task t ON t.tas_mm_id = m.monthly_monitoring_id
        WHERE t.tas_id = ${req.body.tas_id}
      `;
      const mmCheckResult = await DBSendResponse(mmCheckQuery);
      if (mmCheckResult && mmCheckResult.length > 0) {
        const mmRow = mmCheckResult[0];
        if (req.body.tas_mm_status === 'Waiting For Approval' && !mmRow.submitted) {
          return res.json({ code: 400, message: 'Cannot set status to Waiting For Approval: MM form has not been submitted' });
        }
        if (req.body.tas_mm_status === 'Approved' && !mmRow.submitted) {
          return res.json({ code: 400, message: 'Cannot approve: MM form has not been submitted' });
        }
      }
    }

    if(req.body.tas_mm_status === 'Waiting For Approval') {
      let manangerQuery = `select e2.emp_first_name, e2.emp_last_name, e2.emp_id from employee as e2 inner join employee as e1 on e1.emp_manager_id = e2.emp_id where e1.emp_id = ${req.body.empId}`;
      const managerResp = await DBSendResponse(manangerQuery);
      let managerName = managerResp.length > 0 ? managerResp[0].emp_first_name + ' ' + managerResp[0].emp_last_name : req.body.empName, managerId = managerResp.length > 0 ? managerResp[0].emp_id : req.body.empId;
      if(req.body.empId && req.body.companyId && req.body.tas_id && req.body.tas_title && req.body.empName) {
        analytics.track({
          userId: String(req.body.empId),
          event: 'MT Submitted',
          context: {
            groupId: String(req.body.companyId),
          },
          properties: {
            taskName: req.body.tas_title,
            submittedBy: req.body.empName,
            companyId: String(req.body.companyId),
            taskId: String(req.body.tas_id),
            customerId: String(req.body.pro_customer_id),
            customerName: String(req.body.cus_name),
            managerName: String(managerName),
            managerId: String(managerId)
          }
        });
        console.log('logged to segment successfully');
        const data = {
          cus_name: req.body.cusName,
          emp_name: req.body.empName
        };

        if(managerId !== req.body.empId) {
          try {
            console.log(data , managerId);
            let query = `select * from settings where company_id = ${req.body.companyId} and feature_id in (59,60);`;
            let prefQuery  = `select * from individual_settings where emp_id = ${managerId} and feature_id = 1;`;
            const response = await DBSendResponse(query);
            const prefResponse = await DBSendResponse(prefQuery);
            const mtNotifsEnabled = response.length > 0 && response.some(setting => setting.feature_id === 59 && setting.feature_value === 'true');
            const mtSubmissionEnabled = response.length > 0 && response.some(setting => setting.feature_id === 60 && setting.feature_value === 'true');
            const personalPreference = prefResponse.length > 0 && prefResponse.some(setting => setting.feature_id === 1 && setting.feature_value === 'true');
            console.log(response);
            console.log(prefResponse);
            console.log(mtNotifsEnabled, mtSubmissionEnabled, personalPreference);
            if(mtNotifsEnabled && mtSubmissionEnabled && personalPreference) {
              await api.triggerBroadcast(IN_APP_MESSAGE_MT_SUBMISSION_ID, data, { ids: [String(managerId)] });
            }
          } catch (error) {
            console.log('Customer IO Error in updateStatus');
          }
        }    
      }
    } else if(req.body.tas_mm_status === 'Approved') {
      let taskQuery = `select pro_customer_id, cus_name, tas_title from task inner join project on tas_pro_id = pro_id inner join customer on cus_id = pro_customer_id where tas_id = ${req.body.tas_id};`;
      const taskResp = await DBSendResponse(taskQuery);
      if (!taskResp || taskResp.length === 0) {
        console.log(`updateStatus (Approved): no task/project/customer row for tas_id=${req.body.tas_id}, skipping notifications and analytics`);
      } else {
      let pro_customer_id = taskResp[0].pro_customer_id, tas_title = taskResp[0].tas_title, cus_name = taskResp[0].cus_name;
      if(req.body.empId && req.body.companyId && req.body.tas_id && tas_title && pro_customer_id && req.body.empName && cus_name && req.body.submittedByEmpId) {
        try {
          let query = `select * from settings where company_id = ${req.body.companyId} and feature_id in (59,62);`;
          let prefQuery  = `select * from individual_settings where emp_id = ${req.body.submittedByEmpId} and feature_id = 3;`;
          const response = await DBSendResponse(query);
          const prefResponse = await DBSendResponse(prefQuery);
          const mtNotifsEnabled = response.length > 0 && response.some(setting => setting.feature_id === 59 && setting.feature_value === 'true');
          const mtSubmissionEnabled = response.length > 0 && response.some(setting => setting.feature_id === 62 && setting.feature_value === 'true');
          const personalPreference = prefResponse.length > 0 && prefResponse.some(setting => setting.feature_id === 3 && setting.feature_value === 'true');
          console.log(response);
          console.log(prefResponse);
          console.log(mtNotifsEnabled, mtSubmissionEnabled, personalPreference);
          if (mtNotifsEnabled && mtSubmissionEnabled && personalPreference) {
            await api.triggerBroadcast(IN_APP_MESSAGE_MT_STATUS_ID, {
              submittedBy: req.body.submittedByEmpName,
              empName: req.body.empName,
              cusName: String(cus_name),
              status: 'approved'
            }, { 
              ids: [String(req.body.submittedByEmpId)] 
            });
          }
        } catch (error) {
          console.log('Customer IO Error in updateStatus');
        }
        analytics.track({
          userId: String(req.body.empId),
          event: 'MT Approved',
          context: {
            groupId: String(req.body.companyId),
          },
          properties: {
            taskName: tas_title,
            approvedBy: req.body.empName,
            companyId: String(req.body.companyId),
            taskId: String(req.body.tas_id),
            customerId: String(pro_customer_id),
            customerName: String(cus_name)
          }
        });
        console.log('logged to segment successfully');
      }
      }
    } else if(req.body.tas_mm_status === 'Rejected') {
      let taskQuery = `select pro_customer_id, cus_name, tas_title from task inner join project on tas_pro_id = pro_id inner join customer on cus_id = pro_customer_id where tas_id = ${req.body.tas_id};`;
      const taskResp = await DBSendResponse(taskQuery);
      if (!taskResp || taskResp.length === 0) {
        console.log(`updateStatus (Rejected): no task/project/customer row for tas_id=${req.body.tas_id}, skipping notifications and analytics`);
      } else {
      let pro_customer_id = taskResp[0].pro_customer_id, tas_title = taskResp[0].tas_title, cus_name = taskResp[0].cus_name;
      try {
        let query = `select * from settings where company_id = ${req.body.companyId} and feature_id in (59,61);`;
        let prefQuery  = `select * from individual_settings where emp_id = ${req.body.submittedByEmpId} and feature_id = 2;`;
        const response = await DBSendResponse(query);
        const prefResponse = await DBSendResponse(prefQuery);
        const mtNotifsEnabled = response.length > 0 && response.some(setting => setting.feature_id === 59 && setting.feature_value === 'true');
        const mtSubmissionEnabled = response.length > 0 && response.some(setting => setting.feature_id === 61 && setting.feature_value === 'true');
        const personalPreference = prefResponse.length > 0 && prefResponse.some(setting => setting.feature_id === 2 && setting.feature_value === 'true');
        console.log(response);
        console.log(prefResponse);
        console.log(mtNotifsEnabled, mtSubmissionEnabled, personalPreference);
        if (mtNotifsEnabled && mtSubmissionEnabled && personalPreference) {
          await api.triggerBroadcast(IN_APP_MESSAGE_MT_STATUS_ID, {
            submittedBy: req.body.submittedByEmpName,
            empName: req.body.empName,
            cusName: String(cus_name),
            status: 'rejected'
          }, { 
            ids: [String(req.body.submittedByEmpId)] 
          });
        }
      } catch (error) {
        console.log('Customer IO Error in updateStatus');
      }
      if(req.body.empId && req.body.companyId && req.body.tas_id && tas_title && pro_customer_id && req.body.empName && cus_name) {
        analytics.track({
          userId: String(req.body.empId),
          event: 'MT Rejected',
          context: {
            groupId: String(req.body.companyId),
          },
          properties: {
            taskName: tas_title,
            rejectedBy: req.body.empName,
            companyId: String(req.body.companyId),
            taskId: String(req.body.tas_id),
            customerId: String(pro_customer_id),
            customerName: String(cus_name)
          }
        });
        console.log('logged to segment successfully');
      }
      }
    }
    let query = `UPDATE task SET tas_mm_status = '${req.body.tas_mm_status}'  WHERE tas_id = ${req.body.tas_id};`;
    
    const response = await DBUpdate(query);

    if (response === 0 || !response) {
      res.json({ code: 500, message: 'Update failed', query: query });
    } else {
      res.json({ code: 200, message: 'Update Success', query: query });
    }

  } catch (error) {
    console.error('Error in updateStatus:', error);
    res.status(500).json({ code: 500, message: 'Internal Server Error', error: error.message });
  }

}

async function updateMMID(req, res) {
  let query = `UPDATE task SET tas_mm_id = '${req.body.tas_mm_id}'  WHERE tas_id = ${req.body.tas_id};`;
    
  const response = await DBUpdate(query);

  if (response === 0 || !response) {
    res.json({ code: 500, message: 'Update failed', query: query });
  } else {
    res.json({ code: 200, message: 'Update Success', query: query });
  }

}

async function updateCheckin(req, res) {
  let query = `UPDATE task SET checkin = '${req.body.checkin}'  WHERE tas_id = ${req.body.tas_id};`;
    
  const response = await DBUpdate(query);

  if (response === 0 || !response) {
    res.json({ code: 500, message: 'Update failed', query: query });
  } else {
    res.json({ code: 200, message: 'Update Success', query: query });
  }

}

async function updateNotes(req, res) {
  const { tas_notes, tas_id } = req.body;

  if (!tas_notes || !tas_id) {
    return res.status(400).json({ code: 400, message: 'Missing required parameters: tas_notes and/or tas_id' });
  }

  try {
    const response = await DBUpdate(`UPDATE task SET tas_notes = '${tas_notes.replace(/'/g, '\'\'')}' WHERE tas_id = ${tas_id};`);
    if (response === 0 || !response) {
      res.status(500).json({ code: 500, message: 'Update failed' });
    } else {
      res.status(200).json({ code: 200, message: 'Update Success' });
    }
  } catch (error) {
    res.status(500).json({ code: 500, message: 'Internal Server Error', error: error.message });
  }
}

async function getSessionTask(req, res) {
  // Escape apostrophes in tas_title
  try {
    const escapeApostrophes = (str) => str ? String(str).replace(/'/g, '\'\'') : str;
    const safeTasTitle = escapeApostrophes(req.query.tas_title);
    let query = `SELECT * FROM task 
    INNER JOIN project ON tas_pro_id = pro_id
    INNER JOIN customer ON pro_customer_id = cus_id
    WHERE tas_description = 'Session Task' AND tas_title='${safeTasTitle}' AND tas_com_id = ${req.query.tas_com_id} AND tas_start_date = '${req.query.tas_start_date}' AND tas_end_date = '${req.query.tas_end_date}' AND cus_id = ${req.query.cus_id};`;
    
    console.log(query);
    
    const response = await DBSendResponse(query);

    if (response.length === 0) {
      res.json({ code: 500, message: 'No task found' });
    }
    else {
      res.json({ code: 200, data: response[0] });
    }
  } catch (error) {
    console.error('Error in getSessionTask:', error);
    res.status(500).json({ message: 'Internal Server Error', error: error.message });
  }
}

exports.updateSessionTask = async function (req, res) {
  const updates = [];
  
  if (req.body.tas_is_active !== undefined && req.body.tas_is_active !== null) {
    updates.push(`tas_is_active = ${req.body.tas_is_active}`);
  }
  if (req.body.tas_type !== undefined && req.body.tas_type !== null) {
    updates.push(`tas_type = '${req.body.tas_type}'`);
  }
  if (req.body.tas_start_time !== undefined && req.body.tas_start_time !== null) {
    updates.push(`tas_start_date = '${req.body.tas_start_time}'`);
    updates.push(`tas_start_time = '${req.body.tas_start_time}'`);
  }
  if (req.body.tas_end_time !== undefined && req.body.tas_end_time !== null) {
    updates.push(`tas_end_date = '${req.body.tas_end_time}'`);
    updates.push(`tas_end_time = '${req.body.tas_end_time}'`);
  }

  if (updates.length === 0) {
    res.json({ code: 400, message: 'No valid fields to update' });
    return;
  }

  const query = `UPDATE task SET ${updates.join(', ')} WHERE tas_id = ${req.body.tas_id}`;
  console.log(query);
  const response = await DBUpdate(query);

  if (
    req.body.tas_start_time !== undefined && req.body.tas_start_time !== null &&
    req.body.tas_end_time !== undefined && req.body.tas_end_time !== null
  ) {
    const empLocateQuery = `UPDATE empLocate SET empLocdate = '${req.body.tas_start_time}', checkoutEmpDate = '${req.body.tas_end_time}' WHERE taskId = ${req.body.tas_id}`;
    console.log(empLocateQuery);
    await DBUpdate(empLocateQuery);
  }

  console.log(query, response);
  
  if (response === 0 || !response) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
};

exports.updateActive = async function (req, res) {
  const query = `UPDATE task SET tas_is_active = ${req.body.tas_is_active} WHERE tas_id = ${req.body.tas_id}`;
  const response = await DBUpdate(query);
  if (response === 0 || !response) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
};

exports.getTasksAfterInterval = async function (req, res) {
  const query = `SELECT t.*, c.cus_id, c.cus_email, c.cus_name, e.emp_id, e.emp_company_id, e.emp_first_name, e.emp_last_name, e.sec_email, com.com_name FROM 
  task t inner join project p on t.tas_pro_id = p.pro_id inner join customer c on c.cus_id = p.pro_customer_id inner join employee e on e.emp_id = t.tas_emp_id
  inner join company com on com.com_id = e.emp_company_id
  WHERE t.tas_start_time >= DATEADD(${req.query.interval}, ${req.query.time}, '${req.query.date}')
  and t.tas_start_time < DATEADD(MINUTE, 1, DATEADD(${req.query.interval}, ${req.query.time}, '${req.query.date}'))
  and t.tas_is_active = 0 and t.checkin = 0`;  

  const taskList = await DBSendResponse(query);

  return taskList;
};

exports.updateDescription = async function (req, res) {
  const safeDescription = req.body.tas_description.replace(/'/g, '\'\'');
  const query = `UPDATE task SET tas_description = '${safeDescription}' WHERE tas_id = ${req.body.tas_id}`;
  
  const response = await DBUpdate(query);
  if (response === 0 || !response) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
};

exports.getMobileTasks = async function (req, res) {
  try {
    const easternToday = `CAST(GETDATE() AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time' AS DATE)`;

    // EXISTS rather than JOIN: TaskProcCodeMapping holds one row per
    // (comp_id, procedure_code_id, dropdown_id), so a task type has one row per
    // procedure code. A JOIN would fan out each task row once per mapping.
    const allowEarlyStartExists = `EXISTS (
      SELECT 1
      FROM TaskProcCodeMapping tpcm
      JOIN dropdowns dd ON dd.ddID = tpcm.dropdown_id
      WHERE dd.EntityName = 'taskType'
        AND dd.CompanyID = task.tas_com_id
        AND dd.EntityValue = task.tas_type
        AND dd.is_Active IN (0, 3)
        AND tpcm.comp_id = task.tas_com_id
        AND tpcm.allowEarlyStart = 1
    )`;

    const mobileTaskQuery = `
    SELECT
      pro_id, pro_title, pro_starts_on, pro_ends_on, pro_customer_id, pro_manager_id, tas_id, tas_title, tas_description, tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time, tas_priority, tas_billable_by_default, tas_notes, tas_created_at, tas_updated_at, tas_pro_id, tas_emp_id, tas_loc_id, tas_prequisites_task, checkin, tas_is_active, tas_required_sig,
      CAST(CASE WHEN ${allowEarlyStartExists} THEN 1 ELSE 0 END AS BIT) AS allowEarlyStart,
      (SELECT emp_id, emp_first_name, emp_last_name, emp_is_active FROM employee WHERE (emp_id = tas_emp_id OR emp_id = pro_manager_id) FOR JSON PATH) AS empInfo,
      (SELECT * FROM location WHERE loc_id = tas_loc_id OR loc_id = tas_loc1_id OR loc_id = tas_loc2_id FOR JSON PATH) AS locInfo,
	   	(SELECT * FROM customer WHERE cus_id = pro_customer_id FOR JSON PATH) AS cusInfo,
      (SELECT TOP 1 id, sig_pad, customer_id FROM signatures WHERE task_id = tas_id ORDER BY id DESC FOR JSON PATH) AS signatureDets,
      (SELECT * FROM audio_notes WHERE task_id = tas_id FOR JSON PATH) AS audioNote
    FROM task
    JOIN project ON tas_pro_id = pro_id
    WHERE tas_com_id = ${req.query.com_id}
      AND tas_emp_id = ${req.query.emp_id}
      AND tas_type != 'Checklist'
    AND tas_is_active <> 2
    AND (
      tas_start_date IN (
        ${easternToday},
        DATEADD(DAY, -1, ${easternToday})
      )
      OR (
        tas_start_date > ${easternToday}
        AND ${allowEarlyStartExists}
      )
    )
    `;

    let mobileTasks = await DBSendResponse(mobileTaskQuery);

    mobileTasks = mobileTasks.map((taskInfo) => {
      const taskDetails = taskInfo;
      taskDetails.empInfo = JSON.parse(taskInfo.empInfo);
      taskDetails.locInfo = JSON.parse(taskInfo.locInfo);
      taskDetails.cusInfo = JSON.parse(taskInfo.cusInfo);
      taskDetails.signatureDets = JSON.parse(taskInfo.signatureDets);
      taskDetails.audioNote = JSON.parse(taskInfo.audioNote);
      return taskDetails;
    });

    return res.status(200).json(mobileTasks);
  } catch (err) {
    console.log('QUERY FAILURE | getMobileTasks Query Failed:');
    console.log(err);
    return res.status(400).json({
      message: 'An unexpected error occured',
    });
  }
};