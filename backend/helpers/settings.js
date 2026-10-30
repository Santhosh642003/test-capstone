const { get } = require('express/lib/response.js');
const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse } = require('../queries/commonQueries');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');

const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

async function getSettingsFunc(req, res) {
  const query = `select * from settings where company_id=${req.query.comp_id}`;

  let list = await DBinsertSendResponse(query);
  if(req.query.feature_id){
    list = list.filter((data)=> data.feature_id === +req.query.feature_id);
  }
  if(!!req.query.feature_value){
      if(req.query.feature_value === 'primaryBusinessType'){
          console.log(list)
          list = list.filter((data)=> data.feature_id >= 101 && data.feature_id <= 106)
      } else{
        list = list.filter((data)=> data.feature_value === req.query.feature_value)
      }
  }
  return list;
}

exports.getSettingsFunc = getSettingsFunc;

exports.getSettings = async function (req, res) {
  let settings = await getSettingsFunc(req, res);
  res.json(settings);
};

exports.addSettings = async function (req, res) {
  if(req.body.feature_id === 99){
    let stateCheckQuery = `select * from settings where company_id=${req.body.company_id} and feature_id=${req.body.feature_id} and state_id='${req.body.state_id}'`;
    let stateDataSettigs = await DBinsertSendResponse(stateCheckQuery);
    // console.log(stateDataSettigs)
    if(stateDataSettigs.length !== 0){
      res.json({ code: 409, message: 'State Record Already exist in Company Configurations' });
      return;
    }
  }
  
  try{
    const query = `insert into settings (company_id,feature_id,state_id,feature_value,added_by,added_on) values (${req.body.company_id},${req.body.feature_id},${req.body.state_id?`'${req.body.state_id}'`:'NULL'},'${req.body.feature_value}',${req.body.added_by || 'NULL'}, CURRENT_TIMESTAMP); SELECT SCOPE_IDENTITY()`;
    console.log(query);
    const settings_Id = await DBinsertSendID(query);
  
    if (!settings_Id) {
      res.json({ code: 500, message: 'Settings Record Add to DB Failed' });
    } else {
      let com_id = req.body.company_id, emp_id = req.body.emp_id;
      if (com_id && emp_id && settings_Id && req.body.feature_id && req.body.feature_value) {
        analytics.track({
          userId: String(emp_id),
          event: 'Company settings changed',
          context: {
            groupId: com_id,
          },
          properties: {
            id: settings_Id, 
            name: req.body.feature_id, 
            type: req.body.feature_value 
          }
        });
        console.log('logged to segment successfully');
      }
      res.json({ code: 200, settings_data: { id: settings_Id, name: req.body.feature_id, type: req.body.feature_value }, message: 'Settings Add to DB Success' });
    }
  } catch(err){
    res.status(500).json({ message: 'Error when attempting to Add Setting' });
  }
  
};

exports.updateSettings = async function (req, res) {
  let response = null;

  console.log(req.body);
  if(req.body.feature_value) {
    response = await updateSettingsByValue(req, res);
  } else {
    response = await updateSettingsByID(req, res);
  }

  res.json(response);
};

exports.delSettings = async function (req, res) {
  const query = `delete from settings where settings_id =${req.body.settings_id}`;
  console.log(query);
  const settings_update_res = await DBUpdate(query);
  if (settings_update_res === 0) {
    return res.json({ code: 500, message: 'Settings Update Failed' });
  }
  let com_id = req.body.company_id, emp_id = req.body.emp_id;
  if (com_id && emp_id && req.body.settings_id) {
    analytics.track({
      userId: String(emp_id),
      event: 'Settings deleted',
      context: {
        groupId: com_id,
      },
      properties: {
        id: req.body.settings_id, 
      }
    });
    console.log('logged to segment successfully');
  }
  res.json({ code: 200, message: 'Settings Record Delete Success' });
};

const updateSettingsByValue = async (req, res) => {
  const query = `update settings SET feature_value = '${req.body.feature_value}' where settings_id = ${req.body.settings_id}`;
  console.log(query);
  const settings_update_res = await DBUpdate(query);
  if (settings_update_res === 0) {
    return res.json({ code: 500, message: 'Setting Update Failed' });
  }
  let com_id = req.body.company_id, emp_id = req.body.emp_id;
  if (com_id && emp_id && req.body.settings_id && req.body.feature_value) {
    analytics.track({
      userId: String(emp_id),
      event: 'Company settings changed',
      context: {
        groupId: com_id,
      },
      properties: {
        id: req.body.settings_id, 
        name: req.body.feature_value
      }
    });
    console.log('logged to segment successfully');
  }
  res.json({ code: 200, settings_data: { id: req.body.settings_id, name: req.body.feature_value }, message: 'Settings Update Success' });
};

const updateSettingsByID = async (req, res) => {
  const query = `update settings SET feature_id = '${req.body.feature_id}' where settings_id = ${req.body.settings_id}`;
  console.log(query);
  const settings_update_res = await DBUpdate(query);
  if (settings_update_res === 0) {
    return res.json({ code: 500, message: 'Setting Update Failed' });
  }
  let com_id = req.body.company_id, emp_id = req.body.emp_id;
  if (com_id && emp_id && req.body.settings_id && req.body.feature_id) {
    analytics.track({
      userId: String(emp_id),
      event: 'Company settings changed',
      context: {
        groupId: com_id,
      },
      properties: {
        id: req.body.settings_id, 
        name: req.body.feature_id
      }
    });
    console.log('logged to segment successfully');
  }
  res.json({ code: 200, settings_data: { id: req.body.settings_id, name: req.body.feature_id }, message: 'Settings Update Success' });
};

exports.replaceSettings = async (req, res) => {
  const transaction = new db.Transaction();
  console.log(req.body);

  try {
    await transaction.begin(err => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: 'Error when attempting to replace Settings' });
      }
      const request = new db.Request(transaction);
      request.query(`delete from settings where company_id=${req.body.company_id} and ${req.body.feature_id?`feature_id=${req.body.feature_id}`:`feature_value='${req.body.feature_value}'`}`, async (err, result) => {
        if (err) {
          console.log(err);
          try { await transaction.rollback(); } catch (e) {}
          res.status(500).json({ message: 'Error when attempting to delete Settings' });
        } else {
          let settings = req.body.settings;
          let insertQuery = 'insert into settings (company_id,feature_id,state_id,feature_value,added_by,added_on) values ';

          if (settings.length === 0) {
            transaction.commit(async err => {
                if (err) {
                    console.log(err);
                    try { await transaction.rollback(); } catch (e) {}
                    return res.status(500).json({ message: 'Error when attempting to replace Settings' });
                }
                res.json({ code: 200, message: 'Settings Replace Success' });
            });
          } else {
            settings.forEach((setting, index) => {
              insertQuery += `(${req.body.company_id},${setting.feature_id},${setting.state_id?`'${setting.state_id}'`:'NULL'},'${setting.feature_value}',${req.body.added_by || 'NULL'}, CURRENT_TIMESTAMP)`;
              if (index !== settings.length - 1) {
                insertQuery += ',';
              }
            });

            request.query(insertQuery, async (err, result) => {
              if (err) {
                console.log(err);
                try { await transaction.rollback(); } catch (e) {}
                res.status(500).json({ message: 'Error when attempting to insert Settings' });
              } else {
                transaction.commit(async err => {
                    if (err) {
                        console.log(err);
                        try { await transaction.rollback(); } catch (e) {}
                        return res.status(500).json({ message: 'Error when attempting to replace Settings' });
                    }
                    res.json({ code: 200, message: 'Settings Replace Success' });
                });
              }
            });
          }
        }
      });
    });
  } catch (err) {
    console.log(err);
    try { await transaction.rollback(); } catch (e) {}
    res.status(500).json({ message: 'Error when attempting to replace Settings' });
  }
};

async function getIndividualSettingsFunc(req, res) {
  let query = `select * from individual_settings where emp_id=${req.params.emp_id}`;
  console.log(query);
  
  if(req.query.feature_id){
    query += ` and feature_id=${req.query.feature_id}`;
  }

  if(req.query.feature_value){
    query += ` and feature_value='${req.query.feature_value}'`;
  }

  let settings = await DBinsertSendResponse(query);
  console.log(settings);
  return settings;
}

exports.getIndividualSettingsFunc = getIndividualSettingsFunc;

exports.getIndividualSettings = async (req, res) => {
  let settings = await this.getIndividualSettingsFunc(req, res);
  res.json(settings);
};

exports.addIndividualSettings = async (req, res) => {
  const query = `insert into individual_settings (emp_id,feature_id,feature_value,added_by,added_on,company_id) values (${req.params.emp_id},${req.body.feature_id},'${req.body.feature_value}',${req.body.added_by || 'NULL'}, CURRENT_TIMESTAMP, ${req.body.company_id})`;
  console.log(query);
  const settings_update_res = await DBUpdate(query);
  if (settings_update_res === 0) {
    return res.json({ code: 500, message: 'Individual Setting Add Failed' });
  }
  res.json({ code: 200, message: 'Individual Setting Add Success' });
};

exports.updateIndividualSettings = async (req, res) => {
  const query = `update individual_settings SET feature_value = '${req.body.feature_value}' where emp_id = ${req.params.emp_id} and feature_id = ${req.body.feature_id}`;
  console.log(query);
  const settings_update_res = await DBUpdate(query);
  if (settings_update_res === 0) {
    return res.json({ code: 500, message: 'Individual Setting Update Failed' });
  }
  res.json({ code: 200, message: 'Individual Setting Update Success' });
};

exports.delIndividualSettings = async (req, res) => {
  const query = `delete from individual_settings where emp_id = ${req.params.emp_id} and feature_id = ${req.body.feature_id}`;
  console.log(query);
  const settings_update_res = await DBUpdate(query);
  if (settings_update_res === 0) {
    return res.json({ code: 500, message: 'Individual Setting Delete Failed' });
  }
  res.json({ code: 200, message: 'Individual Setting Delete Success' });
};