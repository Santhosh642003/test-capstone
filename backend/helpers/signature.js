const db = require("../models/indexSQL.js");
const { DBInsertAndReturn, DBSendResponse } = require("../queries/commonQueries.js");


exports.addSignature = async (req, res) => {
  try {
    let signatureBlob = req.file.buffer;
    console.log(req);
    let query = `INSERT into signatures (
      sig_pad,
      project_id,
      task_id,
      employee_id,
      captured,
      customer_id,
      location_id,
      sig_Lat,
      sig_Lon,
      Status
    ) 
    Values (
      0x${signatureBlob.toString('hex')},
      ${req.body.project_id ? `'${req.body.project_id}'` : 'NULL'},
      ${req.body.task_id ? `'${req.body.task_id}'` : 'NULL'},
      ${req.body.emp_id},
      CURRENT_TIMESTAMP,
      ${req.body.customer_id ? `'${req.body.customer_id}'` : 'NULL'},
      ${req.body.location_id ? `'${req.body.location_id}'` : 'NULL'},
      ${req.body.sign_Lat ? `'${req.body.sign_Lat}'` : 'NULL'},
      ${req.body.sign_Lon ? `'${req.body.sign_Lon}'` : 'NULL'},
      1
    ); Select SCOPE_IDENTITY();`
    const resp = await DBInsertAndReturn(query);
    console.log(resp)
    return res.json({
      data: resp,
    })
  } catch (err) {
    res.status(500).json({ message: "Failed to add signature, please try again" });
  }
};

exports.getSignature = async (req, res) => {
  if (req.query.task_id) {
    return getTaskSignature(req,res);
  } else if (req.query.emp_id) {
    return getMostRecentSignature(req, res);
  }
}

getTaskSignature = async (req,res) => {
  try {
    // console.log(req.query);
    let query = `select top 1 id, sig_pad, customer_id from signatures where task_id=${req.query.task_id} order by id desc`
    const resp = await DBSendResponse(query);
    // console.log(resp)
    const signatureBuffer = Buffer.from(resp[0].sig_pad)
    res.type('image/png');
    return res.send(signatureBuffer);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch the signature, please try again" });
  }
}

getMostRecentSignature = async (req, res) => {
  try {
    // console.log(req.query);
    let query = `SELECT TOP 1 sig_pad FROM signatures WHERE employee_id = ${req.query.emp_id} ORDER BY captured DESC`
    const resp = await DBSendResponse(query);
    // console.log(resp)
    const signatureBuffer = Buffer.from(resp[0].sig_pad)
    res.type('image/png');
    return res.send(signatureBuffer);
  } catch (err) {
    return res.status(500).json({ message: "Failed to fetch the signature, please try again" });
  }
}