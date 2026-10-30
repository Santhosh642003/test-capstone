const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')

exports.getProjLocation = async function (req, res) {
  let projectLocationList = []

  if (!!req.query.project_id && !!req.query.location_id) {
    projectLocationList = await getProjectLocationID(req)
    res.json(projectLocationList)
  } else if (!!req.query.comp_id && !!req.query.project_id) {
    projectLocationList = await getProjLocation(req)
  } else if (req.query.comp_id) {
    projectLocationList = await getProjLocationByCompany(req.query.comp_id)
  } else if (req.query.project_id) {
    projectLocationList = await getProjLocationByProject(req.query.project_id)
  }
  if (!!req.query.lastN && projectLocationList.length > req.query.lastN) {
    projectLocationList = projectLocationList.slice(Math.max(projectLocationList.length - lastN, 0))
  }
  res.json(projectLocationList)
}

exports.addProjLocation = async function (req, res) {
  const query = 'insert into projectLocation (ploc_pro_id,ploc_loc_id) values ( ' + req.query.project_id + ',' + req.query.location_id + ' );SELECT SCOPE_IDENTITY();'
  const plocId = await DBinsertSendID(query)
  if (plocId) {
    return res.json({ code: 200, id: plocId, message: 'Inserted Successfully' })
  } else {
    return res.json({ code: 500, message: 'Insert Failed' })
  }
}

async function getProjLocation (req) {
  const query = `select * from projectLocation,location 
				 where ploc_loc_id = loc_id and
				 loc_company_id = ${req.query.comp_id} and 
				 ploc_pro_id = ${req.query.project_id}`

  console.log(query)
  const pc_list = await DBinsertSendResponse(query)

  return pc_list
}

async function getProjectLocationID (req) {
  console.log(req.query)
  const query = `select ploc_id from projectLocation where
				 ploc_pro_id = ${req.query.project_id} and
				 ploc_loc_id = ${req.query.location_id}`

  console.log(query)
  const pc_list = await DBinsertSendResponse(query)

  return pc_list
}

async function getProjLocationByCompany (comp_id) {
  const query = `select * from projectLocation,location 
                where ploc_loc_id = loc_id and loc_company_id = ${comp_id}`
  console.log(query)
  const pc_list = await DBinsertSendResponse(query)
  return pc_list
}

async function getProjLocationByProject (project_id) {
  const query = `select * from projectLocation,location 
                where ploc_loc_id = loc_id and ploc_pro_id = ${project_id}`
  console.log(query)
  const pc_list = await DBinsertSendResponse(query)
  return pc_list
}
