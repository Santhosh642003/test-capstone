const jwtDecode = require("../utils/tokenDecoder.js");
const {
  DBInsertAndReturn,
  DBSendResponse,
  DBUpdate,
} = require("../queries/commonQueries");
const moment = require('moment-timezone');
const { handleCatchError } = require("../utils/helperFunction");
var {SEGMENT_API_KEY} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })

exports.addClaimCSV = async function (req, res) {
  await bulkClaimUpload(req, res);
};

async function optionalClaimUpload(req, res) {

  try {
    const authArray = req.body?.data.slice(1);
    const empId = req.body.empId;
    const empCompanyId = req.body.empCompanyId;
    const empName = req.body.empName;
    const companyName = req.body.companyName;
    console.log(empId, empCompanyId, empName, companyName)
    let def_payer_id_info = await DBSendResponse(`select payer_id from payer where payer_id IN (select payer_id from def_payer_state where payer_state IN (select state_id from settings where company_id = ${empCompanyId} and feature_id = 99))`);
    let def_payer_id = def_payer_id_info.length !== 0 ? def_payer_id_info[0].payer_id : null;
    let uniqueToIndexAndStatusMap = {}

    for(let i = 0; i < authArray.length; i+= 200) {
      let checkInDBQuery = "select priorAuth, CAST(startDate as DATE) startDate, CAST(endDate as DATE) endDate, concat_ws(':',procedureCode,replace(procedureModifierCode,'/',':')) procCode from Claim where "
      for(let j = i; j < Math.min(i + 200,authArray.length); j++) {
        const authItem = authArray[j];
        for (const [key, value] of Object.entries(authItem)) {
          authItem[key] = value.trim();
        }
        // let modifier = authItem[13] === "" ? authItem[13] : (authItem[13].replaceAll("/",":").split(":")[0] === authItem[13] ? authItem[13].match(/.{1,2}/g).join(":") : authItem[13].replaceAll("/",":"));

        let priorAuth = authItem.priorAuth, procCode = [authItem.procedureCode].concat(authItem.procedureModifierCode.split("/").filter((val) => val !== "")).join(":"), startDate = moment(authItem.startDate, "MM/DD/YYYY").format("MM/DD/YYYY"), endDate = moment(authItem.endDate, "MM/DD/YYYY").format("MM/DD/YYYY");
        // console.log(priorAuth,procCode,startDate,endDate);
        uniqueToIndexAndStatusMap[`${priorAuth}-${startDate}-${endDate}-${procCode}`] = false;
        checkInDBQuery += `(priorAuth = '${priorAuth}' AND CAST(startDate as DATE) = '${startDate}' AND CAST(endDate as DATE) = '${endDate}' AND concat_ws(':',procedureCode,replace(procedureModifierCode,'/',':')) = '${[procCode]}')`
        if(j !== Math.min(i+200,authArray.length) - 1) {
          checkInDBQuery += " OR "
        }
      }
      // console.log(checkInDBQuery);
      const resp = await DBSendResponse(checkInDBQuery);
      // console.log(resp);
      resp.forEach((obj) => {
        uniqueToIndexAndStatusMap[`${obj.priorAuth}-${moment(obj.startDate).utc().format("MM/DD/YYYY")}-${moment(obj.endDate).utc().format("MM/DD/YYYY")}-${obj.procCode}`] = true;
      })
      // console.log(uniqueToIndexAndStatusMap);
    }

    // console.log(uniqueToIndexAndStatusMap);
    let finalArray = authArray.filter((authItem,index) => {
      let priorAuth = authItem.priorAuth.trim(), procCode = [authItem.procedureCode.trim()].concat(authItem.procedureModifierCode.trim().split(",")).join(":"), startDate = moment(authItem.startDate.trim(), "MM/DD/YYYY").format("MM/DD/YYYY"), endDate = moment(authItem.endDate.trim(), "MM/DD/YYYY").format("MM/DD/YYYY");
      // console.log(`${priorAuth}-${startDate}-${endDate}-${procCode}`)
      return !uniqueToIndexAndStatusMap[`${priorAuth}-${startDate}-${endDate}-${procCode}`];
    })

    // console.log(finalArray);
    // console.log("here")

    let numOfRecords = finalArray.length;
    if(numOfRecords === 0) {
      return res.json({
        success: false,
        message: "No new claims were found, please edit the previously uploaded claims!",
      });
    }
    let numOfBatches = Math.ceil(numOfRecords / 100);
    console.log(numOfBatches);

    for (let i = 0; i < numOfBatches; i++) {
      let insertQuery =
        "INSERT into Claim" +
        "(uploadedBy," +
        "companyID," +
        "DDDID," +
        "FirstName," +
        "LastName," +
        "DateOfBirth," +
        "Gender," +
        "DiagnosisCode," +
        "memberMedicaid," +
        "providerMedicaid," +
        "priorAuth," +
        "procedureCode," +
        "startDate," +
        "endDate," +
        "authUnits," +
        "authAmount," +
        "errCode," +
        "errDescription," +
        "CreateDate," +
        "Status," +
        "procedureModifierCode," +
        "patientAddrLine1, patientCity, patientState, patientZip, patientRel, placeOfServiceCode, facilityTypeCode, payerId, source" +  
        ") VALUES ";
      for (let j = Math.max(i * 100,0); j < Math.min((i + 1) * 100, finalArray.length); j++) {
        // let procedureCode = authItem[12];
        // if (authItem[13]) {
        //   procedureCode += ":" + authItem[13];
        // }
        let authItem = finalArray[j];
        let diagnosisCode = authItem.DiagnosisCode.toUpperCase().replaceAll(".", "");
        // let modifier = authItem[13] === "" ? authItem[13] : (authItem[13].replaceAll("/",":").split(":")[0] === authItem[13] ? authItem[13].match(/.{1,2}/g).join(":") : authItem[13].replaceAll("/",":"));
        // console.log(modifier);
        insertQuery +=
          "(" +
          `${empId}, ${empCompanyId}, '${authItem.DDDID}', '${authItem.FirstName.replaceAll("'","''")}', '${
            authItem.LastName.replaceAll("'","''")
          }', '${moment(authItem.DateOfBirth, "MM/DD/YYYY").format("MM/DD/YYYY")}',` +
          `'${authItem.Gender}', '${diagnosisCode}', '${authItem.memberMedicaid}', '88988', '${authItem.priorAuth}', '${String(authItem.procedureCode).toUpperCase()}', '${moment(authItem.startDate, "MM/DD/YYYY").format(
            "MM/DD/YYYY"
          )}', '${moment(authItem.endDate, "MM/DD/YYYY").format("MM/DD/YYYY")}', ${
            authItem.authUnits
          }, ${authItem.authAmount}` +
          ", " +
          "Null" +
          ", " +
          "Null" +
          ", " +
          `'${moment().tz('America/New_York').toISOString()}'` +
          "," +
          `'Ready to Bill', ` +
          `${authItem.procedureModifierCode ? `'${String(authItem.procedureModifierCode).toUpperCase()}'` : 'Null'},` +
          `${authItem.patientAddrLine1 ? `'${authItem.patientAddrLine1}'` : 'Null'},` + 
          `${authItem.patientCity ? `'${authItem.patientCity}'` : 'Null'},` + 
          `${authItem.patientState ? `'${authItem.patientState}'` : 'Null'},` + 
          `${authItem.patientZip ? `'${authItem.patientZip}'` : 'Null'},` + 
          `${authItem.patientRel ? `'${authItem.patientRel}'` : 'Null'},` + 
          `${authItem.placeOfServiceCode ? `'${authItem.placeOfServiceCode}'` : 'Null'},` + 
          `${authItem.facilityTypeCode ? `'${authItem.facilityTypeCode}'` : 'Null'},` +
          `${authItem.payerId ? `'${authItem.payerId}'` : (def_payer_id ? `'${def_payer_id}'` : 'Null')},` +
          `'Bulk .csv upload'` +
          (j === (i + 1) * 100 - 1 || j === finalArray.length - 1
            ? "); SELECT SCOPE_IDENTITY();"
            : "),");
      }
      // console.log(insertQuery);
      const resp = await DBInsertAndReturn(insertQuery);
      // console.log(resp);
      console.log("Success");
    }

    if(empId && empName && finalArray && empCompanyId && companyName) {
      analytics.track({
        userId: String(empId),
        event: 'Claims uploaded successfully',
        context: {
          groupId: empCompanyId,
        },
        properties: {
          uploadedBy: empName,
          claims: String(finalArray.length),
          companyId: empCompanyId,
          companyName: companyName,          
        }
      })
      console.log("logged to segment successfully")
    }


    return res.json({
      success: true,
      foundError: false,
      message: `${finalArray.length} Claim ${finalArray.length === 1 ? "record was":"records were"} added successfully!`,
    });
  } catch (error) {
    return handleCatchError(error, res);
  }

}

async function bulkClaimUpload(req, res) {

  if (req.body.mode === 'optional') {
    return await optionalClaimUpload(req, res); 
  }

  try {
    console.log(req.body.data);
    const authArray = req.body?.data;
    const empId = req.body.empId;
    const empCompanyId = req.body.empCompanyId;
    const empName = req.body.empName;
    const companyName = req.body.companyName;
    console.log(empId, empCompanyId, empName, companyName)
    let def_payer_id_info = await DBSendResponse(`select payer_id from payer where payer_id IN (select payer_id from def_payer_state where payer_state IN (select state_id from settings where company_id = ${empCompanyId} and feature_id = 99))`);
    let def_payer_id = def_payer_id_info.length !== 0 ? def_payer_id_info[0].payer_id : null;

    let uniqueToIndexAndStatusMap = {}

    for(let i = 1; i < authArray.length; i+= 200) {
      let checkInDBQuery = "select priorAuth, CAST(startDate as DATE) startDate, CAST(endDate as DATE) endDate, concat_ws(':',procedureCode,replace(procedureModifierCode,'/',':')) procCode from Claim where "
      for(let j = i; j < Math.min(i + 200,authArray.length); j++) {
        const authItem = authArray[j];
        for (var item of authItem) {
          item = item.trim();
        }
        // let modifier = authItem[13] === "" ? authItem[13] : (authItem[13].replaceAll("/",":").split(":")[0] === authItem[13] ? authItem[13].match(/.{1,2}/g).join(":") : authItem[13].replaceAll("/",":"));

        let priorAuth = authItem[5], procCode = [authItem[12]].concat((authItem[13] || "").split("/")).join(":"), startDate = moment(authItem[8], "MM/DD/YYYY").format("MM/DD/YYYY"), endDate = moment(authItem[9], "MM/DD/YYYY").format("MM/DD/YYYY");
        // console.log(priorAuth,procCode,startDate,endDate);
        uniqueToIndexAndStatusMap[`${priorAuth}-${startDate}-${endDate}-${procCode}`] = false;
        checkInDBQuery += `(priorAuth = '${priorAuth}' AND CAST(startDate as DATE) = '${startDate}' AND CAST(endDate as DATE) = '${endDate}' AND concat_ws(':',procedureCode,replace(procedureModifierCode,'/',':')) = '${[procCode]}')`
        if(j !== Math.min(i+200,authArray.length) - 1) {
          checkInDBQuery += " OR "
        }
      }
      // console.log(checkInDBQuery);
      const resp = await DBSendResponse(checkInDBQuery);
      // console.log(resp);
      resp.forEach((obj) => {
        uniqueToIndexAndStatusMap[`${obj.priorAuth}-${moment(obj.startDate).utc().format("MM/DD/YYYY")}-${moment(obj.endDate).utc().format("MM/DD/YYYY")}-${obj.procCode}`] = true;
      })
      // console.log(uniqueToIndexAndStatusMap);
    }

    let finalArray = authArray.filter((authItem,index) => {
      if(index !== 0) {
        let priorAuth = authItem[5].trim(), procCode = [authItem[12].trim()].concat((authItem[13] || "").trim().split(",")).join(":"), startDate = moment(authItem[8].trim(), "MM/DD/YYYY").format("MM/DD/YYYY"), endDate = moment(authItem[9].trim(), "MM/DD/YYYY").format("MM/DD/YYYY");
        // console.log(`${priorAuth}-${startDate}-${endDate}-${procCode}`)
        return !uniqueToIndexAndStatusMap[`${priorAuth}-${startDate}-${endDate}-${procCode}`];
      }
      return false;
    })

    // console.log(finalArray);
    // console.log("here")

    let numOfRecords = finalArray.length;
    if(numOfRecords === 0) {
      return res.json({
        success: false,
        message: "No new claims were found, please edit the previously uploaded claims!",
      });
    }
    let numOfBatches = Math.ceil(numOfRecords / 100);
    console.log(numOfBatches);

    for (let i = 0; i < numOfBatches; i++) {
      let insertQuery =
        "INSERT into Claim" +
        "(uploadedBy," +
        "companyID," +
        "DDDID," +
        "FirstName," +
        "LastName," +
        "DateOfBirth," +
        "Gender," +
        "DiagnosisCode," +
        "memberMedicaid," +
        "providerMedicaid," +
        "priorAuth," +
        "procedureCode," +
        "startDate," +
        "endDate," +
        "authUnits," +
        "authAmount," +
        "errCode," +
        "errDescription," +
        "CreateDate," +
        "Status," +
        "procedureModifierCode, payerId, source" + 
        ") VALUES ";
      for (
        let j = Math.max(i * 100,0);
        j < Math.min((i + 1) * 100, finalArray.length);
        j++
      ) {
        const authItem = finalArray[j];
        for (var item of authItem) {
          item = item.trim();
        }
        // let procedureCode = authItem[12];
        // if (authItem[13]) {
        //   procedureCode += ":" + authItem[13];
        // }
        let diagnosisCode = authItem[6].toUpperCase().replaceAll(".", "");
        // let modifier = authItem[13] === "" ? authItem[13] : (authItem[13].replaceAll("/",":").split(":")[0] === authItem[13] ? authItem[13].match(/.{1,2}/g).join(":") : authItem[13].replaceAll("/",":"));
        // console.log(modifier);
        insertQuery +=
          "(" +
          `${empId}, ${empCompanyId}, '${authItem[0]}', '${authItem[1].replaceAll("'","''")}', '${
            authItem[2].replaceAll("'","''")
          }', '${moment(authItem[3], "MM/DD/YYYY").format("MM/DD/YYYY")}',` +
          `'${authItem[4]}', '${diagnosisCode}', '${authItem[7]}', '88988', '${
            authItem[5]
          }', '${String(authItem[12]).toUpperCase()}', '${moment(authItem[8], "MM/DD/YYYY").format(
            "MM/DD/YYYY"
          )}', '${moment(authItem[9], "MM/DD/YYYY").format("MM/DD/YYYY")}', ${
            authItem[11]
          }, ${authItem[10]}` +
          ", " +
          "Null" +
          ", " +
          "Null" +
          ", " +
          `'${moment().tz('America/New_York').toISOString()}'` +
          "," +
          `'Ready to Bill', ` +
          `${authItem[13] ? `'${String(authItem[13]).toUpperCase()}'` : 'Null'},` +
          `${def_payer_id ? `${def_payer_id}` : 'Null'},` + `'Bulk .csv upload'` +
          (j === (i + 1) * 100 - 1 || j === finalArray.length - 1
            ? "); SELECT SCOPE_IDENTITY();"
            : "),");
      }
      // console.log(insertQuery);
      const resp = await DBInsertAndReturn(insertQuery);
      // console.log(resp);
      console.log("Success");
    }

    if(empId && empName && finalArray && empCompanyId && companyName) {
      analytics.track({
        userId: String(empId),
        event: 'Claims uploaded successfully',
        context: {
          groupId: empCompanyId,
        },
        properties: {
          uploadedBy: empName,
          claims: String(finalArray.length),
          companyId: empCompanyId,
          companyName: companyName,          
        }
      })
      console.log("logged to segment successfully")
    }


    return res.json({
      success: true,
      foundError: false,
      message: `${finalArray.length} Claim ${finalArray.length === 1 ? "record was":"records were"} added successfully!`,
    });
  } catch (error) {
    console.log(error);
    return handleCatchError(error, res);
  }
}