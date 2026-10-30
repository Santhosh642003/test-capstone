const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries.js');
const { addNotif } = require('./notifications.js');
const { isActualText, parseSQLText, generateSQLText } = require('../utils/validation.js');


exports.getTimeSheet = async function (req, res) {
  let query = '';
  if(req.query.time_sheet_id){
    query = `SELECT time_sheet.*, pay_period.start_date, pay_period.end_date 
         FROM time_sheet 
         LEFT JOIN pay_period ON time_sheet.pay_period_id = pay_period.pay_period_id
         WHERE time_sheet.time_sheet_id = ${req.query.time_sheet_id}`;
  } else if (req.query.employee_id) {
    query = `SELECT time_sheet.*, pay_period.start_date, pay_period.end_date 
         FROM time_sheet 
         LEFT JOIN pay_period ON time_sheet.pay_period_id = pay_period.pay_period_id
         WHERE time_sheet.emp_id = ${req.query.employee_id}`;
  } else if (req.query.company_id) {
    query = `SELECT time_sheet.*, pay_period.start_date, pay_period.end_date 
         FROM time_sheet 
         LEFT JOIN pay_period ON time_sheet.pay_period_id = pay_period.pay_period_id
         WHERE time_sheet.company_id = ${req.query.company_id}`;
  } else {
    res.status(400).send('missing required parameters');
    return;
  }

  if(req.query.pay_period_id){
    query += ` AND pay_period_id = ${req.query.pay_period_id}`;
  }

  const queryResult = await DBSendResponse(query);
  res.json(queryResult);
};
exports.createTimeSheet = async function (req, res) {

};
exports.updateTimeSheet = async function (req, res) {

};
exports.deleteTimeSheet = async function (req, res) {

};

exports.getTimeSheetSummary = async function (req, res) {
  const start = performance.now();
  try {
    const { pay_period_id, company_id, startIndex, endIndex, sortModel, filterModel, pageSize, paginationModel } = req.query;

    // Check if pay_period_id and company_id are provided
    if (!pay_period_id || !company_id) {
      res.status(400).json({ error: 'Missing required query parameters: pay_period_id and company_id' });
      return;
    }

    // Parse paginationModel if provided
    let parsedPaginationModel = null;
    if (paginationModel) {
      try {
        parsedPaginationModel = JSON.parse(paginationModel);
        console.log('Parsed paginationModel:', parsedPaginationModel);
      } catch (e) {
        console.error('Error parsing paginationModel:', e);
      }
    }

    // Validate and set page size limits for security
    let validatedPageSize = 50; // default
    
    // Priority order: paginationModel.pageSize > pageSize parameter > default
    if (parsedPaginationModel && parsedPaginationModel.pageSize) {
      const pageSizeNum = parseInt(parsedPaginationModel.pageSize);
      if (pageSizeNum > 0 && pageSizeNum <= 1000) { // Max 1000 rows per page for security
        validatedPageSize = pageSizeNum;
        console.log('Using pageSize from paginationModel:', validatedPageSize);
      }
    } else if (pageSize) {
      const pageSizeNum = parseInt(pageSize);
      if (pageSizeNum > 0 && pageSizeNum <= 1000) { // Max 1000 rows per page for security
        validatedPageSize = pageSizeNum;
        console.log('Using pageSize parameter:', validatedPageSize);
      }
    }

    // Check if this is a lazy loading request, if not provide default pagination
    let startNum = 0;
    let endNum = validatedPageSize;
    
    if (startIndex !== undefined && endIndex !== undefined) {
      startNum = parseInt(startIndex);
      endNum = parseInt(endIndex);
    }
    
    const calculatedPageSize = endNum - startNum;
    
    // Ensure page size doesn't exceed security limits
    if (calculatedPageSize > 1000) {
      res.status(400).json({ error: 'Page size exceeds maximum allowed limit of 1000 rows' });
      return;
    }
    
    // Parse sort model if provided with enhanced multi-field sorting support
    // Supports sorting by frontend column IDs: id, timesheet_id, employee_name, total_hours, timesheet_status, submitted_on
    let orderByClause = 'ORDER BY CONCAT(employee.emp_first_name, \' \', employee.emp_last_name) ASC';
    if (sortModel) {
      try {
        const parsedSortModel = JSON.parse(sortModel);
        console.log('Parsed sortModel:', parsedSortModel);
        
        if (parsedSortModel && parsedSortModel.length > 0) {
          // Map frontend field names (column IDs) to actual database column expressions
          // Frontend Column ID -> Backend DB Expression mapping:
          // 'id' -> 'employee.emp_id' (frontend maps: id: row.emp_id)
          // 'timesheet_id' -> 'time_sheet.time_sheet_id' (frontend maps: timesheet_id: row.time_sheet_id)
          // 'employee_name' -> calculated name (frontend maps: employee_name: row.employee_name)
          // 'total_hours' -> calculated hours (frontend maps: total_hours: row.total_hours)
          // 'timesheet_status' -> 'time_sheet.time_sheet_status' (frontend maps: timesheet_status: row.time_sheet_status)
          // 'submitted_on' -> 'time_sheet.submitted_on' (frontend maps: submitted_on: row.submitted_on)
          const fieldMapping = {
            'id': 'employee.emp_id',                    // Frontend: 'id' -> Backend: emp_id
            'timesheet_id': 'time_sheet.time_sheet_id', // Frontend: 'timesheet_id' -> Backend: time_sheet_id
            'employee_name': 'CONCAT(employee.emp_first_name, \' \', employee.emp_last_name)', // Frontend: 'employee_name' -> Backend: concatenated name
            'total_hours': 'ISNULL((SELECT SUM(DATEDIFF(second, empLocate.empLocDate, empLocate.checkoutEmpDate) / 3600.0) FROM task INNER JOIN empLocate ON task.tas_id = empLocate.taskId INNER JOIN pay_period ON empLocate.empLocDate BETWEEN pay_period.start_date AND DATEADD(day, 1, pay_period.end_date) WHERE pay_period.pay_period_id = ' + pay_period_id + ' AND task.tas_com_id = ' + company_id + ' AND task.tas_is_active != 2 AND task.tas_emp_id = employee.emp_id), 0)', // Frontend: 'total_hours' -> Backend: calculated hours
            'timesheet_status': 'time_sheet.time_sheet_status', // Frontend: 'timesheet_status' -> Backend: time_sheet_status
            'submitted_on': 'time_sheet.submitted_on'   // Frontend: 'submitted_on' -> Backend: submitted_on
          };
          
          // Build ORDER BY clause for multiple sort fields
          const orderByParts = parsedSortModel
            .filter(sort => {
              if (!fieldMapping[sort.field]) {
                console.log(`Warning: Invalid sort field '${sort.field}' ignored`);
                return false;
              }
              return true;
            })
            .map(sort => {
              let direction = (sort.sort || 'asc').toUpperCase();
              // Validate direction
              if (!['ASC', 'DESC'].includes(direction)) {
                console.log(`Warning: Invalid sort direction '${direction}' for field '${sort.field}', defaulting to ASC`);
                direction = 'ASC';
              }
              const fieldExpression = fieldMapping[sort.field];
              console.log(`Applying sort: ${sort.field} -> ${fieldExpression} ${direction}`);
              return `${fieldExpression} ${direction}`;
            });
          
          if (orderByParts.length > 0) {
            orderByClause = `ORDER BY ${orderByParts.join(', ')}, CONCAT(employee.emp_first_name, ' ', employee.emp_last_name) ASC`;
            console.log('Final ORDER BY clause:', orderByClause);
          } else {
            console.log('No valid sort fields found, using default sort by employee name');
          }
        }
      } catch (e) {
        console.log('Error parsing sortModel:', e);
      }
    }

    // Parse filter model if provided with comprehensive filtering support
    // Supports filtering on frontend column IDs: id, timesheet_id, employee_name, total_hours, timesheet_status, submitted_on
    // Supported operators: equals, not, contains, startsWith, endsWith, isEmpty, isNotEmpty, >, >=, <, <=
    // Handles both string and numeric fields with proper SQL formatting
    let additionalWhereClause = '';
    if (filterModel) {
      try {
        const parsedFilterModel = JSON.parse(filterModel);
        console.log('Parsed filterModel:', parsedFilterModel);
        
        if (parsedFilterModel && parsedFilterModel.items && parsedFilterModel.items.length > 0) {
          // Map frontend field names to database column expressions for filtering
          const filterFieldMapping = {
            'id': 'employee.emp_id',
            'timesheet_id': 'time_sheet.time_sheet_id',
            'employee_name': 'CONCAT(employee.emp_first_name, \' \', employee.emp_last_name)',
            'total_hours': 'ISNULL((SELECT SUM(DATEDIFF(millisecond, empLocate.empLocDate, empLocate.checkoutEmpDate) / 3600000.0) FROM task INNER JOIN empLocate ON task.tas_id = empLocate.taskId INNER JOIN pay_period ON empLocate.empLocDate BETWEEN pay_period.start_date AND DATEADD(day, 1, pay_period.end_date) WHERE pay_period.pay_period_id = ' + pay_period_id + ' AND task.tas_com_id = ' + company_id + ' AND task.tas_is_active != 2 AND task.tas_emp_id = employee.emp_id), 0)',
            'timesheet_status': 'time_sheet.time_sheet_status',
            'submitted_on': 'time_sheet.submitted_on'
          };
          
          const filterConditions = parsedFilterModel.items
            .filter(filter => {
              if (!filterFieldMapping[filter.field]) {
                console.log(`Warning: Invalid filter field '${filter.field}' ignored`);
                return false;
              }
              return true;
            })
            .map(filter => {
              const fieldExpression = filterFieldMapping[filter.field];
              const operator = filter.operator || 'contains';
              const value = filter.value;
              
              console.log(`Applying filter: ${filter.field} ${operator} '${value}'`);
              
              // Determine if the field is numeric for proper SQL formatting
              const numericFields = ['id', 'total_hours', 'timesheet_id'];
              const isNumericField = numericFields.includes(filter.field);
              const formattedValue = isNumericField ? value : `'${value.replace(/'/g, '\'\'')}'`;
              
              // Build filter condition based on operator
              switch (operator.toLowerCase()) {
              case 'equals':
              case '=':
              case 'is':
                return `${fieldExpression} = ${formattedValue}`;
                
              case 'not':
              case '!=':
              case '<>':
                return `${fieldExpression} != ${formattedValue}`;
                
              case 'contains':
              case 'like':
                return isNumericField ? 
                  `CAST(${fieldExpression} AS VARCHAR) LIKE '%${value.replace(/'/g, '\'\'')}%'` :
                  `${fieldExpression} LIKE '%${value.replace(/'/g, '\'\'')}%'`;
                
              case 'startswith':
              case 'startsWith':
                return isNumericField ?
                  `CAST(${fieldExpression} AS VARCHAR) LIKE '${value.replace(/'/g, '\'\'')}%'` :
                  `${fieldExpression} LIKE '${value.replace(/'/g, '\'\'')}%'`;
                
              case 'endswith':
              case 'endsWith':
                return isNumericField ?
                  `CAST(${fieldExpression} AS VARCHAR) LIKE '%${value.replace(/'/g, '\'\'')}'` :
                  `${fieldExpression} LIKE '%${value.replace(/'/g, '\'\'')}'`;
                
              case 'isempty':
              case 'isEmpty':
                return `(${fieldExpression} IS NULL OR ${fieldExpression} = ${isNumericField ? '0' : '\'\''})`;
                
              case 'isnotempty':
              case 'isNotEmpty':
                return `(${fieldExpression} IS NOT NULL AND ${fieldExpression} != ${isNumericField ? '0' : '\'\''})`;
                
              case '>':
              case 'greaterthan':
                return `${fieldExpression} > ${formattedValue}`;
                
              case '>=':
              case 'greaterthanorequal':
                return `${fieldExpression} >= ${formattedValue}`;
                
              case '<':
              case 'lessthan':
                return `${fieldExpression} < ${formattedValue}`;
                
              case '<=':
              case 'lessthanorequal':
                return `${fieldExpression} <= ${formattedValue}`;
                
              default:
                console.log(`Warning: Unsupported filter operator '${operator}', using LIKE`);
                return isNumericField ?
                  `CAST(${fieldExpression} AS VARCHAR) LIKE '%${value.replace(/'/g, '\'\'')}%'` :
                  `${fieldExpression} LIKE '%${value.replace(/'/g, '\'\'')}%'`;
              }
            })
            .filter(condition => condition); // Remove any null/undefined conditions
          
          if (filterConditions.length > 0) {
            const logicOperator = parsedFilterModel.logicOperator || 'and';
            const sqlLogicOperator = logicOperator.toUpperCase() === 'OR' ? 'OR' : 'AND';
            additionalWhereClause = ` AND (${filterConditions.join(` ${sqlLogicOperator} `)})`;
            console.log('Final filter WHERE clause:', additionalWhereClause);
          }
        }
      } catch (e) {
        console.log('Error parsing filterModel:', e);
      }
    }

    // All requests now use lazy loading with ROW_NUMBER for pagination (without CTE)
    let paginatedQuery = `
        SELECT emp_id, employee_name, time_sheet_id, company_id, pay_period_id, time_sheet_status, submitted_on, approved_on, approved_by, total_hours
        FROM (
          SELECT 
            employee.emp_id, 
            CONCAT(employee.emp_first_name, ' ', employee.emp_last_name) AS employee_name, 
            time_sheet.time_sheet_id, 
            time_sheet.company_id, 
            time_sheet.pay_period_id, 
            time_sheet.time_sheet_status, 
            time_sheet.submitted_on, 
            time_sheet.approved_on, 
            time_sheet.approved_by,
            ISNULL((
              SELECT SUM(DATEDIFF(second, empLocate.empLocDate, empLocate.checkoutEmpDate) / 3600.0)
              FROM task 
              INNER JOIN empLocate ON task.tas_id = empLocate.taskId
              INNER JOIN pay_period ON empLocate.empLocDate BETWEEN pay_period.start_date AND DATEADD(day, 1, pay_period.end_date)
              WHERE pay_period.pay_period_id = ${pay_period_id}
              AND task.tas_com_id = ${company_id} 
              AND task.tas_is_active != 2
              AND task.tas_emp_id = employee.emp_id
            ), 0) AS total_hours,
            ROW_NUMBER() OVER (${orderByClause}) as rn
          FROM employee
          LEFT JOIN time_sheet ON employee.emp_id = time_sheet.emp_id AND time_sheet.pay_period_id = ${pay_period_id}
          WHERE employee.emp_company_id = ${company_id} AND employee.emp_is_active = 1`;

    if(req.query.manager_employee_id){
      paginatedQuery += ` AND employee.emp_manager_id = ${req.query.manager_employee_id}`;
    }

    // Apply additional filter conditions
    if (additionalWhereClause) {
      paginatedQuery += additionalWhereClause;
    }

    paginatedQuery += `
        ) AS PaginatedResults
        WHERE rn > ${startNum} AND rn <= ${endNum}`;

    console.log(paginatedQuery);

    const paginatedResults = await DBSendResponse(paginatedQuery);

    // Get total count for pagination
    let countQuery = `
        SELECT COUNT(*) as total_count
        FROM employee
        LEFT JOIN time_sheet ON employee.emp_id = time_sheet.emp_id AND time_sheet.pay_period_id = ${pay_period_id}
        WHERE employee.emp_company_id = ${company_id} AND employee.emp_is_active = 1`;

    if(req.query.manager_employee_id){
      countQuery += ` AND employee.emp_manager_id = ${req.query.manager_employee_id}`;
    }

    // Apply additional filter conditions to count query as well
    if (additionalWhereClause) {
      countQuery += additionalWhereClause;
    }

    const countResult = await DBSendResponse(countQuery);
    const totalCount = countResult[0]?.total_count || 0;

    console.log(`/api/fieldworkclearer/time_sheet/v2/summary GET SUBQUERY PAGINATION - PageSize: ${validatedPageSize}, Start: ${startNum}, End: ${endNum}, Total: ${totalCount}, SortModel: ${sortModel || 'default'}, FilterModel: ${filterModel || 'none'}, PaginationModel: ${JSON.stringify(parsedPaginationModel)}, TIMETAKEN: ${performance.now() - start} MS`);
    res.json({
      rows: paginatedResults.map(row => ({
        emp_id: row.emp_id,
        employee_name: row.employee_name,
        total_hours: parseFloat(row.total_hours || 0).toFixed(2),
        time_sheet_id: row.time_sheet_id,
        company_id: row.company_id,
        pay_period_id: row.pay_period_id,
        time_sheet_status: row.time_sheet_status,
        submitted_on: row.submitted_on,
        approved_on: row.approved_on,
        approved_by: row.approved_by
      })),
      rowCount: totalCount
    });

  } catch (error) {
    console.log(`/api/fieldworker/time_sheet/v2/summary GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/time_sheet/v2/summary GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};

exports.getTimeSheetTasks = async function (req, res) {
  //based on an emp_id and pay_period_id, get all associated tasks. tasks are associated with a pay_period_id if their corresponding entry in empLocate table empLocDate is between the start_date and end_date of the pay_period between pay periods's start_date and end_date
  const start = performance.now();
  try {
    const { emp_id, pay_period_id } = req.query;

    // Check if emp_id and pay_period_id are provided
    if (!emp_id || !pay_period_id) {
      res.status(400).json({ error: 'Missing required query parameters: emp_id and pay_period_id' });
      return;
    }

    const query = `
      SELECT task.*, project.pro_title, empLocate.empLocDate, empLocate.checkoutEmpDate, empLocate.empLocate_timezone, customer.cus_id, customer.cus_name,
        (SELECT t.*, f.form_name, f.json_schema, f.translated_json_schema, f.ui_schema 
        FROM task_form t 
        INNER JOIN fw_forms f ON t.form_id = f.form_id 
        WHERE t.taskType_id=dropdowns.ddID AND t.company_id=project.pro_com_id 
        FOR JSON PATH) as task_form
      FROM task 
      INNER JOIN empLocate ON task.tas_id = empLocate.taskId
      INNER JOIN pay_period ON empLocate.empLocDate >= pay_period.start_date AND empLocate.empLocDate < DATEADD(day, 1, pay_period.end_date)
      INNER JOIN project ON task.tas_pro_id = project.pro_id
      INNER JOIN customer ON project.pro_customer_id = customer.cus_id
      LEFT JOIN dropdowns ON dropdowns.EntityName='taskType' and dropdowns.CompanyID=project.pro_com_id and (dropdowns.is_Active=0 or dropdowns.is_Active=3) and dropdowns.EntityValue=task.tas_type
      WHERE pay_period.pay_period_id = ${pay_period_id}
      AND task.tas_emp_id = ${emp_id}
      AND task.tas_is_active != 2
      AND empLocate.empId IS NOT NULL`;
    let queryResult = await DBSendResponse(query);
    
    queryResult = queryResult.map(task => {
      task.task_form = JSON.parse(task.task_form);
      return task;
    });

    const groupedTasks = queryResult.reduce((grouped, task) => {
      const key = `${task.pay_period_id}-${task.tas_emp_id}`;
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(task);
      return grouped;
    }, {});

    console.log(`/api/fieldworker/time_sheet/v2/tasks GET TIMETAKEN: ${performance.now() - start} MS`);
    res.json(queryResult);
  } catch (error) {
    console.log(`/api/fieldworker/time_sheet/v2/tasks GET ERROR: ${error.message}`);
    console.log('| ERROR | ', error);
    console.log(`/api/fieldworker/time_sheet/v2/tasks GET TIMETAKEN: ${performance.now() - start} MS`);
    res.status(400).json({ error: 'Server error occurred', message: error.message, fullError: error });
  }
};