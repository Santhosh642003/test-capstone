const { DBinsertSendID, DBInsertAndReturn, DBSendResponse, DBUpdate, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries')
const { generateSQLText } = require('../utils/validation');
const moment = require('moment')
const { handleCatchError } = require('../utils/helperFunction')
var { SEGMENT_API_KEY } = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })

exports.addPreAuthCSV = async function (req, res) {
  try {
    const uncleanedAuthArray = req.body?.data;
    const empId = req.body.empId;
    const empCompanyId = req.body.empCompanyId;
    const pBusinessType = req.body.pBusinessType;

    // Get unique DDDIDs from the current upload
    const uploadedDDDIDs = [...new Set(uncleanedAuthArray.map(item => item[0]))].filter(id => id); // filter removes empty strings

    const isSubsequentQuery = `
    SELECT primaryID, DDDID, priorAuth, procedureCode, startDate, endDate, authUnits, authAmount, procedureCodeModifier, isNewPlan, serviceType 
    FROM preAuth 
    WHERE companyId='${empCompanyId}' AND startDate >= '${req.body.minStartDate}' AND endDate <= '${req.body.maxEndDate}' AND DDDID in (${uploadedDDDIDs.map(id => `'${id}'`).join(',')})
  `;
    const isSubsequentUpload = await DBSendResponse(isSubsequentQuery);

    let authArray = uncleanedAuthArray;

    let deletePrimaryIDs = [];
    let currPrimaryIDs = [];

    const isSubsequentUploadMap = new Map();
    if (isSubsequentUpload.length > 0) {
      isSubsequentUpload.forEach((item) => {
        deletePrimaryIDs.push(item.primaryID);

        const key = pBusinessType !== 101
          ? `${item.DDDID}-${item.priorAuth}-${item.procedureCode + (item.procedureCodeModifier ? item.procedureCodeModifier.replaceAll(":", '') : '')}-${moment(item.startDate).utc().format("MM/DD/YYYY")}-${moment(item.endDate).utc().format("MM/DD/YYYY")}`
          : `${item.priorAuth}-${item.procedureCode + (item.procedureCodeModifier ? item.procedureCodeModifier.replaceAll(":", '') : '')}`;

        isSubsequentUploadMap.set(key, item);
      });
    }

    for (let i = 0; i < authArray.length; i += 300) {
      let updateItems = [];
      let insertItems = [];

      if (isSubsequentUpload.length > 0) {
        for (let j = i; j < Math.min(i + 300, authArray.length); j++) {
          const authItem = authArray[j];

          const key = pBusinessType !== 101
            ? `${authItem[0]}-${authItem[3]}-${authItem[4].replaceAll(":", '')}-${moment(authItem[5].trim(), "MM/DD/YYYY").format("MM/DD/YYYY")}-${moment(authItem[6].trim(), "MM/DD/YYYY").format("MM/DD/YYYY")}`
            : `${authItem[3]}-${authItem[4].replaceAll(":", '')}`;

          const authIsPresent = isSubsequentUploadMap.get(key);

          if (authIsPresent) {
            if (authItem[7] !== authIsPresent.authUnits.toString() || authItem[8] !== authIsPresent.authAmount.toString() || (authItem[11] && authItem[11] !== authIsPresent.isNewPlan) || (authItem[12] && authItem[12] !== authIsPresent.serviceType)) {
              updateItems.push([authIsPresent.primaryID].concat(authItem));
            }
            currPrimaryIDs.push(authIsPresent.primaryID);
          } else {
            insertItems.push(authItem);
          }
        }
      } else {
        insertItems = authArray.slice(i, Math.min(i + 300, authArray.length));
      }

      if (insertItems.length !== 0) {
        let insertNewQuery = 'INSERT into preAuth (uploadedBy,uploadedOn,companyId,DDDID,memberMedicaid,providerMedicaid,priorAuth,procedureCode,startDate,endDate,authUnits,authAmount,errCode,errDescription,procedureCodeModifier,isNewPlan,serviceType) Values ';

        for (let j = 0; j < insertItems.length; j++) {
          let authItem = insertItems[j];

          const procCode = authItem[4].slice(0, 5);
          const procCodeModifier = authItem[4].slice(5).replaceAll(":", '');

          insertNewQuery += `('${empId}', CURRENT_TIMESTAMP, ${empCompanyId}, '${authItem[0]}', '${authItem[1]}', '${authItem[2]}', '${authItem[3]}', '${procCode}', '${authItem[5]}', '${authItem[6]}', ${authItem[7]}, ${authItem[8]}, ${!authItem[9] || authItem[9] === 'None' ? 'null' : `'${authItem[9]}'`}, ${authItem[10] ? `'${authItem[10].replaceAll("'", "''")}'` : 'null'}, '${procCodeModifier}', ${authItem[11] ? `'${authItem[11].replaceAll("'", "''")}'` : 'null'}, ${authItem[12] ? `'${authItem[12].replaceAll("'", "''")}'` : 'null'})`;

          if (j !== insertItems.length - 1) {
            insertNewQuery += ", ";
          }
        }
        await DBSendResponse(insertNewQuery);
      }

      let finalUpdateItems = updateItems.map((item) => {
        return {
          uploadedBy: empId,
          primaryID: item[0],
          authUnits: item[8],
          authAmount: item[9],
          isNewPlan: item[12] ? item[12] : 'null',
          serviceType: item[13] ? item[13] : 'null',
        }
      })

      if (finalUpdateItems.length !== 0) {
        let updateQuery = "Update preAuth Set ";
        let colsToBeUpdated = ["uploadedBy", "uploadedOn", "authUnits", "authAmount", "isNewPlan", "serviceType"];

        for (let k = 0; k < colsToBeUpdated.length; k++) {
          let col = colsToBeUpdated[k];

          if (finalUpdateItems.filter((obj) => obj[col] !== 'null').length === 0) {
            continue;
          }

          updateQuery += col + " = Case ";
          for (let j = 0; j < finalUpdateItems.length; j++) {
            if (finalUpdateItems[j][col] === 'null') {
              continue;
            }
            updateQuery += `WHEN primaryID = ${finalUpdateItems[j]["primaryID"]} THEN ${col === "uploadedOn" ? `CURRENT_TIMESTAMP` : (col === "uploadedBy" || col === "authUnits" || col === "authAmount") ? `${finalUpdateItems[j][col]}` : `'${finalUpdateItems[j][col]}'`} `;
          }
          updateQuery += "END, ";
        }
        updateQuery = updateQuery.slice(0, -2);
        updateQuery += ` Where primaryID IN ${'(' + finalUpdateItems.map((item) => item.primaryID).join(",") + ')'}`;

        await DBUpdate(updateQuery);
      }
    }

    deletePrimaryIDs = deletePrimaryIDs.filter(val => !currPrimaryIDs.includes(val));

    if (deletePrimaryIDs.length !== 0) {
      for (let i = 0; i < deletePrimaryIDs.length; i += 300) {
        let IDsToDelete = deletePrimaryIDs.slice(i, Math.min(i + 300, deletePrimaryIDs.length));

        const updateTaskPreAuthId = `update task set tas_preAuth_id = null where tas_preAuth_id in (${IDsToDelete})`;
        await DBUpdate(updateTaskPreAuthId);

        const deleteRowsQuery = `DELETE FROM preAuth where primaryID in (${IDsToDelete})`;
        await DBUpdate(deleteRowsQuery);
      }
    }

    let companyName = req.body.companyName, empName = req.body.empName;
    if (empId && empName && uncleanedAuthArray && empCompanyId && companyName) {
      analytics.track({
        userId: String(empId),
        event: 'Prior Auth uploaded',
        context: {
          groupId: empCompanyId,
        },
        properties: {
          uploadedBy: empName,
          records: uncleanedAuthArray.length,
          companyId: empCompanyId,
          companyName: companyName,
        }
      })
      console.log("logged to segment successfully")
    }

    return res.json({
      code: 200,
      message: 'Success!',
    })
  } catch (error) {
    return handleCatchError(error, res)
  }
};

exports.addPreAuth = async function (req, res) {
  try {
    const data = {
      DDDID: generateSQLText(req.body.DDDID, 50, null),
      memberMedicaid: generateSQLText(req.body.memberMedicaid, 50, null),
      providerMedicaid: generateSQLText(req.body.providerMedicaid, 50, null),
      priorAuth: generateSQLText(req.body.priorAuth, 50, null),
      procedureCode: generateSQLText(req.body.procedureCode, 50, null),
      procedureCodeModifier: generateSQLText(req.body.procedureCodeModifier, 50, null),
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      authUnits: isNaN(parseInt(req.body.authUnits)) ? null : parseInt(req.body.authUnits),
      authAmount: isNaN(parseFloat(req.body.authAmount)) ? null : parseFloat(req.body.authAmount),
      companyId: isNaN(parseInt(req.body.companyId)) ? null : parseInt(req.body.companyId),
      uploadedBy: isNaN(parseInt(req.body.uploadedBy)) ? null : parseInt(req.body.uploadedBy),
      uploadedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
    };

    const query = generateInsertSQL('preAuth', data) + 'SELECT SCOPE_IDENTITY()'
    const newPreAuthId = await DBinsertSendID(query)

    res.status(200).json({
      id: newPreAuthId
    })
  } catch (err) {
    console.log('QUERY FAILURE | addPreAuth Query Failed:')
    console.log(err)
    res.status(400).json({
      message: 'An unexpected error occured'
    })
  }
};

exports.getpreAuth = async function (req, res) {
  if (req.query.companyID && req.query.primaryBusinessType && req.query.startDate && req.query.endDate) {
    try {
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;
      const companyID = req.query.companyID;
      const primaryBusinessType = req.query.primaryBusinessType;

      const prevMonthStart = moment(startDate).subtract(1, 'month').startOf('month').format('YYYY-MM-DD');
      const prevMonthEnd = moment(startDate).subtract(1, 'month').endOf('month').format('YYYY-MM-DD');

      if (primaryBusinessType === '101') {
        const lastMonthQuery = `
        SELECT pa.primaryID, c.cus_id 
        FROM preAuth pa 
        JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = ${companyID}
        WHERE pa.companyID = ${companyID} AND pa.startDate >= '${prevMonthStart}' AND pa.endDate <= '${prevMonthEnd} 23:59:59'`;

        let lastMonthData = await DBSendResponse(lastMonthQuery);

        const query = `
          SELECT pa.*, c.cus_id, c.DDDID, c.cus_name, c.dob, c.gender, c.DDD_tier, c.PrimaryDiagnosisCode, pro.pro_customer_id, pro.pro_id, pro.pro_primary_payer, tas_id, t.tas_title, t.tas_type, t.tas_pro_id, t.tas_start_date, t.tas_end_date, t.tas_preAuth_id, t.tas_mm_status, bn.*,
            (SELECT TOP 1 ploc_loc_id FROM projectLocation WHERE ploc_pro_id = pro.pro_id) AS project_location
          FROM preAuth pa 
          LEFT JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = ${companyID}
          LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND (pro.pro_is_active = 'True' OR (pro.pro_starts_on IS NULL OR pro.pro_ends_on IS NULL OR pro.pro_starts_on <= '1900-01-01'))
          LEFT JOIN task t ON t.tas_pro_id = pro.pro_id AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate AND ((t.tas_mm_id IS NOT NULL AND tas_mm_status = 'Approved') OR tas_title = 'Initial Plan Task') AND t.tas_billable_by_default = 'True' AND t.tas_is_active != 2
          LEFT JOIN billing_notes bn ON bn.preAuth_id = pa.primaryID
          WHERE pa.companyID = ${companyID} AND pa.startDate >= '${startDate}' AND pa.endDate <= '${endDate} 23:59:59'`;

        let preAuthData = await DBSendResponse(query);

        if (!preAuthData || !Array.isArray(preAuthData)) {
          console.error('DBSendResponse returned invalid data:', preAuthData);
          preAuthData = [];
        }

        preAuthData.forEach((item, index) => {
          item.ChargeIdentified = '-';

          const startDate = moment(item.startDate).utc();
          const endDate = moment(item.endDate).utc();
          const isFirstDateOfMonth = startDate.date() === 1;
          const isLastDateOfMonth = endDate.date() === endDate.daysInMonth();

          if (!(isFirstDateOfMonth && isLastDateOfMonth)) {
            item.ChargeIdentified = 'Partial Auth';
          }
        });

        const custDiff = preAuthData.filter(obj1 => !lastMonthData.some(obj2 => obj1.cus_id === obj2.cus_id))
          .concat(lastMonthData.filter(obj2 => !preAuthData.some(obj1 => obj2.cus_id === obj1.cus_id)));

        custDiff.forEach((obj) => {
          if (preAuthData.some(data => data.cus_id === obj.cus_id)) {
            preAuthData.map((entry) => {
              if (entry.primaryID === obj.primaryID) {
                entry.ChargeIdentified = 'Customer added';
              }
            })
          }
        })

        return res.json({
          rows: preAuthData
        });

      } else {
        const query = `
        WITH PreAuthBase AS (
          SELECT pa.*, c.cus_id, c.cus_name, c.dob, c.gender, c.DDD_tier, c.PrimaryDiagnosisCode, pro.*, bn.*,
            (
              SELECT TOP 1 dd.EntityValue
              FROM dropdowns dd
              JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
              JOIN procedure_code pc ON pc.procCode_id = tpcm.procedure_code_id AND pc.state_id = 'NJ'
              WHERE dd.CompanyID = pa.companyID AND dd.is_Active IN (0, 3) AND pc.procProcCode = pa.procedureCode AND (pa.serviceType IS NULL OR tpcm.deliveryMode = pa.serviceType)
            ) AS taskType,
            (
              SELECT t.tas_id, t.tas_type, t.tas_start_date, t.tas_end_date, t.tas_preAuth_id, el.empLocdate, el.checkoutEmpDate, pc.procUnitOfService, tpcm.deliveryMode, br.rate
              FROM task t
              JOIN dropdowns dd ON dd.EntityValue = t.tas_type AND dd.CompanyID = t.tas_com_id
              JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
              JOIN procedure_code pc ON pc.procCode_id = tpcm.procedure_code_id AND pc.state_id = 'NJ'
              JOIN empLocate el ON t.tas_id = el.taskId
              JOIN billingrates br ON br.procProcCode = pa.procedureCode AND br.tier = c.DDD_tier AND (pa.serviceType IS NULL OR br.deliveryMode = pa.serviceType)
              WHERE t.tas_pro_id = pro.pro_id 
                AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate 
                AND pa.procedureCode = pc.procProcCode 
                AND (
                  pa.serviceType IS NULL 
                  OR pa.serviceType = tpcm.deliveryMode
                )
                AND t.tas_billable_by_default = 'True' 
                AND t.tas_is_active != 2
              FOR JSON PATH
            ) AS tasksJson
          FROM preAuth pa
          LEFT JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = ${companyID}
          LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND pro.pro_is_active = 'True'
          LEFT JOIN billing_notes bn ON bn.preAuth_id = pa.primaryID
          WHERE pa.companyID = ${companyID}
            AND pa.startDate >= 
              CASE 
                WHEN pa.isNewPlan = 'Yes' 
                  THEN pa.startDate -- fetch from plan start if new plan
                ELSE ISNULL(pro.pro_starts_on, pa.startDate) -- else project start (fallback to pa.startDate if NULL)
              END
            AND pa.endDate <= '${endDate} 23:59:59'
        )
        , PreAuthWithUnits AS (
            SELECT *,
              (
                SELECT 
                  CASE 
                      WHEN COUNT(*) = 0 THEN 0
                      WHEN MAX(procUnitOfService) = '15 Minutes' THEN 
                          CASE 
                              WHEN SUM(DATEDIFF(MINUTE, t.empLocdate, t.checkoutEmpDate)) < 15 THEN 1
                              ELSE 
                                  FLOOR(SUM(DATEDIFF(MINUTE, t.empLocdate, t.checkoutEmpDate)) / 15.0) +
                                  CASE 
                                      WHEN SUM(DATEDIFF(MINUTE, t.empLocdate, t.checkoutEmpDate)) % 15 >= 7.5 THEN 1
                                      ELSE 0
                                  END
                          END
                      WHEN MAX(procUnitOfService) = '1 Hour' THEN 
                          CASE 
                              WHEN SUM(DATEDIFF(MINUTE, t.empLocdate, t.checkoutEmpDate)) < 60 THEN 1
                              ELSE 
                                  FLOOR(SUM(DATEDIFF(MINUTE, t.empLocdate, t.checkoutEmpDate)) / 60.0) +
                                  CASE 
                                      WHEN SUM(DATEDIFF(MINUTE, t.empLocdate, t.checkoutEmpDate)) % 60 >= 30 THEN 1
                                      ELSE 0
                                  END
                            END
                      ELSE COUNT(*)
                  END
                FROM OPENJSON(pb.tasksJson)
                WITH (
                  tas_id INT '$.tas_id',
                  empLocdate DATETIME2 '$.empLocdate',
                  checkoutEmpDate DATETIME2 '$.checkoutEmpDate',
                  procUnitOfService NVARCHAR(50) '$.procUnitOfService'
                ) t
                WHERE t.tas_id IS NOT NULL
              ) AS cumulativeUnits
            FROM PreAuthBase pb
        )
        , PreAuthWithRemaining AS (
            SELECT p.*, (p.authUnits - p.cumulativeUnits) AS remainingUnits
            FROM PreAuthWithUnits p
        )
        , PreAuthWithGroup AS (
            SELECT *,
              SUM(CASE WHEN isNewPlan = 'Yes' THEN 1 ELSE 0 END) OVER (
                PARTITION BY cus_id, procedureCode, ISNULL(procedureCodeModifier,'')
                ORDER BY startDate
                ROWS UNBOUNDED PRECEDING
              ) AS PlanGroup
            FROM PreAuthWithRemaining
        )
        , CumulativeCalculation AS (
          SELECT *,
            SUM(remainingUnits) OVER (
              PARTITION BY cus_id, procedureCode, ISNULL(procedureCodeModifier,''), PlanGroup
              ORDER BY startDate
              ROWS UNBOUNDED PRECEDING
            ) AS cumulativeRemainingUnits
          FROM PreAuthWithGroup
        )
        SELECT *
        FROM CumulativeCalculation
        WHERE companyID = ${companyID} AND startDate >= '${startDate}' AND endDate <= '${endDate} 23:59:59'`;

        let preAuthData = await DBSendResponse(query);

        if (!preAuthData || !Array.isArray(preAuthData)) {
          console.error('DBSendResponse returned invalid data:', preAuthData);
          preAuthData = [];
        }

        preAuthData.forEach((item, index) => {
          item.ChargeIdentified = '-';
          item.tasks = JSON.parse(item.tasksJson) || [];
          item.taskIds = (JSON.parse(item.tasksJson) || [])?.map(t => t.tas_id).join(", ");

          const startDate = moment(item.startDate).utc();
          const endDate = moment(item.endDate).utc();
          const isFirstDateOfMonth = startDate.date() === 1;
          const isLastDateOfMonth = endDate.date() === endDate.daysInMonth();

          if (!(isFirstDateOfMonth && isLastDateOfMonth)) {
            item.ChargeIdentified = 'Partial Auth';
          }
        });

        return res.json({
          rows: preAuthData
        });
      }

    } catch (error) {
      console.error('Error in preAuth lazy loading:', error);
      return res.status(500).json({
        error: 'Failed to fetch preAuth data',
        message: error.message
      });
    }
  } else {
    console.error('No valid parameters!');
    return res.json({
      rows: [],
      rowCount: 0
    });
  }

  // Traditional loading (fallback for non-lazy loading requests)
  const companyID = req.query.companyID;

  // { "primaryBusinessType": "Support Coordination", "featureValue": 101 },
  // { "primaryBusinessType": "Service Provider", "featureValue": 102 },
  const primaryBusinessType = req.query.primaryBusinessType;

  if (primaryBusinessType === '101') {
    const preAuthQuery = `SELECT pa.*, c.cus_id, c.DDDID, c.cus_name, c.dob, c.gender, c.DDD_tier, c.PrimaryDiagnosisCode, pro.pro_customer_id, pro.pro_id, pro.pro_primary_payer, tas_id, t.tas_title, t.tas_type, t.tas_pro_id, t.tas_start_date, t.tas_end_date, t.tas_preAuth_id, t.tas_mm_status,
      (SELECT TOP 1 ploc_loc_id FROM projectLocation WHERE ploc_pro_id = pro.pro_id) AS project_location
    FROM preAuth pa 
      LEFT JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = ${companyID}
      LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND (pro.pro_is_active = 'True' OR (pro.pro_starts_on IS NULL OR pro.pro_ends_on IS NULL OR pro.pro_starts_on <= '1900-01-01'))
      LEFT JOIN task t ON t.tas_pro_id = pro.pro_id AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate AND ((t.tas_mm_id IS NOT NULL AND tas_mm_status = 'Approved') OR tas_title = 'Initial Plan Task') AND t.tas_billable_by_default = 'True' AND t.tas_is_active != 2
    where companyID = ${companyID} and pa.startDate >= '${req.query.fromDate ? req.query.fromDate : moment().subtract(3, 'months').startOf("month").format('MM/DD/YYYY')}' and pa.startDate <= '${req.query.toDate ? req.query.toDate : moment().endOf("month").format('MM/DD/YYYY')}'`

    let preAuthData = await DBSendResponse(preAuthQuery)

    const custQuery = `SELECT * FROM customer c
      LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND pro.pro_is_active = 'True'
        JOIN task t ON t.tas_pro_id = pro.pro_id AND t.tas_mm_id IS NOT NULL AND t.tas_billable_by_default = 'True' and tas_type != 'Checklist' AND t.tas_is_active != 2
      LEFT JOIN preAuth pa ON c.DDDID = pa.DDDID
    WHERE c.DDDID NOT IN (
      SELECT DISTINCT pa.DDDID
      FROM preAuth pa
      WHERE companyID = ${companyID}
    )
    AND c.cus_company_id = ${companyID}`

    let custWithoutPA = await DBSendResponse(custQuery)

    preAuthData.push(...custWithoutPA)

    res.json(preAuthData);
  }
  else {
    const preAuthQuery = `SELECT *, 
    (select * 
      from task t 
      join dropdowns dd on dd.EntityValue = t.tas_type and dd.CompanyID = t.tas_com_id
      join TaskProcCodeMapping tpcm on tpcm.dropdown_id = dd.ddID
      join procedure_code pc on pc.procCode_id = tpcm.procedure_code_id AND state_id = 'NJ'
      join empLocate el on t.tas_id = el.taskId
    where t.tas_pro_id = pro.pro_id AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate AND t.tas_billable_by_default = 'True' AND t.tas_is_active != 2 for JSON PATH) as tasks
  FROM preAuth pa 
    LEFT JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = ${companyID}
    LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND pro.pro_is_active = 'True'
  where companyID = ${companyID} and pa.startDate >= '${req.query.fromDate ? req.query.fromDate : moment().subtract(3, 'months').startOf("month").format('MM/DD/YYYY')}' and pa.startDate <= '${req.query.toDate ? req.query.toDate : moment().endOf("month").format('MM/DD/YYYY')}'`

    let preAuthData = await DBSendResponse(preAuthQuery)

    preAuthData = preAuthData.map((obj) => {
      obj.tasks = JSON.parse(obj.tasks);

      console.log(obj.tasks);
      if (obj.tasks !== null) {
        obj.tasks = obj.tasks.filter((taskObj) => {
          // return taskObj.procProcCode + (taskObj.procModifierCode ? taskObj.procModifierCode.replaceAll(":", '') : '') === obj.procedureCode + (obj.procedureCodeModifier ? obj.procedureCodeModifier.replaceAll(":", '') : '');
          return taskObj.procProcCode === obj.procedureCode;
        })
      } else {
        obj.tasks = []
      }
      obj.taskIds = '';
      obj.cumulativeUnits = 0;
      obj.remainingUnits = 0;
      obj.cumulativeMinutes = 0;
      if (obj.tasks.length !== 0) {
        obj.taskIds = obj.tasks.map((e) => e.tas_id).join(", ");
        obj.cumulativeMinutes = obj.tasks.map((e) => moment(e.checkoutEmpDate).diff(moment(e.empLocdate), "m")).reduce((a, b) => a + b, 0);
        if (obj.tasks[0].procUnitOfService === '15 Minutes') {
          obj.cumulativeUnits = calculateUnits(obj.cumulativeMinutes, 15);
        }
        else if (obj.tasks[0].procUnitOfService === '1 Hour') {
          obj.cumulativeUnits = calculateUnits(obj.cumulativeMinutes, 60);
        }
        else {
          obj.cumulativeUnits = obj.tasks.length
        }
      }
      obj.remainingUnits = obj.authUnits - obj.cumulativeUnits
      return { ...obj }
    })

    preAuthData.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))

    const groupedData = {};

    preAuthData.forEach(item => {
      const key = `${item.cus_id}-${item.procedureCode + (item.procedureCodeModifier ? item.procedureCodeModifier.replaceAll(":", '') : '')}`;
      if (!groupedData[key]) {
        groupedData[key] = [];
      }
      groupedData[key].push(item);
    });

    for (const key in groupedData) {
      let prevRemainingUnits = 0;
      for (const item of groupedData[key]) {
        if (item.isNewPlan === 'Yes') {
          prevRemainingUnits = 0;
        }
        item.remainingUnits += prevRemainingUnits;
        prevRemainingUnits = item.remainingUnits;
      }
    }

    const ungroupedData = [].concat(...Object.values(groupedData));

    const monthStart = req.query.toDate ? moment(req.query.toDate, 'MM/DD/YYYY').startOf('month').format('YYYY-MM-DD') : moment().startOf('month').format('YYYY-MM-DD');
    const monthEnd = req.query.toDate ? moment(req.query.toDate, 'MM/DD/YYYY').endOf('month').format('YYYY-MM-DD') : moment().endOf('month').format('YYYY-MM-DD');

    const custQuery = `SELECT * FROM customer c
    JOIN project pro ON pro.pro_customer_id = c.cus_id AND pro.pro_is_active = 'True'
    JOIN task t ON t.tas_pro_id = pro.pro_id AND t.tas_billable_by_default = 'True' AND t.tas_is_active != 2
    JOIN dropdowns dd ON dd.EntityValue = t.tas_type and dd.CompanyID = t.tas_com_id
    JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
    JOIN procedure_code pc ON pc.procCode_id = tpcm.procedure_code_id AND state_id = 'NJ'
    JOIN empLocate el ON t.tas_id = el.taskId
  WHERE c.DDDID NOT IN (
      SELECT DISTINCT pa.DDDID
      FROM preAuth pa
      WHERE companyID = ${companyID}
    )
  AND c.cus_company_id = ${companyID}
  AND t.tas_start_date BETWEEN '${monthStart}' AND '${monthEnd}'`

    let custWithoutPA = await DBSendResponse(custQuery)

    custWithoutPA = custWithoutPA.map((obj) => {
      obj.taskIds = obj.tas_id
      obj.cumulativeUnits = 0;
      obj.remainingUnits = 0;
      obj.cumulativeMinutes = 0;

      obj.cumulativeMinutes = moment(obj.checkoutEmpDate).diff(moment(obj.empLocdate), "m");
      if (obj.procUnitOfService === '15 Minutes') {
        obj.cumulativeUnits = calculateUnits(obj.cumulativeMinutes, 15);
      }
      else if (obj.procUnitOfService === '1 Hour') {
        obj.cumulativeUnits = calculateUnits(obj.cumulativeMinutes, 60);
      }
      else {
        obj.cumulativeUnits = 1
      }
      return obj
    })

    ungroupedData.push(...custWithoutPA)

    res.json(ungroupedData);
  }
}

exports.getPreAuthTaskType = async function (req, res) {
  if (!req.query.companyID || !req.query.taskType || !req.query.fromDate || !req.query.toDate) {
    return res.json([]);
  }
  const companyID = req.query.companyID;
  try {
    const preAuthQuery = `
    SELECT pa.*, c.cus_id, procUnitOfService,
    (select el.checkoutEmpDate, el.empLocdate
      from task t 
      join empLocate el on t.tas_id = el.taskId
    where t.tas_pro_id = pro.pro_id AND t.tas_type = '${req.query.taskType}' AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate AND t.tas_billable_by_default = 'True' AND t.tas_is_active != 2 for JSON PATH) as tasks
  FROM preAuth pa 
    LEFT JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = ${companyID}
    LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND pro.pro_is_active = 'True'
    LEFT JOIN dropdowns dd on dd.EntityValue = '${req.query.taskType}' and dd.CompanyID = ${companyID}
    LEFT JOIN TaskProcCodeMapping tpcm on tpcm.dropdown_id = dd.ddID
    LEFT JOIN procedure_code pc on pc.procCode_id = tpcm.procedure_code_id AND state_id = 'NJ'
  where pa.companyID = ${companyID} and pa.startDate >= '${req.query.fromDate}' and pa.startDate <= '${req.query.toDate}' AND pa.procedureCode = procProcCode
  `;

    let preAuthData = await DBSendResponse(preAuthQuery)

    preAuthData = preAuthData.map((obj) => {
      obj.tasks = JSON.parse(obj.tasks);

      if (!obj.tasks) {
        obj.tasks = [];
      }

      obj.cumulativeUnits = 0;
      obj.remainingUnits = 0;
      obj.cumulativeMinutes = 0;
      if (obj.tasks.length !== 0) {
        obj.cumulativeMinutes = obj.tasks.map((e) => moment(e.checkoutEmpDate).diff(moment(e.empLocdate), "m")).reduce((a, b) => a + b, 0);
        if (obj.procUnitOfService === '15 Minutes') {
          obj.cumulativeUnits = calculateUnits(obj.cumulativeMinutes, 15);
        }
        else if (obj.procUnitOfService === '1 Hour') {
          obj.cumulativeUnits = calculateUnits(obj.cumulativeMinutes, 60);
        }
        else {
          obj.cumulativeUnits = obj.tasks.length
        }
      }
      obj.remainingUnits = obj.authUnits - obj.cumulativeUnits
      return { ...obj }
    })

    preAuthData.sort((a, b) => new Date(a.startDate) - new Date(b.startDate))

    const groupedData = {};

    preAuthData.forEach(item => {
      const key = `${item.cus_id}-${item.procedureCode + (item.procedureCodeModifier ? item.procedureCodeModifier.replaceAll(":", '') : '')}`;
      if (!groupedData[key]) {
        groupedData[key] = [];
      }
      groupedData[key].push(item);
    });

    for (const key in groupedData) {
      let prevRemainingUnits = 0;
      for (const item of groupedData[key]) {
        if (item.isNewPlan === 'Yes') {
          prevRemainingUnits = 0;
        }
        item.remainingUnits += prevRemainingUnits;
        prevRemainingUnits = item.remainingUnits;
      }
    }

    const ungroupedData = [].concat(...Object.values(groupedData));

    res.json(ungroupedData)
  } catch (error) {
    return handleCatchError(error, res)
  }
}

function calculateUnits(minutes, unitDuration) {
  if (minutes < unitDuration) return 1;

  const fullUnits = Math.floor(minutes / unitDuration);
  const remainder = minutes % unitDuration;

  if (remainder >= unitDuration / 2) {
    return fullUnits + 1;
  } else {
    return fullUnits;
  }
}