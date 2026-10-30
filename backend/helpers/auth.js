const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBSendResponse } = require('../queries/commonQueries')
const moment = require('moment')
var {SEGMENT_API_KEY} = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })

exports.getUserDetails = async function (req, res) {

  await getUsers(req, res)
}

async function getUsers (req, res) {
  try {
    const query = `
      SELECT employee.*, company.*, company_logo.logo, company_logo.type
      FROM employee
      LEFT JOIN company ON employee.emp_company_id = company.com_id
      LEFT JOIN company_logo ON company.com_id = company_logo.com_id
      WHERE empEmail = '${req.query.email}'
    `;
    const users = await DBSendResponse(query);
    
    let data = [];
    
    req.log.debug(users);
    req.log.debug('getUsers() userList: ' + JSON.stringify(users));
    
    for (const user of users) {
        if (user.emp_is_active == false) {
            continue;
        }
    
        const Funcquery = `select s.feature_id,d.feature_value from settings as s, defaults as d where s.feature_id=d.feature_id and s.company_id=${user.com_id} and s.feature_value='functionality'`;
        const statequery = `select state_id,feature_value from settings where feature_id=99 and company_id=${user.com_id}`;
        const loginNumQuery = `select COUNT(*) as loginsDone from fw_log where action_detail = '${req.query.email}' and action_type LIKE '%login%'`;
    
        const subs = await DBSendResponse(Funcquery);
        const states = await DBSendResponse(statequery);
        const loginNumQ = await DBSendResponse(loginNumQuery);
        let currLogin = (loginNumQ && loginNumQ[0] ? loginNumQ[0].loginsDone : 0) + 1;

        const company_query = `select * from company where com_name='${user.com_name}'`;
        const companydata = await DBSendResponse(company_query);
    
        let date = moment().toDate();
        let subDate = companydata[0].subscriptionEndDate;
        let trialDate = companydata[0].trialEndDate;
        subDate = moment(subDate).add(3, 'days');
        trialDate = moment(trialDate).add(3, 'days');
        
        analytics.group({
          userId: String(user.emp_id),
          groupId: String(user.com_id),
          traits: {
            name: user.com_name
          }
        });
  
        analytics.identify({
          userId: String(user.emp_id),
          traits: {
            name: user.emp_first_name + " " + user.emp_last_name,
            email: user.sec_email,
            company_id: user.com_id,
            company: user.com_name,
            emp_created_at: user.emp_created_at
          }
        })
  
        analytics.track({
          userId: String(user.emp_id),
          event: 'Signed In',
          context: {
            groupId: user.com_id,
          },
          properties: {
            name: user.emp_first_name + " " + user.emp_last_name,
            email: user.sec_email,
            groupId: user.com_id,
            groupName: user.com_name, 
          }
        })

        if(user.logo) {
          let base64Logo = Buffer.from(user.logo).toString('base64');
          user.logo = `data:${user.type};base64,${base64Logo}`;
        }

        if(date<=subDate || date<=trialDate) {
          data.push({
            ...user,
            subs: subs,
            states: states,
            company: companydata,
            loginNum: currLogin
          });
        }
    }
    if(data.length == 0) {
      data = { code: 2, message: 'Account Could Not Be Found Or Subscription Expired' }
    }
    res.json(data);

  } catch(err) {
      console.log(`| ERROR | encountered error with getting user ${req.query.email}:`);
      console.log(err);
      res.json({ code: 1, message: 'Error occured while fetching user' });
  }
}

exports.getCustomerDetails = async function (req, res) {
  await getCustomers(req, res)
}

async function getCustomers (req, res) {
  const query = `select * from customer,company where cus_company_id=com_id and cus_email='${req.query.email}'`
  const user = await DBSendResponse(query)
  res.json(user)
}
