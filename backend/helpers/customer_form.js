const moment = require('moment')
const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries')

exports.getForm = async function (req, res) {
    const query = `SELECT * FROM customer_form where form_id = ${req.params.id}`
    const result = await DBSendResponse(query)
    res.json(result)
}

exports.postForm = async function (req, res) {
    const query = `INSERT INTO customer_form (customer_id, task_id, data, created_on, last_updated, form_type, created_by) 
    VALUES (${req.body.customer_id}, ${req.body.task_id}, N'${req.body.data.replaceAll("'", "''")}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '${req.body.form_type}', ${req.body.emp_id}); SELECT SCOPE_IDENTITY();`

    const result = await DBinsertSendID(query)
    console.log(result);
    if (result) {
        res.json({ code: 200, message: 'Form created successfully', form_id: result })
    } else {
        res.json({ code: 400, message: 'Error creating form' })
    }
}

exports.updateForm = async function (req, res) {
    const query = `UPDATE customer_form SET data = N'${req.body.data.replaceAll("'", "''")}', last_updated = '${moment().format('YYYY-MM-DD HH:mm:ss')}', created_by = ${req.body.emp_id} WHERE form_id = ${req.params.id}`
    const result = await DBUpdate(query)
    if (result) {
        res.json({ code: 200, message: 'Form updated successfully' })
    } else {
        res.json({ code: 400, message: 'Error updating form' })
    }
}

exports.deleteForm = async function (req, res) {
    const query = `DELETE FROM customer_form WHERE form_id = ${req.params.id}`
    const result = await DBUpdate(query)
    if (result) {
        res.json({ code: 200, message: 'Form deleted successfully' })
    } else {
        res.json({ code: 400, message: 'Error deleting form' })
    }
}

exports.getFormsByTask = async function (req, res) {
    let query = `SELECT cf.*, f.form_name, f.json_schema, f.translated_json_schema, t.tas_title, t.tas_claim_id, el.empLocdate, el.checkoutEmpDate, el.empLocate_timezone, e.emp_first_name, e.emp_last_name
    FROM customer_form cf
    JOIN fw_forms f ON cf.form_type = f.form_id
    JOIN task t ON t.tas_id = cf.task_id
    JOIN empLocate el ON el.taskId = t.tas_id
    LEFT JOIN employee e ON e.emp_id = 
    CASE 
        WHEN cf.created_by IS NOT NULL THEN cf.created_by 
        ELSE el.empId 
    END
    WHERE cf.task_id = ${req.params.id}`

    if (req.query.formType) {
        query += ` AND cf.form_type = ${req.query.formType}`
    }

    const result = await DBSendResponse(query)
    res.json(result)
}

exports.getFormsByCustomer = async function (req, res) {
    const query = `SELECT cf.*, f.form_name, f.json_schema, f.translated_json_schema, t.tas_title, t.tas_claim_id, el.empLocdate, el.checkoutEmpDate, el.empLocate_timezone, e.emp_first_name, e.emp_last_name,
        (SELECT cg.customer_goal_id, cg.goal_title, cg.goal_detail
            FROM customer_goal cg 
            JOIN permitted_task pt ON pt.customer_goal_id = cg.customer_goal_id
            JOIN TaskProcCodeMapping tm ON tm.taskProcCode_id = pt.taskProcCode_id
            JOIN dropdowns dd ON dd.ddID = tm.dropdown_id
        WHERE cg.customer_id = ${req.params.id} AND cg.goal_status != 3 AND dd.EntityValue = t.tas_type for JSON PATH) as cusGoals
    FROM customer_form cf
    JOIN fw_forms f ON cf.form_type = f.form_id
    JOIN task t ON t.tas_id = cf.task_id
    JOIN empLocate el ON el.taskId = t.tas_id
    LEFT JOIN employee e ON e.emp_id = 
    CASE 
        WHEN cf.created_by IS NOT NULL THEN cf.created_by 
        ELSE el.empId 
    END
    WHERE cf.customer_id = ${req.params.id}`;

    let result = await DBSendResponse(query);

    result = result.map((form) => {
        form.json_schema = JSON.parse(form.json_schema);
        form.translated_json_schema = form.translated_json_schema ? JSON.parse(form.translated_json_schema) : null;
        form.formData = JSON.parse(form.data);
        form.cusGoals = JSON.parse(form.cusGoals);
        return form;
    })

    res.json(result)
}

exports.getFormsWithData = async function (req, res) {
    let query = `SELECT cf.data, ff.json_schema, ff.translated_json_schema, t.tas_title, t.tas_type, t.tas_claim_id, el.empLocdate, el.checkoutEmpDate, el.empLocate_timezone, c.cus_name, c.cus_local_id, e.emp_first_name, e.emp_last_name, e.emp_local_id,
    (SELECT * FROM location l WHERE l.loc_id = el.locId or l.loc_id = el.checkoutLocId for JSON PATH) as locInfo
    FROM customer_form cf
    JOIN fw_forms ff ON ff.form_id = cf.form_type
    JOIN task t ON t.tas_id = cf.task_id
    JOIN empLocate el ON el.taskId = t.tas_id
    JOIN customer c ON c.cus_id = cf.customer_id
    LEFT JOIN employee e ON e.emp_id = 
    CASE 
        WHEN cf.created_by IS NOT NULL THEN cf.created_by 
        ELSE el.empId 
    END
    WHERE c.cus_company_id = ${req.query.compID} AND cf.form_type = ${req.query.formID}`

    if (req.query.taskStartDate && req.query.taskEndDate) {
        query += ` AND el.checkoutEmpDate BETWEEN '${req.query.taskStartDate}' AND '${req.query.taskEndDate}'`;
    }

    if (req.query.formStartDate && req.query.formEndDate) {
        query += ` AND cf.created_on BETWEEN '${req.query.taskStartDate}' AND '${req.query.taskEndDate}'`;
    }

    if (req.query.custID) {
        query += ` AND cf.customer_id = ${req.query.custID}`;
    }

    if (req.query.empID) {
        query += ` AND (cf.created_by = ${req.query.empID} OR (cf.created_by IS NULL AND el.empId = ${req.query.empID}))`;
    }

    if (req.query.taskType) {
        query += ` AND t.tas_type = '${req.query.taskType}'`;
    }

    let result = await DBSendResponse(query);

    result = result.map((form) => {
        form.json_schema = JSON.parse(form.json_schema);
        form.translated_json_schema = form.translated_json_schema ? JSON.parse(form.translated_json_schema) : null;
        form.formData = JSON.parse(form.data);
        form.locInfo = JSON.parse(form.locInfo);
        return form;
    })

    res.json(result);
}

exports.getFormCount = async function (req, res) {
    const query = `SELECT COUNT(*) AS count FROM customer_form WHERE form_type = ${req.params.id}`
    const result = await DBSendResponse(query)
    res.json(result)
}
