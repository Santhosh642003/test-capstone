const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');

const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

async function getAllPayers (req, res) {
  const query = 'select * from payer';
  let payer_List = await DBinsertSendResponse(query);
  if(req.query.comp_id){
    let queryforpayerSettings = `select * from settings where feature_id=${99} and company_id=${req.query.comp_id}`; 
    let payerSettings_List = await DBinsertSendResponse(queryforpayerSettings);
    payerSettings_List = payerSettings_List.map((pay)=> {
      return pay.state_id;
    });
    console.log(payerSettings_List.map((p) => `'${p}'`));
    let def_payers = await DBSendResponse(`select * from def_payer_state where payer_state in (${payerSettings_List.map((p) => `'${p}'`).join(',')})`);
    def_payers = def_payers.map((p) => p.payer_id);
    console.log(payer_List[0]);
    payer_List = payer_List.map(p => {
      if (def_payers.includes(String(p.payer_id))) {
        return {
          ...p,
          default_payer: true,
        };
      } else {
        return {
          ...p,
          default_payer: false,
        };
      }
    });
    payer_List = payer_List.filter((pay)=> payerSettings_List.includes(pay.payer_state));
  }
  res.json(payer_List);
}

async function getOnePayer (req, res) {
  const query = `select * from payer where payer_id=${req.query.payer_id}`;
  const payer_List = await DBinsertSendResponse(query);
  res.json(payer_List);
}

exports.getPayer = async function (req, res) {
  if (req.query.payer_id) {
    await getOnePayer(req, res);
  } else {
    await getAllPayers(req, res);
  }
};

exports.addPayer = async function (req, res) {
  const query = `insert into payer (payer_name,payer_phone,payer_is_active,payerTaxID,con_first_name,con_last_name,payer_Addr_line1,payer_Addr_line2,payer_state,payer_city,payer_zip,con_designation) values ('${req.body.payer_name}','${req.body.payer_phone}','true','${req.body.payerTaxID}','${req.body.con_first_name}','${req.body.con_last_name}','${req.body.payer_Addr_line1}','${req.body.payer_Addr_line2}','${req.body.payer_state}','${req.body.payer_city}','${req.body.payer_zip}','${req.body.con_designation}'); SELECT SCOPE_IDENTITY()`;
  console.log(query);
  try {
    const payer_Id = await DBinsertSendID(query);
    if (payer_Id) {
      // UPDATE COMPANY
      const compQuery = `UPDATE company SET payerId=${payer_Id} where com_id=${req.body.com_id}`;
      const compStatus = await DBUpdate(compQuery);
      if (compStatus === 0) {
        res.json({ code: 500, message: 'Payer Update to DB Failed' });
      } else {
        let com_id = req.body.com_id, emp_id = req.body.emp_id;
        if (com_id && emp_id) {
          analytics.track({
            userId: String(emp_id),
            event: 'Payer added',
            context: {
              groupId: com_id,
            },
            properties: {
              payerId: payer_Id,
            }
          });
          console.log('logged to segment successfully');
        }
        res.json({ code: 200, payer_data: { payer_id: payer_Id }, message: 'Payer Added to DB Success' });
      }
    } else {
      res.json({ code: 500, message: 'Payer Addition to DB Failed' });
    }
  } catch (err) {
    console.log(err);
    res.json({ code: 500, message: 'Payer Addition to DB Failed' });
  }
};

exports.updatePayer = async function (req, res) {
  const query = `update payer SET 
        payer_name='${req.body.payer_name}',
        payerTaxID='${req.body.payerTaxID}',
        con_first_name='${req.body.con_first_name}',
        con_last_name='${req.body.con_last_name}',
        payer_Addr_line1='${req.body.payer_Addr_line1}',
        payer_Addr_line2='${req.body.payer_Addr_line2}',
        payer_state='${req.body.payer_state}',
        payer_city='${req.body.payer_city}',
        payer_zip='${req.body.payer_zip}',
        con_designation='${req.body.con_designation}',
        payer_phone='${req.body.payer_phone}',
        payer_is_active='true'
        WHERE payer_id=${req.body.payer_id}`;
  const payer_update_res = await DBUpdate(query);
  if (payer_update_res === 0) {
    res.json({ code: 500, message: 'Payer Update Failed' });
  }
  let com_id = req.body.com_id, emp_id = req.body.emp_id;
  if (com_id && emp_id) {
    analytics.track({
      userId: String(emp_id),
      event: 'Payer details updated',
      context: {
        groupId: com_id,
      },
      properties: {
        payerId: req.body.payer_id
      }
    });
    console.log('logged to segment successfully');
  }
  res.json({ code: 200, payer_data: { id: req.body.payer_id }, message: 'Payer Update Success' });
};

exports.delPayer = async function (req, res) {
  const query = `update payer SET payer_is_active='false' WHERE payer_id=${req.body.payer_id}`;
  const comment_update_res = await DBUpdate(query);
  if (comment_update_res === 0) {
    res.json({ code: 500, message: 'Payer Update Failed' });
  }
  res.json({ code: 200, payer_data: { id: req.body.payer_id }, message: 'Payer Update Success' });
};
