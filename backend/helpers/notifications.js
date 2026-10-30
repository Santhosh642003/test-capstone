const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse, DBinsert } = require('../queries/commonQueries')
const moment = require('moment')


exports.getNotification = async function (req, res) {
  let {notif_id} = req.params
  // let {sendRes} = req.body
  let data = await getOneNotification(notif_id)
  res.json(data)
}

getOneNotification = async(id) => {
  const query = `SELECT notif_id,notif_type,notif_send_id,notif_rec_id,notif_date,notif_text,isRead,status,notif_reason_id,
  (select * from project where pro_id = notifications.pro_id for JSON PATH) as projectDetails,
  (select * from task where tas_id = notifications.tas_id for JSON PATH) as taskDetails,
  (select * from employee where emp_id = notifications.emp_id for JSON PATH) as employeeDetails,
  (select * from comments where comment_id = notifications.comment_id for JSON PATH) as commentDetails,
  (select * from artifacts where id = notifications.artifact_id for JSON PATH) as artifactDetails,
  (select * from calls where callId = notifications.emp_callId for JSON PATH) as empCallDetails,
  (select * from CUSTOMER_CALLS where callID = notifications.cus_callID for JSON PATH) as customerCallDetails  
  from notifications WHERE notif_id=${id}`
  // const query = `SELECT notif_id,notif_type,notif_send_id,notif_rec_id,notif_date,notif_text,isRead,status
  // from notifications WHERE notif_id=${id}`
  
  let data = await DBSendResponse(query)
  
  // console.log(sendRes)
  let payload =  {...data[0], 
    projectDetails: JSON.parse(data[0].projectDetails),
    taskDetails:JSON.parse(data[0].taskDetails),
    employeeDetails:JSON.parse(data[0].employeeDetails),
    commentDetails:JSON.parse(data[0].commentDetails),
    artifactDetails:JSON.parse(data[0].artifactDetails),
    empCallDetails:JSON.parse(data[0].empCallDetails),
    customerCallDetails:JSON.parse(data[0].customerCallDetails),
    locationAddress: {}
  }
  if(payload.notif_type === "task" && payload.taskDetails[0].tas_loc_id){
    let taskLocQuery = 'select * from location where loc_id=' + payload.taskDetails[0].tas_loc_id
    
    try{
        let locaData = await DBSendResponse(taskLocQuery)
        payload.locationAddress = locaData[0]
    } catch(err){
        payload.locationAddress = {}
    }
  }
  if(payload.notif_type === "timesheet"){
    let timesheet = `Select time_sheet_id,company_id,emp_id,time_sheet.pay_period_id,time_sheet_status,submitted_on,approved_on,approved_by,payroll_type,start_date,end_date,pay_date,time_entry_submit_date,time_entry_approval_date 
    from time_sheet,pay_period
                  where time_sheet.pay_period_id = pay_period.pay_period_id
                  and time_sheet_id = ${payload.notif_reason_id}`
    let timesheetData = await DBSendResponse(timesheet)
    payload.timesheetData = timesheetData[0]
  }
  if(payload.notif_type === "project"){
    let proLocQuery = `select *, (select * from location where loc_is_active='true' and loc_id=ploc_loc_id for JSON PATH) as addressDetails from projectLocation where ploc_pro_id=${payload.projectDetails[0].pro_id}`
    let locaData = await DBSendResponse(proLocQuery)
    locaData = locaData.map((loc)=> {
      return {
        ...loc, addressDetails: JSON.parse(loc.addressDetails)[0]
      }
    })
    payload.locationAddress = locaData
  }
  if(["task","project","comment"].includes(payload.notif_type)){
    let customerQuery = `select * from customer where cus_id=${payload.projectDetails[0].pro_customer_id}`
    let custData = await DBSendResponse(customerQuery)
    // custData = custData
    // let userQuery = `select * from employee where emp_id=${payload.notif_send_id}`
    // let userData = await DBSendResponse(userQuery)
    
    // payload.user = userData[0]
    payload.customerDetails = custData[0]
  }
  if(["task","project","comment","timesheet"].includes(payload.notif_type)){
    let userQuery = `select * from employee where emp_id=${payload.notif_send_id}`
    let userData = await DBSendResponse(userQuery)
    payload.user = userData[0]
  }
  if(["timesheet"].includes(payload.notif_type)){
    let TsApproverUserQuery = `select * from employee where emp_id=${payload.notif_rec_id}`
    let userData = await DBSendResponse(TsApproverUserQuery)
    payload.approverData = userData[0]
  }

  return payload
}

exports.getAllNotifications = async function (req, res) {
  const start = performance.now()
  try {
    let listOfAllNotificationsID = await getAllNotificationsData()
    if(!!req.query.rec_id && !!req.query.send_id){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> (data.notif_send_id === +req.query.send_id || data.notif_rec_id === +req.query.rec_id))
    }
    if(!!req.query.rec_id && !req.query.send_id){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> data.notif_rec_id === +req.query.rec_id)
    }
    if(!!req.query.send_id && !req.query.rec_id){
      console.log(req.query.send_id)
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> data.notif_send_id === +req.query.send_id)
    }
    if(!!req.query.rec_id && !!req.query.send_id){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> (data.notif_send_id === +req.query.send_id || data.notif_rec_id === +req.query.rec_id))
      .map((data)=> {
        if(['project','comment'].includes(data.notif_type)){
          if(data.notif_rec_id !== +req.query.rec_id && data.notif_send_id === +req.query.send_id){
              return null
          }else{
            return data
          }
        }else{
          return data
        }
      }).filter((dd)=> !!dd)
      // .filter((data)=> 
      // (data.notif_rec_id === +req.query.rec_id && data.notif_send_id !== +req.query.send_id && ['project'].includes(data.notif_type) ))
      // && !['project'].includes(data.notif_type)
    }
    if(!!req.query.emp_id){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> data.emp_id === +req.query.emp_id)
    }
    if(!!req.query.pro_id){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> data.pro_id === +req.query.pro_id)
    }
    if(!!req.query.tas_id){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> data.tas_id === +req.query.tas_id)
    }
    if(!!req.query.artifact_id){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> data.artifact_id === +req.query.artifact_id)
    }
    if(!!req.query.comment_id){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> data.comment_id === +req.query.comment_id)
    }
    if(!!req.query.notif_type){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> data.notif_type === req.query.notif_type)
    }
    if(!!req.query.isRead){
      listOfAllNotificationsID = listOfAllNotificationsID.filter((data)=> req.query.isRead === 'Yes'?!!data.isRead:!data.isRead )
    }
    // return res.json(listOfAllNotificationsID)
    console.log(`/api/fieldworker/notifications GET TIMETAKEN: ${performance.now() - start} MS`);
    return res.json(listOfAllNotificationsID.filter((data)=> (data.status !== 'ARCH' && data.status !== 'DEL')))
    }
  catch (err) {
    console.log(`/api/fieldworker/notifications GET ERROR: ${err.message}`);
    console.log(`| ERROR | `, err);
    console.log(`/api/fieldworker/notifications GET TIMETAKEN: ${performance.now() - start} MS`);
    return res.status(400).json({ error: 'Server error occurred', message: err.message, fullError: err })
  }
}

exports.addNotif = async function (req, res) {
  return await addNotifCommon(req, res, true)
}

exports.addNotification = async function(req,res) {
  await addNotifCommon(req, res, false)
}


async function addNotifCommon(req, res, notifSendId) {
  let {send_id,rec_id,text,emp_id,pro_id,tas_id,comment_id,artifact_id,emp_callId,cus_callID,status,notif_reason_id} = req.body
  // let val = [send_id,rec_id,text,emp_id,pro_id,tas_id,comment_id,artifact_id,emp_callId,cus_callID]
  const query = `INSERT INTO notifications VALUES (
    ${send_id || 'NULL'},
    ${rec_id || 'NULL'},
    CURRENT_TIMESTAMP,
    '${text}',
    ${emp_id || 'NULL'},
    ${pro_id || 'NULL'},
    ${tas_id || 'NULL'},
    ${comment_id || 'NULL'},
    ${artifact_id || 'NULL'},
    ${emp_callId || 'NULL'},
    ${cus_callID || 'NULL'},
    '${req.params.notif_type}', 
    '${false}',
    '${status || 'NULL'}',
    ${notif_reason_id || 'NULL'}
    ); SELECT SCOPE_IDENTITY()`
  // console.log(query)
  let result = await DBinsertSendID(query)
  console.log(result,notifSendId)
  
  if(!!result){
    if(!!notifSendId){
      return result
    }else{
      res.send({"code":200,"message":"Notification Pushed", id: result, type : req.params.notif_type});
    }
  }else{
    if(!!notifSendId){
      return null
    }else{
    res.json({code: 500, message: "Notification Addition to DB Failed"});
    }
  }
}




exports.updateNotif = async (req, res) => {
  let {
    // send_id,rec_id,
    text,
    // emp_id,pro_id,tas_id,comment_id,artifact_id,emp_callId,cus_callID, 
    status,isRead} = req.body
    console.log(req.body)
  let {notif_id} = req.params
  // let notifData = await getOneNotification(notif_id)
  // let query = `update notifications SET 
  // notif_text='${text || notifData.notif_text || 'NULL'}',
  // status='${status || notifData.status || 'NULL'}',
  // isRead='${isRead || (status === 'READ'?true:status === 'UNREAD'?false:notifData.isRead)}' 
  // WHERE notif_id=${notif_id}`

  let query = `UPDATE notifications SET
  status='${status || 'NULL'}'`

  if (isRead) {
    query += `, isRead='${isRead}'
    WHERE notif_id IN (${notif_id})`;
  } else {
    query += ` WHERE notif_id IN (${notif_id})`;
  }

  let result = await DBUpdate(query)
  if(result !== 0){
    res.send({"code":200,"message":`Notification id ${notif_id} Updated`});
  }else{
    res.json({ code: 500, "message":`Notification id ${notif_id} Updated`})
  }
}

async function getAllNotificationsData() {
  const query = `SELECT * FROM [dbo].[notifications] WHERE notif_date > '${moment().subtract(3, 'months').format('YYYY-MM-DDTHH:mm:ss')}' ORDER BY notif_date DESC`
  const result = await DBSendResponse(query)
  // console.log(result)
  return result
}
