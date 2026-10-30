const db = require('../models/indexSQL.js')
const moment = require('moment')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries')
// const {getEmpUnderMan } = require('../helpers/employees')
const { getAssociatedEmployeesAPI } = require('./employees.js');
var {SEGMENT_API_KEY} = require("../config");
var {SEGMENT_API_KEY, CUSTOMERIO_API_KEY, IN_APP_MESSAGE_TIMESHEET_SUBMISSION_ID} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })
const { APIClient, RegionUS } = require("customerio-node");
const api = new APIClient(CUSTOMERIO_API_KEY, { region: RegionUS });
const { generateSQLText } = require('../utils/validation')

// UPDATE FOR EMP LOCATE TOGGLER
exports.getTimeSheets = async (req, res) => {
  const start = performance.now();
  try {
    await getTimeSheets(req,res)
    console.log(`/api/fieldworker/timesheets GET TIMETAKEN: ${performance.now() - start} MS`)
  } catch (error) {
    console.log(`/api/fieldworker/timesheets GET ERROR: ${error.message}`);
    console.log(`| ERROR | `, error);
    console.log(`/api/fieldworker/timesheets GET TIMETAKEN: ${performance.now() - start} MS`)
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error })
  }
}

async function getTimeSheets (req,res) {
  let query = ''
  if (!!req.query.emp_id && !req.query.comp_id) {
    query = `Select empLocId as id, empLocdate as start_time, checkoutEmpDate as end_time, empLocate_timezone,
        (Select * from project WHERE pro_id = projId for JSON PATH) as projDets, 
        (Select * from task WHERE tas_id = taskId for JSON PATH) as taskDets, 
        (Select * from projectEmployeeAssignment WHERE pea_pro_id = projId and pea_emp_id = empId and pea_is_active = 'true' for JSON PATH) as paymentDets, 
        (Select emp_id,emp_first_name,emp_last_name,emp_type,emp_company_id,emp_manager_id from employee WHERE emp_id = empId for JSON PATH) as empDets,
        (Select * from location WHERE loc_id = locId or loc_id = checkoutLocId for JSON PATH) as locDets 
        from empLocate where empId=${req.query.emp_id}`
  } else if (!!req.query.comp_id && !req.query.emp_id) {
    query = `Select empLocId as id, empLocdate as start_time, checkoutEmpDate as end_time, emp_company_id, empLocate_timezone,
        (Select * from project WHERE pro_id = projId for JSON PATH) as projDets, 
        (Select * from task WHERE tas_id = taskId for JSON PATH) as taskDets, 
        (Select * from projectEmployeeAssignment WHERE pea_pro_id = projId and pea_emp_id = empId and pea_is_active = 'true' for JSON PATH) as paymentDets, 
        (Select emp_id,emp_first_name,emp_last_name,emp_type,emp_company_id,emp_manager_id from employee WHERE emp_id = empId for JSON PATH) as empDets,
        (Select * from location WHERE loc_id = locId or loc_id = checkoutLocId for JSON PATH) as locDets 
        from empLocate,employee where emp_id = empId and emp_company_id=${req.query.comp_id}`
  } else if (!!req.query.emp_id && !!req.query.comp_id && !!req.query.timesheetsSummaryFix){
    query = `SELECT el.empLocId as id, el.empLocdate as start_time, el.checkoutEmpDate as end_time, e.emp_company_id, el.empLocate_timezone,
            (SELECT p.pro_title, p.pro_id FROM project p WHERE p.pro_id = el.projId FOR JSON PATH) as projDets,
            (SELECT * FROM task t WHERE t.tas_id = el.taskId FOR JSON PATH) as taskDets,
            (SELECT e.emp_id, e.emp_first_name, e.emp_last_name, e.emp_type, e.emp_company_id, e.emp_manager_id FROM employee e WHERE e.emp_id = el.empId FOR JSON PATH) as empDets
        FROM empLocate el
        JOIN employee e ON el.empId = e.emp_id
        WHERE e.emp_company_id = ${req.query.comp_id};`
  } else if (!!req.query.emp_id && !!req.query.comp_id && !req.query.timesheetsSummaryFix && req.query.start && req.query.end){
    query = `Select empLocId as id, empLocdate as start_time, checkoutEmpDate as end_time, cus_id, cus_name, empLocate_timezone,
      (Select t.*, f.form_name, f.json_schema, f.translated_json_schema, f.ui_schema from task_form t INNER JOIN fw_forms f ON t.form_id = f.form_id WHERE t.taskType_id=dropdowns.ddID AND t.company_id=${req.query.comp_id} for JSON PATH) as task_form,
      (Select * from project WHERE pro_id = projId for JSON PATH) as projDets, 
      (Select * from task WHERE tas_id = taskId for JSON PATH) as taskDets, 
      (Select * from projectEmployeeAssignment WHERE pea_pro_id = projId and pea_emp_id = empId and pea_is_active = 'true' for JSON PATH) as paymentDets, 
      (Select emp_id,emp_first_name,emp_last_name,emp_type,emp_company_id,emp_manager_id from employee WHERE emp_id = empId for JSON PATH) as empDets,
      (Select * from location WHERE loc_id = locId or loc_id = checkoutLocId for JSON PATH) as locDets 
      from empLocate 
      INNER JOIN project ON projId = pro_id
      INNER JOIN customer ON pro_customer_id = cus_id
      INNER JOIN task ON empLocate.taskId = task.tas_id and task.tas_is_active != 2
      INNER JOIN dropdowns ON dropdowns.EntityName='taskType' and dropdowns.CompanyID=${req.query.comp_id} and (dropdowns.is_Active=0 or dropdowns.is_Active=3) and dropdowns.EntityValue=task.tas_type
      where empId=${req.query.emp_id} and empLocdate >= '${req.query.start}' and empLocdate < DATEADD(day, 1, CAST('${req.query.end}' AS DATETIME))`
  } else { //TODO review case 1-30-24
    query = `Select empLocId as id, empLocdate as start_time, checkoutEmpDate as end_time, empLocate_timezone,
        (Select * from project WHERE pro_id = projId for JSON PATH) as projDets, 
        (Select * from projectEmployeeAssignment WHERE pea_pro_id = projId and pea_emp_id = empId and pea_is_active = 'true' for JSON PATH) as paymentDets, 
        (Select * from task WHERE tas_id = taskId for JSON PATH) as taskDets, 
        (Select emp_id,emp_first_name,emp_last_name,emp_type,emp_company_id,emp_manager_id from employee WHERE emp_id = empId for JSON PATH) as empDets,
        (Select * from location WHERE loc_id = locId or loc_id = checkoutLocId for JSON PATH) as locDets,
        (Select comment_text from comments where task_id = taskId for JSON PATH) as taskComments 
        from empLocate`
  }

  let timesheetsData = await DBSendResponse(query)
  timesheetsData = timesheetsData.map((ts) => {
    // if(ts.projDets && ts.taskDets && ts.empDets && )
    ts.task_form = !ts.task_form ? null : JSON.parse(ts.task_form)
    ts.projDets = !ts.projDets ? null : JSON.parse(ts.projDets)[0]
    ts.taskDets = !ts.taskDets ? null : JSON.parse(ts.taskDets)[0]
    ts.paymentDets = !ts.paymentDets ? null : JSON.parse(ts.paymentDets)[0]
    ts.empDets = !ts.empDets ? null : JSON.parse(ts.empDets)[0]
    ts.locDets = !ts.locDets ? null : JSON.parse(ts.locDets)
    ts.taskComments = !ts.taskComments ? null : JSON.parse(ts.taskComments)
    return ts
  }).filter((ts) => !!ts.empDets)
  console.log(!!req.query.emp_id && !!req.query.comp_id)

  if (!!req.query.emp_id && !!req.query.comp_id) {
    // find emp type
    const EmpQuery = `select * from employee where emp_id = ${req.query.emp_id}`
    const empobj = await DBSendResponse(EmpQuery)
    // console.log(empobj)
    // find proj for emp
    // var projEmpQuery = `select * from projectEmployeeAssignment where pea_emp_id = ${req.query.emp_id} and pea_is_active='true'`
    // let projList = await DBSendResponse(projEmpQuery)
    const ManEmpQuery = `select * from employee where emp_manager_id = ${req.query.emp_id} and emp_is_active='true'`
    const empSupList = await DBSendResponse(ManEmpQuery)
    // console.log(empSupList)
    // if(empobj.length === 0){
    //     timesheetsData = []
    // }else
    // if (empobj[0].emp_type === 'Manager') {
    //   timesheetsData = timesheetsData.filter((ts) => ((ts.empDets.emp_company_id === empobj[0].emp_company_id && (!!empSupList.find((assign) => assign.emp_id === ts.empDets.emp_id)) || ts.empDets.emp_id === +req.query.emp_id) || (!ts.projDets && ts.empDets.emp_company_id === empobj[0].emp_company_id && (!!empSupList.find((assign) => (assign.emp_id === ts.empDets.emp_id)) || ts.empDets.emp_id === +req.query.emp_id))))
    //   // timesheetsData = timesheetsData.filter((ts)=> ts.empDets.emp_company_id === empobj[0].emp_company_id && (!!ts.projDets && !!projList.find((assign) => assign.pea_emp_id === +req.query.emp_id && assign.pea_pro_id === ts.projDets.pro_id)) || (!ts.projDets && ts.empDets.emp_company_id === empobj[0].emp_company_id))
    // } else 

    timesheetsData = timesheetsData.filter((ts) => ts.empDets.emp_company_id === empobj[0].emp_company_id)

    let associatedEmployees = await getAssociatedEmployeesAPI(req.query.emp_id);
    associatedEmployees = associatedEmployees.directlyManaged.concat(associatedEmployees.hr_managed).concat({emp_id: req.query.emp_id})

    associatedEmployees = associatedEmployees.filter((obj, index, self) => {
      return index === self.findIndex((t) => (
        t.emp_id === obj.emp_id
      ));
    });

    let filteredTimesheets = []
    if (empobj[0].emp_type !== 'Admin') {
      for (const employee of associatedEmployees) {
        let empData = timesheetsData.filter((ts) => ts.empDets.emp_id === parseInt(employee.emp_id))
        filteredTimesheets.push(...empData)
      }
      timesheetsData = filteredTimesheets
    } 
    // else {
    //   timesheetsData = timesheetsData.filter((ts) => ts.empDets.emp_company_id === empobj[0].emp_company_id && ts.empDets.emp_id === empobj[0].emp_id)
    // }
    // console.log(empobj.length,':',projList.length,':', timesheetsData.length)
    // filter timesheet data accordingly
  }

  if (!!req.query.start && !!req.query.end) {
    timesheetsData = timesheetsData.map((ts) => {
      // console.log('PARAM TSTRT: ',moment(ts.start_time).format('YYYYMMDD'), 'PARAM TEND: ', moment(ts.end_time).format('YYYYMMDD'),'PARAM STRT: ',req.query.start.replace(/-/g,''),'PARAM END: ',req.query.end.replace(/-/g,''))
      // console.log(parseInt(moment(ts.start_time).format('YYYYMMDD')) - parseInt(req.query.start.replace(/-/g,'')) >=0 && parseInt(moment(ts.end_time).format('YYYYMMDD')) - parseInt(req.query.end.replace(/-/g,'')) <=0)

      if (parseInt(moment(ts.start_time).format('YYYYMMDD')) - parseInt(req.query.start.replace(/-/g, '')) >= 0 && parseInt(moment(ts.start_time).format('YYYYMMDD')) - parseInt(req.query.end.replace(/-/g, '')) <= 0) {
        return ts
      } else {
        return null
      }
    }).filter((ts) => !!ts)
    // console.log(moment(req.query.start),moment(req.query.end))
  }
  if (req.query.proj_id) {
    // console.log(+req.query.proj_id)
    timesheetsData = timesheetsData.filter((ts) => (ts.projDets && ts.projDets.pro_id === +req.query.proj_id))
  }
  if (req.query.task_id) {
    timesheetsData = timesheetsData.filter((ts) => (ts.taskDets && ts.taskDets.tas_id === +req.query.task_id))
  }

  let com_id = req.query.companyId;
  let employee_id = req.query.employeeId;

  if(com_id && employee_id) {
		analytics.track({
			userId: String(employee_id),
			event: 'EVV Report Generated',
			context: {
				groupId: com_id,
			},
			properties: {
				companyId: com_id,
			}
		})
		console.log("logged to segment successfully");
	}

  timesheetsData = timesheetsData.sort((a, b) => b.id - a.id)
  console.log(timesheetsData.length)
  res.send(timesheetsData)
}

exports.insertTimeSheet = async (req, res) => {
  const query = 'INSERT INTO empLocate (projId, empId, taskId, locId, emploc_lat, emploc_lon, empLocdate, checkoutEmpDate, timesheet_status, empLocate_timezone) ' +
  'VALUES (' + req.body.projId + ',' + req.body.empId + ',' + req.body.taskId + ',' + req.body.locId + ',' + req.body.emploc_lat + ',' + req.body.emploc_lon + ',' + "'" + req.body.start_time + "'," + "'" + req.body.end_time + "'," + (req.body.timesheet_status ? req.body.timesheet_status : 0)  + ",'" + req.body.empLocate_timezone + "'); SELECT SCOPE_IDENTITY();"
  console.log(query)
  const result = await DBinsertSendID(query)
   	if (!result) {
    // console.log(err);
    res.send({ code: 500, message: 'insert Error' })
  } else {
    let empId = req.body.assignedById, taskName = req.body.taskName, empName = req.body.empName, taskId = req.body.taskId;
    if(empId && taskName && empName && req.body.companyId && taskId) {
      let manangerQuery = `select e2.emp_first_name, e2.emp_last_name, e2.emp_id from employee as e2 inner join employee as e1 on e1.emp_manager_id = e2.emp_id where e1.emp_id = ${empId}`
      const managerResp = await DBSendResponse(manangerQuery);
      let name, id
      if(managerResp.length === 0) {
        const employeeName = await DBSendResponse(`select emp_first_name, emp_last_name from employee where emp_id = ${empId}`)
        name = employeeName[0].emp_first_name + " " + employeeName[0].emp_last_name
        id = empId
      } else {
        name = managerResp[0].emp_first_name + " " + managerResp[0].emp_last_name
        id = managerResp[0].emp_id;
      }
      analytics.track({
        userId: String(empId),
        event: 'Timesheet entry created',
        context: {
          groupId: String(req.body.companyId),
        },
        properties: {
          taskName: taskName,
          addedBy: empName,
          companyId: String(req.body.companyId),
          taskId: String(taskId),
          managerName: String(name),
          managerId: String(id)
        }
      })
      console.log("logged to segment successfully")
      const data = {
        emp_name: req.body.empName
      }
      if(id !== empId) {
        try {
          let query = `select * from settings where company_id = ${req.body.companyId} and feature_id=58;`

          const response = await DBSendResponse(query)
          console.log("ABC", response);
          if(response.length > 0) {
            if(response[0].feature_value === "true") {
              await api.triggerBroadcast(IN_APP_MESSAGE_TIMESHEET_SUBMISSION_ID, data, { ids: [String(id)] });
            }
          }
        } catch (err) {
          console.log(err)
        }
      }
    }
    res.send({ code: 200, message: 'success', id: result })
  }
}

exports.updateTimeSheet = async (req, res) => {
  let query = ''
  if (req.body.proj_id) {
    query = `update empLocate set empLocdate='${req.body.start}',checkoutEmpDate='${req.body.end}',projId=${req.body.proj_id} where empLocId=${req.body.id}`
  } else {
    query = `update empLocate set empLocdate='${req.body.start}',checkoutEmpDate='${req.body.end}' where empLocId=${req.body.id}`
  }
  console.log(query)
  const result = await DBUpdate(query)

  // Finding the taskID of the note to edit.
  let tas_id_query = `SELECT taskId FROM empLocate WHERE empLocId = ${req.body.id};`
  console.log(tas_id_query);
  const tas_id_result = await DBSendResponse(tas_id_query);

  // tas_id_result[0] is the task_id in the DB.
  //console.log(Object.values(tas_id_result[0]));

  let notes_update_query = `UPDATE task SET tas_notes = '${generateSQLText(req.body.tNotes)}' WHERE tas_id = ${Object.values(tas_id_result[0])}`;
  const notes_result = await DBUpdate(notes_update_query);

  if (result === 0 && tas_id_result === 0) {
    res.json({ code: 500, message: 'Error in Task Update' })
  } else {
    let empId = req.body.empId, taskName = req.body.taskName, empName = req.body.empName;
    if(empId && taskName && empName && req.body.companyId && tas_id_result[0].taskId) {
      let manangerQuery = `select e2.emp_first_name, e2.emp_last_name, e2.emp_id from employee as e2 inner join employee as e1 on e1.emp_manager_id = e2.emp_id where e1.emp_id = ${empId}`
      const managerResp = await DBSendResponse(manangerQuery);
      let managerName = managerResp.length > 0 ? managerResp[0].emp_first_name + " " + managerResp[0].emp_last_name : empName, managerId = managerResp.length > 0 ? managerResp[0].emp_id : empId;
      analytics.track({
        userId: String(empId),
        event: 'Timesheet entry updated',
        context: {
          groupId: String(req.body.companyId),
        },
        properties: {
          taskName: taskName,
          updatedBy: empName,
          companyId: String(req.body.companyId),
          taskId: String(tas_id_result[0].taskId),
          managerName: String(managerName),
          managerId: String(managerId)
        }
      })
      console.log("logged to segment successfully")
    }
    res.json({ code: 200, message: 'Success in Task Update' })
  }
}

exports.getTimeSheetData = async (req,res) => {
  const { task_id } = req.query;
  let query = `SELECT * FROM task,empLocate WHERE task.tas_id=${task_id} AND empLocate.taskId=${task_id}`
  let timesheetData = await DBSendResponse(query)
  res.send(timesheetData)
}

exports.updateTimeSheetData = async (req,res) => {
  const { task_id, startTime, endTime, title, tas_type } = req.body;
  
  if(!task_id) {
    return res.status(400).send("Task ID is required");
  }

  if(startTime && endTime) {
    // Also Update Scheduled Time For Case Management Company
    try{
      const { company_id } = (await DBSendResponse(`select tas_com_id from task where tas_id=${req.body.task_id}`))[0].tas_com_id;
    let updateTaskResponse = await DBSendResponse(`UPDATE task SET tas_start_time='${startTime}', tas_end_time='${endTime}' WHERE tas_id=${req.body.task_id}`);
    } catch (err) {
      console.log(err);
    }
    
    let query = `UPDATE empLocate SET empLocdate='${startTime}', checkoutEmpDate='${endTime}' WHERE taskId=${req.body.task_id}`
    let result = await DBSendResponse(query);
  }

  if(tas_type){
    let query = `UPDATE task SET tas_type='${tas_type}' WHERE tas_id=${task_id}`
    let updateTaskResponse = await DBSendResponse(query);
  }

  if(title) {
    let query = `UPDATE task SET tas_title='${String(title).replace(/'/g, "''")}' WHERE tas_id=${task_id}`
    let result = await DBSendResponse(query);
  }

  //send 200 status code
  res.status(200).send("Updated successfully");
}