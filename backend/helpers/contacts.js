const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse, generateUpdateSQL } = require('../queries/commonQueries');
const { getContactList, getCustomerList } = require('../queries/entityGetQueries');
const { designationDD, contactStatusDD, contactTypeDD, statesDD } = require('../queries/dropdownQueries');
const { generateSQLText } = require('../utils/validation.js');
var { SEGMENT_API_KEY } = require('../config');
const { Analytics } = require('@segment/analytics-node');
const e = require('express');
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY });

// get all contacts
exports.getAllContacts = async function (req, res) {
  const id = req.query.comp_id;
  const query = `Select * from contact WHERE con_is_active='true' AND con_company_id=${id}`;
  const contacts = await DBSendResponse(query);
  const results = {
    contacts: contacts,
    cust_list: await getCustomerList(id),
    designation: await designationDD(id),
    contactType: await contactTypeDD(id),
    states: await statesDD(id),
    contactStatus: await contactStatusDD(id)
  };
  res.json(results);
};

exports.getContacts = async function (req, res) {
  let conList;
  if (req.query.com_id) {
    conList = await getContList(req, res);
  } else if (!!req.query.customer_id && !!req.query.comp_id) {
    conList = await getContactsByCustomer(req, res);
  } else {
    conList = await getContactList(req.query.comp_id);
  }
  res.json(conList);
};

exports.addNewContact = async function (req, res) {
  addContact(req, res);
};

exports.updateContact = async function (req, res) {
  updateOneContact(req, res);
};

exports.delContact = async function (req, res) {
  delOneContact(req, res);
};

async function getContList(req, res) {
  const id = req.query.com_id;
  const query = `Select * from contact left join customer on cus_id = con_customer_id WHERE con_is_active='true' AND con_company_id=${id}`;
  let contacts = await DBSendResponse(query);
  if (req.query.cust_id) {
    contacts = contacts.filter((con) => con.con_customer_id === +req.query.cust_id && !!con.con_is_active);
  } else if (req.query.con_id) {
    contacts = contacts.filter((con) => con.con_id === +req.query.con_id && !!con.con_is_active);
  } else if (req.query.contact_type) {
    contacts = contacts.filter((con) => con.con_contact_type === req.query.contact_type && !!con.con_is_active);
  } else {
    contacts = contacts.filter((con) => !!con.con_is_active);
  }
  if (!!req.query.lastN && contacts.length > +req.query.lastN) {
    contacts = contacts.slice(Math.max(contacts.length - +req.query.lastN, 0));
  }
  return contacts;
}

function addContact(req, res) {
  let fname = (req.body.first_name ?? '').normalize('NFC');
  fname = fname.replace('\'', '\'\'');
  let lname = (req.body.last_name ?? '').normalize('NFC');
  lname = lname.replace('\'', '\'\'');
  let note = req.body.con_note ? req.body.con_note.normalize('NFC') : '';
  note = note.replace('\'', '\'\'');
  const dateToken = (val) => {
    if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return 'NULL';
    return `'${String(val).replace('\'', '\'\'')}'`;
  };
  const firstContactDateToken = dateToken(req.body.first_contact_date);
  const lastContactDateToken = dateToken(req.body.last_contact_date);
  const prefCommMode = req.body.prefCommMode === undefined || req.body.prefCommMode === null || req.body.prefCommMode === 'undefined'
    ? ''
    : req.body.prefCommMode;
  console.log(req.body);
  const query = `insert into contact (
      con_first_name, con_last_name, con_Addr_line1, con_Addr_line2, con_city, con_state, con_zip,
      con_email, con_phone, con_designation, con_status, con_contact_type, con_note,
      con_first_contact_date, con_last_contact_date, con_created_at, con_customer_id,
      con_company_id, con_is_active, prefCommMode
    ) values (
      '${fname}', '${lname}',
      '${(req.body.address_line_1 ?? '').normalize('NFC')}',
      '${(req.body.address_line_2 ?? '').normalize('NFC')}',
      '${(req.body.city ?? '').normalize('NFC')}',
      '${(req.body.state ?? '').normalize('NFC')}',
      '${req.body.zip ?? ''}',
      '${(req.body.email ?? '').normalize('NFC')}',
      '${req.body.phoneList ?? ''}',
      '${req.body.designation ?? ''}',
      '${req.body.status ?? ''}',
      '${req.body.contact_type ?? ''}',
      '${note}',
      ${firstContactDateToken}, ${lastContactDateToken}, CURRENT_TIMESTAMP,
      ${!req.body.customer_id ? 'NULL' : req.body.customer_id},
      ${req.body.company_id}, 'true', '${prefCommMode}'
    );

    DECLARE @contact_id INT = SCOPE_IDENTITY();

    INSERT INTO ProjectContact (proj_id, cont_id)
    SELECT pro_id, @contact_id
    FROM project
    WHERE pro_customer_id = ${!req.body.customer_id ? 'NULL' : req.body.customer_id}
      AND pro_is_active = 'True';

    SELECT @contact_id;`;
  console.log(query);
  if (req.body.emp_id && req.body.company_id && req.body.emp_name && req.body.first_name && req.body.last_name) {
    analytics.track({
      userId: String(req.body.emp_id),
      event: 'New contact added',
      context: {
        groupId: req.body.company_id,
      },
      properties: {
        uploadedBy: req.body.emp_name,
        companyId: req.body.company_id,
        customerName: req.body.first_name + ' ' + req.body.last_name,
      },
    });
  }
  let result = DBinsert(res, query);
  console.log(result);
}

async function updateOneContact(req, res) {
  let fname = (req.body.first_name ?? '').normalize('NFC');
  fname = fname.replace('\'', '\'\'');
  let lname = (req.body.last_name ?? '').normalize('NFC');
  lname = lname.replace('\'', '\'\'');
  let note = req.body.con_note ? req.body.con_note.normalize('NFC') : '';
  note = note.replace('\'', '\'\'');
  const dateToken = (val) => {
    if (val === undefined || val === null || val === '' || val === 'undefined' || val === 'null') return 'NULL';
    return `'${String(val).replace('\'', '\'\'')}'`;
  };
  const prefCommMode = req.body.prefCommMode === undefined || req.body.prefCommMode === null || req.body.prefCommMode === 'undefined'
    ? ''
    : req.body.prefCommMode;
  const query = `UPDATE contact
           SET
             con_first_name='${fname}',
             con_last_name='${lname}',
             con_Addr_line1='${(req.body.address_line_1 ?? '').normalize('NFC')}',
             con_Addr_line2='${(req.body.address_line_2 ?? '').normalize('NFC')}',
             con_city='${(req.body.city ?? '').normalize('NFC')}',
             con_state='${(req.body.state ?? '').normalize('NFC')}',
             con_zip='${req.body.zip ?? ''}',
             con_email='${(req.body.email ?? '').normalize('NFC')}',
             con_phone='${req.body.phoneList ?? ''}',
             con_designation='${req.body.designation ?? ''}',
             con_status='${req.body.status ?? ''}',
             con_contact_type='${req.body.contact_type ?? ''}',
             con_note='${note}',
             con_first_contact_date=${dateToken(req.body.first_contact_date)},
             con_last_contact_date=${dateToken(req.body.last_contact_date)},
             con_updated_at=CURRENT_TIMESTAMP,
             con_company_id=${req.body.company_id},
             con_customer_id=${req.body.customer_id},
             prefCommMode='${prefCommMode}'
           WHERE con_id = ${req.body.cont_id}`;
  const out = await DBUpdate(query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}

async function delOneContact(req, res) {
  const booleanValue = req.body.bval;
  const id = req.body.id;
  const query = `UPDATE contact SET con_is_active = '${booleanValue}' WHERE con_id = ${id}`;
  // console.log(query)
  const out = await DBUpdate(query);
  if (out == 0) {
    res.json({ code: 500, message: 'Update failed' });
  } else {
    res.json({ code: 200, message: 'Update Success' });
  }
}


async function getContactsByCustomer(req, res) {
  const query = `SELECT c.* FROM contact c INNER JOIN ProjectContact pc ON c.con_id = pc.cont_id INNER JOIN project p ON pc.proj_id = p.pro_id WHERE p.pro_customer_id = ${req.query.customer_id} AND p.pro_com_id = ${req.query.comp_id} AND p.pro_is_active = 'True'
  UNION SELECT c.* FROM contact c WHERE c.con_customer_id = ${req.query.customer_id} AND c.con_company_id = ${req.query.comp_id}`;
  let contacts = await DBSendResponse(query);
  return contacts;
}

exports.getContactsByCustomer = getContactsByCustomer;

exports.updateContactEmail = async (req, res) => {
  try {
    const data = {
      con_email: generateSQLText(req.body.con_email, 255, null),
    };
    const query = generateUpdateSQL('contact', data, `con_id = ${parseInt(req.body.con_id)}`);
    await DBSendResponse(query);

    res.status(200).json({
      message: 'Contact Email updated successfully'
    });
  } catch (err) {
    console.log('QUERY FAILURE | updateContactEmail Query Failed:');
    console.log(err);
    res.status(400).json({
      message: 'An unexpected error occurred'
    });
  }
};
