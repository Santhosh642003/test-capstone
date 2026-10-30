const e = require('express');
const moment = require('moment');
const {
  DBinsertSendID,
  DBinsert,
  DBUpdate,
  DBSendResponse,
  DBinsertSendResponse,
  generateInsertSQL,
  generateUpdateSQL
} = require('../queries/commonQueries');
const { isActualText, parseSQLText, generateSQLText } = require('../utils/validation');


exports.addCustomerGoal = async function (req, res) {
  if (!(req.body.customer_id && req.body.project_id && !isNaN(parseInt(req.body.customer_id)) && !isNaN(parseInt(req.body.project_id)))) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  const data = {
    customer_id: parseInt(req.body.customer_id),
    project_id: parseInt(req.body.project_id),
    goal_title: generateSQLText(req.body.goal_title, 128, 'New Goal'),
    goal_detail: generateSQLText(req.body.goal_detail, 8000, 'New Goal Details'),
    goal_status: isNaN(parseInt(req.body.goal_status)) ? 0 : parseInt(req.body.goal_status),
    goal_progress: isNaN(parseInt(req.body.goal_progress)) ? 0 : parseInt(req.body.goal_progress)
  };
  const query = generateInsertSQL('customer_goal', data) + 'SELECT SCOPE_IDENTITY()';

  try {
    const newCustomerGoalId = await DBinsertSendID(query);
    res.status(200).json({
      id: newCustomerGoalId
    });
  } catch (err) {
    console.log('QUERY FAILURE | addCustomerGoal Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.updateCustomerGoal = async function (req, res) {
  if (!(req.body.customer_id && req.body.project_id && req.body.customer_goal_id && !isNaN(parseInt(req.body.customer_id)) && !isNaN(parseInt(req.body.project_id)) && !isNaN(parseInt(req.body.customer_goal_id)))) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  const data = {
    customer_id: parseInt(req.body.customer_id),
    project_id: parseInt(req.body.project_id),
    goal_title: generateSQLText(req.body.goal_title, 128, 'New Goal'),
    goal_detail: generateSQLText(req.body.goal_detail, 8000, 'New Goal Details'),
    goal_status: isNaN(parseInt(req.body.goal_status)) ? 0 : parseInt(req.body.goal_status),
    goal_progress: isNaN(parseInt(req.body.goal_progress)) ? 0 : parseInt(req.body.goal_progress)
  };
  const query = generateUpdateSQL('customer_goal', data, `customer_goal_id = ${parseInt(req.body.customer_goal_id)}`);

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Goal updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateCustomerGoal Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getCustomerGoal = async function (req, res) {
  const conditions = [];
  if (req.query.customer_id && !isNaN(parseInt(req.query.customer_id))) { conditions.push(`customer_id = ${parseInt(req.query.customer_id)}`); }
  if (req.query.project_id && !isNaN(parseInt(req.query.project_id))) { conditions.push(`project_id = ${parseInt(req.query.project_id)}`); }
  if (req.query.customer_goal_id && !isNaN(parseInt(req.query.customer_goal_id))) { conditions.push(`customer_goal_id = ${parseInt(req.query.customer_goal_id)}`); }
  if (conditions.length === 0) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  let query = 'SELECT * FROM customer_goal WHERE ';
  query += conditions.join(' AND ');

  try {
    let response = await DBinsertSendResponse(query);
    response = response.filter(goal => goal.goal_status != 3);
    res.status(200).json(response);
  } catch (err) {
    console.log('QUERY FAILURE | getCustomerGoal Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.removeCustomerGoal = async function (req, res) {
  const { customer_goal_id } = req.query;

  if (!customer_goal_id) {
    return res.status(400).json({ error: 'Missing customer_goal_id' });
  }

  try {
    const query = `UPDATE customer_goal SET goal_status = 3 WHERE customer_goal_id = ${customer_goal_id}`;
    await DBSendResponse(query);
    res.status(200).json({ message: 'Customer goal removed successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while removing the customer goal' });
  }
};

exports.addPermittedTask = async function (req, res) {
  if (!(req.body.customer_goal_id && req.body.taskProcCode_id && !isNaN(parseInt(req.body.customer_goal_id)) && !isNaN(parseInt(req.body.taskProcCode_id)))) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  const data = {
    'customer_goal_id': parseInt(req.body.customer_goal_id),
    'taskProcCode_id': parseInt(req.body.taskProcCode_id),
    'goal_reference': generateSQLText(req.body.goal_reference, 255, null),
    'billable_to': req.body.billable_to ? parseInt(req.body.billable_to) : null,
    'provider_assigned': req.body.provider_assigned ? parseInt(req.body.provider_assigned) : null,
    'location_assigned': req.body.location_assigned ? parseInt(req.body.location_assigned) : null,
    'start_date': req.body.start_date,
    'end_date': req.body.end_date,
    'total_cost': parseFloat(req.body.total_cost)
  };
  const query = generateInsertSQL('permitted_task', data) + 'SELECT SCOPE_IDENTITY()';

  try {
    //check for an existing permitted task with the same customer_goal_id and taskProcCode_id
    const checkQuery = `SELECT * FROM permitted_task WHERE customer_goal_id = ${parseInt(req.body.customer_goal_id)} AND taskProcCode_id = ${parseInt(req.body.taskProcCode_id)}`;
    const checkResponse = await DBinsertSendResponse(checkQuery);
    if (checkResponse.length > 0) {
      res.status(400).json({
        message: 'A permitted task with the same customer goal and task type already exists'
      });
      return;
    }
    const newPermittedTaskId = await DBinsertSendID(query);
    res.status(200).json({
      id: newPermittedTaskId
    });
  } catch (err) {
    console.log('QUERY FAILURE | addPermittedTask Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.updatePermittedTask = async function (req, res) {
  if (!(req.body.permitted_task_id && !isNaN(parseInt(req.body.permitted_task_id)))) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  const data = {
    'customer_goal_id': parseInt(req.body.customer_goal_id),
    'taskProcCode_id': parseInt(req.body.taskProcCode_id),
    'goal_reference': generateSQLText(req.body.goal_reference, 255, null),
    'billable_to': req.body.billable_to ? parseInt(req.body.billable_to) : null,
    'provider_assigned': req.body.provider_assigned ? parseInt(req.body.provider_assigned) : null,
    'location_assigned': req.body.location_assigned ? parseInt(req.body.location_assigned) : null,
    'start_date': req.body.start_date,
    'end_date': req.body.end_date,
    'total_cost': parseFloat(req.body.total_cost)
  };
  const query = generateUpdateSQL('permitted_task', data, `permitted_task_id = ${parseInt(req.body.permitted_task_id)}`);

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Permitted task updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updatePermittedTask Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getPermittedTask = async function (req, res) {
  const conditions = [];
  if (req.query.permitted_task_id && !isNaN(parseInt(req.query.permitted_task_id))) {
    conditions.push(`permitted_task_id = ${parseInt(req.query.permitted_task_id)}`);
  }

  if (req.query.customer_goal_id && !isNaN(parseInt(req.query.customer_goal_id))) {
    conditions.push(`customer_goal_id = ${parseInt(req.query.customer_goal_id)}`);
  }
  if (conditions.length === 0) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  let query = 'SELECT * FROM permitted_task WHERE ';
  query += conditions.join(' AND ');

  try {
    const permittedTasksResponse = await DBinsertSendResponse(query);

    let finalResponse = [];

    for (let task of permittedTasksResponse) {
      // Step 1: Get dropdown_id
      let dropdown_id_query = `SELECT dropdown_id FROM TaskProcCodeMapping WHERE taskProcCode_id = ${task.taskProcCode_id}`;
      let dropdown_id_result = await DBinsertSendResponse(dropdown_id_query);
      let dropdown_id = dropdown_id_result[0]?.dropdown_id;

      // Step 2: Get EntityName
      let entity_value_query = `SELECT EntityValue FROM dropdowns WHERE ddID = ${dropdown_id}`;
      let entity_value_result = await DBinsertSendResponse(entity_value_query);
      let entity_value = entity_value_result[0]?.EntityValue;

      // Step 3: Get customer_id
      let customer_query = `SELECT customer_id FROM customer_goal WHERE customer_goal_id = ${task.customer_goal_id}`;
      let customer_result = await DBinsertSendResponse(customer_query);
      let customer_id = customer_result[0]?.customer_id;

      //push a row to finalResponse with the current task, dropdown_id, and entity_value
      let response_data = {
        ...task,
        dropdown_id: parseInt(dropdown_id),
        task_type_name: entity_value,
        customer_id: customer_id
      };

      finalResponse.push(response_data);
    }

    res.status(200).json(finalResponse);
  } catch (err) {
    console.log('QUERY FAILURE | getPermittedTask Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.removePermittedTask = async function (req, res) {
  if (!(req.query.permitted_task_id && !isNaN(parseInt(req.query.permitted_task_id)))) {
    res.status(400).json({
      message: 'There were missing or invalid required fields'
    });
    return;
  }

  const query = `DELETE FROM permitted_task WHERE permitted_task_id = ${parseInt(req.query.permitted_task_id)}`;

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Permitted task deleted successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | removePermittedTask Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getCustomerGoalsByTaskType = async function (req, res) {
  const query = `SELECT cg.customer_goal_id, cg.goal_title, cg.goal_detail
        FROM customer_goal cg 
        JOIN permitted_task pt ON pt.customer_goal_id = cg.customer_goal_id
        JOIN TaskProcCodeMapping tm ON tm.taskProcCode_id = pt.taskProcCode_id
        JOIN dropdowns dd ON dd.ddID = tm.dropdown_id
        JOIN task t ON t.tas_pro_id = cg.project_id
    WHERE cg.customer_id = ${req.query.customer_id} AND cg.goal_status != 3 AND t.tas_id = ${req.query.task_id} AND dd.EntityValue = t.tas_type`;

  let result = await DBSendResponse(query);

  res.json(result);
};