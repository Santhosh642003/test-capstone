const { DBSendResponse } = require("../queries/commonQueries")
const moment = require("moment");


exports.getEvvLog = async function (req, res) {
    let comp_id = req.query.comp_id
    let start = moment(req.query.start).utc().format('YYYY-MM-DDTHH:mm:ss')
    let end = moment(req.query.end).utc().format('YYYY-MM-DDTHH:mm:ss')

    var query = `SELECT *,
    (select * from evv_AZ_log where evv_AZ_log.processlogID = evv_AZ_process_log.processlogID for JSON PATH) as evvLogList,
    (select * from evv_AZ where evv_AZ.processlogID = evv_AZ_process_log.processlogID for JSON PATH) as persons
    from evv_AZ_process_log
	where evvProcessLogComid=${comp_id} and processID is not null and timestamp BETWEEN '${start}' AND '${end}'`

    let data = await DBSendResponse(query)
    data = data.map((record) => {
        record = { ...record, evvLogList: JSON.parse(record.evvLogList), persons: JSON.parse(record.persons) }
        return record
    })

    let taskData_query = `select * from task
    INNER JOIN employee ON employee.emp_id=task.tas_emp_id
    INNER JOIN project ON project.pro_id=task.tas_pro_id
    INNER JOIN empLocate ON empLocate.taskId=task.tas_id
    where tas_com_id=${comp_id};`
    let data2 = await DBSendResponse(taskData_query)

    let finalData = { processes: data, tasks: data2 }

    res.json(finalData)
}