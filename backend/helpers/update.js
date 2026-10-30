const db = require('../models/indexSQL.js')

const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')
exports.UpdateOperation = function (req, res) {
  console.log(req.params.table)
  switch (req.params.table) {
    case 'projects':
      updateOneProject(req, res)
      break
    case 'employees':
      updateOneEmployee(req, res)
      break
    case 'customers':
      updateOneCustomer(req, res)
      break
    case 'contacts':
      updateOneContact(req, res)
      break
    case 'locations':
      updateOneLocation(req, res)
      break
    case 'tasks':
      updateOneTask(req, res)
      break
    case 'projEmp':
      updateProjectEmp(req, res)
      break
    case 'artifacts':
      break
    default:
      res.send('error')
      break
  }
}

// add to projects helper

// TO-DO CHANGE NAMES ON THE QUERY
async function updateOneProject (req, res) {
  // Find All Locations Related Projects
  const getAllProjLocQuery = `Select * from projectLocation where ploc_pro_id = ${req.body.projId}`
  const pLocResult = await DBSendResponse(getAllProjLocQuery)
  console.log(pLocResult)
  let prevLocId = pLocResult
  req.body.pLoc.forEach(loc => {
    prevLocId = prevLocId.filter((pLoc) => (pLoc.ploc_loc_id !== loc.locId))
  })

  console.log('Locations to Delete: ', prevLocId)
  const delRes = await Promise.all(prevLocId.map(async (pLoc) => {
    const delQuery = `DELETE from projectLocation WHERE ploc_id=${pLoc.ploc_id}`
    const res = await DBUpdate(delQuery)
    if (res === 0) {
      res.json({ code: 500, message: 'Update failed' })
    }
    // console.log(delQuery)
    return { status: 200, id: pLoc.ploc_id, action: 'DELETED' }
  }))
  console.log(delRes)

  let currPloc = req.body.pLoc
  pLocResult.forEach((loc) => {
    currPloc = currPloc.filter(currloc => (currloc.locId !== loc.ploc_loc_id))
  })
  console.log('Locations to Add: ', currPloc)
  const addRes = await Promise.all(currPloc.map(async (addLoc) => {
    const addQuery = `insert into projectLocation(ploc_pro_id,ploc_loc_id) values(${req.body.projId},${addLoc.locId}); SELECT SCOPE_IDENTITY();`
    // console.log(addQuery)
    const res = await DBUpdate(addQuery)
    if (res === 0) {
      res.json({ code: 500, message: 'Update failed' })
    }
    return { status: 200, id: addLoc.locId, action: 'ADDED' }
  }))
  console.log(addRes)

  const query = `UPDATE project 
				SET 
					pro_title='${req.body.pTitle}',
					pro_description='${req.body.pDesc}',
					pro_ends_on='${req.body.pEndDate}',
					pro_price='${req.body.pPrice}',
					pro_updated_at=CURRENT_TIMESTAMP,
					pro_sponsors_id=${req.body.pSponsor},
					pro_manager_id=${req.body.pManager},
					pro_com_id=${req.body.company_id}
				WHERE pro_id = ${req.body.projId}`
  console.log(query)
  const out = await DBUpdate(query)

  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

// add to employee helpers
// TO-DO CHANGE NAMES ON THE QUERY
async function updateOneEmployee (req, res) {
  const query = `UPDATE employee 
				SET 
					emp_first_name=${req.body.first_name},
					emp_last_name=${req.body.last_name},
					emp_addr_line1=${req.body.address1},
					emp_addr_line2=${req.body.address2},
					emp_city=${req.body.city},
					emp_state=${req.body.state},
					emp_zip=${req.body.zip},
					emp_phone_number=${req.body.phoneList},
					emp_join_date=${req.body.join_date},
					emp_status=${req.body.status},
					emp_type=${req.body.employee_type},
					emp_level=${req.body.employee_level},
					emp_vacation=${req.body.vacation_days},
					emp_personal=${req.body.personal_days_off},
					emp_updated_at=CURRENT_TIMESTAMP,
					emp_manager_id=${req.body.manager},
					emp_company_id=${req.body.company_id},
					emp_doxylink=${req.body.doxylink}
				WHERE emp_id = ${req.body.emp_id}`
  const out = await DBUpdate(query)
  if (out === 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

// add to project employee assignment helpers
async function updateProjectEmp (req, res) {
  const query = `UPDATE projectEmployeeAssignment SET pea_status='${req.body.status}', pea_bill_rate=${req.body.billRate},pea_frequency='${req.body.freq}',pea_associate_from='${req.body.assFrom}',pea_associate_to='${req.body.assTo}',pea_updated_at=CURRENT_TIMESTAMP WHERE pea_id=${req.body.id}`
  console.log(query)
  const pea_update = await DBUpdate(query)
  if (pea_update === 0) {
    res.json({ code: 200, message: 'Update Failed' })
  }
  res.json({ code: 200, message: 'Update Success' })
}

// add to customer helpers
async function updateOneCustomer (req, res) {
  // console.log(req.body)
  // GET PREV_ADDLIST
  const prevCustAddList = 'SELECT cus_address from customer WHERE cus_id=' + req.body.cus_id
  const custAddListRes = await DBSendResponse(prevCustAddList)
  const prevCustList = custAddListRes[0].cus_address.split(':')
  // console.log(prevCustList)
  const loc_IdList = []
  const preAddList = await Promise.all(prevCustList.map(async (add) => {
    const addArr = add.split(',')
    const findPrevLocIDQuery = `SELECT loc_id from location WHERE loc_addr_line1 = '${addArr[0]}' AND loc_addr_line2 = '${addArr[1]}' AND loc_city = '${addArr[2]}' AND loc_state = '${addArr[3]}' AND loc_zip = '${addArr[4]}' AND loc_is_active='true'`
    // console.log(findPrevLocIDQuery)
    const prevLocIdRes = await DBSendResponse(findPrevLocIDQuery)
    loc_IdList.push(prevLocIdRes[0].loc_id)
    // console.log(prevLocIdRes)
    const addObj = { addId: prevLocIdRes[0].loc_id, address_line_1: addArr[0], address_line_2: addArr[1], city: addArr[2], state: addArr[3], zip: addArr[4] }
    return addObj
  }))
  console.log(preAddList)
  console.log(loc_IdList)
  const tasks = {}
  // Query for finding tasks related to location Id
  await Promise.all(loc_IdList.map(async (id) => {
    const taskQuery = `Select tas_id from task where tas_loc_id=${id}`
    const restTaskforLoc = await DBSendResponse(taskQuery)
    tasks[id] = restTaskforLoc
 		// console.log(restTaskforLoc)
    return restTaskforLoc
  }))
  console.log(tasks)
  const locations = req.body.addList.map((add) => { return add.address_line_1 + ',' + add.address_line_2 + ',' + add.city + ',' + add.state + ',' + add.zip })
  // console.log(locations)// .join(":")
  const taskOrder = []
  if (preAddList.length === req.body.addList.length) {
    locations.forEach((add, i) => {
      const foundIndex = prevCustList.indexOf(locations[i])
      if (foundIndex === -1) {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: loc_IdList[i], new_loc_id: loc_IdList[i] })
      } else {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: loc_IdList[foundIndex], new_loc_id: loc_IdList[i] })
      }
    })
    prevCustList.forEach((add, i) => {
      const foundIndex = locations.indexOf(prevCustList[i])
      if (foundIndex === -1) {
        taskOrder[i] = { ...taskOrder[i], new_loc_id: loc_IdList[i] }
      } else {
        taskOrder[i] = { ...taskOrder[i], tranTask_loc_id: loc_IdList[foundIndex] }
      }
    })
    console.log(taskOrder)
  } else if (preAddList.length > req.body.addList.length) {
    prevCustList.forEach((add, i) => {
      const foundIndex = locations.indexOf(prevCustList[i])
      if (foundIndex === -1) {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: 'No trasfer Needed', new_loc_id: loc_IdList[i] })
      } else {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: loc_IdList[i], new_loc_id: loc_IdList[i] })
      }
    })
    locations.forEach((add, i) => {
      const foundIndex = prevCustList.indexOf(locations[i])
      if (foundIndex === -1) {
        taskOrder[i] = { ...taskOrder[i], tranTask_loc_id: 'No trasfer Needed', new_loc_id: loc_IdList[i] }
      } else {
        taskOrder[i] = { ...taskOrder[i], tranTask_loc_id: loc_IdList[foundIndex], new_loc_id: loc_IdList[i] }
      }
    })
    console.log(taskOrder)
  } else {
    locations.forEach((add, i) => {
      const foundIndex = prevCustList.indexOf(locations[i])
      if (foundIndex === -1) {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: 'No trasfer Needed', new_loc_id: 'New ID' })
      } else {
        taskOrder.push({ indx: foundIndex, tranTask_loc_id: loc_IdList[foundIndex], new_loc_id: (!loc_IdList[i] ? 'New ID' : loc_IdList[i]) })
      }
    })
    prevCustList.forEach((add, i) => {
      const foundIndex = locations.indexOf(prevCustList[i])
      if (foundIndex === -1) {
        taskOrder[i] = { ...taskOrder[i], tranTask_loc_id: loc_IdList[i], new_loc_id: loc_IdList[i] }
      } else {
        taskOrder[i] = { ...taskOrder[i], new_loc_id: loc_IdList[i] }
      }
    })
    console.log(taskOrder)
  }

  const finalTranferOfTasks = await Promise.all(taskOrder.map(async (taskTransfer) => {
    let TaskRes
    if (taskTransfer.tranTask_loc_id !== taskTransfer.new_loc_id && taskTransfer.tranTask_loc_id !== 'No trasfer Needed' && tasks[taskTransfer.tranTask_loc_id].length !== 0) {
      const taskTransterRes = await Promise.all(tasks[taskTransfer.tranTask_loc_id].map(async (task) => {
        const taskTransQuery = `UPDATE task SET tas_loc_id=${taskTransfer.new_loc_id} WHERE tas_id=${task.tas_id}`
        console.log(taskTransQuery)
        const taskUpdateRes = await DBUpdate(taskTransQuery)
        if (taskUpdateRes === 0) {
          res.json({ code: 500, message: 'Error in Task Update' })
        }
        return { tid: task.tas_id, tloc: taskTransfer.new_loc_id, status: 'Updated' }
      }))
      TaskRes = { loc_id: taskTransfer.new_loc_id, tasks: taskTransterRes }
    } else {
      // console.log(tasks[taskTransfer.tranTask_loc_id])
      TaskRes = { loc_id: taskTransfer.new_loc_id, tasks: (!tasks[taskTransfer.new_loc_id]) ? 'No trasfer Needed' : tasks[taskTransfer.new_loc_id] }
      // finalTranferOfTasks[taskTransfer.new_loc_id] = tasks[taskTransfer.new_loc_id]
    }
    return TaskRes
  }))

  console.log(finalTranferOfTasks)

  const query = `UPDATE customer 
				SET 
					cus_name='${req.body.cus_name}',
					cus_address='${locations.join(':')}',
					cus_phone='${req.body.phonList}',
					cus_status='${req.body.status}',
					cus_type='${req.body.type}',
					cus_updated_at=CURRENT_TIMESTAMP
				WHERE cus_id = ${req.body.cus_id}`
  console.log(query)
  const out = await DBUpdate(query)
  if (out === 0) {
    console.log('WTF')
    res.json({ code: 500, message: 'Customer Update failed' })
  } else {
    // CHECK FOR DIFF CASES AFTER UPDATE ON CUSTOMER TABLE
    // CASE 1
    if (preAddList.length === req.body.addList.length) {
      const checkUpdtRes = await Promise.all(req.body.addList.map(async (add, index) => {
        const updateRes = await updateOneLocation(req, add, preAddList[index].addId)
        if (updateRes.code === 500) {
          // console.log(updateRes.message)
          res.json({ code: updateRes.code, message: updateRes.message })
        }
        return { loc_id: preAddList[index].addId, status: updateRes.code }
      }))
      console.log('Update Results For CASE 1:', checkUpdtRes)
      res.json({ code: 200, message: 'Update Success' })
    }
    // CASE 2
    else if (preAddList.length < req.body.addList.length) {
      const checkUpdtRes = await Promise.all(req.body.addList.map(async (add, index) => {
        const ResObj = {}
        if (index > preAddList.length - 1) {
          // ADD LOC TO LOCATION
          const addLocQuery = `insert into location(loc_addr_line1,loc_addr_line2,loc_city,loc_state,loc_zip,loc_lat,loc_lon,loc_type,loc_status,loc_county,loc_association_date,loc_phone_number,loc_company_id) values (
						 				'${add.address_line_1}',
						 				'${add.address_line_2}',
						 				'${add.city}','${add.state}','${add.zip}',
						 				${add.latitude},${add.longitude},
						 				'Customer Location','Personal','United States',GETDATE(),
						 				'${req.body.phonList.split(',')[0]}',${req.body.comp_id}); SELECT SCOPE_IDENTITY();`
          // console.log(addLocQuery)
          const addRes = await DBinsertSendID(addLocQuery)
          if (!addRes) {
            res.json({ code: 500, message: 'Failed To add Adress' })
          } else {
            // ADD REF TO PLOC TABLE
            const addPlocQuery = `insert into projectLocation(ploc_pro_id,ploc_loc_id) values(${req.body.proId},${addRes}); SELECT SCOPE_IDENTITY();`
            // console.log(addPlocQuery)
            const PlocRes = await DBinsertSendID(addPlocQuery)
            if (!PlocRes) {
              res.json({ code: 500, message: 'Failed to assign Location to Project' })
            }
            ResObj.loc_id = addRes
            ResObj.status = 200
            ResObj.message = 'ADDED'
          }
        } else {
          // UPDATE LOC
          const updateRes = await updateOneLocation(req, add, preAddList[index].addId)
          if (updateRes.code === 500) {
            res.json({ code: updateRes.code, message: updateRes.message })
          }
          ResObj.loc_id = preAddList[index].addId
          ResObj.status = updateRes.code
          ResObj.message = 'UPDATED'
        }
        return ResObj
      }))
      console.log('Update Results For CASE 2:', checkUpdtRes)
      res.json({ code: 200, message: 'Update Success' })
    }
    // CASE 3
    else {
      const checkUpdtRes = await Promise.all(preAddList.map(async (add, index) => {
        const ResObj = {}
        if (index > req.body.addList.length - 1) {
          // DEL REF TO PLOC TABLE
          const delPlocQuery = `DELETE FROM projectLocation WHERE ploc_loc_id=${add.addId}`
          // console.log(delPlocQuery)
          const PlocDelRes = await DBUpdate(delPlocQuery)
          if (PlocDelRes === 0) {
            res.json({ code: 500, message: 'Failed To delete ref Adress' })
          } else {
            // DEL LOC TO LOCATION
            const delLocQuery = `UPDATE location SET loc_is_active='false' WHERE loc_id=${add.addId}`
            // console.log(delLocQuery)
            const LocDelRes = await DBUpdate(delLocQuery)
            if (LocDelRes === 0) {
              res.json({ code: 500, message: 'Failed to delete Location' })
            }
            ResObj.loc_id = add.addId
            ResObj.status = 200
            ResObj.message = 'DELETED'
          }
        } else {
          // UPDATE LOC
          const updateRes = await updateOneLocation(req, req.body.addList[index], add.addId)
          if (updateRes.code === 500) {
            res.json({ code: updateRes.code, message: updateRes.message })
          }
          ResObj.loc_id = add.addId
          ResObj.status = updateRes.code
          ResObj.message = 'UPDATED'
        }
        return ResObj
      }))
      console.log('Update Results For CASE 3:', checkUpdtRes)
      res.json({ code: 200, message: 'Update Success' })
    }
  }
}

// add to contact helpers

// TO-DO CHANGE NAMES ON THE QUERY
async function updateOneContact (req, res) {
  const query = `UPDATE contact 
				SET 
					con_first_name='${req.body.first_name}',
					con_last_name='${req.body.last_name}',
					con_Addr_line1='${req.body.address_line_1}',
					con_Addr_line2='${req.body.address_line_2}',
					con_city='${req.body.city}',
					con_state='${req.body.state}',
					con_zip='${req.body.zip}',
					con_phone='${req.body.phoneList}',
					con_designation='${req.body.designation}',
					con_status='${req.body.status}',
					con_contact_type='${req.body.contact_type}',
					con_first_contact_date='${req.body.first_contact_date}',
					con_last_contact_date='${req.body.last_contact_date}',
					con_updated_at=CURRENT_TIMESTAMP,
					con_company_id=${req.body.company_id},
					con_customer_id=${req.body.customer_id}
				WHERE con_id = ${req.body.cont_id}`
  const out = await DBUpdate(query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

// add to location helpers

// TO-DO CHANGE NAMES ON THE QUERY
async function updateOneLocation (req, address, updtLocId) {
  const query = `UPDATE location 
				SET 
					loc_addr_line1='${address.address_line_1}',
					loc_addr_line2='${address.address_line_2}',
					loc_city='${address.city}',
					loc_state='${address.state}',
					loc_zip='${address.zip}',
					loc_lat=${address.latitude},
					loc_lon=${address.longitude},
					loc_is_active='true',
					loc_phone_number='${req.body.phonList.split(',')[0]}'
				WHERE loc_id = ${updtLocId}`
  console.log(query)
  const out = await DBUpdate(query)
  if (out == 0) {
    return ({ code: 500, message: 'Update failed' })
  } else {
    return ({ code: 200, message: 'Update Success' })
  }
}

// add to task helpers

// TO-DO CHANGE NAMES ON THE QUERY
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
					tas_loc_id=${req.body.tLoc},
					tas_prequisites_task=${req.body.tPreReq},
					tas_com_id=${req.body.company_id}
				WHERE tas_id = ${req.body.taskId}`
  console.log(query)
  const out = await DBUpdate(query)
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' })
  } else {
    res.json({ code: 200, message: 'Update Success' })
  }
}

// async function DBUpdate(query) {
// 	var request = new db.Request();
// 	let out = await request.query(query).then((result)=>{return result}).catch((err)=>{console.log(err)});
// 	// console.log(out);
// 	return out.rowsAffected[0];
// }

// async function DBinsertSendID(query) {
// 	// console.log(query);
// 	var request = new db.Request();
// 	let res = await request.query(query).then((result)=>{return result}).catch((err)=>{console.log(err)});
// 	// console.log(res)
// 	return res.recordset[0][''];
// }

// async function DBSendResponse(query) {
// 	var request = new db.Request();
// 	let res = await request.query(query).then((result)=>{return result}).catch((err)=>{console.log(err)});
// 	// console.log(res.recordset)
// 	return res.recordset;
// }
