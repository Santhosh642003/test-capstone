const db = require('../models/indexSQL.js')

const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')
const { getTaskList, getEmployeeList, getCustomerList, getProjectList, getContactList, getLocationList } = require('../queries/entityGetQueries')
const { empLevelDD, empTypeDD, empStatusDD, currencyDD, frequencyDD, customerTypeDD, customerStatusDD, designationDD, contactStatusDD, contactTypeDD, statesDD, locStatusDD, locTypeDD, taskTypeDD } = require('../queries/dropdownQueries')

exports.getAllTables = function (req, res) {
  getAllNew(req, res)
}

exports.postTables = function (req, res) {
  const message = { message: 'This is a post to the ' + req.params.table + ' table.' }
  switch (req.params.table) {
    case 'projects':
      // console.log(req.body)
      addProject(req, res, sendId = false)
      break
    case 'employees':
      // console.log(req.body)
      addEmployee(req, res)
      break
    case 'customers':
      // console.log(req.body)
      addCustomer(req, res, sendId = false)
      break
    case 'contacts':
      // console.log(req.body)
      addContact(req, res)
      break
    case 'locations':
      console.log(req.body)
      addlocation(req, res, sendId = false)
      break
    case 'tasks':
      console.log(req.body)
      addTask(req, res, sendId = false)
      break
    case 'artifacts':
      res.json(message)
      break
    default:
      res.send('error')
      break
  }
}
// add to locaion helpers
async function addlocation (req, res) {
  const query = 'insert into location(loc_addr_line1,loc_addr_line2,loc_city,loc_state,loc_zip,' +
		'loc_lat,loc_lon,loc_type,' +
		'loc_status,loc_county,loc_association_date,loc_phone_number,loc_company_id,loc_is_active) values ' +
		"('" + (!sendId ? req.body.address_line_1 : address.address_line_1) + "'," +
		"'" + (!sendId ? req.body.address_line_2 : address.address_line_2) + "'," +
		"'" + (!sendId ? req.body.city : address.city) + "'," +
		"'" + (!sendId ? req.body.state : address.state) + "'," +
		"'" + (!sendId ? req.body.zip : address.zip) + "'," +
		"'" + (!sendId ? req.body.latitude : address.latitude) + "'," +
		"'" + (!sendId ? req.body.longitude : address.longitude) + "'," +
		"'" + (!sendId ? req.body.location_type : 'Customer Location') + "'," +
		"'" + (!sendId ? req.body.location_status : 'Personal') + "'," +
		"'" + (!sendId ? req.body.country : 'United States') + "'," +
		(!sendId ? "'" : '') +
		 (!sendId ? req.body.association_date : 'GETDATE()') +
		(!sendId ? "'," : ',') +
		"'" + req.body.phone + "'," +
		'' + req.body.company_id + ",'true'); SELECT SCOPE_IDENTITY();"
  if (!sendId) {
    DBinsert(res, query)
  } else {
    const locId = await DBinsertSendID(query)
    return locId
  }
}

// add to emplyoyee helpers
function addEmployee (req, res) {
  const query = 'insert into employee' +
			'(emp_first_name,emp_last_name,emp_addr_line1,emp_addr_line2,' +
			' emp_city,emp_state,emp_zip,emp_phone_number,emp_join_date,emp_status,' +
			'emp_type,emp_level,emp_doxylink,emp_vacation,emp_personal,emp_is_admin,emp_is_project_manager,' +
			'emp_is_active,emp_created_at,emp_updated_at,' +
			'emp_manager_id,emp_company_id)' +
			'values(' +
			"'" + req.body.first_name + "'," +
			"'" + req.body.last_name + "'," +
			"'" + req.body.address1 + "'," +
			"'" + req.body.address2 + "'," +
			"'" + req.body.city + "'," +
			"'" + req.body.state + "'," +
			"'" + req.body.zip + "'," +
			"'" + req.body.phoneList + "'," +
			"'" + req.body.join_date + "'," +
			"'" + req.body.status + "'," +
			"'" + req.body.employee_type + "'," +
			"'" + req.body.employee_level + "'," +
			"'" + req.body.employee_doxy_link + "'," +
			'' + req.body.vacation_days + ',' +
			'' + req.body.personal_days_off + ',' +
			"'false'," +
			"'false'," +
			"'true'," +
			'CURRENT_TIMESTAMP,' +
			'NULL,' +
			'' + req.body.manager + ',' +
			'' + req.body.company_id + ')'
  DBinsert(res, query)
}

// add to customers helpers
async function addCustomer (req, res) {
  const locations = req.body.address.map((add) => { return add.address_line_1 + ',' + add.address_line_2 + ',' + add.city + ',' + add.state + ',' + add.zip }).join(':')
  const query = 'insert into customer (cus_name, cus_address, cus_phone, cus_acquired_date, cus_status, cus_type,cus_created_at,cus_company_id,cus_is_company,cus_is_active) ' +
	'values (' +
	"'" + req.body.name + "'," +
	"'" + locations + "'," +
	"'" + req.body.phone + "'," +
	"'" + req.body.acquired_date + "'," +
	"'" + req.body.status + "'," +
	"'" + req.body.customer_type + "'," +
	'CURRENT_TIMESTAMP,' +
	'' + req.body.company_id + ',' +
	"'" + req.body.is_company + "'," +
	"'true'" +
	'); SELECT SCOPE_IDENTITY();'
  const cus_id = await DBinsertSendID(query)
  if (!cus_id) { res.json({ code: 500, message: 'Insert Failed For Customer' }) }
  const locArrId = []
  for (var i = 0; i < req.body.address.length; i++) {
    const loc_id = await addlocation(req, res, sendId = true, address = req.body.address[i])
    if (!loc_id) { res.json({ code: 500, message: 'Insert Failed For Location' }) } else { locArrId.push(loc_id) }
  }
  const proj_id = await addProject(req, res, sendId = true, cusId = cus_id, locarrId = locArrId)
  if (!proj_id) { res.json({ code: 500, message: 'Insert Failed For Projects' }) }
  const taskList = [
	    { tas_name: 'TASK 1 for ' + req.body.name, tas_desc: 'Task Desc 1', tas_type: 'Online', tas_mon: 'DATEADD(month,1,CURRENT_TIMESTAMP)', tas_priority: 'High', tas_note: 'Note 1' },
	    { tas_name: 'TASK 2 for ' + req.body.name, tas_desc: 'Task Desc 2', tas_type: 'In-Person', tas_mon: 'DATEADD(month,2,CURRENT_TIMESTAMP)', tas_priority: 'Low', tas_note: 'Note 2' },
	    { tas_name: 'TASK 3 for ' + req.body.name, tas_desc: 'Task Desc 3', tas_type: 'In-Person', tas_mon: 'DATEADD(month,3,CURRENT_TIMESTAMP)', tas_priority: 'High', tas_note: 'Note 3' },
	    { tas_name: 'TASK 4 for ' + req.body.name, tas_desc: 'Task Desc 4', tas_type: 'In-Person', tas_mon: 'DATEADD(month,4,CURRENT_TIMESTAMP)', tas_priority: 'Low', tas_note: 'Note 4' },
	    { tas_name: 'TASK 5 for ' + req.body.name, tas_desc: 'Task Desc 5', tas_type: 'Online', tas_mon: 'DATEADD(month,5,CURRENT_TIMESTAMP)', tas_priority: 'Low', tas_note: 'Note 5' },
    { tas_name: 'TASK 6 for ' + req.body.name, tas_desc: 'Task Desc 6', tas_type: 'Online', tas_mon: 'DATEADD(month,6,CURRENT_TIMESTAMP)', tas_priority: 'High', tas_note: 'Note 6' },
    { tas_name: 'TASK 7 for ' + req.body.name, tas_desc: 'Task Desc 7', tas_type: 'Online', tas_mon: 'DATEADD(month,7,CURRENT_TIMESTAMP)', tas_priority: 'High', tas_note: 'Note 7' },
	    { tas_name: 'TASK 8 for ' + req.body.name, tas_desc: 'Task Desc 8', tas_type: 'In-Person', tas_mon: 'DATEADD(month,8,CURRENT_TIMESTAMP)', tas_priority: 'Low', tas_note: 'Note 8' },
	    { tas_name: 'TASK 9 for ' + req.body.name, tas_desc: 'Task Desc 9', tas_type: 'In-Person', tas_mon: 'DATEADD(month,9,CURRENT_TIMESTAMP)', tas_priority: 'High', tas_note: 'Note 9' },
	    { tas_name: 'TASK 10 for ' + req.body.name, tas_desc: 'Task Desc 10', tas_type: 'In-Person', tas_mon: 'DATEADD(month,10,CURRENT_TIMESTAMP)', tas_priority: 'Low', tas_note: 'Note 10' },
	    { tas_name: 'TASK 11 for ' + req.body.name, tas_desc: 'Task Desc 11', tas_type: 'Online', tas_mon: 'DATEADD(month,11,CURRENT_TIMESTAMP)', tas_priority: 'Low', tas_note: 'Note 11' },
	    { tas_name: 'TASK 12 for ' + req.body.name, tas_desc: 'Task Desc 12', tas_type: 'Online', tas_mon: 'DATEADD(month,12,CURRENT_TIMESTAMP)', tas_priority: 'High', tas_note: 'Note 12' }
  ]
  for (var i = 0; i < taskList.length; i++) {
    const taskId = await addTask(req, res, sendId = true, task = taskList[i], proj = proj_id, locId = locArrId[0])
    if (!taskId) { res.json({ code: 500, message: 'Insert Failed For Task' }) }
  }
  res.json({ code: 200, message: 'Insert Success' })
}

// add to contact helpers
function addContact (req, res) {
  const query = 'insert into contact (con_first_name, con_last_name, con_Addr_line1, con_Addr_line2, con_city, con_state, con_zip, con_phone,' +
		'con_designation, con_status, con_contact_type, con_first_contact_date, con_last_contact_date,con_created_at,con_customer_id, con_company_id) ' +
		'values(' +
		"'" + req.body.first_name + "'," +
		"'" + req.body.last_name + "'," +
		"'" + req.body.address_line_1 + "'," +
		"'" + req.body.address_line_2 + "'," +
		"'" + req.body.city + "'," +
		"'" + req.body.state + "'," +
		"'" + req.body.zip + "'," +
		"'" + req.body.phoneList + "'," +
		"'" + req.body.designation + "'," +
		"'" + req.body.status + "'," +
		"'" + req.body.contact_type + "'," +
		"'" + req.body.first_contact_date + "'," +
		"'" + req.body.last_contact_date + "'," +
		'CURRENT_TIMESTAMP,' +
		'' + req.body.customer_id + ',' +
		'' + req.body.company_id + ',' +
		"'true'" +
		');'
		// console.log(query)
  DBinsert(res, query)
}

// add to task helpers
async function addTask (req, res) {
  const query = 'insert into task (tas_title, tas_description,tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time,tas_priority, ' +
		'tas_billable_by_default,tas_notes,tas_is_active,tas_created_at, tas_pro_id,tas_emp_id,tas_loc_id,tas_prequisites_task,tas_com_id, tas_cus_id) ' +
		'values(' +
		"'" + (!sendId ? req.body.tTitle : task.tas_name) + "'," +
		"'" + (!sendId ? req.body.tDesc : task.tas_desc) + "'," +
		"'" + (!sendId ? req.body.tType : task.tas_type) + "'," +
		(!sendId ? "'" : '') +
		(!sendId ? req.body.tStrtDate : task.tas_mon) +
		(!sendId ? "'," : ',') +
		(!sendId ? "'" : '') +
		(!sendId ? req.body.tEndDate : task.tas_mon) +
		(!sendId ? "'," : ',') +
		"'" + (!sendId ? req.body.tStartTime : '9 AM') + "'," +
		"'" + (!sendId ? req.body.tEndTime : '5 PM') + "'," +
		"'" + (!sendId ? req.body.tPriority : task.tas_priority) + "'," +
		"'" + (!sendId ? req.body.tIsBillable : true) + "'," +
		"'" + (!sendId ? req.body.tNotes : task.tas_note) + "'," +
		0 + ',' +
		'CURRENT_TIMESTAMP,' +
		'' + (!sendId ? req.body.tProject : proj) + ',' +
		'' + (!sendId ? req.body.tAssTo : req.body.pManager) + ',' +
		'' + (!sendId ? req.body.tLoc : locId) + ',' +
		'' + (!sendId ? req.body.tPreReq : 'NULL') + ',' +
		'' + req.body.company_id + ',' +
		'' + (req.body.cus_id ? req.body.cus_id : 'NULL') + '); SELECT SCOPE_IDENTITY();'
  console.log(query)
  if (!sendId) {
    DBinsert(res, query)
  } else {
    const taskId = await DBinsertSendID(query)
    return taskId
  }
}

// ADD TO PROJECT HELPERS
async function addProject (req, res) {
  const query = 'insert into project (pro_title, pro_description, pro_customer_id, pro_sponsors_id,' +
		'pro_contact_id, pro_manager_id, pro_starts_on, pro_ends_on, pro_price, pro_currency,pro_is_active,pro_created_at,pro_com_id)' +
		'VALUES (' +
		"'" + (!sendId ? req.body.pTitle : 'Project for '.concat(req.body.name)) + "'," +
		"'" + (!sendId ? req.body.pDesc : 'Support Coordination') + "'," +
		'' + (!sendId ? req.body.pCustomer : cusId) + ',' +
		'' + (!sendId ? req.body.pSponsor : 'NULL') + ',' +
		'' + (!sendId ? req.body.pContact : 'NULL') + ',' +
		'' + req.body.pManager + ',' +
		(!sendId ? "'" : '') +
		(!sendId ? req.body.pstrtDate : 'CURRENT_TIMESTAMP') +
		(!sendId ? "'," : ',') +
		(!sendId ? "'" : '') +
		(!sendId ? req.body.pEndDate : 'DATEADD(year, 1, CURRENT_TIMESTAMP)') +
		(!sendId ? "'," : ',') +
		'' + (!sendId ? req.body.pPrice : 0) + ',' +
		"'" + (!sendId ? req.body.pCurrency : 'USD') + "'," +
		"'true',CURRENT_TIMESTAMP," +
		'' + req.body.company_id + '' +
		'); SELECT SCOPE_IDENTITY()'
  const request = new db.Request()
  const proj_id = await request.query(query).then((recordset) => {
    const project_id = recordset.recordset[0]['']
    let empList
    if (!sendId) { empList = req.body.selectedEmp } else { empList = [{ empId: req.body.pManager }] }
    empList.map(elem => {
      const projectEmpAssign = 'insert into projectEmployeeAssignment (pea_pro_id, pea_emp_id, pea_status,' +
				'pea_bill_rate, pea_currency, pea_frequency, pea_associate_from, pea_associate_to,pea_is_active,pea_created_at) ' +
				'VALUES (' +
				'' + project_id + ',' +
				'' + elem.empId + ',' +
				"'" + (!sendId ? elem.pEmpStatus : 'Full Time') + "'," +
				'' + (!sendId ? elem.pEmpBillRate : 11) + ',' +
				"'" + (!sendId ? elem.pEmpCurrency : 'USD') + "'," +
				"'" + (!sendId ? elem.pEmpFrequency : 'Hourly') + "'," +
				(!sendId ? "'" : '') +
				(!sendId ? elem.pEmpAssFromDate : 'CURRENT_TIMESTAMP') +
				(!sendId ? "'," : ',') +
				(!sendId ? "'" : '') +
				(!sendId ? elem.pEmpAssToDate : 'DATEADD(year, 1, CURRENT_TIMESTAMP)') +
				(!sendId ? "'," : ',') +
				"'true',CURRENT_TIMESTAMP" +
				');'
      request.query(projectEmpAssign, (err, recordset) => {
        if (err) {
          console.log(err)
          res.json({ code: 500, message: 'Insert Failed' })
        }
      })
    })
    let locList
    if (!sendId) { locList = req.body.pLoc } else { locList = locarrId }
    locList.forEach(function (loc) {
      const PlocatioQuery = 'insert into projectLocation(ploc_pro_id,ploc_loc_id) values(' + project_id + ',' + (!sendId ? loc.locId : loc) + ');'
      request.query(PlocatioQuery, (err, recordset) => {
        if (err) {
          console.log(err)
          res.json({ code: 500, message: 'Insert Failed' })
        }
      })
    })
    if (!sendId) { res.json({ code: 200, message: 'success' }) } else { return project_id }
  }).catch((err) => { console.log(err) })
  return proj_id
}

async function getAllNew (req, res) {
  const id = req.query.comp_id
  const data = {
    employees: {
      list: await getEmployeeList(id),
      empType: await empTypeDD(id),
      empLevel: await empLevelDD(id),
      empStatus: await empStatusDD(id),
      currency: await currencyDD(id),
      frequency: await frequencyDD(id)
    },
    customers: {
      list: await getCustomerList(id),
      customerType: await customerTypeDD(id),
      customerStatus: await customerStatusDD(id)
    },
    projects: {
          	list: await getProjectList(id)
    },
    tasks: {
      list: await getTaskList(id),
      taskType: await taskTypeDD(id)
    },
    contacts: {
      list: await getContactList(id),
      designation: await designationDD(id),
      contactType: await contactTypeDD(id),
      contactStatus: await contactStatusDD(id)
    },
    locations: {
      list: await getLocationList(id),
      states: await statesDD(id),
      locStatus: await locStatusDD(id),
      locType: await locTypeDD(id)
    }
  }
  res.json(data)
}
