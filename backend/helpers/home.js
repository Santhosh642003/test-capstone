const db = require('../models/indexSQL.js');
const moment = require('moment');
const geolib = require('geolib');
const { DBSendResponse } = require('../queries/commonQueries');
const { getProjectList, getEmployeeList } = require('../queries/entityGetQueries');
// var moment = require('moment')

exports.getProjectPieData = async function (req, res) {
  const id = req.query.comp_id;
  const ActiveQuery = `SELECT tas_pro_id, pro_title,COUNT(tas_id) as num FROM task,project WHERE tas_com_id=${id} AND tas_is_active=0 AND tas_pro_id = pro_id AND tas_start_date between DATEADD(day,-1,CURRENT_TIMESTAMP) AND DATEADD(month,1,CURRENT_TIMESTAMP) GROUP BY tas_pro_id,pro_title`;
  const upComingQuery = `SELECT tas_pro_id, pro_title,COUNT(tas_id) as num FROM task,project WHERE tas_com_id=${id} AND tas_is_active=0 AND tas_pro_id = pro_id AND tas_start_date >= DATEADD(month,1,CURRENT_TIMESTAMP) GROUP BY tas_pro_id,pro_title`;
  const completeQuery = `SELECT tas_pro_id, pro_title,COUNT(tas_id) as num FROM task,project WHERE tas_com_id=${id} AND tas_is_active=1 AND tas_pro_id = pro_id GROUP BY tas_pro_id,pro_title`;
  const active = await DBSendResponse(ActiveQuery) || [];
  const upComing = await DBSendResponse(upComingQuery) || [];
  const complete = await DBSendResponse(completeQuery) || [];
  const proj = await getProjectList(id);
  // let result = {active: active, upcoming: upComing, complete: complete, proj: proj}
  const result = proj.map((pro) => {
    let pieObj = { pid: pro.pid, pname: pro.pname };
    const activeTask = active.find((info) => (info.tas_pro_id === pro.pid));
    const upComingTask = upComing.find((info) => (info.tas_pro_id === pro.pid));
    const CompleteTask = complete.find((info) => (info.tas_pro_id === pro.pid));
    pieObj = { ...pieObj, ongoing: !activeTask ? 0 : activeTask.num, upcoming: !upComingTask ? 0 : upComingTask.num, complete: !CompleteTask ? 0 : CompleteTask.num };
    return pieObj;
  });
  res.json(result);
};

exports.getHomeDetails = async (req, res) => {
  const id = req.query.comp_id;
  // var emp_id = req.query.emp_id
  // var pro_id = req.query.pro_id
  // var dateRange = {cusStart: req.query.start, cusEnd: req.query.end,contStart: req.query.start, contEnd: req.query.end,start: req.query.start, end: req.query.end}
  const getCustAqcCount = `select count(*) as cus_YTD_num from customer where cus_company_id=${id} and cus_created_at > '${moment().startOf('year').format('YYYY-MM-DDTHH:mm:ss')}' and cus_created_at < '${moment().endOf('year').format('YYYY-MM-DDTHH:mm:ss')}'`;
  const getContactsMTDCount = `select count(*) as cont_MTD_num from task where tas_com_id=${id} and tas_start_date > '${moment().startOf('M').format('YYYY-MM-DDTHH:mm:ss')}' and tas_start_date < '${moment().endOf('M').format('YYYY-MM-DDTHH:mm:ss')}'`;
  const getInHomeConMTDCount = `select count(*) as inhomecountMDT from task where tas_com_id=${id} and tas_start_date > '${moment().startOf('M').format('YYYY-MM-DDTHH:mm:ss')}' and tas_start_date < '${moment().endOf('M').format('YYYY-MM-DDTHH:mm:ss')}' and (tas_type='Home Visit' or tas_type='Vist')`;
  const getCustCount = `select count(*) as cus_num from customer where cus_company_id=${id}`;
  const getContactsCount = `select count(*) as cont_num from task where tas_com_id=${id}`;
  const getInHomeConCount = `select count(*) as inhomecount from task where tas_com_id=${id} and (tas_type='Home Visit' or tas_type='Vist')`;
  const contMTD = await DBSendResponse(getContactsMTDCount);
  const custYTD = await DBSendResponse(getCustAqcCount);
  const custNum = await DBSendResponse(getCustCount);
  const contCount = await DBSendResponse(getContactsCount);
  const inHomeCont = await DBSendResponse(getInHomeConCount);
  const inHomeMTDCont = await DBSendResponse(getInHomeConMTDCount);
  const headerInfo = {
    custYTD: custYTD,
    inHomeMTDCont: inHomeMTDCont,
    custNum: custNum
  };
  const barInfo = [];
  const lineInfo = [];
  // barInfo = barInfo.map(async (obj,i)=> {
  for (let i = 0; i < 12; i++) {
    const start = moment().startOf('year').add(i, 'month').format('YYYY-MM-DDTHH:mm:ss');
    const barquery = `select count(*) as cont_MTD_num from task where tas_com_id=${id} and tas_is_Active=1 and tas_start_date > '${moment(start).startOf('month').format('YYYY-MM-DDTHH:mm:ss')}' and tas_start_date < '${moment(start).endOf('month').format('YYYY-MM-DDTHH:mm:ss')}'`;
    const linequery = `select count(*) as cont_MTD_num from task where tas_com_id=${id} and tas_is_Active=1 and tas_start_date > '${moment(start).startOf('month').format('YYYY-MM-DDTHH:mm:ss')}' and tas_start_date < '${moment(start).endOf('month').format('YYYY-MM-DDTHH:mm:ss')}' and (tas_type='Home Visit' or tas_type='Vist')`;
    const barNum = await DBSendResponse(barquery);
    const lineNum = await DBSendResponse(linequery);
    console.log(barNum, lineNum);
    // let res = {num: barNum[0].cont_MTD_num, line: lineNum[0].cont_MTD_num,
    //     month: moment().startOf('year').add('month', i).format('MMM YYYY')
    // }
    // return res
    barInfo.push(barNum?.[0]?.cont_MTD_num ?? 0);
    lineInfo.push(lineNum?.[0]?.cont_MTD_num ?? 0);
  }
  // })

  const result = {
    headerInfo,
    barInfo,
    lineInfo,
    contCount: contCount?.[0] ?? {},
    inHomeCont: inHomeCont?.[0] ?? {},
    contMTD: contMTD?.[0] ?? {}

  };
  // console.log(custNum,contCount,inHomeCont)
  res.json(result);
};

exports.getEmployeeAnalytics = async function (req, res) {
  const id = req.query.comp_id;
  const empBarChartQuery = `SELECT emp_id,tas_is_active,COUNT(*) as num_task from employee,task WHERE tas_emp_id=emp_id AND tas_com_id=${id} GROUP BY emp_id,tas_is_active`;
  const empLocateBarRes = await DBSendResponse(empBarChartQuery);
  const empList = await getEmployeeList(id);
  // console.log(empLocateBarRes)
  // console.log(empList)
  const EmpBarChart = empList.map((emp) => {
    let resObj = emp;
    const foundObjup = empLocateBarRes.find((item) => (item.emp_id === emp.id && item.tas_is_active === 0));
    const foundObjcom = empLocateBarRes.find((item) => (item.emp_id === emp.id && item.tas_is_active === 1));
    if (foundObjup) {
      resObj = { ...emp, ongoing: foundObjup.num_task, completed: (!resObj.completed) ? 0 : resObj.completed + 0 };
    }
    if (foundObjcom) {
      resObj = { ...emp, ongoing: (!resObj.ongoing) ? 0 : resObj.ongoing + 0, completed: foundObjcom.num_task };
    }
    if (!foundObjup && !foundObjcom) {
      resObj = { ...emp, ongoing: 0, completed: 0 };
    }
    return resObj;
  });

  const empLineChartQ1 = `SELECT emp_id, tas_id, Max(tas_is_active) as taskDesg, Max(tas_start_date) as start_date, Max(tas_start_time) as start_time, Max(tas_end_date) as end_date, Max(tas_end_time) as end_time from employee,task WHERE tas_com_id=${id} AND tas_emp_id=emp_id AND (tas_is_active=0 or tas_is_active=1) GROUP BY emp_id,tas_id`;
  const empLineChartQ2 = `Select taskId,max(empLocdate) as start_date,max(checkoutEmpDate) as end_date from empLocate,employee where empId=emp_id AND emp_company_id=${id} group by taskId`;

  const empLineRes1 = await DBSendResponse(empLineChartQ1);
  const empLineRes2 = await DBSendResponse(empLineChartQ2);
  // console.log(empLineRes1)
  // console.log(empLineRes2)
  const empLineChartRes = empLineRes1.map((empRes) => {
    let resObj = { emp_id: empRes.emp_id, tas_id: empRes.tas_id, start_date: empRes.start_date, end_date: empRes.end_date, taskStat: empRes.taskDesg };
    const taskEmpLoc = empLineRes2.find((task) => (task.taskId === empRes.tas_id));
    if (taskEmpLoc) {
      resObj = { ...resObj, start_date: taskEmpLoc.start_date, end_date: taskEmpLoc.end_date };
    } else {
      if(empRes.start_time == null || empRes.end_time == null){
        const fallbackDate = empRes.start_date || empRes.end_date;
        if (!fallbackDate) {
          return resObj;
        }
        resObj = { ...resObj, start_date: fallbackDate.toISOString().slice(0, 12), end_date: fallbackDate.toISOString().slice(0, 12) };
        return resObj;
      }
      let timeStart = parseInt(empRes.start_time.slice(0, 2));
      let timeEnd = parseInt(empRes.end_time.slice(0, 2));
      if (empRes.start_time.slice(-2) === 'PM' && timeStart !== 12) {
        timeStart += 12;
      } else if (empRes.start_time.slice(-2) === 'AM' && timeStart === 12) {
        timeStart = 0;
      } else {
        timeStart += 0;
      }
      if (empRes.end_time.slice(-2) === 'PM' && timeEnd !== 12) {
        timeEnd += 12;
      } else if (empRes.start_time.slice(-2) === 'AM' && timeStart === 12) {
        timeEnd = 0;
      } else {
        timeEnd += 0;
      }
      const startDate = (timeStart.toString().length === 1) ? `${empRes.start_date.toISOString().slice(0, 12)}${timeStart.toString()}${empRes.start_date.toISOString().slice(13)}` : `${empRes.start_date.toISOString().slice(0, 11)}${timeStart.toString()}${empRes.start_date.toISOString().slice(13)}`;
      const endDate = (timeEnd.toString().length === 1) ? `${empRes.end_date.toISOString().slice(0, 12)}${timeEnd.toString()}${empRes.end_date.toISOString().slice(13)}` : `${empRes.end_date.toISOString().slice(0, 11)}${timeEnd.toString()}${resObj.end_date.toISOString().slice(13)}`;
      resObj = { ...resObj, start_date: startDate, end_date: endDate };
    }
    return resObj;
  });
  const result = {};
  result.EmpBarChart = EmpBarChart;
  result.EmpLineChart = empLineChartRes;
  res.json(result);
};

exports.getEmployeeAnalyticsAverageMiles = async function (req, res) {
  const FILTERS = ['day', 'week', 'month', '6 month', 'year'];
  const id = req.query.comp_id;
  const filter = req.query.filter;
  const taskLocQuery = `SELECT emp_id, emp_first_name, emp_last_name, loc_lat, loc_lon, tas_end_date FROM employee, task, [location] WHERE emp_id = tas_emp_id and tas_loc_id = loc_id and tas_end_date <= CAST(GETDATE() AS DATE) and tas_is_active = 1 and tas_com_id = ${id} ORDER BY tas_end_date`;
  const queryResult = await DBSendResponse(taskLocQuery);
  const empList = await getEmployeeList(id);

  const empTask = {};
  queryResult.forEach(item => {
    let filterDate = '';
    if (!empTask[item.emp_id]) empTask[item.emp_id] = {};
    if (!empTask[item.emp_id].locations) empTask[item.emp_id].locations = {};
    empTask[item.emp_id].firstName = item.emp_first_name;
    empTask[item.emp_id].lastName = item.emp_last_name;
    if (filter.toLowerCase() === FILTERS[0]) {
      filterDate = item.tas_end_date;
    } else if (filter.toLowerCase() === FILTERS[1]) {
      filterDate = `${moment(item.tas_end_date).year()}-${moment(item.tas_end_date).week()}`;
    } else if (filter.toLowerCase() === FILTERS[2]) {
      filterDate = `${moment(item.tas_end_date).year()}-${moment(item.tas_end_date).month()}`;
    } else if (filter.toLowerCase() === FILTERS[3]) {
      filterDate = `${moment(item.tas_end_date).year()}-${moment(item.tas_end_date).month() < 5 ? 0 : 6}`;
    } else if (filter.toLowerCase() === FILTERS[4]) {
      filterDate = `${moment(item.tas_end_date).year()}`;
    } else {
      return res.status(500).send({
        message: `${filter} is unsupported`
      });
    }
    if (!empTask[item.emp_id].locations[filterDate]) empTask[item.emp_id].locations[filterDate] = [];
    empTask[item.emp_id].locations[filterDate].push({
      lat: item.loc_lat,
      lon: item.loc_lon
    });
  });
  const empMiles = {};
  let result = [];
  Object.keys(empTask).forEach(key => {
    const locations = empTask[key].locations;
    let avgDistance = 0;
    Object.keys(locations).forEach(locKey => {
      const locationList = locations[locKey];
      if (locationList.length > 1) {
        for (let i = 0; i < locationList.length - 1; i++) {
          avgDistance += geolib.getDistance(
            {
              latitude: locationList[i].lat, longitude: locationList[i].lon
            },
            {
              latitude: locationList[i + 1].lat, longitude: locationList[i + 1].lon
            },
            0.1
          ) / 1000;
        }
      }
    });
    avgDistance = ((avgDistance / Object.keys(locations).length) * 1.60934).toFixed(2);
    empMiles[key] = avgDistance;
  });

  result = empList.map(emp => {
    if (empMiles[emp.id]) {
      return {
        id: emp.id,
        employee_name: emp.employee_name,
        avg_miles: parseFloat(empMiles[emp.id])
      };
    } else {
      return {
        id: emp.id,
        employee_name: emp.employee_name,
        avg_miles: 0
      };
    }
  });

  result.sort((a, b) => b.avg_miles - a.avg_miles);
  res.json(result);
};

exports.getEmployeeAnalyticsFaceToFaceCalls = async function (req, res) {
  const id = req.query.comp_id;
  const empList = await getEmployeeList(id);

  const query = 'select sum(cast(duration AS int)) as total_call_duration, empID from calls group by empID';
  const queryResult = await DBSendResponse(query);

  const result = empList.map(emp => {
    const empF2F = queryResult.find(item => item.empID === emp.id);
    if (empF2F) {
      return {
        id: emp.id,
        name: emp.employee_name,
        duration: empF2F.total_call_duration
      };
    } else {
      return {
        id: emp.id,
        name: emp.employee_name,
        duration: 0
      };
    }
  });
  result.sort((a, b) => b.duration - a.duration);
  res.json(result);
};

exports.getBillingSummary = async (req, res) => {
  try {
    const comp_id = req.query.comp_id;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    if (!comp_id || !startDate || !endDate) {
      return res.status(400).json({ error: 'comp_id, startDate, and endDate are required' });
    }

    // 1. Shift hours per month from master_schedule
    const shiftQuery = `
      SELECT 
        FORMAT(ms.date, 'yyyy-MM') AS month_key,
        SUM(DATEDIFF(MINUTE, ms.start_time, ms.end_time)) / 60.0 AS shift_hours
      FROM master_schedule ms
      WHERE ms.company_id = ${comp_id}
        AND ms.date >= '${startDate}' AND ms.date <= '${endDate}'
      GROUP BY FORMAT(ms.date, 'yyyy-MM')
    `;

    // 2. Billed hours per month from sessions (check_in to check_out)
    const billedQuery = `
      SELECT 
        FORMAT(ms.date, 'yyyy-MM') AS month_key,
        SUM(DATEDIFF(MINUTE, s.check_in_time, s.check_out_time)) / 60.0 AS billed_hours
      FROM sessions s
      INNER JOIN master_schedule ms ON s.schedule_id = ms.schedule_id
      WHERE ms.company_id = ${comp_id}
        AND ms.date >= '${startDate}' AND ms.date <= '${endDate}'
        AND s.check_in_time IS NOT NULL
        AND s.check_out_time IS NOT NULL
      GROUP BY FORMAT(ms.date, 'yyyy-MM')
    `;

    // 3. Paid hours per month from claims (Processed/Released status)
    const paidQuery = `
      SELECT 
        FORMAT(clm.startDate, 'yyyy-MM') AS month_key,
        SUM(clm.authUnits) AS paid_units
      FROM claim clm
      WHERE clm.companyID = ${comp_id}
        AND clm.startDate >= '${startDate}' AND clm.endDate <= '${endDate} 23:59:59'
        AND clm.Status IN ('Processed as Primary', 'Released')
      GROUP BY FORMAT(clm.startDate, 'yyyy-MM')
    `;

    const [shiftData, billedData, paidData] = await Promise.all([
      DBSendResponse(shiftQuery),
      DBSendResponse(billedQuery),
      DBSendResponse(paidQuery),
    ]);

    // Build lookup maps
    const shiftMap = {};
    (shiftData || []).forEach((row) => {
      shiftMap[row.month_key] = parseFloat(row.shift_hours) || 0;
    });

    const billedMap = {};
    (billedData || []).forEach((row) => {
      billedMap[row.month_key] = parseFloat(row.billed_hours) || 0;
    });

    const paidMap = {};
    (paidData || []).forEach((row) => {
      paidMap[row.month_key] = parseFloat(row.paid_units) || 0;
    });

    // Build month buckets
    const start = moment(startDate);
    const end = moment(endDate);
    const result = [];
    const cursor = start.clone().startOf('month');

    while (cursor.isSameOrBefore(end, 'month')) {
      const key = cursor.format('YYYY-MM');
      result.push({
        month: cursor.format('MMM'),
        shiftHours: parseFloat((shiftMap[key] || 0).toFixed(1)),
        billedHours: parseFloat((billedMap[key] || 0).toFixed(1)),
        paidHours: parseFloat((paidMap[key] || 0).toFixed(1)),
      });
      cursor.add(1, 'month');
    }

    res.json(result);
  } catch (error) {
    console.error('Error in getBillingSummary:', error);
    res.status(500).json({ error: 'Failed to fetch billing summary' });
  }
};
