const db = require('../models/indexSQL.js')
const moment = require('moment')
const crypto = require('crypto')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries.js')
const { CUSTOMERIO_API_KEY, env } = require('../config.js')
const { APIClient, SendEmailRequest } = require("customerio-node");
const client = new APIClient(CUSTOMERIO_API_KEY);

/* CREATE TABLE tokens (
    token_id INT PRIMARY KEY IDENTITY(1,1),
    token NVARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used BIT NOT NULL DEFAULT 0,
    entity_data NVARCHAR(MAX),
    entity_type NVARCHAR(50) NOT NULL, -- Type of entity (e.g., 'form', 'document')
    created_by INT FOREIGN KEY REFERENCES employee(emp_id),
    created_on DATETIME NOT NULL
  ); */

  // entity_type: form: entity_data: { form_ids: [n], task_id: n, customer_id: n, signature_required: 0/1, customer_name: 'name', company_id: n, company_name: 'name' }


  exports.getToken = async function (req, res) {
    try {
        const query = `select * from tokens where token = '${req.query.token}'`
        const token = await DBSendResponse(query)

        console.log(token);
        
        
        if (token.length == 0) {
            console.log('Token not found');
            res.status(404).json({ error: 'Token not found' })
            return
        }

        if (token[0].used) {
            res.status(400).json({ error: 'Token already used' })
            return
        }

        if (token[0].expires_at < moment().format('YYYY-MM-DD HH:mm:ss')) {
            res.status(400).json({ error: 'Token expired' })
            return
        }

        res.json(token)
    } catch (err) {
        console.log(err);
        
        res.json({ error: err })
    }
}

exports.insertToken = async function (req, res) {
    try {
        const query = `insert into tokens (token, expires_at, entity_data, entity_type, created_by, created_on) OUTPUT INSERTED.* 
        values ('${crypto.randomBytes(32).toString('hex')}', '${req.body.expires_at}', '${req.body.entity_data}', '${req.body.entity_type}', ${req.body.created_by}, '${moment().format('YYYY-MM-DD HH:mm:ss')}')`
        const token = await DBinsertSendResponse(query)

        res.json(token)
    } catch (err) {
        console.log(err);
        
        res.json({ error: err })
    }   
}

exports.updateToken = async function (req, res) {
    try {
        const query = `update tokens set used = 1 where token = '${req.body.token}'`
        const token = await DBSendResponse(query)
        res.json(token)
    }
    catch (err) {
        res.json({ error: err })
    }
}

exports.sendEmail = async function (req, res) {
    // form_data: { email, token, task_id, form_ids, customer_id, created_by, employee_name }
    try {
        
        let type = req.params.type;

        let site

        switch(env) {
            case 'prod':
                site = 'https://app.fieldworker.ai/form/'
                break;
            case 'test':
                site = 'https://test.fieldworker.ai/form/'
                break;
            case 'dev':
                site = 'https://dev.fieldworker.ai/form/'
                break;
            default:
                site = 'http://localhost:3000/form/'
        }

        let emailData = {
            ...req.body.data,
            site,
        }
        

        let emailRequest = new SendEmailRequest({
            transactional_message_id: type,
            message_data: emailData,
            identifiers: {
                id: req.body.employee_id,
            },
            to: req.body.email
        });

        let response = await client.sendEmail(emailRequest);
        console.log(response);
        
        res.json({ code: 200 });
    }
    catch (err) {
        console.error('sendEmail error:', err);
        res.json({ error: err.message || 'Failed to send email' });
    }
}
        
