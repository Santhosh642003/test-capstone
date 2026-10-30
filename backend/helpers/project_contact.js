const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse } = require('../queries/commonQueries');

exports.getProjContact = async function (req, res) {
  let projectContactList = [];
  const lastN = req.query.lastN;
  if (!!req.query.comp_id && !!req.query.project_id) {
    projectContactList = await getProjContacts(req);
  } else if (req.query.comp_id) {
    projectContactList = await getProjContactsByCompany(req.query.comp_id);
  } else if (req.query.project_id) {
    projectContactList = await getProjContactsByProject(req.query.project_id);
  } else if (req.query.customer_id){
    let allCustomerProjects = await DBSendResponse(`SELECT pro_id FROM project WHERE pro_customer_id = ${req.query.customer_id}`);
    projectContactList = await DBSendResponse(`SELECT * FROM ProjectContact, contact WHERE cont_id = con_id AND proj_id IN (${allCustomerProjects?.map(p => p.pro_id).join(',')})`);
    console.log(projectContactList);
  }
  if (!!lastN && projectContactList.length > lastN) {
    projectContactList = projectContactList.slice(Math.max(projectContactList.length - lastN, 0));
  }
  res.json(projectContactList);
};

exports.addProjContact = async function (req, res) {
  const hasRelationship = req.body.pc_relationship && typeof req.body.pc_relationship === 'string';
  const columns = hasRelationship ? 'proj_id,cont_id,pc_relationship' : 'proj_id,cont_id';
  const values = hasRelationship 
    ? `${req.body.projId},${req.body.contId},'${req.body.pc_relationship.replace(/'/g, '\'\'')}'`
    : `${req.body.projId},${req.body.contId}`;
  
  const query = `insert into ProjectContact(${columns}) values(${values}); SELECT SCOPE_IDENTITY()`;
  console.log(query);
  const projContactRes = await DBinsertSendID(query);
  if (!projContactRes) {
    res.json({ code: 500, message: 'Contact Add to Project Failed' });
  }
  res.json({ code: 200, message: 'Contact Add to Project Success' });
};

exports.delProjContact = async function (req, res) {
  const query = `DELETE FROM ProjectContact WHERE proj_id=${req.body.projId} AND cont_id=${req.body.contId}`;
  console.log(query);
  const delProjContactRes = await DBUpdate(query);
  if (delProjContactRes === 0) {
    res.json({ code: 500, message: 'Contact Del to Project Failed' });
  }
  res.json({ code: 200, message: 'Contact Del to Project Success' });
};
async function getProjContacts (req) {
  const query = `select * from ProjectContact,contact 
				 where cont_id = con_id and
				 con_company_id = ${req.query.comp_id} and 
				 proj_id = ${req.query.project_id}`;

  console.log(query);
  const pc_list = await DBinsertSendResponse(query);
  console.log(pc_list);
  return pc_list;
}

async function getProjContactsByCompany (comp_id) {
  const query = `select * from ProjectContact,contact where cont_id = con_id and con_company_id = ${comp_id}`;
  console.log(query);
  const pc_list = await DBinsertSendResponse(query);
  return pc_list;
}

async function getProjContactsByProject (project_id) {
  const query = `select * from ProjectContact,contact where cont_id = con_id and proj_id = ${project_id}`;
  console.log(query);
  const pc_list = await DBinsertSendResponse(query);
  return pc_list;
}
