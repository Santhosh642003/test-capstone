const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');
// const {addNotif} = require('./notifications')

exports.getProcs = async function (req, res) {
  let dataQuery = 'select * from procedure_code';
  // console.log(req.body.states)
  let data = await DBSendResponse(dataQuery);
  try{
    if(req.body.states.length !== 0 ){
      data = data.map((code)=> 
      {
        // console.log(req.body.states.includes(code.state_id),code )
        if(req.body.states.map((ste)=> {return ste.state_id;}).includes(code.state_id)) {
          return code;
        }else{return null;}
      }).filter((data)=> !!data);
    }
  } catch(err){
    console.log('ERROR | error occured in getProcs() function:');
    console.log(err);
    console.log('~~~');
  }
    
  res.json(data);
};

exports.getProcCodeMappingsForCompany = async function (req, res) {
  // procedure_code
  // procedure_code_id = procCode_id and
  // { id: 1, description: 'Personal Care Assistance', unit: '15 Minutes', code: 'T1019', modifierCode:'', taskType:'Visit'}
  let dataQuery = `
    select procCode_id,ddID, procProcCode,MappingTaskType.procTaskType,MappingTaskType.taskProcCode_id,procCode_description,procModifierCode, procUnitOfService, state_id, MappingTaskType.taskRate, MappingTaskType.officeIdentifier, MappingTaskType.payerIdentifier, MappingTaskType.providerIdentifier, MappingTaskType.deliveryMode, MappingTaskType.allowEarlyStart from procedure_code left join (select procedure_code_id, ddID, EntityValue as procTaskType, taskProcCode_id, taskRate,officeIdentifier, payerIdentifier, providerIdentifier, deliveryMode, allowEarlyStart from TaskProcCodeMapping,dropdowns where ddID = dropdown_id and comp_id=${req.query.comp_id}) as MappingTaskType on procedure_code.procCode_id = MappingTaskType.procedure_code_id`;
  // console.log(req.body.states)
  let data = await DBSendResponse(dataQuery);
  res.json(data);
};

exports.getOneMappingForProcCode = async function (req, res) {
  let dataQuery = `select * from TaskProcCodeMapping where dropdown_id='${req.query.dropdown_id}'`;
  console.log(req.query.dropdown_id);
  let data = await DBSendResponse(dataQuery);
  res.json(data);
};


exports.handleMappings = async function (req, res) {
  let { dropdown_id,procedure_code_id,comp_id,taskRate,officeIdentifier,payerIdentifier,providerIdentifier,deliveryMode,allowEarlyStart } = req.body;
  let checkQ = `select * from TaskProcCodeMapping where comp_id = ${comp_id}`;
  let dataBankMapper = await DBSendResponse(checkQ);
  const procCodeExists = dataBankMapper.find((dataMapping)=> dataMapping.procedure_code_id === procedure_code_id && dataMapping.dropdown_id === dropdown_id);
  if(procCodeExists){
    const deliveryModeValue = deliveryMode ? deliveryMode.substring(0, 1) : null;
    let existProcUpdateQuery = `Update TaskProcCodeMapping SET dropdown_id=${dropdown_id}, taskRate=${taskRate}, officeIdentifier=${officeIdentifier}, payerIdentifier=${payerIdentifier}, providerIdentifier=${providerIdentifier}, deliveryMode=${deliveryModeValue ? `'${deliveryModeValue}'` : 'NULL'}, allowEarlyStart=${allowEarlyStart ? 1 : 0} where taskProcCode_id = ${procCodeExists.taskProcCode_id}`;
    let existProcUpdate = await DBUpdate(existProcUpdateQuery);
    console.log(existProcUpdateQuery);
      
    if(existProcUpdate){
      res.send({ 'code':200,'message':'Mapped successfully', id: procCodeExists.taskProcCode_id });
    }else{
      res.json({ code: 500, message: 'Mapping Failed' });
    }
  }else{
    const deliveryModeValue = deliveryMode ? deliveryMode.substring(0, 1) : null;
    const query = `INSERT INTO TaskProcCodeMapping (comp_id, procedure_code_id, dropdown_id, taskRate, officeIdentifier, payerIdentifier, providerIdentifier, deliveryMode, allowEarlyStart) VALUES (
        ${comp_id || 'NULL'},
        ${procedure_code_id || 'NULL'},
        ${dropdown_id || 'NULL'},
        ${taskRate || 'NULL'},
        ${officeIdentifier || 'NULL'},
        ${payerIdentifier || 'NULL'},
        ${providerIdentifier || 'NULL'},
        ${deliveryModeValue ? `'${deliveryModeValue}'` : 'NULL'},
        ${allowEarlyStart ? 1 : 0}
        ); SELECT SCOPE_IDENTITY()`;
    console.log(query);
    let result = await DBinsertSendID(query);
    // console.log(result,notifSendId)
      
    if(result){
      res.send({ 'code':200,'message':'Mapped successfully', id: result });
    }else{
      res.json({ code: 500, message: 'Mapping Failed' });
    }
  }
    
  // else{
  //   let procCodeUpdateExist = dataBankMapper.find((dataMapping)=> dataMapping.procedure_code_id === procedure_code_id )
  //   let datatoUpdate = dataBankMapper.filter((dataMapping)=> dataMapping.procedure_code_id !== procedure_code_id && dataMapping.dropdown_id === dropdown_id).map((d)=> {return d.taskProcCode_id }).toString()
  //   console.log(dataBankMapper)
  //   if(!!datatoUpdate){
  //     let updateQuery = `Update TaskProcCodeMapping SET dropdown_id='', taskRate = NULL, officeIdentifier = NULL, payerIdentifier = NULL, providerIdentifier = NULL where taskProcCode_id IN (${datatoUpdate})`
  //     let resultUpdate = await DBUpdate(updateQuery)
  //     // console.log(resultUpdate)
  //   }
  //   if(procCodeUpdateExist){
  //     let existProcUpdateQuery = `Update TaskProcCodeMapping SET dropdown_id=${dropdown_id}, taskRate=${taskRate}, officeIdentifier=${officeIdentifier}, payerIdentifier=${payerIdentifier}, providerIdentifier=${providerIdentifier} where taskProcCode_id = ${procCodeUpdateExist.taskProcCode_id}`
  //     let existProcUpdate = await DBUpdate(existProcUpdateQuery)
  //     // console.log(existProcUpdate)
  //     if(!!existProcUpdate){
  //         res.send({"code":200,"message":"Mapped successfully", id: procCodeUpdateExist.taskProcCode_id});
  //     }else{
  //       res.json({code: 500, message: "Mapping Failed"});
  //     }
  //   }else{
  //     const query = `INSERT INTO TaskProcCodeMapping (comp_id, procedure_code_id, dropdown_id, taskRate, officeIdentifier, payerIdentifier, providerIdentifier) VALUES (
  //       ${comp_id || 'NULL'},
  //       ${procedure_code_id || 'NULL'},
  //       ${dropdown_id || 'NULL'},
  //       ${taskRate || 'NULL'},
  //       ${officeIdentifier || 'NULL'},
  //       ${payerIdentifier || 'NULL'},
  //       ${providerIdentifier || 'NULL'}
  //       ); SELECT SCOPE_IDENTITY()`
  //     // console.log(query)
  //     let result = await DBinsertSendID(query)
  //     // console.log(result,notifSendId)
        
  //     if(!!result){
  //         res.send({"code":200,"message":"Mapped successfully", id: result});
  //     }else{
  //       res.json({code: 500, message: "Mapping Failed"});
  //     }
  //   }
  // }
};
  
exports.updateProcCodeMapping = async function (req, res) {
  let updateQuery = `Update TaskProcCodeMapping SET dropdown_id='', taskRate = NULL, officeIdentifier = NULL, payerIdentifier = NULL, providerIdentifier = NULL, allowEarlyStart = NULL where taskProcCode_id = ${req.body.taskProcCode_id}`;
  let resultUpdate = await DBUpdate(updateQuery);

  if(resultUpdate){
    res.send({ 'code':200,'message':'Mapped successfully', id: req.body.taskProcCode_id });
  }else{
    res.json({ code: 500, message: 'Mapping Failed' });
  }
};