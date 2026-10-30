const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const axios = require("axios");
const moment = require('moment');
const { APIClient, SendEmailRequest } = require("customerio-node");
const reportClient = require('@jsreport/nodejs-client')(process.env.JSREPORT_URL, process.env.JSREPORT_USER, process.env.JSREPORT_PW);
const { CUSTOMERIO_API_KEY } = require('../config.js');

const client = new APIClient(CUSTOMERIO_API_KEY);

exports.getPrivatePayerTasks = async function (req, res) {
    try {
        let privatePayerTaskQuery = `
        SELECT t.tas_id, t.tas_title, pro.pro_title, c.cus_id, c.cus_name, el.empLocdate, el.checkoutEmpDate, el.empLocate_timezone,
        FORMAT(tpcm.taskRate, 'N2') AS taskRate,
        FORMAT(DATEDIFF(SECOND, el.empLocdate, el.checkoutEmpDate) / 3600.0, 'N2') AS taskHours,
        FORMAT((DATEDIFF(SECOND, el.empLocdate, el.checkoutEmpDate) / 3600.0) * tpcm.taskRate, 'N2') AS taskAmount
            FROM task t
            JOIN project pro ON pro.pro_id = t.tas_pro_id
            JOIN customer c ON c.cus_id = pro.pro_customer_id
            JOIN empLocate el ON el.taskId = t.tas_id
            JOIN dropdowns dd ON dd.EntityValue = t.tas_type AND dd.CompanyID = t.tas_com_id
            JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
            JOIN provider_identifier pi ON pi.prov_iden_id = tpcm.providerIdentifier
        WHERE t.tas_com_id = ${req.query.compID}
            AND el.empLocdate >= '${req.query.fromDate}' AND el.empLocdate <= '${req.query.toDate}'
            AND t.task_invoice_id IS NULL
            AND pi.prov_name = 'Contract for Private Payers'
            AND pi.prov_iden = '999999'
        `;

        if (req.query.custID) {
            privatePayerTaskQuery += ` AND pro.pro_customer_id = ${req.query.custID} `;
        }

        const privatePayerTasks = await DBSendResponse(privatePayerTaskQuery);

        return res.status(200).json(privatePayerTasks);
    } catch (err) {
        console.log('QUERY FAILURE | getPrivatePayerTasks Query Failed:')
        console.log(err)
        return res.status(400).json({
            message: 'An unexpected error occured',
        })
    }
};

exports.getPrivatePayerInvoices = async function (req, res) {
    try {
        let privatePayerInvoiceQuery = `
        SELECT ppi.*, t.tas_id, t.tas_title, c.cus_name, e.emp_first_name, e.emp_last_name
            FROM PrivatePayerInvoice ppi
            JOIN task t ON t.task_invoice_id = ppi.invoiceID
            JOIN customer c ON c.cus_id = ppi.invoiceCustomer
            JOIN employee e ON e.emp_id = ppi.invoiceCreatedBy
        WHERE invoiceCompany = ${req.query.compID}
        `;

        if (req.query.custID) {
            privatePayerInvoiceQuery += ` AND invoiceCustomer = ${req.query.custID} `;
        }

        const privatePayerInvoices = await DBSendResponse(privatePayerInvoiceQuery);

        return res.status(200).json(privatePayerInvoices);
    } catch (err) {
        console.log('QUERY FAILURE | getPrivatePayerInvoices Query Failed:')
        console.log(err)
        return res.status(400).json({
            message: 'An unexpected error occured',
        })
    }
};

exports.generateInvoices = async function (req, res) {
    try {
        const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks : [];

        if (!tasks.length) {
            return res.status(400).json({ message: 'No tasks provided' });
        };

        // Group tasks by customer
        const groupedByCustomer = tasks.reduce((map, t) => {
            const key = t.cus_id;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(t);
            return map;
        }, new Map());

        const results = [];
        const DEFAULT_TAX_PERCENT = 10;

        for (const [cusId, customerTasks] of groupedByCustomer.entries()) {
            const parseNum = (val) => {
                if (val == null) return 0;
                const n = Number(String(val).replace(/,/g, ''));
                return Number.isFinite(n) ? n : 0;
            };

            const subTotal = customerTasks.reduce((sum, t) => {
                const amt = parseNum(t.taskAmount);
                return sum + (Number.isFinite(amt) ? amt : 0);
            }, 0);

            const taxAmount = subTotal * (DEFAULT_TAX_PERCENT / 100);
            const invoiceTotal = Math.round((subTotal + taxAmount) * 100) / 100;

            const data = {
                invoiceCompany: isNaN(parseInt(req.body.invoiceCompany)) ? null : parseInt(req.body.invoiceCompany),
                invoiceCustomer: isNaN(parseInt(cusId)) ? null : parseInt(cusId),
                invoiceNumber: generateSQLText(null, 128, null),
                invoiceTotal: invoiceTotal,
                invoiceCreatedBy: isNaN(parseInt(req.body.invoiceCreatedBy)) ? null : parseInt(req.body.invoiceCreatedBy),
                invoiceStatus: generateSQLText('Invoice Raised', 128, null),
                invoiceRaisedOn: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
            };

            const query = generateInsertSQL('PrivatePayerInvoice', data) + 'SELECT SCOPE_IDENTITY()';
            const newPrivatePayerInvoiceId = await DBinsertSendID(query);

            const updateInvoiceQuery = `
                UPDATE PrivatePayerInvoice
                SET invoiceNumber = CONCAT(YEAR(invoiceRaisedOn), ' - ', FORMAT(${newPrivatePayerInvoiceId}, 'D4'))
                WHERE invoiceID = ${newPrivatePayerInvoiceId}
            `;
            await DBUpdate(updateInvoiceQuery);

            const taskIds = customerTasks
                .map(t => parseInt(t.tas_id))
                .filter(n => Number.isInteger(n));

            if (taskIds.length) {
                const updateTaskQuery = `
                    UPDATE task
                    SET task_invoice_id = ${newPrivatePayerInvoiceId}
                    WHERE tas_id IN (${taskIds.join(',')})
                `;
                await DBUpdate(updateTaskQuery);
            }

            results.push({
                customerId: parseInt(cusId),
                invoiceId: newPrivatePayerInvoiceId,
            });
        }

        res.status(200).json({
            invoices: results
        })
    } catch (err) {
        console.log('QUERY FAILURE | generateInvoices Query Failed:')
        console.log(err)
        res.status(400).json({
            message: 'An unexpected error occured'
        })
    }
};

exports.sendInvoices = async function (req, res) {
    const compID = req.body.com_id;
    const empID = req.body.emp_id;
    const results = {
        successful: [],
        failed: []
    };

    try {
        const invoiceIds = Array.isArray(req.body.invoices)
            ? req.body.invoices.map(id => parseInt(id)).filter(n => Number.isInteger(n))
            : [];

        if (invoiceIds.length === 0) {
            return res.status(400).json({
                message: 'No valid invoice IDs provided',
                results: results
            });
        }

        const invoiceQuery = `
            SELECT 
                ppi.invoiceID,
                ppi.invoiceNumber,
                ppi.invoiceCustomer,
                ppi.invoiceRaisedOn,
                c.cus_name,
                c.private_payer,
                con.con_email,
                con.con_first_name,
                con.con_last_name,
                con.con_phone,
                comp.com_name
            FROM PrivatePayerInvoice ppi
            JOIN customer c ON c.cus_id = ppi.invoiceCustomer
            JOIN contact con ON con.con_id = c.private_payer
            JOIN company comp ON comp.com_id = ppi.invoiceCompany
            WHERE ppi.invoiceID IN (${invoiceIds.join(',')})
        `;

        const invoices = await DBSendResponse(invoiceQuery);

        if (!invoices || invoices.length === 0) {
            return res.status(200).json({
                message: 'No invoices found',
                results: results
            });
        }

        for (const invoice of invoices) {
            try {
                const pdfBuffer = await generateInvoicePDF(compID, invoice.invoiceID);

                const request = new SendEmailRequest({
                    transactional_message_id: "private_payer_invoice",
                    message_data: {
                        from_title: invoice.com_name,
                        company_name: invoice.com_name,
                        customer_name: invoice.cus_name,
                        contact_name: invoice.con_first_name,
                        invoice_number: `Invoice - ${invoice.invoiceNumber}`,
                        invoice_date: moment(invoice.invoiceRaisedOn).format('MM/DD/YYYY'),
                    },
                    identifiers: {
                        id: empID
                    },
                    to: invoice.con_email,
                    subject: `Invoice for ${invoice.cus_name}`
                });

                request.attach(
                    `Invoice-${invoice.invoiceNumber}.pdf`,
                    pdfBuffer
                );

                await client.sendEmail(request);

                // 1. Update invoice status
                const updateInvoiceQuery = `
                    UPDATE PrivatePayerInvoice 
                    SET invoiceStatus = 'Invoice Sent' 
                    WHERE invoiceID = ${invoice.invoiceID}
                `;
                await DBSendResponse(updateInvoiceQuery);

                // 2. Get all tasks associated with this invoice and insert into accounts_receivable
                const tasksQuery = `
                SELECT t.tas_id, t.tas_pro_id, pc.procProcCode,
                    FORMAT(tpcm.taskRate, 'N2') AS taskRate,
                    CASE
                        WHEN pc.procUnitOfService = '15 Minutes' THEN CEILING(DATEDIFF(MINUTE, el.empLocdate, el.checkoutEmpDate) / 15.0)
                        WHEN pc.procUnitOfService = '1 Hour' THEN CEILING(DATEDIFF(MINUTE, el.empLocdate, el.checkoutEmpDate) / 60.0)
                        ELSE 1
                    END AS taskUnits
                FROM task t
                JOIN empLocate el ON el.taskId = t.tas_id
                JOIN dropdowns dd ON dd.EntityValue = t.tas_type AND dd.CompanyID = t.tas_com_id
                JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
                JOIN procedure_code pc ON pc.procCode_id = tpcm.procedure_code_id AND pc.state_id = 'NJ'
                WHERE t.task_invoice_id = ${invoice.invoiceID}
                `;

                const tasks = await DBSendResponse(tasksQuery);

                for (const task of tasks) {
                    const insertARQuery = `
                        INSERT INTO accounts_receivable
                        (company_id, YYYYMM, customer_id, project_id, task_id, post_date, proc_code, unit, rate, account_code)
                        VALUES (
                            ${compID},
                            '${moment(invoice.invoiceRaisedOn).format('YYYYMM')}',
                            ${invoice.invoiceCustomer},
                            ${task.tas_pro_id},
                            ${task.tas_id},
                            CURRENT_TIMESTAMP,
                            '${task.procProcCode}',
                            ${task.taskUnits},
                            ${task.taskRate},
                            'SERVICE PROVIDED'
                        )
                    `;

                    await DBSendResponse(insertARQuery);
                }

                results.successful.push({
                    invoiceID: invoice.invoiceID,
                    invoiceNumber: invoice.invoiceNumber,
                    email: invoice.con_email,
                    customerName: invoice.cus_name,
                    tasksProcessed: tasks.length
                });
            } catch (error) {
                console.error(`Failed to send invoice ${invoice.invoiceNumber}:`, error);
                results.failed.push({
                    invoiceID: invoice.invoiceID,
                    invoiceNumber: invoice.invoiceNumber,
                    email: invoice.con_email,
                    customerName: invoice.cus_name,
                    error: error.message
                });
            }
        }

        return res.status(200).json({
            message: 'Invoice sending process completed',
            summary: {
                total: invoices.length,
                successful: results.successful.length,
                failed: results.failed.length
            },
            results: results
        });

    } catch (error) {
        console.error('Error in sendInvoices:', error);
        return res.status(500).json({
            error: 'Error processing invoices',
            message: error.message,
            results: results
        });
    }
};

const generateInvoicePDF = async (compID, invoiceID) => {
    const DEFAULT_TAX_PERCENT = 10;
    const DEFAULT_DUE_DAYS = 14;

    const invoiceQuery = `
        SELECT ppi.*, c.cus_name, c.cus_address, t.tas_title, FORMAT(tpcm.taskRate, 'N2') AS taskRate,
        FORMAT(DATEDIFF(SECOND, el.empLocdate, el.checkoutEmpDate) / 3600.0, 'N2') AS taskHours,
        FORMAT((DATEDIFF(SECOND, el.empLocdate, el.checkoutEmpDate) / 3600.0) * tpcm.taskRate, 'N2') AS taskAmount
        FROM PrivatePayerInvoice ppi
        JOIN customer c ON c.cus_id = ppi.invoiceCustomer
        JOIN task t ON t.task_invoice_id = ppi.invoiceID
        JOIN empLocate el ON el.taskId = t.tas_id
        JOIN dropdowns dd ON dd.EntityValue = t.tas_type AND dd.CompanyID = t.tas_com_id
        JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
        WHERE ppi.invoiceID = ${invoiceID}
    `;

    const invoiceData = await DBSendResponse(invoiceQuery);

    const parseNum = (val) => {
        if (val == null) return 0;
        const n = Number(String(val).replace(/,/g, ''));
        return Number.isFinite(n) ? n : 0;
    };

    const subTotal = invoiceData.reduce((sum, t) => {
        const amt = parseNum(t.taskAmount);
        return sum + (Number.isFinite(amt) ? amt : 0);
    }, 0);

    const taxAmount = subTotal * (DEFAULT_TAX_PERCENT / 100);
    const invoiceTotal = Math.round((subTotal + taxAmount) * 100) / 100;

    const companyQuery = `
        SELECT *
        FROM company c
        JOIN location l ON c.com_id = l.loc_company_id
        LEFT JOIN company_logo cl ON c.com_id = cl.com_id
        WHERE c.com_id = ${compID} AND l.loc_type ='COMPANY'
    `;
    const companyData = await DBSendResponse(companyQuery);

    let logoBase64 = null;

    if (companyData[0]?.logo) {
        const buffer = Buffer.from(companyData[0].logo, 'hex');
        logoBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    }

    const customerAddresses = invoiceData[0].cus_address?.split(':');

    return new Promise((resolve, reject) => {
        reportClient.render({
            template: {
                shortid: "FbOBnoisa",
            },
            data: {
                logoBase64: logoBase64,
                company: companyData[0],
                customerName: invoiceData[0].cus_name,
                customerAddress: Array.isArray(customerAddresses) && customerAddresses.length > 0 ? customerAddresses[0] : '',
                invoiceItems: invoiceData,
                invoiceNumber: invoiceData[0].invoiceNumber,
                invoiceDate: moment(invoiceData[0].invoiceDate).format('MM/DD/YYYY'),
                invoiceDueDate: moment(invoiceData[0].invoiceDate).add(DEFAULT_DUE_DAYS, 'days').format('MM/DD/YYYY'),
                invoiceDueDays: DEFAULT_DUE_DAYS,
                subTotal: subTotal.toFixed(2),
                taxPercent: DEFAULT_TAX_PERCENT,
                taxAmount: taxAmount.toFixed(2),
                invoiceTotal: invoiceTotal.toFixed(2)
            },
            options: {
                preview: false
            }
        }).then((response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).catch(reject);
    });
};