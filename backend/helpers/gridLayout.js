const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const axios = require('axios');
const moment = require('moment');

exports.getGridLayout = async function (req, res) {
  try {
    const getLayout = `SELECT * FROM GridLayout WHERE companyID = ${req.query.companyID} AND employeeType = '${req.query.employeeType}'`;
    const layout = await DBSendResponse(getLayout);

    if (layout.length > 0) {
      return res.status(200).json(layout);
    }

    const getDefaultEmpTypeLayout = `SELECT * FROM GridLayout WHERE companyID = -1 AND companyLineOfBusiness = ${req.query.LineOfBusiness} AND employeeType = '${req.query.employeeType}'`;
    const defaultEmpTypeLayout = await DBSendResponse(getDefaultEmpTypeLayout);

    if (defaultEmpTypeLayout.length > 0) {
      return res.status(200).json(defaultEmpTypeLayout);
    } else {
      const getDefaultLayout = `SELECT * FROM GridLayout WHERE companyID = -1 AND companyLineOfBusiness = ${req.query.LineOfBusiness} AND employeeType = 'Others'`;
      const defaultLayout = await DBSendResponse(getDefaultLayout);

      return res.status(200).json(defaultLayout);
    }
  } catch (err) {
    console.log('QUERY FAILURE | getGridLayout Query Failed:');
    console.log(err);
    return res.status(400).json({
      message: 'An unexpected error occured',
    });
  }
};

exports.addGridLayout = async function (req, res) {
  try {
    const data = {
      layoutConfig: generateSQLText(req.body.layoutConfig, 256, null),
      layoutType: generateSQLText(req.body.layoutType, 50, null),
      layoutAddedBy: isNaN(parseInt(req.body.layoutAddedBy)) ? null : parseInt(req.body.layoutAddedBy),
      layoutAddedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
      employeeType: generateSQLText(req.body.employeeType, 50, null),
      companyID: isNaN(parseInt(req.body.companyID)) ? null : parseInt(req.body.companyID),
      companyState: generateSQLText(req.body.companyState, 50, null),
      companyLineOfBusiness: isNaN(parseInt(req.body.companyLineOfBusiness)) ? null : parseInt(req.body.companyLineOfBusiness)
    };

    const query = generateInsertSQL('GridLayout', data) + 'SELECT SCOPE_IDENTITY()';
    const newGridLayoutId = await DBinsertSendID(query);

    res.status(200).json({
      id: newGridLayoutId
    });
  } catch (err) {
    console.log('QUERY FAILURE | addGridLayout Query Failed:');
    console.log(err);
    res.status(400).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.updateGridLayout = async function (req, res) {
  try {
    const data = {
      layoutConfig: generateSQLText(req.body.layoutConfig, 256, null),
      layoutType: generateSQLText(req.body.layoutType, 50, null),
      layoutAddedBy: isNaN(parseInt(req.body.layoutAddedBy)) ? null : parseInt(req.body.layoutAddedBy),
      layoutAddedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
      employeeType: generateSQLText(req.body.employeeType, 50, null),
    };
    const query = generateUpdateSQL('GridLayout', data, `layoutID = ${parseInt(req.body.layoutID)}`);
    await DBSendResponse(query);

    res.status(200).json({
      message: 'Grid Layout updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateGridLayout Query Failed:');
    console.log(err);
    res.status(400).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.deleteGridLayout = async function (req, res) {
  const query = `DELETE FROM GridLayout WHERE layoutID = ${parseInt(req.query.layoutID)}`;

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Grid Layout deleted successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | deleteGridLayout Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getGridLayoutContent = async function (req, res) {
  try {
    const getLayoutContent = `SELECT * FROM GridLayoutContent WHERE companyID = ${req.query.companyID} AND employeeType = '${req.query.employeeType}'`;
    const layoutContent = await DBSendResponse(getLayoutContent);

    if (layoutContent.length > 0) {
      return res.status(200).json(layoutContent);
    }

    const getDefaultEmpTypeLayoutContent = `SELECT * FROM GridLayoutContent WHERE companyID = -1 AND companyLineOfBusiness = ${req.query.LineOfBusiness} AND employeeType = '${req.query.employeeType}'`;
    const defaultEmpTypeLayoutContent = await DBSendResponse(getDefaultEmpTypeLayoutContent);

    if (defaultEmpTypeLayoutContent.length > 0) {
      return res.status(200).json(defaultEmpTypeLayoutContent);
    } else {
      const getDefaultLayoutContent = `SELECT * FROM GridLayoutContent WHERE companyID = -1 AND companyLineOfBusiness = ${req.query.LineOfBusiness} AND employeeType = 'Others'`;
      const defaultLayoutContent = await DBSendResponse(getDefaultLayoutContent);

      return res.status(200).json(defaultLayoutContent);
    }
  } catch (err) {
    console.log('QUERY FAILURE | getGridLayoutContent Query Failed:');
    console.log(err);
    return res.status(400).json({
      message: 'An unexpected error occured',
    });
  }
};

exports.addGridLayoutContent = async function (req, res) {
  try {
    const data = {
      layoutContent: generateSQLText(req.body.layoutContent, 256, null),
      layoutType: generateSQLText(req.body.layoutType, 50, null),
      contentAddedBy: isNaN(parseInt(req.body.contentAddedBy)) ? null : parseInt(req.body.contentAddedBy),
      contentAddedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
      employeeType: generateSQLText(req.body.employeeType, 50, null),
      companyID: isNaN(parseInt(req.body.companyID)) ? null : parseInt(req.body.companyID),
      companyState: generateSQLText(req.body.companyState, 50, null),
      companyLineOfBusiness: isNaN(parseInt(req.body.companyLineOfBusiness)) ? null : parseInt(req.body.companyLineOfBusiness)
    };

    const query = generateInsertSQL('GridLayoutContent', data) + 'SELECT SCOPE_IDENTITY()';
    const newGridLayoutContentId = await DBinsertSendID(query);

    res.status(200).json({
      id: newGridLayoutContentId
    });
  } catch (err) {
    console.log('QUERY FAILURE | addGridLayoutContent Query Failed:');
    console.log(err);
    res.status(400).json({
      message: 'An unexpected error occured'
    });
  }
};

exports.updateGridLayoutContent = async function (req, res) {
  try {
    const data = {
      layoutContent: generateSQLText(req.body.layoutContent, 256, null),
      layoutType: generateSQLText(req.body.layoutType, 50, null),
      contentAddedBy: isNaN(parseInt(req.body.contentAddedBy)) ? null : parseInt(req.body.contentAddedBy),
      contentAddedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
      employeeType: generateSQLText(req.body.employeeType, 50, null),
    };
    const query = generateUpdateSQL('GridLayoutContent', data, `layoutContentID = ${parseInt(req.body.layoutContentID)}`);
    await DBSendResponse(query);

    res.status(200).json({
      message: 'Grid Layout Content updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateGridLayoutContent Query Failed:');
    console.log(err);
    res.status(400).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.deleteGridLayoutContent = async function (req, res) {
  const query = `DELETE FROM GridLayoutContent WHERE layoutContentID = ${parseInt(req.query.layoutContentID)}`;

  try {
    await DBSendResponse(query);
    res.status(200).json({
      message: 'Grid Layout Content deleted successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | deleteGridLayoutContent Query Failed:');
    console.log(err);
    res.status(500).json({
      message: 'An unexpected error occurred'
    });
  }
};

exports.getGridLayoutForSettings = async function (req, res) {
  try {
    const getLayout = `SELECT * FROM GridLayout WHERE companyID = ${req.query.companyID} OR (companyID = -1 AND companyLineOfBusiness = ${req.query.LineOfBusiness})`;
    const layout = await DBSendResponse(getLayout);

    return res.status(200).json(layout);

  } catch (err) {
    console.log('QUERY FAILURE | getGridLayoutForSettings Query Failed:');
    console.log(err);
    return res.status(400).json({
      message: 'An unexpected error occured',
    });
  }
};

exports.getGridLayoutContentForSettings = async function (req, res) {
  try {
    const getLayoutContent = `SELECT * FROM GridLayoutContent WHERE companyID = ${req.query.companyID} OR (companyID = -1 AND companyLineOfBusiness = ${req.query.LineOfBusiness})`;
    const layoutContent = await DBSendResponse(getLayoutContent);

    return res.status(200).json(layoutContent);

  } catch (err) {
    console.log('QUERY FAILURE | getGridLayoutContentForSettings Query Failed:');
    console.log(err);
    return res.status(400).json({
      message: 'An unexpected error occured',
    });
  }
};