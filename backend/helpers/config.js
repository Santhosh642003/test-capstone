const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse } = require('../queries/commonQueries')

exports.getConfig = async function (req, res) {
  const query = `select * from Config where CompanyID=${req.query.comp_id}`
  console.log(query)
  const configList = await DBinsertSendResponse(query)
  res.json(configList)
}

exports.addConfig = async function (req, res) {
  const query = `insert into Config (TaskName,TaskType,completion_days,created_on,CompanyID) values ('${req.body.tName}','${req.body.tType}',${req.body.tComp_Days},CURRENT_TIMESTAMP,${req.query.comp_id}); SELECT SCOPE_IDENTITY()`
  console.log(query)
  const config_Id = await DBinsertSendID(query)
  if (!config_Id) {
    res.json({ code: 500, message: 'Config Add to DB Failed' })
  } else {
    res.json({ code: 200, config_data: { id: config_Id, name: req.body.tName, type: req.body.tType }, message: 'Config Add to DB Success' })
  }
}

exports.updateConfig = async function (req, res) {
  const query = `update config SET TaskName = '${req.body.tName}', TaskType = '${req.body.tType}' ,completion_days = ${req.body.tComp_Days} where configID = ${req.body.config_Id}`
  console.log(query)
  const conf_update_res = await DBUpdate(query)
  if (conf_update_res === 0) {
    res.json({ code: 500, message: 'Config Update Failed' })
  }
  res.json({ code: 200, config_data: { id: req.body.config_Id, name: req.body.tName, value: req.body.tType }, message: 'Config Update Success' })
}

exports.delConfig = async function (req, res) {
  const query = `delete from config where configID =${req.body.config_Id}`
  console.log(query)
  const conf_update_res = await DBUpdate(query)
  if (conf_update_res === 0) {
    res.json({ code: 500, message: 'Dropdown Update Failed' })
  }
  res.json({ code: 200, message: 'Config Delete Success' })
}
