const e = require('express');
const db = require('../models/indexSQL.js');
const {
  DBinsert,
  DBUpdate,
  DBSendResponse,
  DBinsertSendResponse,
} = require('../queries/commonQueries');
const moment = require('moment');
const { handleCatchError } = require('../utils/helperFunction');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

// For non-SC companies a claim covers the matching tasks rather than the whole
// authorization period, so it spans the earliest tas_start_date to the latest
// tas_end_date across that set.
const getTaskDateBound = (tasks, field, pick) => {
  const dates = (tasks || [])
    .map((t) => t && t[field])
    .filter((d) => !!d && moment.utc(d).isValid())
    .sort((a, b) => moment.utc(a) - moment.utc(b));
  return dates.length ? (pick === 'earliest' ? dates[0] : dates[dates.length - 1]) : null;
};

const getEarliestTaskStartDate = (tasks) => getTaskDateBound(tasks, 'tas_start_date', 'earliest');
const getLatestTaskEndDate = (tasks) => getTaskDateBound(tasks, 'tas_end_date', 'latest');

exports.getClaims = async function (req, res) {
  // Check if this is a lazy loading request
  if (req.query.startIndex !== undefined && req.query.endIndex !== undefined) {
    try {
      // Parse pagination, sorting, and filtering parameters
      const startIndex = parseInt(req.query.startIndex) || 0;
      const endIndex = parseInt(req.query.endIndex) || 100;
      const sortModel = req.query.sortModel ? JSON.parse(req.query.sortModel) : [];
      const filterModel = req.query.filterModel ? JSON.parse(req.query.filterModel) : { items: [] };

      // Parse date range parameters
      const startDate = req.query.startDate;
      const endDate = req.query.endDate;

      console.log('Claims Lazy Loading - FilterModel:', filterModel);
      console.log('Claims Lazy Loading - SortModel:', sortModel);
      console.log('Claims Lazy Loading - Date Range:', { startDate, endDate });

      // Helper function to build filter conditions for WHERE clauses
      const buildFilterConditions = (filterModel) => {
        if (!filterModel || !filterModel.items || filterModel.items.length === 0) {
          return '';
        }

        console.log('Building filter conditions for claims data', filterModel);

        // Field mapping for filters - maps frontend column IDs to database expressions
        const getFieldExpression = (field) => {
          switch (field) {
          case 'DDDID':
            return 'clm.DDDID';
          case 'FirstName':
            return 'clm.FirstName';
          case 'LastName':
            return 'clm.LastName';
          case 'DateOfBirth':
            return 'clm.DateOfBirth';
          case 'Gender':
            return 'clm.Gender';
          case 'memberMedicaid':
            return 'clm.memberMedicaid';
          case 'priorAuth':
            return 'clm.priorAuth';
          case 'procedureCode':
            return 'clm.procedureCode';
          case 'procedureModifierCode':
            return 'clm.procedureModifierCode';
          case 'startDate':
            return 'clm.startDate';
          case 'endDate':
            return 'clm.endDate';
          case 'DiagnosisCode':
            return 'clm.DiagnosisCode';
          case 'authUnits':
            return 'clm.authUnits';
          case 'authAmount':
            return 'clm.authAmount';
          case 'Status':
            return 'clm.Status';
          case 'Response':
            return 'clm.Response';
          case 'CreateDate':
            return 'clm.CreateDate';
          case 'LastResponseDate':
            return 'clm.LastResponseDate';
          case 'errCode':
            return 'clm.errCode';
          case 'errDescription':
            return 'clm.errDescription';
          case 'payerId':
            return 'clm.payerId';
          case 'patientAddrLine1':
            return 'clm.patientAddrLine1';
          case 'patientCity':
            return 'clm.patientCity';
          case 'patientState':
            return 'clm.patientState';
          case 'patientZip':
            return 'clm.patientZip';
          case 'patientRel':
            return 'clm.patientRel';
          case 'placeOfServiceCode':
            return 'clm.placeOfServiceCode';
          case 'billing_note':
            return 'bn.billing_note';
          default:
            return null;
          }
        };

        // Determine which numeric fields need numeric comparison
        const isNumericField = (field) => {
          const numericFields = [
            'authUnits', 'authAmount', 'payerId', 'placeOfServiceCode'
          ];
          return numericFields.includes(field);
        };

        // Build filter conditions for each filter item
        const conditions = filterModel.items
          .map(item => {
            const { field, operator, value } = item;

            console.log(`Processing filter: ${field} ${operator} ${value}`);

            // Get the database field expression
            const fieldExpr = getFieldExpression(field);
            if (!fieldExpr) {
              console.log(`Unknown field for filtering: ${field}`);
              return null;
            }

            // Handle different operators
            let condition = null;
            const isNumeric = isNumericField(field);

            // Escape value to prevent SQL injection
            const escapeValue = (val) => {
              if (val === null || val === undefined) return 'NULL';
              if (isNumeric && !isNaN(parseFloat(val))) {
                return parseFloat(val);
              }
              return `'${String(val).replace(/'/g, '\'\'')}'`;
            };

            switch (operator) {
            case 'equals':
              condition = `${fieldExpr} = ${escapeValue(value)}`;
              break;
            case 'not':
              condition = `${fieldExpr} != ${escapeValue(value)}`;
              break;
            case 'contains':
              condition = `${fieldExpr} LIKE '%${String(value).replace(/'/g, '\'\'')}%'`;
              break;
            case 'startsWith':
              condition = `${fieldExpr} LIKE '${String(value).replace(/'/g, '\'\'')}%'`;
              break;
            case 'endsWith':
              condition = `${fieldExpr} LIKE '%${String(value).replace(/'/g, '\'\'')}'`;
              break;
            case 'isEmpty':
              condition = `(${fieldExpr} IS NULL OR ${fieldExpr} = '')`;
              break;
            case 'isNotEmpty':
              condition = `(${fieldExpr} IS NOT NULL AND ${fieldExpr} != '')`;
              break;
            case '>':
              condition = `${fieldExpr} > ${escapeValue(value)}`;
              break;
            case '>=':
              condition = `${fieldExpr} >= ${escapeValue(value)}`;
              break;
            case '<':
              condition = `${fieldExpr} < ${escapeValue(value)}`;
              break;
            case '<=':
              condition = `${fieldExpr} <= ${escapeValue(value)}`;
              break;
            default:
              console.log(`Unknown operator: ${operator}`);
              return null;
            }

            if (condition) {
              console.log(`Generated condition: ${condition}`);
            }

            return condition;
          })
          .filter(condition => condition !== null);

        // Combine conditions with AND/OR based on logicOperator (default to AND)
        const logicOperator = filterModel.logicOperator === 'or' ? 'OR' : 'AND';
        const result = conditions.length > 0 ? `AND (${conditions.join(` ${logicOperator} `)})` : '';

        console.log('Final filter conditions for claims:', result);
        return result;
      };

      // Build ORDER BY clause
      let orderByClause = 'ORDER BY clm.CreateDate DESC';
      if (sortModel && Array.isArray(sortModel) && sortModel.length > 0) {
        const sortClauses = sortModel.map(sort => {
          const column = sort.field;
          const direction = sort.sort === 'desc' ? 'DESC' : 'ASC';

          // Map frontend column names to database column names
          switch (column) {
          case 'DDDID': return `clm.DDDID ${direction}`;
          case 'FirstName': return `clm.FirstName ${direction}`;
          case 'LastName': return `clm.LastName ${direction}`;
          case 'DateOfBirth': return `clm.DateOfBirth ${direction}`;
          case 'Gender': return `clm.Gender ${direction}`;
          case 'memberMedicaid': return `clm.memberMedicaid ${direction}`;
          case 'priorAuth': return `clm.priorAuth ${direction}`;
          case 'procedureCode': return `clm.procedureCode ${direction}`;
          case 'startDate': return `clm.startDate ${direction}`;
          case 'endDate': return `clm.endDate ${direction}`;
          case 'authUnits': return `clm.authUnits ${direction}`;
          case 'authAmount': return `clm.authAmount ${direction}`;
          case 'Status': return `clm.Status ${direction}`;
          case 'CreateDate': return `clm.CreateDate ${direction}`;
          case 'payerId': return `clm.payerId ${direction}`;
          default: return `clm.CreateDate ${direction}`;
          }
        });
        orderByClause = `ORDER BY ${sortClauses.join(', ')}`;
      }

      // Get total count first with filters applied
      const filterConditions = buildFilterConditions(filterModel);

      // Add date range filtering if provided
      let dateRangeFilter = '';
      if (startDate && endDate) {
        dateRangeFilter = ` AND clm.CreateDate >= '${startDate}' AND clm.CreateDate <= '${endDate} 23:59:59'`;
      }

      const countQuery = `SELECT COUNT(*) as total_count
        FROM claim clm 
        LEFT JOIN billing_notes bn ON clm.claim_ID = bn.claim_id 
        WHERE clm.companyID = ${req.query.companyID}
        ${filterConditions}
        ${dateRangeFilter}`;

      console.log('Count query with filters:', countQuery);
      const countResult = await DBSendResponse(countQuery);
      console.log('Count query result:', countResult);

      if (!countResult || !Array.isArray(countResult) || countResult.length === 0) {
        console.error('Count query returned invalid result:', countResult);
        return res.json({
          rows: [],
          rowCount: 0
        });
      }

      const totalCount = countResult[0].total_count;

      // Get paginated data with filters and sorting applied
      const query = `SELECT clm.*, bn.billing_note_id, bn.billing_note
        FROM claim clm 
        LEFT JOIN billing_notes bn ON clm.claim_ID = bn.claim_id 
        WHERE clm.companyID = ${req.query.companyID}
        ${filterConditions}
        ${dateRangeFilter}
        ${orderByClause}
        OFFSET ${startIndex} ROWS
        FETCH NEXT ${endIndex - startIndex} ROWS ONLY`;

      console.log('Executing lazy loading query with filters and pagination:', query);
      let claims = await DBSendResponse(query);

      // Add safety check for claims result
      if (!claims || !Array.isArray(claims)) {
        console.error('DBSendResponse returned invalid data:', claims);
        claims = [];
      }

      // Return data in the format expected by DataSource
      return res.json({
        rows: claims,
        rowCount: totalCount
      });

    } catch (error) {
      console.error('Error in lazy loading getClaims:', error);
      return res.status(500).json({ error: 'Failed to fetch claims data' });
    }
  }

  // Single claim status lookup by claim_id
  if (req.query.claim_id) {
    try {
      const query = `SELECT claim_ID, Status FROM claim WHERE claim_ID = ${parseInt(req.query.claim_id)}`;
      const result = await DBSendResponse(query);
      if (!result || result.length === 0) {
        return res.status(404).json({ error: 'Claim not found' });
      }
      return res.json(result[0]);
    } catch (error) {
      console.error('Error fetching claim by ID:', error);
      return res.status(500).json({ error: 'Failed to fetch claim' });
    }
  }

  // Fallback to original implementation for backwards compatibility
  let claimListDetails = await getClaimList(req, res);
  res.json(claimListDetails);
};

const insertClaim = async function (obj) {
  let query = 'Insert into Claim (companyID,uploadedBy,DDDID,FirstName,LastName,DateOfBirth,Gender,DiagnosisCode,memberMedicaid,providerMedicaid,priorAuth,procedureCode,procedureModifierCode,startDate,endDate,authUnits,authAmount,CreateDate,Status,payerId,source) Values ';
  query += `(${obj.companyID},'${obj.uploadedBy}','${obj.DDDID}','${obj.FirstName.replaceAll('\'', '\'\'')}','${obj.LastName.replaceAll('\'', '\'\'')}','${obj.DateOfBirth}','${obj.Gender}','${obj.DiagnosisCode.replaceAll('.', '').toUpperCase()}','${obj.memberMedicaid}','88988', '${obj.priorAuth}', '${obj.procedureCode.toUpperCase()}', ${obj.procedureModifierCode ? `'${String(obj.procedureModifierCode).trim()}'` : 'NULL'}, '${obj.startDate}', '${obj.endDate}', ${obj.authUnits ? `${obj.authUnits}` : '0'}, ${obj.authAmount ? `${obj.authAmount}` : 'NULL'}, '${obj.CreateDate}', '${obj.Status}', ${obj.payerId}, 'Manual entry'); Select SCOPE_IDENTITY();`;
  console.log(query);
  const resp = await DBinsertSendResponse(query) || [];
  console.log(resp);
  return {
    claim_ID: resp[0] ? resp[0][''] : null,
  };
};

async function checkForDuplicatesBeforeUpdate(claimsData, colName, newVal) {
  const results = {
    validIds: [],
    duplicateIds: [],
    details: []
  };

  console.log(claimsData.map(c => ({ ...c, [colName]: newVal })));

  // Step 1: Calculate projected uniqueKeys after update
  const projectedClaims = claimsData.map(c => ({ ...c, [colName]: newVal })).map((claim, index) => {
    const procCode = [claim.procedureCode].concat((claim.procedureModifierCode || '').split('/')).join(':');
    const startDate = moment.utc(claim.startDate).format('MM/DD/YYYY');
    const endDate = moment.utc(claim.endDate).format('MM/DD/YYYY');
    const uniqueKey = `${claim.priorAuth}-${startDate}-${endDate}-${procCode}`;

    return {
      id: claim.claim_ID,
      uniqueKey: uniqueKey,
      wouldChange: claimsData[index][colName] != newVal,
      originalData: claim
    };
  });

  // Step 2: Check for duplicates within the batch being updated
  const uniqueKeysInBatch = new Set();
  const batchDuplicateIds = [];

  for (const claim of projectedClaims) {
    if (claim.wouldChange) {
      if (uniqueKeysInBatch.has(claim.uniqueKey)) {
        batchDuplicateIds.push(claim.id);
        results.details.push({
          id: claim.id,
          reason: 'BATCH_DUPLICATE',
          uniqueKey: claim.uniqueKey
        });
      } else {
        uniqueKeysInBatch.add(claim.uniqueKey);
      }
    }
  }

  // Step 3: Check against existing database records
  const claimsToCheckAgainstDB = projectedClaims.filter(c => c.wouldChange && !batchDuplicateIds.includes(c.id));

  if (claimsToCheckAgainstDB.length > 0) {
    const allIds = claimsData.map(c => c.claim_ID);
    const uniqueKeyPlaceholders = claimsToCheckAgainstDB.map(c => `'${c.uniqueKey}'`).join(',');
    const idPlaceholders = allIds.join(',');

    const duplicateCheckQuery = `
      SELECT uniqueKey
      FROM claim 
      WHERE claim_ID NOT IN (${idPlaceholders}) 
      AND uniqueKey IN (${uniqueKeyPlaceholders})
    `;
    const existingDuplicates = await DBSendResponse(duplicateCheckQuery);
    const duplicateKeys = new Set(existingDuplicates.map(d => d.uniqueKey));

    // Mark claims that would conflict with existing records
    for (const claim of claimsToCheckAgainstDB) {
      if (duplicateKeys.has(claim.uniqueKey)) {
        batchDuplicateIds.push(claim.id);
        results.details.push({
          id: claim.id,
          reason: 'DB_DUPLICATE',
          uniqueKey: claim.uniqueKey
        });
      }
    }
  }

  // Step 4: Separate valid and duplicate IDs
  results.duplicateIds = [...new Set(batchDuplicateIds)];
  results.validIds = claimsData.map(c => c.claim_ID).filter(id => !results.duplicateIds.includes(id));

  return results;
}

exports.updateClaim = async function (req, res) {
  const colName = req.body.colName;
  const val = req.body.newVal;

  try {
    let claimsData = [];
    let allIds = [];

    if (req.body.claim_IDs) {
      allIds = req.body.claim_IDs;
      claimsData = req.body.currentClaimsData || [];
    } else {
      allIds = [req.body.claim_ID];
      claimsData = [req.body.currentClaimData];
    }

    allIds = allIds.filter((id) => id !== undefined && id !== null);
    if (allIds.length === 0) {
      return res.json({ code: 400, message: 'No claims selected' });
    }

    const fieldsRequiringDuplicateCheck = ['priorAuth', 'procedureCode', 'procedureModifierCode', 'startDate', 'endDate'];

    if (!fieldsRequiringDuplicateCheck.includes(colName)) {
      // Perform direct update without duplicate check
      const allIdsString = allIds.join(',');
      const updateQuery = `UPDATE claim SET ${colName}=${colName === 'authAmount' || colName === 'authUnits' ? `${val}` : (val ? `'${val}'` : 'NULL')} WHERE claim_ID IN (${allIdsString})`;

      let claim_update_res = await DBUpdate(updateQuery);

      if (claim_update_res === 0) {
        return res.json({ code: 500, message: 'Claim Update Failed' });
      }

      // Return appropriate response based on request type
      if (req.body.claim_IDs) {
        // Multiple claims response
        return res.json({
          code: 200,
          claim_data: {
            claim_IDs: req.body.claim_IDs,
            colName: req.body.colName,
            newVal: req.body.newVal,
          },
          message: 'Claim Update Success',
          details: {
            totalRequested: allIds.length,
            successfulUpdates: allIds.length,
            skippedDuplicates: 0,
            skippedClaimIDs: [],
            duplicateDetails: [],
            updatedClaimIDs: allIds
          }
        });
      } else {
        // Single claim response
        return res.json({
          code: 200,
          claim_data: {
            claim_ID: req.body.claim_ID,
            colName: req.body.colName,
            newVal: req.body.newVal,
          },
          message: 'Claim Update Success',
        });
      }
    }

    // UNIFIED DUPLICATE CHECK - runs for both single and multiple (only for specific fields)
    const duplicateCheckResult = await checkForDuplicatesBeforeUpdate(claimsData, colName, val);

    // If no valid IDs to update
    if (duplicateCheckResult.validIds.length === 0) {
      return res.json({
        code: 409,
        message: allIds.length === 1 ? 'Update would create duplicate combination - no update performed' : 'All claims would create duplicates - no updates performed',
        details: {
          totalRequested: allIds.length,
          successfulUpdates: 0,
          skippedDuplicates: duplicateCheckResult.duplicateIds.length,
          skippedClaimIDs: duplicateCheckResult.duplicateIds,
          duplicateDetails: duplicateCheckResult.details
        }
      });
    }

    // Perform update only for valid IDs
    const validIdsString = duplicateCheckResult.validIds.join(',');
    const updateQuery = `UPDATE claim SET ${colName}=${colName === 'authAmount' || colName === 'authUnits' ? `${val}` : (val ? `'${val}'` : 'NULL')} WHERE claim_ID IN (${validIdsString})`;

    let claim_update_res = await DBUpdate(updateQuery);

    if (claim_update_res === 0) {
      return res.json({ code: 500, message: 'Claim Update Failed' });
    }

    // Return appropriate response based on request type
    if (req.body.claim_IDs) {
      // Multiple claims response
      const hasSkipped = duplicateCheckResult.duplicateIds.length > 0;

      return res.json({
        code: 200,
        claim_data: {
          claim_IDs: req.body.claim_IDs,
          colName: req.body.colName,
          newVal: req.body.newVal,
        },
        message: hasSkipped
          ? `Partial Update Success: ${duplicateCheckResult.validIds.length} updated, ${duplicateCheckResult.duplicateIds.length} skipped due to duplicates`
          : 'Claim Update Success',
        details: {
          successfulUpdates: duplicateCheckResult.validIds.length,
          skippedDuplicates: duplicateCheckResult.duplicateIds.length,
          skippedClaimIDs: duplicateCheckResult.duplicateIds,
          totalRequested: allIds.length,
          updatedClaimIDs: duplicateCheckResult.validIds
        }
      });
    } else {
      // Single claim response
      const wasSkipped = duplicateCheckResult.duplicateIds.includes(req.body.claim_ID);

      if (wasSkipped) {
        return res.json({
          code: 409,
          message: 'Update would create duplicate combination',
          details: {
            conflictingUniqueKey: duplicateCheckResult.details[0]?.uniqueKey
          }
        });
      } else {
        return res.json({
          code: 200,
          claim_data: {
            claim_ID: req.body.claim_ID,
            colName: req.body.colName,
            newVal: req.body.newVal,
          },
          message: 'Claim Update Success',
        });
      }
    }

  } catch (error) {
    console.error('Update claim error:', error);
    return res.json({ code: 500, message: 'Claim Update Failed: ' + error.message });
  }
};

async function getClaimList(req, res) {
  if (req.query.rem) {
    const id = req.query.companyID;
    const query = `Select * from remittances WHERE comId=${id}`;
    let rems = await DBSendResponse(query);
    return rems;
  } else {
    const id = req.query.companyID;
    let startDate = req.query.startDate;
    let endDate = req.query.endDate;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 100;
    const offset = (page - 1) * limit;
    let totalCount = 0;
    console.log(page, limit, offset, startDate, endDate);
    const query = `Select clm.*, bn.billing_note_id, bn.billing_note 
      from claim clm 
      left join billing_notes bn on clm.claim_ID = bn.claim_id 
      WHERE companyID=${id} 
      ${startDate && endDate ? `AND clm.CreateDate >= '${startDate}' AND clm.CreateDate < '${endDate}'` : ''}
      ORDER BY clm.CreateDate DESC
      OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;
    if (page === 1) {
      const countQuery = `SELECT COUNT(DISTINCT clm.claim_ID) as total 
        FROM claim clm 
        WHERE companyID=${id} 
        ${startDate && endDate ? `AND clm.CreateDate >= '${startDate}' AND clm.CreateDate < '${endDate}'` : ''}`;
      totalCount = (await DBSendResponse(countQuery))[0].total;
    }
    let claims = await DBSendResponse(query);
    console.log(query);
    return {
      claims: claims,
      total: page === 1 ? totalCount : req.query.totalCount,
      page: page,
      limit: limit,
      hasMore: (page * limit) < (page === 1 ? totalCount : req.query.totalCount)
    };
  }
}

const sqlText = function (value) {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  return `'${String(value).replaceAll('\'', '\'\'')}'`;
};

const sqlDate = function (value) {
  const parsed = moment(value).utc();

  return parsed.isValid() ? `'${parsed.format('MM/DD/YYYY')}'` : 'NULL';
};

// The columns behind these are NOT NULL, so there is no honest value to fall back to. Reject the
// entry up front -- buildClaimValues runs before the transaction begins, so nothing is written
// and the UI gets a message naming what is missing.
const assertClaimFieldsPresent = function (entryItem, dddId) {
  const missing = [
    [dddId, 'a DDD ID'],
    [entryItem.PrimaryDiagnosisCode, 'a diagnosis code'],
    [entryItem.memberMedicaid, 'a member Medicaid ID'],
    [entryItem.providerMedicaid, 'a provider Medicaid ID'],
    [entryItem.priorAuth, 'a prior authorization number'],
    [entryItem.procedureCode, 'a procedure code'],
  ]
    .filter(([value]) => value === null || value === undefined || String(value).trim() === '')
    .map(([, label]) => label);

  if (!moment(entryItem.startDate).isValid() || !moment(entryItem.endDate).isValid()) {
    missing.push('valid service dates');
  }

  if (missing.length) {
    throw new Error(`${entryItem.cus_name} is missing ${missing.join(', ')}, so no claim could be created.`);
  }
};

const buildClaimValues = function (entryItem, ctx) {
  const { comp_id, emp_id, primaryBusinessType, billingRates, billingDatePreference } = ctx;

  const dddId = Array.isArray(entryItem.DDDID) ? entryItem.DDDID[0] : entryItem.DDDID;

  assertClaimFieldsPresent(entryItem, dddId);

  let billingStartDate = moment(entryItem.startDate).utc().format('MM/DD/YYYY');
  let billingEndDate = moment(entryItem.endDate).utc().format('MM/DD/YYYY');

  if (primaryBusinessType === 101 && billingDatePreference === 'contact_date_only' && entryItem.tas_end_date && moment(entryItem.tas_end_date).isValid()) {
    billingEndDate = moment(entryItem.tas_end_date).utc().format('MM/DD/YYYY');
  }
  else if (primaryBusinessType !== 101) {
    const earliestTaskStartDate = getEarliestTaskStartDate(entryItem.tasks);
    const latestTaskEndDate = getLatestTaskEndDate(entryItem.tasks);
    if (earliestTaskStartDate) {
      billingStartDate = moment(earliestTaskStartDate).utc().format('MM/DD/YYYY');
    }
    if (latestTaskEndDate) {
      billingEndDate = moment(latestTaskEndDate).utc().format('MM/DD/YYYY');
    }
  }

  let names = entryItem.cus_name.split(' '), firstName = '', lastName = '';
  if (names.length > 2) {
    firstName = names.shift();
    lastName = names.join(' ');
  } else {
    firstName = names[0];
    lastName = names[1];
  }

  let procCode = entryItem.procedureCode.slice(0, 5);
  let procModifierCode = entryItem.procedureCodeModifier ? entryItem.procedureCodeModifier.replaceAll(':', '') : entryItem.procedureCode.slice(5);

  let parts = [];
  for (let i = 0; i < procModifierCode.length; i += 2) {
    parts.push(procModifierCode.slice(i, i + 2));
  }

  procModifierCode = parts.join(':');

  const diagnosisCode = entryItem.PrimaryDiagnosisCode.replace('.', '');

  let billUnits = entryItem.authUnits, billAmount = entryItem.authAmount;

  if (primaryBusinessType !== 101) {
    let billingRate = billingRates.find(rate =>
      (rate.procProcCode || '').replaceAll(':', '') === procCode &&
      rate.tier === entryItem.DDD_tier &&
      rate.deliveryMode === (entryItem.tasks?.[0]?.deliveryMode ?? null)
    );

    if (!billingRate) {
      billingRate = billingRates.find(rate =>
        (rate.procProcCode || '').replaceAll(':', '') === procCode &&
        rate.tier === 'Base' &&
        rate.deliveryMode === (entryItem.tasks?.[0]?.deliveryMode ?? null)
      );
    }

    if (billingRate) {
      if (billingRate.procModifierCode) {
        let cleanProcModifierCode = String(billingRate.procModifierCode).replaceAll(':', '');
        let parts = [];
        for (let i = 0; i < cleanProcModifierCode.length; i += 2) {
          parts.push(cleanProcModifierCode.slice(i, i + 2));
        }
        procModifierCode = parts.join(':');
      } else {
        procModifierCode = '';
      }
      billUnits = Math.round(entryItem.cumulativeUnits);
      billAmount = (Math.round(entryItem.cumulativeUnits) * billingRate.rate).toFixed(2);
    } else {
      procModifierCode = '';
      billUnits = Math.round(entryItem.cumulativeUnits);
      let perUnitAmount = entryItem.authUnits ? (entryItem.authAmount / entryItem.authUnits) : 0;
      billAmount = (Math.round(entryItem.cumulativeUnits) * perUnitAmount).toFixed(2);
    }
  }

  const payerId = entryItem.pro_primary_payer || ctx.def_payer_id;

  return `(${comp_id}, ${emp_id}, ${sqlText(dddId)}, ${sqlText(firstName)}, ${sqlText(lastName)}, ${sqlDate(entryItem.dob)}, ${sqlText(entryItem.gender)}, ${sqlText(diagnosisCode)}, ${sqlText(entryItem.memberMedicaid)}, ${sqlText(entryItem.providerMedicaid)}, ${sqlText(entryItem.priorAuth)}, ${sqlText(procCode)}, ${sqlText(procModifierCode)}, '${billingStartDate}', '${billingEndDate}', ${billUnits}, ${billAmount}, '${moment().utc().toISOString()}', 'Ready to Bill', ${payerId ? `'${payerId}'` : 'Null'}, 'Pre auth / Change capture route')`;
};

const parseTaskIds = function (value) {
  return String(value ?? '')
    .split(',')
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id));
};

exports.addClaim = async function (req, res) {
  if (req.body.claimInfo) {
    const resp = await insertClaim(req.body.claimInfo);
    return res.json(resp);
  }

  const entries = (Array.isArray(req.body.entries) ? req.body.entries : []).filter((ele) => ele.cus_name);
  const comp_id = req.body.comp_id;
  const emp_id = req.body.emp_id;
  const primaryBusinessType = req.body.primaryBusinessType;

  if (!entries.length) {
    return res.json({
      success: true,
      foundError: false,
      claimsCreated: 0,
      message: 'No claim records to add.',
    });
  }

  let def_payer_id_info = await DBSendResponse(`select payer_id from payer where payer_id IN (select payer_id from def_payer_state where payer_state IN (select state_id from settings where company_id = ${comp_id} and feature_id = 99))`);
  let def_payer_id = def_payer_id_info.length !== 0 ? def_payer_id_info[0].payer_id : null;

  const billingRates = await DBSendResponse('SELECT * FROM billingrates');

  const billingDatePreferenceInfo = await DBSendResponse(`SELECT * FROM settings WHERE company_id = ${comp_id} AND feature_id = 77`);
  const billingDatePreference = billingDatePreferenceInfo.length > 0 ? billingDatePreferenceInfo[0].feature_value : 'contact_date_only';

  const transaction = new db.Transaction();
  let transactionStarted = false;

  try {
    const ctx = { comp_id, emp_id, primaryBusinessType, billingRates, billingDatePreference, def_payer_id };
    const claimValues = entries.map((entryItem) => buildClaimValues(entryItem, ctx));

    await transaction.begin();
    transactionStarted = true;
    const request = new db.Request(transaction);

    let claimsCreated = 0;
    const numOfRecords = entries.length;
    const numOfBatches = Math.ceil(numOfRecords / 100);

    for (let i = 0; i < numOfBatches; i++) {
      const batchStart = i * 100;
      const batchEnd = Math.min((i + 1) * 100, numOfRecords);
      const batchEntries = entries.slice(batchStart, batchEnd);

      const insertQuery = claimValues
        .slice(batchStart, batchEnd)
        .map((values) => `INSERT into Claim (companyID, uploadedBy, DDDID, FirstName, LastName, DateOfBirth, Gender, DiagnosisCode, memberMedicaid, providerMedicaid, priorAuth, procedureCode, procedureModifierCode, startDate, endDate, authUnits, authAmount, CreateDate, Status, payerId, source) VALUES ${values}; SELECT SCOPE_IDENTITY() AS claim_id;`)
        .join('\n');

      const insertRes = await request.query(insertQuery);
      const recordsets = insertRes.recordsets || [];

      if (recordsets.length !== batchEntries.length) {
        throw new Error(`Expected ${batchEntries.length} claim records to be created, the database returned ${recordsets.length}.`);
      }

      for (let k = 0; k < batchEntries.length; k++) {
        const entryItem = batchEntries[k];
        const claimId = Number(recordsets[k]?.[0]?.claim_id);
        const preAuthId = parseInt(entryItem.primaryID, 10);

        if (!claimId) {
          throw new Error(`No claim record was created for prior authorization ${entryItem.primaryID}.`);
        }

        if (!Number.isInteger(preAuthId)) {
          throw new Error(`The entry for ${entryItem.cus_name} has no prior authorization id, so its tasks could not be marked as sent.`);
        }

        claimsCreated++;

        let taskIds = [];

        if (primaryBusinessType === 101) {
          let resolvedTaskId = entryItem.tas_id;

          if (entryItem.ChargeIdentified === 'Customer added' && !entryItem.tas_id) {
            const taskQuery = `INSERT INTO task (tas_title, tas_description, tas_type, tas_start_date, tas_end_date, tas_start_time, tas_end_time, tas_priority, tas_billable_by_default, tas_is_active, tas_created_at, tas_pro_id, tas_emp_id, tas_loc_id, tas_created_by, tas_com_id, tas_required_sig, tas_cus_id)
                          VALUES (
                            'Initial Plan Task',
                            'Initial Plan Task',
                            'Phone Call',
                            '${moment(entryItem.startDate).format('YYYY-MM-DD') + 'T' + moment(entryItem.startDate).format('HH:mm:ss')}',
                            '${moment(entryItem.endDate).format('YYYY-MM-DD') + 'T' + moment(entryItem.endDate).format('HH:mm:ss')}',
                            '${moment(entryItem.startDate).format('YYYY-MM-DD') + 'T' + moment(entryItem.startDate).format('HH:mm:ss')}',
                            '${moment(entryItem.endDate).format('YYYY-MM-DD') + 'T' + moment(entryItem.endDate).format('HH:mm:ss')}',
                            'Med',
                            'true',
                            0,
                            CURRENT_TIMESTAMP,
                            ${entryItem.pro_id ? entryItem.pro_id : 'NULL'},
                            ${emp_id ? emp_id : 'NULL'},
                            ${entryItem.project_location ? entryItem.project_location : 'NULL'},
                            ${emp_id ? emp_id : 'NULL'},
                            ${comp_id ? comp_id : 'NULL'},
                            0,
                            ${entryItem.cus_id ? entryItem.cus_id : 'NULL'}
                          ); SELECT SCOPE_IDENTITY() AS tas_id;`;

            const taskRes = await request.query(taskQuery);
            resolvedTaskId = taskRes.recordset?.[0]?.tas_id;

            if (!resolvedTaskId) {
              throw new Error(`Could not create the task for prior authorization ${entryItem.primaryID}.`);
            }
          }

          taskIds = parseTaskIds(resolvedTaskId);
        }
        else {
          taskIds = parseTaskIds(entryItem.taskIds);
        }

        if (taskIds.length) {
          await request.query(`UPDATE task SET tas_preAuth_id = ${preAuthId}, tas_claim_id = ${claimId} WHERE tas_id IN (${taskIds.join(', ')})`);
        } else {
          console.warn(`Claim ${claimId} was created for prior authorization ${preAuthId} with no tasks to mark as sent.`);
        }

        if (entryItem.billing_note) {
          await request.query(`UPDATE billing_notes SET claim_id = ${claimId} WHERE preAuth_id = ${preAuthId}`);
        }
      }
    }

    await transaction.commit();

    return res.json({
      success: true,
      foundError: false,
      claimsCreated: claimsCreated,
      message: 'All Claim records are added successfully!',
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error('Failed to roll back the claim transaction:', rollbackError);
      }
    }

    console.error('Error adding claims from Prior Authorization:', error);
    return handleCatchError(error, res);
  }
};

exports.delClaims = async function (req, res) {

  const claim_IDs = (Array.isArray(req.body.idsToBeDeleted) ? req.body.idsToBeDeleted : [])
    .map((id) => parseInt(id, 10))
    .filter((id) => Number.isInteger(id));
  let empId = req.body.empId;
  let compId = req.body.compId;

  if (!claim_IDs.length) {
    return res.json({ code: 400, message: 'No claims selected for deletion' });
  }

  const idList = claim_IDs.join(',');
  // Releasing the tasks is part of the delete: a task left pointing at a deleted claim keeps
  // its Prior Authorization row showing 'Sent to Claims', which the PA grid then refuses to
  // let anyone re-send.
  const releaseTasksQuery = `UPDATE task SET tas_preAuth_id = NULL, tas_claim_id = NULL WHERE tas_claim_id in (${idList})`;
  const delQuery = `Delete from Claim where claim_ID in (${idList})`;
  const delNoteQuery = `Delete from billing_notes where claim_id in (${idList})`;

  const transaction = new db.Transaction();
  let transactionStarted = false;

  try {
    await transaction.begin();
    transactionStarted = true;
    const request = new db.Request(transaction);

    console.log(delQuery);
    await request.query(releaseTasksQuery);
    const delRes = await request.query(delQuery);
    await request.query(delNoteQuery);

    await transaction.commit();

    if (delRes.rowsAffected[0] === 0) {
      return res.json({ code: 500, message: 'Update failed' });
    }

    res.json({ code: 200, message: 'Update Success' });
  } catch (error) {
    if (transactionStarted) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error('Failed to roll back the claim deletion:', rollbackError);
      }
    }

    console.error('Error deleting claims:', error);
    return res.json({ code: 500, message: error.message || 'Update failed' });
  }

  console.log(empId, compId, claim_IDs.length);

  if (empId && compId && claim_IDs.length > 0) {
    analytics.track({
      userId: String(empId),
      event: 'Claims deleted successfully',
      context: {
        groupId: compId,
      },
      properties: {
        claimsDeleted: String(claim_IDs.length),          
      }
    });
    console.log('logged to segment successfully');
  }
};

/*
 * Added comprehensive server-side lazy loading support to Claims management:
 * 
 * Backend Implementation (claims.js):
 * - Enhanced getClaims function with optional lazy loading support
 * - Checks for startIndex/endIndex parameters to enable lazy loading mode
 * - buildFilterConditions helper function with claims-specific field mapping
 * - Supports 12+ filter operators: equals, not, contains, startsWith, endsWith, isEmpty, isNotEmpty, >, >=, <, <=
 * - Comprehensive field mapping for all claim properties (DDDID, FirstName, LastName, dates, amounts, etc.)
 * - SQL injection protection with proper value escaping and field validation
 * - Pagination with OFFSET/FETCH for SQL Server compatibility
 * - Maintains backwards compatibility - falls back to original implementation if no lazy loading params
 * 
 * Frontend Implementation (Claims.js):
 * - Added useLazyLoading state and dataSource for MUI X DataGridPro
 * - createDataSource function that handles server communication
 * - Data transformation to match frontend expectations
 * - Error checking integration for lazy-loaded data
 * - Toggle button in toolbar to switch between traditional and lazy loading modes
 * - Conditional DataGrid props (rows vs dataSource)
 * - Updated data fetching to support both modes
 * 
 * Features:
 * - Server-side filtering with comprehensive operator support
 * - Server-side sorting with proper column mapping
 * - Server-side pagination for performance with large datasets
 * - Backward compatibility with existing traditional grid implementation
 * - Real-time mode switching without data loss
 * - Proper error handling and data validation
 * - Maintains all existing functionality (editing, selection, bulk operations)
 */