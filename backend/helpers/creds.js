const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries')
var {SEGMENT_API_KEY} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })

async function getAllCompCreds (req, res) {
  const query = `select * from credentials where cred_company_id=${req.query.com_id}`
  const cred_List = await DBinsertSendResponse(query)
  res.json(cred_List)
}

async function getOneCred (req, res) {
  const query = `select * from credentials where cred_id=${req.query.cred_id}`
  const cred_List = await DBinsertSendResponse(query)
  res.json(cred_List)
}

async function getAllCreds (req, res) {
  const query = 'select * from credentials'
  const cred_List = await DBinsertSendResponse(query)
  res.json(cred_List)
}

exports.getCred = async function (req, res) {
  if (req.query.com_id) {
    await getAllCompCreds(req, res)
  } else if (req.query.cred_id) {
    await getOneCred(req, res)
  } else {
    await getAllCreds(req, res)
  }
}

exports.addCred = async function (req, res) {
  if (req.body.payerId) {
    const transaction = new db.Transaction()

    transaction.begin(err => {
      const request = new db.Request(transaction)

      request.query(`insert into credentials (cred_company_id,cred_clientID,cred_clientSecret,cred_created_at,cred_updated_at,cred_updatedby_id,cred_is_active,cred_con_email,bus_entity_id,bus_entity_Medicaid_identifier) values (${req.body.com_id},'${req.body.cred_clientID}','${req.body.cred_clientSecret}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,${req.body.emp_id},'true','${req.body.cred_con_email}','${req.body.bus_entity_id}','${req.body.bus_entity_Medicaid_identifier}'); SELECT SCOPE_IDENTITY()`, (err, result) => { 
        if(err) {
          console.log(err)
          transaction.rollback(err => {
            res.json({ code: 500, message: 'Update failed' })
          })
        } else {
          request.query(`UPDATE companyPayerRel SET credId = ${result.recordset[0]['']} WHERE payerId = ${req.body.payerId} and compId = ${req.body.com_id}`, (err, updateRes) => {
            if(err) {
              console.log(err)
              transaction.rollback(err => {
                res.json({ code: 500, message: 'Update failed' })
              })
            } else {
              transaction.commit(async err => {
                const selectQ = `SELECT * FROM credentials where credId = ${result.recordset[0]['']};`
                let credDets = await DBSendResponse(selectQ);
                let com_id = req.body.com_id, emp_id = req.body.emp_id;
                if (com_id && emp_id) {
                  analytics.track({
                    userId: String(emp_id),
                    event: 'Credentials added',
                    context: {
                      groupId: com_id,
                    },
                    properties: {
                      credId: result.recordset[0][''],
                    }
                  })
                  console.log("logged to segment successfully");
                }
                res.json({ code: 200, message: 'Update Success', credId: result.recordset[0][''], credDets: credDets });
              })
            }
          })
        }
      })
    })
  } else {
    const query = `insert into credentials (cred_company_id,cred_clientID,cred_clientSecret,cred_created_at,cred_updated_at,cred_updatedby_id,cred_is_active,cred_con_email,bus_entity_id,bus_entity_Medicaid_identifier) values (${req.body.com_id},'${req.body.cred_clientID}','${req.body.cred_clientSecret}',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,${req.body.emp_id},'true','${req.body.cred_con_email}','${req.body.bus_entity_id}','${req.body.bus_entity_Medicaid_identifier}'); SELECT SCOPE_IDENTITY()`
    // console.log(query)
    const cred_Id = await DBinsertSendID(query)

    if (!cred_Id) {
      res.json({ code: 500, message: 'Credentials Addition to DB Failed' })
    } else {
      let com_id = req.body.com_id, emp_id = req.body.emp_id;
      if (com_id && emp_id) {
        analytics.track({
          userId: String(emp_id),
          event: 'Credentials added',
          context: {
            groupId: com_id,
          },
          properties: {
            credId: cred_Id,
          }
        })
        console.log("logged to segment successfully");
      }
      res.json({ code: 200, cred_data: { cred_id: cred_Id }, message: 'Credentials Added to DB Success' })
    }
  }
}

exports.updateCred = async function (req, res) {
  const query = `update credentials SET 
                    cred_clientID='${req.body.cred_clientID}',
                    cred_clientSecret='${req.body.cred_clientSecret}',
                    cred_updated_at=CURRENT_TIMESTAMP,
                    cred_updatedby_id=${req.body.emp_id},
                    cred_is_active='${req.body.cred_is_active}',
                    cred_con_email='${req.body.cred_con_email}',
                    bus_entity_id='${req.body.bus_entity_id}',
                    bus_entity_Medicaid_identifier='${req.body.bus_entity_Medicaid_identifier}'
                    WHERE cred_id=${req.body.cred_id}`
  const cred_update_res = await DBUpdate(query)
  if (cred_update_res === 0) {
    res.json({ code: 500, message: 'Credentials Update Failed' })
  }
  let com_id = req.body.com_id, emp_id = req.body.emp_id;
  if (com_id && emp_id) {
    analytics.track({
      userId: String(emp_id),
      event: 'Credentials updated',
      context: {
        groupId: com_id,
      },
      properties: {
        credId: req.body.cred_id,
      }
    })
    console.log("logged to segment successfully");
  }
  res.json({ code: 200, cred_data: { id: req.body.cred_id }, message: 'Credentials Update Success' })
}

exports.delCred = async function (req, res) {
  const query = `update credentials SET cred_is_active='${req.body.cred_is_active}' WHERE cred_id=${req.body.cred_id}`
  const cred_update_res = await DBUpdate(query)
  if (cred_update_res === 0) {
    res.json({ code: 500, message: 'Credentials Update Failed' })
  }
  res.json({ code: 200, cred_data: { id: req.body.cred_id }, message: 'Comment Update Success' })
}
