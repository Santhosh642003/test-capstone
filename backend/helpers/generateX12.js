const e = require("express");
const db = require('../models/indexSQL.js')
const {
  DBinsertSendID,
  DBinsert,
  DBUpdate,
  DBSendResponse,
  DBinsertSendResponse,
  DBInsertAndReturn,
} = require("../queries/commonQueries");
const { handleCatchError } = require('../utils/helperFunction')

exports.addX12 = async function (req, res) {
  try {

    const transaction = new db.Transaction()

    transaction.begin(err => {
      const userData = req.body;
      const request = new db.Request(transaction)
      request.query(`INSERT INTO BiliingX12Status (companyID, uploadedBy, providerMedicaid, FileName, FileLocation, Status, CreateDate) VALUES (${userData.comp_id}, '${userData.emp_name}', '  ', '${userData.fileName}', '${userData.fileLocation}', '${userData.Status}', '${userData.SubmitDate}'); SELECT SCOPE_IDENTITY();`, (err, result) => {
        if(err) {
          console.log(err)
          transaction.rollback(err => {
            res.json({ code: 500, message: 'adding file to x12 failed!' })
          })
        } else {
          request.query(`UPDATE Claim SET fileId = ${result.recordset[0]['']} WHERE claim_ID IN (${userData.claim_IDs.join(",")});`, (error, finalResult) => {
            if (error) {
              console.log(error);
              transaction.rollback(err => {
                res.json({ code: 500, message: 'updating fileId in claim failed!'});
              })
            } else {
              transaction.commit(err => {
                return res.json({
                  success: true,
                  fileId: result.recordset[0][''],
                  claimsUpdated: finalResult.rowsAffected[0],
                  message: 'x12 file was generated and uploaded!'
                })
              })
            }
          })
        }
      });
    });
  } catch (err) {
    console.log(err);
    return handleCatchError(err, res)
  }
};
