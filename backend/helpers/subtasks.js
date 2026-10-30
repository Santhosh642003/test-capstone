const db = require('../models/indexSQL.js')
const { DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries.js')

exports.getAllSubtasks = async (req, res) => {
    try {
        if (!!req.query.task_id) {
            // res.json({
            //     code : 200,
            //     message : "Successfully executed. Here are all the Subtask ID"
            // })
            const listOfAllSubtaskID = await getAllSubtasksData(req.query.task_id)
            return res.json(listOfAllSubtaskID)
        }
        else {
            res.json({
                code: 500,
                message: "Enter the task ID!"
            })
        }
    }
    catch (err) {
        console.log(err)
    }
}

exports.sendSubtaskData = async (req, res) => {
    try {
        if (!!req.body.task_id) {
            var subtaskID = await addSubtask(req.body.task_id, req.body.subtask_category_id, req.body.status, req.body.reason_code, req.body.action_taken, req.body.subtask_name)
            if(subtaskID == null){
                res.json({
                    code: 500,
                    message: "Could Not Complete Request"
                })
                return;
            }
            res.json({
                code: 200,
                message: "Successfully Inserted!"
            })
            return subtaskID
        }
        else {
            res.json({
                code: 500,
                message: "Enter the Task ID"
            })
        }
    }
    catch (err) {
        console.log(err)
    }
}

exports.updateOneSubtask = async (req, res) => {
    try {
        if (!!req.body.subtask_id) {
            await updateSubtask(req.body.subtask_id, req.body.subtask_category_id, req.body.status, req.body.reason_code, req.body.action_taken, req.body.subtask_name)
            res.json({
                code: 200,
                message: "Successfully updated!"
            })
        }
        else {
            res.json({
                code: 500,
                message: "Enter Subtask ID!"
            })
        }
    }
    catch (err) {
        console.log(err)
    }

}

async function getAllSubtasksData(task_id) {
    const query = `SELECT * FROM subtasks WHERE task_id='${task_id}'`
    return await DBSendResponse(query)
}

async function addSubtask(task_id, subtask_category_id, status, reason_code, action_taken, subtask_name) {

    //status = 0 for Scheduled
    //status = 1 for Completed
    //status = 2 for Missed
    const query = `INSERT into subtasks (task_id, subtask_category_id, status, reason_code, action_taken, created_at, updated_at, subtask_name) values
    ('${task_id}', '${subtask_category_id}', '${status}', '${reason_code}', '${action_taken}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '${subtask_name}'); SELECT SCOPE_IDENTITY();`

    return await DBinsertAndSelectResponse(query)
}

async function updateSubtask(subtask_id, subtask_category_id, status, reason_code, action_taken, subtask_name) {
    const query = `UPDATE subtasks SET subtask_category_id = '${subtask_category_id}', status = '${status}', reason_code = '${reason_code}', action_taken = '${action_taken}', updated_at = CURRENT_TIMESTAMP, subtask_name = '${subtask_name}' WHERE subtask_id = '${subtask_id}'`
    return await DBUpdate(query)
}

async function getSubtaskId(task_id) {

    const query = `SELECT subtask_id FROM subtasks WHERE task_id = '${task_id}'`
    const result = await DBinsertAndSelectResponse(query)
    return result
}

async function DBinsertAndSelectResponse(query) {
    console.log(query + " dbinsertandselect")
    const request = new db.Request()
    let res = await request.query(query).then((result) => {
        return result
    }).catch((err) => {
        console.log(err)
        return null
    })
    return !res ? null : res.recordset[0]
}