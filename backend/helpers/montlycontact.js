const { query } = require('express')
const db = require('../models/indexSQL.js')
const { DBUpdate } = require('../queries/commonQueries.js')

exports.sendMontlyContactData = async (req, res) => {
    try {
        if (!!req.body.year && !!req.body.month && !!req.body.task_id && !!req.body.cus_id && !!req.body.proj_id) {
            const monthlycontact_id = await getMonthlyContactID(req.body.cus_id, req.body.proj_id, req.body.year, req.body.month)
            if (monthlycontact_id === undefined) {
                var monthlycontactData = await addMonthlyContact(req.body.cus_id, req.body.proj_id, req.body.emp_id, req.body.year, req.body.month, req.body.task_id, req.body.comment_id, req.body.artifact_id)
                res.json({
                    code: 200,
                    message: "Successfully inserted!"
                })
            }
            else {
                var monthlycontactData = await updateSubtaskId(req.body.year, req.body.month, req.body.task_id, req.body.cus_id, req.body.proj_id)
                res.json({
                    code: 500,
                    // message : "Record already exists"
                    message: "Task ID is updated!"
                })
            }

            return monthlycontactData
        }
        else {
            res.json({
                code: 500,
                message: 'Enter the mandatory fields : cus_id, proj_id, task_id, year, month!'
            })
        }
    }
    catch (err) {
        console.log(err)
    }
}

exports.updateMonthlyContact = async (req, res) => {
    try {
        if (!!req.body.cus_id && !!req.body.proj_id && !!req.body.year && !!req.body.month) {
            let task_id
            let comment_id
            let artifact_id
            //get the id's
            const monthlycontact_id = await getMonthlyContactID(req.body.cus_id, req.body.proj_id, req.body.year, req.body.month)
            if (monthlycontact_id === undefined) {
                task_id = !req.body.task_id ? 'NULL' : req.body.task_id
                comment_id = !req.body.comment_id ? 'NULL' : req.body.comment_id
                artifact_id = !req.body.artifact_id ? 'NULL' : req.body.artifact_id
                employee_id = !req.body.employee_id ? 'NULL' : req.body.employee_id
                console.log(task_id + ":" + comment_id + ":" + artifact_id)
                var updateMonthlyContact = await addMonthlyContact(req.body.cus_id, req.body.proj_id, employee_id, req.body.year, req.body.month, task_id, comment_id, artifact_id)
                res.json({
                    code: 500,
                    // message : "Record doesn't exist"
                    message: "Record doesn't exist. A new record is created!"
                })
            }
            else {
                task_id = !!req.body.task_id ? req.body.task_id : await getTaskID(req.body.cus_id, req.body.proj_id, req.body.year, req.body.month)
                comment_id = !!req.body.comment_id ? req.body.comment_id : await getCommentID(req.body.cus_id, req.body.proj_id, req.body.year, req.body.month)
                artifact_id = !!req.body.artifact_id ? req.body.artifact_id : await getArtifactID(req.body.cus_id, req.body.proj_id, req.body.year, req.body.month)

                // console.log(task_id + ":" + artifact_id + ":" + comment_id)

                var updateMonthlyContact = await updateMonthlyContactData(monthlycontact_id.monthlycontact_id, task_id, comment_id, artifact_id)
                res.json({
                    code: 200,
                    message: "Successfully updated!"
                })
            }

        }
        else {
            res.json({
                code: 500,
                message: "Enter the mandatory fields : cus_id, proj_id, year, month!"
            })
        }
        return updateMonthlyContact

    }
    catch (err) {
        console.log(err)
    }
}

// exports.replaceMonthlyContactDataByTaskId = async (req, res) => {
//     try {
//         if (!!req.body.year && !!req.body.month && !!task_id) {
//             const monthlycontact_id = await getMonthlyContactID(req.body.cus_id, req.body.proj_id, req.body.year, req.body.month)
//             if(monthlycontact_id === undefined){
//                 res.json({
//                     code : 500,
//                     message : "Record doesn't exist"
//                 })
//             }
//             else{
//                 var updateMonthlyContactData = await updateMontlyContactByTaskId(req.body.cus_id, req.body.proj_id, req.body.emp_id, req.body.year, req.body.month, req.body.task_id)
//                 res.json({
//                     code : 200,
//                     message: "Successfully updated!"
//                 })
//             }
//             return updateMonthlyContactData;
//         }
//         else {
//             res.json({
//                 code: 500,
//                 message: 'Something went wrong!'
//             })
//         }
//     }
//     catch (err) {
//         console.log(err)
//     }
// }

// exports.replaceMonthlyContactDataByCommentId = async (req, res) => {
//     try {
//         if (!!req.body.year && !!req.body.month && !!task_id) {
//             const monthlycontact_id = await getMonthlyContactID(req.body.cus_id, req.body.proj_id, req.body.year, req.body.month)
//             if(monthlycontact_id === undefined){
//                 res.json({
//                     code : 500,
//                     message : "Record doesn't exist"
//                 })
//             }
//             else{
//                 var updateMonthlyContactData = await updateMontlyContactByCommentId(req.body.cus_id, req.body.proj_id, req.body.emp_id, req.body.year, req.body.month, req.body.comment_id)
//                 res.json({
//                     code : 200,
//                     message: "Successfully updated!"
//                 })
//             }
//             return updateMonthlyContactData;
//         }
//         else {
//             res.json({
//                 code: 500,
//                 message: 'Something went wrong!'
//             })
//         }
//     }
//     catch (err) {
//         console.log(err)
//     }
// }

// exports.replaceMonthlyContactDataByArtifactId  = async (req, res) => {
//     try {
//         if (!!req.body.year && !!req.body.month && !!task_id) {
//             const monthlycontact_id = await getMonthlyContactID(req.body.cus_id, req.body.proj_id, req.body.year, req.body.month)
//             if(monthlycontact_id === undefined){
//                 res.json({
//                     code : 500,
//                     message : "Record doesn't exist"
//                 })
//             }
//             else{
//                 var updateMonthlyContactData = await updateMontlyContactByArtifactId(req.body.cus_id, req.body.proj_id, req.body.emp_id, req.body.year, req.body.month, req.body.artifact_id)
//                 res.json({
//                     code : 200,
//                     message: "Successfully updated!"
//                 })
//             }
//             return updateMonthlyContactData;
//         }
//         else {
//             res.json({
//                 code: 500,
//                 message: 'Something went wrong!'
//             })
//         }
//     }
//     catch (err) {
//         console.log(err)
//     }
// }

async function addMonthlyContact(cus_id, proj_id, emp_id, year, month, task_id, comment_id, artifact_id) {
    const query = `insert into monthlycontact (customer_id, project_id, employee_id, year, month, task_id, comment_id, 
        artifact_id, created_date, updated_date) values (${cus_id}, ${proj_id}, ${emp_id}, ${year}, ${month},
        ${task_id}, ${comment_id ? comment_id : 'NULL'}, ${artifact_id ? artifact_id : 'NULL'}, CURRENT_TIMESTAMP, 
        CURRENT_TIMESTAMP); SELECT SCOPE_IDENTITY();`

    return await DBinsertAndSelectResponse(query)

}

// async function updateMontlyContactByTaskId(cus_id, proj_id, year, month, newtaskid) {

//     const query = `UPDATE monthlycontact SET task_id = '${newtaskid}' WHERE customer_id='${cus_id}' AND project_id='${proj_id}' AND year='${year}'AND month='${month}'`
//     return await DBUpdate(query)
// }

// async function updateMontlyContactByCommentId(cus_id, proj_id, year, month, newcommentid) {

//     const query = `UPDATE monthlycontact SET comment_id = '${newcommentid}' WHERE customer_id='${cus_id}' AND project_id='${proj_id}' AND year='${year}'AND month='${month}'`
//     return await DBUpdate(query)
// }

// async function updateMontlyContactByArtifactId(cus_id, proj_id, year, month, newartifactid) {

//     const query = `UPDATE monthlycontact SET artifact_id = '${newartifactid}' WHERE customer_id='${cus_id}' AND project_id='${proj_id}' AND year='${year}'AND month='${month}'`
//     return await DBUpdate(query)
// }

async function updateMonthlyContactData(monthlycontact_id, task_id, comment_id, artifact_id) {

    const query = `UPDATE monthlycontact SET task_id = ${task_id}, comment_id = ${comment_id},artifact_id = ${artifact_id} WHERE monthlycontact_id = ${monthlycontact_id}`
    return await DBUpdate(query)
}

async function updateSubtaskId(year, month, task_id, cus_id, proj_id) {

    const query = `UPDATE monthlycontact SET task_id = ${task_id} WHERE customer_id = ${cus_id} AND project_id = ${proj_id} AND year = ${year} AND month = ${month}`
    return await DBUpdate(query)
}

async function getTaskID(cus_id, proj_id, year, month) {

    const query = `SELECT task_id from monthlycontact WHERE customer_id = '${cus_id}' AND project_id = '${proj_id}' AND year = '${year}' AND month = '${month}'`
    const result = await DBinsertAndSelectResponse(query)
    return result.task_id
}

async function getCommentID(cus_id, proj_id, year, month) {

    const query = `SELECT comment_id from monthlycontact WHERE customer_id = '${cus_id}' AND project_id = '${proj_id}' AND year = '${year}' AND month = '${month}'`
    const result = await DBinsertAndSelectResponse(query)
    return result.comment_id
}

async function getArtifactID(cus_id, proj_id, year, month) {

    const query = `SELECT artifact_id from monthlycontact WHERE customer_id = '${cus_id}' AND project_id = '${proj_id}' AND year = '${year}' AND month = '${month}'`
    const result = await DBinsertAndSelectResponse(query)
    return result.artifact_id
}

async function getMonthlyContactID(cus_id, proj_id, year, month) {

    const query = `SELECT monthlycontact_id from monthlycontact WHERE customer_id = '${cus_id}' AND project_id = '${proj_id}' AND year = '${year}' AND month = '${month}'`
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
        return null;
    })
    return !res ? null : res.recordset[0]
}