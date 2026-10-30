const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse } = require('../queries/commonQueries')

exports.getDefaults = async function (req, res) {
  const query = `select * from defaults`
  console.log(query)
  let list = await DBinsertSendResponse(query)

  if(!!req.query.feature_type){
    list = list.filter((data)=> data.feature_type === req.query.feature_type)
  }
  if(!!req.query.feature_id){
    list = list.filter((data)=> data.feature_id === req.query.feature_id)
  }
  res.json(list)
}

exports.addDefault = async function (req, res) {
  const query = `insert into defaults (feature_type,feature_value,added_by,added_on,state_id) values ('${req.body.feature_type}','${req.body.feature_value}',${req.body.added_by || 'NULL'},CURRENT_TIMESTAMP,'${req.body.state_id}'); SELECT SCOPE_IDENTITY()`
  console.log(query)
  const default_Id = await DBinsertSendID(query)
  if (!default_Id) {
    res.json({ code: 500, message: 'Default Add to DB Failed' })
  } else {
    res.json({ code: 200, default_data: { id: default_Id, name: req.body.feature_value, type: req.body.feature_type }, message: 'Default Add to DB Success' })
  }
}

exports.addDefaultBulk = async function (req, res) {
    console.log(req.body.data.length)
    // res.json(req.body.data)
    let data = await Promise.all(req.body.data.map(async(d)=> {
        const query = `insert into defaults (feature_type,feature_value,added_by,added_on,state_id) values ('${d.feature_type}','${d.feature_value}',${d.added_by || 'NULL'},CURRENT_TIMESTAMP,'${d.state_id}'); SELECT SCOPE_IDENTITY()`
        // console.log(query)
        const default_Id = await DBinsertSendID(query)
        if(!!default_Id){
            return default_Id
        }else{
            return null
        }
        // return query
    }).filter((d)=> !!d))

    res.json({ code: 200, default_data: data, message: 'Default Added to DB ' })
    
  }



exports.delAllDefaults = async function (req, res) {
  const query = `delete from defaults`
  console.log(query)
  const conf_update_res = await DBUpdate(query)
  if (conf_update_res === 0) {
    res.json({ code: 500, message: 'Dropdown Update Failed' })
  }
  res.json({ code: 200, message: 'Config Delete Success' })
}
