const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries')
const moment = require('moment')
const { deleteOne } = require('./delete.js')

async function getAllProjCalls (req, res) {
  const query = `select * from calls where projectID=${req.query.pro_id}`

  let calls_List = await DBSendResponse(query)
  const lastN = req.query.lastN
  console.log(lastN)
  // console.log(calls_List)

  if (!!lastN && calls_List.length > lastN) {
    calls_List = calls_List.slice(Math.max(calls_List.length - lastN, 0))
  }

  res.json(calls_List)
}

async function getOneCalls (req, res) {
  const query = `select * from calls where callId=${req.query.call_id}`
  const calls_List = await DBinsertSendResponse(query)
  res.json(calls_List)
}

async function getAllCalls (req, res) {
  const lastN = req.query.lastN
  // var query = `select * from calls`
  const query = `select callId,recipientType,endDateOfCall,startDateOfCall,emp_company_id as comp_id,
    (select tas_id,tas_title from task where tas_id = taskID for JSON PATH) as tasksDetails,
    (select pro_id,pro_title from project where pro_id = projectID for JSON PATH) as projectDetails,
    (select emp_id as id,CONCAT(emp_first_name,' ',emp_last_name) as name,emp_phone_number as phone,emp_type as desg from employee where emp_id = recipientID for JSON PATH) as EmpRecpDetails,
    (select cus_id as id,cus_name as name,cus_phone as phone,cus_type as desg from customer where cus_id = recipientID for JSON PATH) as CustRecpDetails,
    (select con_id as id,CONCAT(con_first_name,' ',con_last_name) as name,con_phone as phone,con_designation as desg from contact where  con_id = recipientID for JSON PATH) as ContRecpDetails,
    (select emp_id as id,CONCAT(emp_first_name,' ',emp_last_name) as name,emp_phone_number as phone,emp_type as desg from employee where empID = emp_id for JSON PATH) as callerDetails
    from calls,employee where empID = emp_id and emp_company_id = ${req.query.com_id}`
  let calls_List = await DBSendResponse(query)
  // console.log(calls_List)
  calls_List = calls_List.map((callObj) => {
    const newCallObj = { ...callObj }
    newCallObj.tasksDetails = newCallObj.tasksDetails ? JSON.parse(newCallObj.tasksDetails)[0] : JSON.parse(newCallObj.tasksDetails)
    newCallObj.projectDetails = newCallObj.projectDetails ? JSON.parse(newCallObj.projectDetails)[0] : JSON.parse(newCallObj.projectDetails)
    newCallObj.callerDetails = JSON.parse(newCallObj.callerDetails)[0]
    if (newCallObj.EmpRecpDetails) {
      newCallObj.recpDetails = JSON.parse(newCallObj.EmpRecpDetails)[0]
    } else if (newCallObj.CustRecpDetails) {
      newCallObj.recpDetails = JSON.parse(newCallObj.CustRecpDetails)[0]
    } else if (newCallObj.ContRecpDetails) {
      newCallObj.recpDetails = JSON.parse(newCallObj.ContRecpDetails)[0]
    }

    delete newCallObj.EmpRecpDetails
    delete newCallObj.CustRecpDetails
    delete newCallObj.ContRecpDetails
    return newCallObj
  })
  // if(!!req.query.tas_id && !!req.query.pro_id){
  //     calls_List = calls_List.filter((callObj)=>callObj.projectdetails.pro_id === +req.query.pro_id && callObj.tasksDetails.tas_id === +req.query.tas_id )
  // }
  // else
  if (req.query.pro_id) {
    calls_List = calls_List.filter((callObj) => (!!callObj.projectDetails && callObj.projectDetails.pro_id === +req.query.pro_id))
  } else if (req.query.tas_id) {
    calls_List = calls_List.filter((callObj) => (!!callObj.tasksDetails && callObj.tasksDetails.tas_id === +req.query.tas_id))
  } else if (req.query.emp_id) {
    calls_List = calls_List.filter((callObj) => callObj.callerDetails?.id === +req.query.emp_id ||
        (callObj.recipientType === 'employee' && callObj.recpDetails?.id === +req.query.emp_id))
  } else if (req.query.call_id) {
    calls_List = calls_List.filter((callObj) => callObj.callId === +req.query.call_id)
  } else {
    calls_List = calls_List
  }

  // console.log(lastN)
  // console.log(calls_List)

  if (!!lastN && calls_List.length > lastN) {
    calls_List = calls_List.slice(Math.max(calls_List.length - lastN, 0))
  }

  res.json(calls_List)
}

async function getAllEmpCalls (req, res) {
  const query = `select * from calls where empID=${req.query.emp_id}`
  let calls_List = await DBinsertSendResponse(query)
  const lastN = req.query.lastN
  console.log(lastN)
  if (!!lastN && calls_List.length > lastN) {
    calls_List = calls_List.slice(Math.max(calls_List.length - lastN, 0))
  }
  res.json(calls_List)
}

async function getAllTaskCalls (req, res) {
  const query = `select * from calls where taskID=${req.query.tas_id}`
  let calls_List = await DBinsertSendResponse(query)
  const lastN = req.query.lastN
  console.log(lastN)
  if (!!lastN && calls_List.length > lastN) {
    calls_List = calls_List.slice(Math.max(calls_List.length - lastN, 0))
  }
  res.json(calls_List)
}

exports.getCalls = async function (req, res) {
  // if(!!req.query.pro_id){
  //     await getAllProjCalls(req,res)
  // }else if(!!req.query.tas_id){
  //     await getAllTaskCalls(req,res)
  // }else if(!!req.query.emp_id){
  //     await getAllEmpCalls(req,res)
  // }else if(!!req.query.call_id){
  //     await getOneCalls(req,res)
  // }else{
  const start = performance.now();
  try {
    await getAllCalls(req, res)
    console.log(`/api/fieldworker/calls GET TIMETAKEN: ${performance.now() - start} MS`);
  } catch (error) {
    console.log(`/api/fieldworker/calls GET ERROR: ${error.message}`);
    console.log(`| ERROR | `, error);
    console.log(`/api/fieldworker/calls GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error })
  }
  // }
}

exports.addCall = async function (req, res) {
  console.log(req.body)
  let recp_id = req.body.recp_id;

  const query = `insert into calls (recipientID,projectID,taskID,empID,endDateOfCall,startDateOfCall,recipientType) values (${recp_id != undefined && recp_id != null ? recp_id : 0},${req.body.pro_id},${req.body.tas_id},${!!req.body.emp_id ? req.body.emp_id : !!req.body.caller_id ? req.body.caller_id : `NULL`},'${req.body.end_time}','${req.body.start_time}','${req.body.recp_type}'); SELECT SCOPE_IDENTITY()`
  console.log(query)
  const call_Id = await DBinsertSendID(query)
  if (!call_Id) {
    res.json({ code: 500, message: 'Comment Addition to DB Failed' })
  } else {
    res.json({ code: 200, call_data: { call_Id: call_Id, recipient_Id: req.body.recipient_id, recipient_Type: req.body.recipient_type, duration: req.body.duration, pro_id: req.body.pro_id, emp_id: req.body.emp_id }, message: 'Comment Added to DB Success' })
  }
}
