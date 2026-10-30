var db = require("../models/indexSQL.js")
const {DBinsertSendID,DBinsert,DBUpdate,DBSendResponse,DBinsertSendResponse,DBInsertAndReturn} = require("../queries/commonQueries")


exports.getEvvLog = async function(req,res) {
    let comp_id = req.query.comp_id
    var query = `SELECT *,
    (select * from evv_log where evv_log.evvProcessLogId = evv_process_log.evvProcessLogId ${req.query.start ? `and invocationTimestamp >= '${req.query.start}' and invocationTimestamp < '${req.query.end}'` : ''} for JSON PATH) as evvLogList
    from evv_process_log where evvProcessLogComId=${comp_id} ${req.query.start ? `and invocationTimestamp >= '${req.query.start}' and invocationTimestamp < '${req.query.end}'` : ''}`
    let data = await DBSendResponse(query)
    data = data.map((record) =>{
        record = {...record, evvLogList: JSON.parse(record.evvLogList)}
        return record
    })
    
    let taskData_query = `select * from task
    INNER JOIN employee ON employee.emp_id=task.tas_emp_id
    INNER JOIN project ON project.pro_id=task.tas_pro_id
    INNER JOIN empLocate ON empLocate.taskId=task.tas_id
    where tas_com_id=${comp_id};`
    let data2 = await DBSendResponse(taskData_query)

    let finalData = {processes: data, tasks: data2}

    res.json(finalData)
}


// getEvv = async (req,res)=> {
//     let comp_id = req.query.comp_id
//     var query = `select *,(select * from evv_log,evv_process_log where evv_log.evvProcessLogId = evv_process_log.evvProcessLogId for JSON PATH) as evvLoglist from evv_process_log where evvProcessLogComId=${comp_id}`
//     let data = await DBSendResponse(query)
//     res.json(data)
// }