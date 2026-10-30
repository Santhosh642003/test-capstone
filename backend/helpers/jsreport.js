const { type } = require('express/lib/response');
const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries')
const { getReportData, getDebarData } = require('./exclusionsList');
const client = require('@jsreport/nodejs-client')(process.env.JSREPORT_URL, process.env.JSREPORT_USER, process.env.JSREPORT_PW);
const moment = require('moment');
const axios = require('axios');
var zipcode_to_timezone = require('zipcode-to-timezone');
const jwt_decode = require('../utils/tokenDecoder.js')
const { getCustomersAssociatedAPI } = require('./customers.js');
const { getAssociatedEmployeesAPI } = require('./employees.js');
var { SEGMENT_API_KEY } = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })

exports.getDebarmentReport = async (req, res) => {
    if (req.query.com_id) {
        const reportData = await getReportData(req.query.com_id);

        const com_id = JSON.parse(req.query.com_id)
        const employee_id = req.query.emp_id;
        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`

        const companyData = await DBSendResponse(companyQuery);

        const date = moment().format('YYYY-MM-DD')
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        try {
            client.render({
                template: {
                    shortid: "Au5Ut-LUrv",
                },
                data: {
                    employeesDebarementReport: reportData,
                    company: companyData[0],
                    date: date,
                    datetime: datetime
                },
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'Debarment Report Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
            }).catch((err) => {
                console.error('Error rendering Debarment Report:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Debarment Report try block:', err);
            res.status(500).send('Error generating report');
        }
    }
}

exports.getDebarmentReportV2 = async (req, res) => {
    if (req.query.com_id) {
        const com_id = JSON.parse(req.query.com_id)
        const employee_id = req.query.emp_id;

        const employeesQuery = `SELECT
                emp.emp_id,
                emp.emp_first_name,
                emp.emp_last_name,
                emp.emp_addr_line1,
                emp.emp_addr_line2,
                emp.emp_city,
                emp.emp_state,
                emp.emp_zip,
                emp.emp_status,
                emp.emp_type,
                emp.emp_is_active,
                CASE WHEN ex.LASTNAME IS NOT NULL THEN 1 ELSE 0 END AS is_excluded,
                ex.EXCLTYPE,
                ex.EXCLDATE,
                ex.WVRSTATE,
                ex.WAIVERDATE,
                ex.REINDATE
            FROM [dbo].[employee] emp
            LEFT JOIN [dbo].[exclusions_list] ex
                ON LTRIM(RTRIM(ex.FIRSTNAME)) = UPPER(emp.emp_first_name)
                AND LTRIM(RTRIM(ex.LASTNAME)) = UPPER(emp.emp_last_name)
                AND ex.ZIP = emp.emp_zip
            WHERE emp.emp_company_id = ${com_id}
            ORDER BY CASE WHEN ex.LASTNAME IS NOT NULL THEN 0 ELSE 1 END, emp.emp_last_name, emp.emp_first_name`;

        const reportData = await DBSendResponse(employeesQuery);

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`

        const companyData = await DBSendResponse(companyQuery);

        const date = moment().format('YYYY-MM-DD')
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        const excludedCount = Array.isArray(reportData)
            ? reportData.filter((r) => r.is_excluded === 1 || r.is_excluded === true).length
            : 0;

        try {
            client.render({
                template: {
                    shortid: "5LBFo7xD4",
                },
                data: {
                    employeesReport: reportData,
                    totalEmployees: Array.isArray(reportData) ? reportData.length : 0,
                    excludedCount: excludedCount,
                    company: companyData[0],
                    date: date,
                    datetime: datetime
                },
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'Debarment Report V2 Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
            }).catch((err) => {
                console.error('Error rendering Debarment Report V2:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Debarment Report V2 try block:', err);
            res.status(500).send('Error generating report');
        }
    }
}

exports.getConsolidatedDebarmentReport = async (req, res) => {
    if (req.query.com_id) {
        const reportData = await getDebarData(req.query.com_id);

        const com_id = JSON.parse(req.query.com_id)
        const employee_id = req.query.emp_id
        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`

        const companyData = await DBSendResponse(companyQuery);

        const date = moment().format('YYYY-MM-DD')
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        try {
            client.render({
                template: {
                    shortid: "IzvGJgXDc",
                },
                data: {
                    employeesDebarementReport: reportData,
                    company: companyData[0],
                    date: date,
                    datetime: datetime
                },
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'NJ Consolidated Debarment Report Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
            }).catch((err) => {
                console.error('Error rendering Consolidated Debarment Report:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Consolidated Debarment Report try block:', err);
            res.status(500).send('Error generating report');
        }
    }
}

exports.getConsolidatedDebarmentReportV2 = async (req, res) => {
    if (req.query.com_id) {
        const com_id = JSON.parse(req.query.com_id)
        const employee_id = req.query.emp_id;

        const employeesQuery = `SELECT
                emp.emp_id,
                emp.emp_first_name,
                emp.emp_last_name,
                emp.emp_addr_line1,
                emp.emp_addr_line2,
                emp.emp_city,
                emp.emp_state,
                emp.emp_zip,
                emp.emp_status,
                emp.emp_type,
                emp.emp_is_active,
                CASE WHEN d.IndividualLastName IS NOT NULL THEN 1 ELSE 0 END AS is_debarred,
                d.Category,
                d.Action,
                d.Reason,
                d.DebarringAgency
            FROM [dbo].[employee] emp
            LEFT JOIN [dbo].[DebarmentData] d
                ON d.IndividualLastName <> '' AND d.IndividualLastName = UPPER(emp.emp_last_name)
                AND d.IndividualFirstName <> '' AND d.IndividualFirstName = UPPER(emp.emp_first_name)
                AND d.IndividualZIP <> '' AND d.IndividualZIP = emp.emp_zip
            WHERE emp.emp_company_id = ${com_id}
            ORDER BY CASE WHEN d.IndividualLastName IS NOT NULL THEN 0 ELSE 1 END, emp.emp_last_name, emp.emp_first_name`;

        const reportData = await DBSendResponse(employeesQuery);

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`

        const companyData = await DBSendResponse(companyQuery);

        const date = moment().format('YYYY-MM-DD')
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        const debarredCount = Array.isArray(reportData)
            ? reportData.filter((r) => r.is_debarred === 1 || r.is_debarred === true).length
            : 0;

        try {
            client.render({
                template: {
                    shortid: "JvKrx9p-H",
                },
                data: {
                    employeesReport: reportData,
                    totalEmployees: Array.isArray(reportData) ? reportData.length : 0,
                    debarredCount: debarredCount,
                    company: companyData[0],
                    date: date,
                    datetime: datetime
                },
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'NJ Consolidated Debarment Report V2 Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
            }).catch((err) => {
                console.error('Error rendering Consolidated Debarment Report V2:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Consolidated Debarment Report V2 try block:', err);
            res.status(500).send('Error generating report');
        }
    }
}

exports.getPayrollReport = async (req, res) => {
    let companyData = [];
    let payrollData;
    let projectData;

    if (req.query.com_id) {
        let com_id = JSON.parse(req.query.com_id);

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`

        companyData = await DBSendResponse(companyQuery);

        if (companyData) {
            //Need the payroll info both for the report and to get our empLocate info
            let payroll_type;

            if (companyData[0].payCycle === "Monthly")
                payroll_type = "MONTH";
            else if (companyData[0].payCycle === 'Semi-Monthly')
                payroll_type = "SEMIMONTH";
            else if (companyData[0].payCycle === "Bi-Weekly")
                payroll_type = "BIWEEK";
            else
                payroll_type = "WEEK";

            const year = moment().year();

            const payrollQuery = `SELECT * FROM pay_period INNER JOIN payroll ON payroll.pay_period_id = pay_period.pay_period_id WHERE company_id = ${com_id} and payroll_type='${payroll_type}' and start_date >= '${year}'`
            let payroll = await DBSendResponse(payrollQuery);
            console.log("PAYROLL DATA: ", payroll);

            payrollData = getPayPeriod(payroll);
            if (payrollData) {

                payrollData.start_date = moment(payrollData.start_date).format('YYYY-MM-DD')
                payrollData.end_date = moment(payrollData.end_date).format('YYYY-MM-DD')

                const projectQuery = `SELECT * FROM empLocate INNER JOIN project ON empLocate.projid=project.pro_id INNER JOIN employee ON empLocate.empid=employee.emp_id WHERE pro_com_id=${com_id} AND checkoutEmpDate <= '${payrollData.end_date}' AND empLocDate >= '${payrollData.start_date}'`
                projectData = await DBSendResponse(projectQuery);
                projectData.sort(compare);
                appendHours(projectData);
            }
        }
    }

    let datetime = getTimeZoneTime(companyData[0].loc_zip)
    let com_id = req.query.com_id;
    let employee_id = req.query.emp_id;
    let startDate = payrollData ? (payrollData.start_date ? payrollData.start_date : "-") : "-"
    let endDate = payrollData ? (payrollData.end_date ? payrollData.end_date : "-") : "-"

    console.log(companyData, projectData, payrollData);


    try {
        client.render({
            template: {
                shortid: "nuZ373w8pR",
            },
            data: {
                company: companyData[0],
                project: projectData,
                payroll: payrollData,
                datetime: datetime
            },
            options: {
                preview: true
            }
        }).then((response) => {
            if (com_id && employee_id && startDate && endDate) {
                analytics.track({
                    userId: String(employee_id),
                    event: 'Payroll Report Generated',
                    context: {
                        groupId: com_id,
                    },
                    properties: {
                        companyId: com_id,
                        startDate: startDate,
                        endDate: endDate,
                    }
                })
                console.log("logged to segment successfully");
            }
            response.pipe((res))
        }).catch((err) => {
            console.error('Error rendering Payroll Report:', err);
            res.status(500).send('Error generating report');
        });
    } catch (err) {
        console.error('Error in Payroll Report try block:', err);
        res.status(500).send('Error generating report');
    }
}

exports.getInvoiceReport = async (req, res) => {
    let com_id = JSON.parse(req.query.com_id);
    let employee_id = JSON.parse(req.query.emp_id);
    console.log(req.query)

    let associatedCustomers = await getCustomersAssociatedAPI(com_id, employee_id);
    let cus_ids = []
    for (const customer of associatedCustomers) {
        cus_ids.push(customer.cus_id)
    }

    const companyQuery = `SELECT * from company as a,location as b
    where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`

    let companyData = await DBSendResponse(companyQuery)

    const invoiceQuery = `SELECT invoice_id AS id, CONVERT(varchar, invoice_date, 101) as invoice_date, cus_name, procProcCode, invoice_number, line_item_no, amount
    FROM invoice i, customer c
    WHERE i.line_item_no > 0 AND i.customer_id = c.cus_id AND c.cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1}) AND i.comp_id = ${com_id} and i.invoice_date >= '${req.query.start}' AND i.invoice_date <= '${req.query.end}' ORDER BY cus_name,invoice_date DESC,invoice_number ASC, procProcCode ASC,line_item_no;`

    // console.log(invoiceQuery)

    const privatePayerInvoiceQuery = `SELECT 
                ppi.invoiceID as id,
                ppi.invoiceNumber as invoice_number,
                ppi.invoiceCustomer,
                ppi.invoiceRaisedOn as invoice_date,
                ppi.invoiceTotal as amount,
                c.cus_name as cus_name
            FROM PrivatePayerInvoice ppi
            JOIN customer c ON c.cus_id = ppi.invoiceCustomer
            WHERE ppi.invoiceCompany = ${com_id}
            AND ppi.invoiceStatus IN ('Invoice Raised', 'Invoice Sent')
            AND ppi.invoiceRaisedOn >= '${req.query.start}' AND ppi.invoiceRaisedOn <= '${req.query.end}'
            AND c.cus_id in (${(cus_ids && cus_ids.length > 0) ? cus_ids : -1})`;

    console.log(privatePayerInvoiceQuery)

    let invoiceData = await DBSendResponse(invoiceQuery);
    let privatePayerInvoiceData = await DBSendResponse(privatePayerInvoiceQuery);
    console.log(privatePayerInvoiceData);

    for (let invoice of privatePayerInvoiceData) {
        const procCodeQuery = `SELECT t.tas_id, t.tas_pro_id, pc.procProcCode,
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
                WHERE t.task_invoice_id = ${invoice.id}`;
        let procCodeData = await DBSendResponse(procCodeQuery);
        if (procCodeData && procCodeData.length > 0) {
            invoiceData.push({
                ...invoice,
                procProcCode: procCodeData.length === 1 ? procCodeData[0].procProcCode : 'Multiple',
            });
        } else {
            invoiceData.push({
                ...invoice,
                procProcCode: 'N/A',
            });
        }
    }

    //get invoice time based on company location using zip code
    let datetime = getTimeZoneTime(companyData[0].loc_zip)

    //get invoice total amount
    let tot = 0
    for (let i = 0; i < invoiceData.length; i++) {
        tot = invoiceData[i].amount + tot
    }
    tot = Math.round(tot * 100) / 100

    try {
        client.render({
            template: {
                shortid: "sowTMv1P5i",
            },
            data: {
                company: companyData[0],
                invoice: invoiceData,
                total: tot,
                datetime: datetime,
                start: moment(req.query.start).format('MM/DD/YYYY'),
                end: moment(req.query.end).format('MM/DD/YYYY')
            },
            options: {
                preview: true
            }
        }).then((response) => {
            if (com_id && employee_id && req.query.start && req.query.end) {
                analytics.track({
                    userId: String(employee_id),
                    event: 'Invoice Report Generated',
                    context: {
                        groupId: com_id,
                    },
                    properties: {
                        companyId: com_id,
                        startDate: moment(req.query.start).format('MM/DD/YYYY'),
                        endDate: moment(req.query.end).format('MM/DD/YYYY'),
                    }
                })
                console.log("logged to segment successfully");
            }
            response.pipe((res))
            console.log("success")
        }).catch((err) => {
            console.error('Error rendering Invoice Report:', err);
            res.status(500).send('Error generating report');
        });
    } catch (err) {
        console.error('Error in Invoice Report try block:', err);
        res.status(500).send('Error generating report');
    }
}

exports.getCM_InvoiceReport = async (req, res) => {
    try {
        let com_id = JSON.parse(req.query.com_id);
        let employee_id = req.query.emp_id;
        let cus_id = JSON.parse(req.query.cus_id);
        let cus_name = req.query.cus_name;
        let dateFilter = JSON.parse(req.query.dateFilter);
        let dateType = req.query.dateType;

        const billingRatesQuery = `SELECT dropdowns.EntityValue, TaskProcCodeMapping.taskRate 
        FROM dropdowns
        JOIN TaskProcCodeMapping ON TaskProcCodeMapping.dropdown_id = dropdowns.ddID
        WHERE dropdowns.CompanyID = ${com_id}`
        let billingRates = await DBSendResponse(billingRatesQuery)

        let rateMap = {};
        billingRates.forEach(item => {
            rateMap[item.EntityValue] = item.taskRate ? item.taskRate : 0;
        });

        const taskQuery = `SELECT * 
                                FROM project p
                                JOIN task t ON t.tas_pro_id = p.pro_id
                                LEFT JOIN empLocate el ON el.taskId = t.tas_id
                            WHERE p.pro_com_id = ${com_id} and p.pro_customer_id = ${cus_id} AND t.tas_is_active != 2`
        let taskData = await DBSendResponse(taskQuery)

        const uniqueProIds = new Set();

        for (const row of taskData) {
            uniqueProIds.add(row.pro_id);
        }

        const proIds = Array.from(uniqueProIds);

        const commentsQuery = `SELECT * from comments where customer_id = ${cus_id}`
        let commentsData = await DBSendResponse(commentsQuery)

        commentsData = commentsData.map(comment => {
            const comment_string = isJSON(comment.comment_text) ? JSON.parse(comment.comment_text).blocks.map(block => block.text).join(' ') : comment.comment_text;

            return {
                ...comment,
                comment_text: comment_string
            };
        });

        let custComments = commentsData.filter((comment) => comment.customer_id === cus_id && !comment.proj_id && !comment.task_id);

        if (custComments.length !== 0) {
            for (let j = 0; j < custComments.length; j++) {
                taskData.push({
                    tas_start_time: null,
                    tas_end_time: null,
                    tas_start_date: custComments[j].created_at,
                    tas_description: '',
                    tas_notes: '',
                    comments: custComments[j].comment_text,
                    nonTaskComment: true,
                })
            }
        }

        for (let i = 0; i < proIds.length; i++) {
            let projComments = commentsData.filter((comment) => comment.proj_id === proIds[i] && !comment.task_id);

            if (projComments.length !== 0) {
                for (let j = 0; j < projComments.length; j++) {
                    taskData.push({
                        tas_start_time: null,
                        tas_end_time: null,
                        tas_start_date: projComments[j].created_at,
                        tas_description: '',
                        tas_notes: '',
                        comments: projComments[j].comment_text,
                        nonTaskComment: true,
                    })
                }
            }
        }

        taskData.sort((a, b) => new Date(a.tas_start_date) - new Date(b.tas_start_date))

        if (dateType === 'Monthly') {
            taskData = taskData.filter(task => moment(task.checkoutEmpDate ? task.checkoutEmpDate : task.tas_start_date).isSame(new Date(JSON.parse(req.query.from)), 'year') && (moment(task.checkoutEmpDate ? task.checkoutEmpDate : task.tas_start_date).utc().month() + 1) === dateFilter)
        } else if (dateType === 'Quarterly') {
            taskData = taskData.filter((task) => {
                const taskStartDate = new Date(task.tas_start_date);
                return taskStartDate >= new Date(dateFilter.quarterStart) && taskStartDate <= new Date(dateFilter.quarterEnd);
            });
        } else if (dateType === 'Yearly') {
            taskData = taskData.filter((task) => {
                const taskStartDate = new Date(task.checkoutEmpDate ? task.checkoutEmpDate : task.tas_start_date);
                const taskYear = taskStartDate.getFullYear();
                return taskYear === dateFilter;
            });
        } else if (dateType === 'None') {
            taskData = taskData.filter((task) => {
                const taskStartDate = new Date(task.checkoutEmpDate ? task.checkoutEmpDate : task.tas_start_date);
                return taskStartDate >= new Date(dateFilter.start) && taskStartDate <= new Date(dateFilter.end);
            });
        }

        for (let i = 0; i < taskData.length; i++) {
            if (!taskData[i].nonTaskComment) {
                taskComments = commentsData.filter((comment) => comment.task_id === taskData[i].tas_id);
                taskData[i].comments = ""
                for (let j = 0; j < taskComments.length; j++) {
                    taskData[i].comments += (" | " + taskComments[j].comment_text)
                }
            }
        }

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`

        companyData = await DBSendResponse(companyQuery);

        let invoiceData = []
        await Promise.all(taskData.map(async function (task) {
            let duration = task.empLocId ? moment(task.checkoutEmpDate).diff(moment(task.empLocdate), 'minutes') : moment(task.tas_end_time).diff(moment(task.tas_start_time), 'minutes');
            let hr = Math.round((duration / 60) * 100) / 100;
            let rate = rateMap[task.tas_type] ? rateMap[task.tas_type] : 0;
            const invoice = {
                Date: task.empLocId ? moment(task.checkoutEmpDate).utc().format('MM/DD/YY') : moment(task.tas_start_date).utc().format('MM/DD/YY'),
                Description: (!!task.tas_description ? task.tas_description : '') + (!!task.tas_notes ? (' | ' + task.tas_notes) : '') + (!!task.comments ? task.comments : ''),
                TaskType: task.tas_type ? task.tas_type : '-',
                Hours: toHoursAndMinutes(duration),
                Rate: rate,
                Amount: !task.nonTaskComment ? Math.round((hr * rate) * 100) / 100 : 0,
                nonTaskComment: task.nonTaskComment,
            };

            invoiceData.push(invoice);
        }))

        let total = 0
        for (let i = 0; i < invoiceData.length; i++) {
            total += invoiceData[i].Amount
        }
        total = Math.round(total * 100) / 100

        //get invoice time based on company location using zip code
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        try {
            client.render({
                template: {
                    shortid: "QVxuHBp3d",
                },
                data: {
                    company: companyData[0],
                    invoice: invoiceData,
                    total: total,
                    datetime: datetime,
                    cus_name: cus_name,
                    from: moment(JSON.parse(req.query.from)).utc().format('MM/DD/YYYY'),
                    to: moment(JSON.parse(req.query.to)).utc().format('MM/DD/YYYY')
                },
                options: {
                    preview: true
                }
            }).then((response) => {
                console.log(com_id, employee_id, dateFilter, cus_id)
                if (com_id && employee_id && dateFilter && cus_id) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'Customer Invoice Report Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                            cusId: cus_id,
                            dateFilter: dateFilter,
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
                console.log("success")
            }).catch((err) => {
                console.error('Error rendering Customer Invoice Report:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Customer Invoice Report try block:', err);
            res.status(500).send('Error generating report');
        }
    }
    catch (err) {
        res.sendStatus(204)
        console.log(err)
    }
}

exports.getBillingTransReport = async (req, res) => {
    try {
        let com_id = JSON.parse(req.query.com_id);
        let employee_id = req.query.emp_id;

        let claimQuery = `SELECT * from Claim WHERE companyID = ${com_id} AND startDate >= '${req.query.start}' AND startDate <='${req.query.end}'`
        if (req.query.cus_DDDIDs) {
            claimQuery += ` AND DDDID in (${req.query.cus_DDDIDs})`
        }
        let claimData = await DBSendResponse(claimQuery)
        console.log(claimData)

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`
        companyData = await DBSendResponse(companyQuery);

        let billingTransData = []
        await Promise.all(claimData.map(async function (claim) {
            const billing = {
                Medicaid_ID: claim.memberMedicaid,
                PriorAuth_ID: claim.priorAuth,
                Claim_ID: claim.claim_ID,
                Payment_Number: '',
                Patient_Name: claim.FirstName + ' ' + claim.LastName,
                Adjustment_Reason: '',
                Service_Date: moment(claim.startDate).format('MM/DD/YYYY'),
                Deposit_Date: claim.SubmitDate ? moment(claim.SubmitDate).format('MM/DD/YYYY') : '',
                Ins_Amount: claim.authAmount,
                Pat_Amount: 0.0
            };

            billingTransData.push(billing);
        }))
        // STEPS:
        /*
        1) Get all invoices for the company within the date range and optional customer filter
        2) For each invoice, get all tasks associated with it within the date range
        3) From the tasks, extract unique prior auths and service dates, if multiple tasks have same service date, we show that date
         */
        // First query: Get all invoices
        const invoiceQuery = `
            SELECT DISTINCT
                ppi.invoiceID as claim_ID,
                c.medicaid_id,
                c.cus_name as patient_name,
                ppi.invoiceTotal as ins_amount
            FROM PrivatePayerInvoice ppi
            JOIN customer c ON c.cus_id = ppi.invoiceCustomer
            JOIN task t ON t.task_invoice_id = ppi.invoiceID
            JOIN emplocate el ON el.taskId = t.tas_id
            WHERE el.empLocDate >= '${req.query.start}' AND el.empLocDate <= '${req.query.end}'
            AND ppi.invoiceCompany = ${com_id}
            AND ppi.invoiceStatus IN ('Invoice Raised', 'Invoice Sent')
            ${req.query.cus_DDDIDs ? `AND c.cus_id IN (${req.query.cus_DDDIDs})` : ''}
        `;

        const invoices = await DBSendResponse(invoiceQuery);

        // Second query: Get tasks and preauths for each invoice
        await Promise.all(invoices.map(async (invoice) => {
            const taskQuery = `
                SELECT 
                    pa.priorAuth,
                    el.empLocDate
                FROM task t
                JOIN emplocate el ON el.taskId = t.tas_id
                LEFT JOIN preAuth pa ON pa.primaryID = t.tas_preAuth_id
                WHERE t.task_invoice_id = ${invoice.claim_ID}
                AND el.empLocDate BETWEEN '${req.query.start}' AND '${req.query.end}'
            `;

            const tasks = await DBSendResponse(taskQuery);

            if (tasks.length === 0) {
                return;
            }
            console.log("Tasks for invoice ", invoice.claim_ID, tasks, [...new Set(tasks.map(t => t.empLocDate))]);
            const uniquePreAuths = [...new Set(tasks.map(t => t.priorAuth).filter(Boolean))];
            const priorAuth_ID = uniquePreAuths.length > 1 ? 'Multiple' :
                uniquePreAuths.length === 1 ? uniquePreAuths[0] : '';

            const uniqueDates = [...new Set(tasks.map(t => moment(t.empLocDate).format('YYYY-MM-DD')))];
            const service_date = uniqueDates.length > 1 ? 'Multiple' :
                uniqueDates.length === 1 ? moment(uniqueDates[0]).format('MM/DD/YYYY') : '';

            const billing = {
                Medicaid_ID: invoice.medicaid_id,
                PriorAuth_ID: priorAuth_ID,
                Claim_ID: invoice.claim_ID,
                Payment_Number: '',
                Patient_Name: invoice.patient_name,
                Adjustment_Reason: '',
                Service_Date: service_date,
                Deposit_Date: '',
                Ins_Amount: invoice.ins_amount,
                Pat_Amount: 0.0
            };

            billingTransData.push(billing);
        }));

        let insTotal = 0
        let patTotal = 0
        for (let i = 0; i < billingTransData.length; i++) {
            insTotal += billingTransData[i].Ins_Amount
            patTotal += billingTransData[i].Pat_Amount
        }
        insTotal = Math.round(insTotal * 100) / 100
        patTotal = Math.round(patTotal * 100) / 100

        //get invoice time based on company location using zip code
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        const reportData = {
            company: companyData[0],
            billing: billingTransData,
            insTotal: insTotal,
            patTotal: patTotal,
            datetime: datetime,
            start: moment(req.query.start).format('MM/DD/YYYY'),
            end: moment(req.query.end).format('MM/DD/YYYY')
        };

        if (claimData.length > 2000) {
            return res.status(200).json({
                tooLarge: true,
                claimData: reportData
            });
        }

        try {
            client.render({
                template: {
                    shortid: "BCxcKqGHc",
                },
                data: reportData,
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id && req.query.start && req.query.end) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'Billing Transaction Report Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                            startDate: moment(req.query.start).format('MM/DD/YYYY'),
                            endDate: moment(req.query.end).format('MM/DD/YYYY'),
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
                console.log("success")
            }).catch((err) => {
                console.error('Error rendering Billing Transaction Report:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Billing Transaction Report try block:', err);
            res.status(500).send('Error generating report');
        }
    }
    catch (err) {
        res.sendStatus(204)
        console.log(err)
    }
}

exports.getClaimCollectReport = async (req, res) => {
    try {
        let com_id = JSON.parse(req.query.com_id);
        let employee_id = req.query.emp_id;

        const claimQuery = `SELECT * from Claim WHERE companyID = ${com_id} and startDate >= '${req.query.start}' AND startDate <='${req.query.end}' ORDER BY startDate ASC`;
        let claimData = await DBSendResponse(claimQuery)

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`
        companyData = await DBSendResponse(companyQuery);

        let claimCollectData = []
        await Promise.all(claimData.map(async function (claim) {
            const collection = {
                Trans_Date: moment(claim.startDate).format('MM/DD/YYYY'),
                Claim_ID: claim.claim_ID,
                Order_Date: moment(claim.startDate).format('MM/DD/YYYY'),
                Patient_Name: claim.FirstName + ' ' + claim.LastName,
                Ins_Carrier: 'Medicaid',
                Net_Sale: claim.authAmount,
                Ins_Recieve: 0.0,
                Ins_Payment: 0.0,
                Pat_Payment: 0.0,
                Collect_Amount: 0.0,
                Collect_Reason: '',
                status: claim.Status
            };

            claimCollectData.push(collection);
        }))

        const invoiceQuery = `
            SELECT DISTINCT
                ppi.invoiceID as claim_ID,
                c.medicaid_id,
                c.cus_name as patient_name,
                ppi.invoiceTotal as ins_amount,
                con.con_first_name,
                con.con_last_name,
                ppi.invoiceStatus as status,
                ppi.invoiceRaisedOn as invoice_date
            FROM PrivatePayerInvoice ppi
            JOIN customer c ON c.cus_id = ppi.invoiceCustomer
            JOIN task t ON t.task_invoice_id = ppi.invoiceID
            JOIN emplocate el ON el.taskId = t.tas_id
            JOIN contact con ON c.private_payer = con.con_id
            WHERE el.empLocDate >= '${req.query.start}' AND el.empLocDate <= '${req.query.end}'
            AND ppi.invoiceCompany = ${com_id}
            AND ppi.invoiceStatus NOT IN ('Invoice Paid')
            ${req.query.cus_DDDIDs ? `AND c.cus_id IN (${req.query.cus_DDDIDs})` : ''}
        `;

        const invoices = await DBSendResponse(invoiceQuery);

        // Second query: Get tasks and preauths for each invoice
        await Promise.all(invoices.map(async (invoice) => {


            const collection = {
                Trans_Date: invoice.invoice_date ? moment(invoice.invoice_date).format('MM/DD/YYYY') : '',
                Claim_ID: invoice.claim_ID,
                Order_Date: invoice.invoice_date ? moment(invoice.invoice_date).format('MM/DD/YYYY') : '',
                Patient_Name: invoice.patient_name,
                Ins_Carrier: invoice.con_first_name + ' ' + invoice.con_last_name,
                Net_Sale: invoice.ins_amount,
                Ins_Recieve: 0.0,
                Ins_Payment: 0.0,
                Pat_Payment: 0.0,
                Collect_Amount: 0.0,
                Collect_Reason: '',
                status: invoice.status
            };
            claimCollectData.push(collection);

        }));

        let netTotal = 0
        let insRecTotal = 0
        let insPayTotal = 0
        let patPayTotal = 0
        let collTotal = 0
        for (let i = 0; i < claimCollectData.length; i++) {
            netTotal += claimCollectData[i].Net_Sale
            insRecTotal += claimCollectData[i].Ins_Recieve
            insPayTotal += claimCollectData[i].Ins_Payment
            patPayTotal += claimCollectData[i].Pat_Payment
            collTotal += claimCollectData[i].Collect_Amount
        }
        netTotal = Math.round(netTotal * 100) / 100
        insRecTotal = Math.round(insRecTotal * 100) / 100
        insPayTotal = Math.round(insPayTotal * 100) / 100
        patPayTotal = Math.round(patPayTotal * 100) / 100
        collTotal = Math.round(collTotal * 100) / 100

        //get invoice time based on company location using zip code
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        const reportData = {
            from: moment(req.query.start).format('MM/DD/YYYY'),
            to: moment(req.query.end).format('MM/DD/YYYY'),
            company: companyData[0],
            collection: claimCollectData,
            netTotal: netTotal,
            insRecTotal: insRecTotal,
            insPayTotal: insPayTotal,
            patPayTotal: patPayTotal,
            collTotal: collTotal,
            datetime: datetime
        };

        if (claimData.length > 2000) {
            return res.status(200).json({
                tooLarge: true,
                claimData: reportData
            });
        }

        try {
            client.render({
                template: {
                    shortid: "FLk_2mF4n",
                },
                data: reportData,
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id && req.query.start && req.query.end) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'Claim Collection Report Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                            startDate: moment(req.query.start).format('MM/DD/YYYY'),
                            endDate: moment(req.query.end).format('MM/DD/YYYY'),
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
                console.log("success")
            }).catch((err) => {
                console.error('Error rendering Claim Collection Report:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Claim Collection Report try block:', err);
            res.status(500).send('Error generating report');
        }
    }
    catch (err) {
        res.sendStatus(204)
        console.log(err)
    }
}

exports.getClaimBalanceReport = async (req, res) => {
    try {
        let com_id = JSON.parse(req.query.com_id);
        let cutoff = moment(req.query.cutoff).toJSON();
        let employee_id = req.query.emp_id;

        const claimQuery = `SELECT * from Claim WHERE companyID = ${com_id} AND startDate <='${cutoff}' AND Status != 'Processed as Primary' ORDER BY CreateDate desc`
        let claimData = await DBSendResponse(claimQuery)

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`
        companyData = await DBSendResponse(companyQuery);

        let outstandingData = []
        await Promise.all(claimData.map(async function (claim) {
            const outstanding = {
                Plan_Name: 'Medicaid',
                Claim_ID: claim.claim_ID,
                Patient_Name: claim.FirstName + ' ' + claim.LastName,
                Service_Date: moment(claim.startDate).format('MM/DD/YYYY'),
                Status: claim.Status,
                Balance: claim.authAmount,
            };

            outstandingData.push(outstanding);
        }))

        //
        // STEPS:
        /*  1) Get all invoices for the company up to the cutoff date (filtering is on task date for invoices NOT the invoice date)
        2) For each invoice, get all tasks associated with it up to the cutoff date
        3) From the tasks, extract unique service dates, if multiple tasks have same service date, we show that date
         */


        const invoiceQuery = `
            SELECT DISTINCT
                ppi.invoiceID as claim_ID,
                c.cus_name as patient_name,
                ppi.invoiceTotal as balance,
                ppi.invoiceStatus as status,
				ppi.invoiceRaisedOn,
                con.con_first_name,
				con.con_last_name
            FROM PrivatePayerInvoice ppi
            JOIN customer c ON c.cus_id = ppi.invoiceCustomer
            JOIN task t ON t.task_invoice_id = ppi.invoiceID
            JOIN emplocate el ON el.taskId = t.tas_id
            JOIN contact con ON c.private_payer = con.con_id
            WHERE el.empLocDate <= '${cutoff}'
            AND ppi.invoiceCompany = ${com_id}
            AND ppi.invoiceStatus IN ('Invoice Raised', 'Invoice Sent')
            ORDER BY ppi.invoiceRaisedOn DESC
        `;

        const invoices = await DBSendResponse(invoiceQuery);

        console.log(invoices)

        // For each invoice, get task dates
        await Promise.all(invoices.map(async (invoice) => {
            const taskQuery = `
                SELECT 
                    el.empLocDate
                FROM task t
                JOIN emplocate el ON el.taskId = t.tas_id
                WHERE t.task_invoice_id = ${invoice.claim_ID}
                AND el.empLocDate <= '${cutoff}'
            `;

            const tasks = await DBSendResponse(taskQuery);

            // Determine service_date
            const dateStrings = tasks.map(t => moment(t.empLocDate).format('YYYY-MM-DD'));
            const uniqueDates = [...new Set(dateStrings)];
            const service_date = uniqueDates.length > 1 ? 'Multiple' :
                uniqueDates.length === 1 ? moment(uniqueDates[0]).format('MM/DD/YYYY') : '';

            const outstanding = {
                Plan_Name: (invoice.con_first_name + ' ' + invoice.con_last_name),
                Claim_ID: invoice.claim_ID,
                Patient_Name: invoice.patient_name,
                Service_Date: service_date,
                Status: invoice.status,
                Balance: invoice.balance,
            };

            outstandingData.push(outstanding);
        }));
        let balTotal = 0
        for (let i = 0; i < outstandingData.length; i++) {
            balTotal += outstandingData[i].Balance
        }
        balTotal = Math.round(balTotal * 100) / 100

        let claimBalanceData = []
        await Promise.all(claimData.map(async function (claim) {
            let numDays = moment(cutoff).diff(moment(claim.startDate), 'days');
            const balance = {
                carrier: 'Medicaid',
                current: numDays <= 30 ? claim.authAmount : 0,
                _30: (numDays > 30 && numDays <= 60) ? claim.authAmount : 0,
                _60: (numDays > 60 && numDays <= 90) ? claim.authAmount : 0,
                _90: (numDays > 90 && numDays <= 120) ? claim.authAmount : 0,
                _120: (numDays > 120 && numDays <= 150) ? claim.authAmount : 0,
                _150: numDays > 150 ? claim.authAmount : 0,
                total: 0.0
            };

            claimBalanceData.push(balance);
        }))

        let currTotal = 0
        let _30Total = 0
        let _60Total = 0
        let _90Total = 0
        let _120Total = 0
        let _150Total = 0
        for (let i = 0; i < claimBalanceData.length; i++) {
            currTotal += claimBalanceData[i].current
            _30Total += claimBalanceData[i]._30
            _60Total += claimBalanceData[i]._60
            _90Total += claimBalanceData[i]._90
            _120Total += claimBalanceData[i]._120
            _150Total += claimBalanceData[i]._150
        }
        currTotal = Math.round(currTotal * 100) / 100
        _30Total = Math.round(_30Total * 100) / 100
        _60Total = Math.round(_60Total * 100) / 100
        _90Total = Math.round(_90Total * 100) / 100
        _120Total = Math.round(_120Total * 100) / 100
        _150Total = Math.round(_150Total * 100) / 100

        let finalBalanceData = [
            {
                carrier: 'Medicaid',
                current: currTotal,
                _30: _30Total,
                _60: _60Total,
                _90: _90Total,
                _120: _120Total,
                _150: _150Total,
                total: Math.round((currTotal + _30Total + _60Total + _90Total + _120Total + _150Total) * 100) / 100
            }
        ]

        //get invoice time based on company location using zip code
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        const reportData = {
            cutoff: moment(req.query.cutoff).format('MM/DD/YYYY'),
            company: companyData[0],
            outstanding: outstandingData,
            balTotal: balTotal,
            balance: finalBalanceData,
            currTotal: currTotal,
            _30Total: _30Total,
            _60Total: _60Total,
            _90Total: _90Total,
            _120Total: _120Total,
            _150Total: _150Total,
            datetime: datetime
        };

        if (claimData.length > 2000) {
            return res.status(200).json({
                tooLarge: true,
                claimData: reportData
            });
        }

        try {
            client.render({
                template: {
                    shortid: "ze0pIr1hc",
                },
                data: reportData,
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id && req.query.cutoff) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'Claim Balance Report Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                            cutoffDate: moment(req.query.cutoff).format('MM/DD/YYYY'),
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
                console.log("success")
            }).catch((err) => {
                console.error('Error rendering Claim Balance Report:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Claim Balance Report try block:', err);
            res.status(500).send('Error generating report');
        }
    }
    catch (err) {
        res.sendStatus(204)
        console.log(err)
    }
}

exports.getOutstandingBalanceReport = async (req, res) => {
    try {
        let com_id = JSON.parse(req.query.com_id);
        let employee_id = req.query.emp_id;

        const claimQuery = `SELECT * from Claim WHERE companyID = ${com_id} AND startDate >= '${req.query.start}' AND startDate <='${req.query.end}' AND Status != 'Processed as Primary' ORDER BY CreateDate desc`
        let claimData = await DBSendResponse(claimQuery)

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`
        companyData = await DBSendResponse(companyQuery);

        let outstandingData = []
        await Promise.all(claimData.map(async function (claim) {
            const outstanding = {
                Plan_Name: 'Medicaid',
                Claim_ID: claim.claim_ID,
                Patient_Name: claim.FirstName + ' ' + claim.LastName,
                Service_Date: moment(claim.startDate).format('MM/DD/YYYY'),
                Status: claim.Status,
                Balance: claim.authAmount,
            };

            outstandingData.push(outstanding);
        }))

        const invoiceQuery = `
            SELECT DISTINCT
                ppi.invoiceID as claim_ID,
                c.medicaid_id,
                c.cus_name as patient_name,
                ppi.invoiceTotal as ins_amount,
                con.con_first_name,
                con.con_last_name,
                ppi.invoiceStatus as status
            FROM PrivatePayerInvoice ppi
            JOIN customer c ON c.cus_id = ppi.invoiceCustomer
            JOIN task t ON t.task_invoice_id = ppi.invoiceID
            JOIN emplocate el ON el.taskId = t.tas_id
            JOIN contact con ON c.private_payer = con.con_id
            WHERE el.empLocDate >= '${req.query.start}' AND el.empLocDate <= '${req.query.end}'
            AND ppi.invoiceCompany = ${com_id}
            AND ppi.invoiceStatus NOT IN ('Invoice Paid')
            ${req.query.cus_DDDIDs ? `AND c.cus_id IN (${req.query.cus_DDDIDs})` : ''}
        `;

        const invoices = await DBSendResponse(invoiceQuery);

        // Second query: Get tasks and preauths for each invoice
        await Promise.all(invoices.map(async (invoice) => {
            const taskQuery = `
                SELECT 
                    pa.priorAuth,
                    el.empLocDate
                FROM task t
                JOIN emplocate el ON el.taskId = t.tas_id
                LEFT JOIN preAuth pa ON pa.primaryID = t.tas_preAuth_id
                WHERE t.task_invoice_id = ${invoice.claim_ID}
                AND el.empLocDate BETWEEN '${req.query.start}' AND '${req.query.end}'
            `;

            const tasks = await DBSendResponse(taskQuery);

            if (tasks.length === 0) {
                return;
            }

            const uniquePreAuths = [...new Set(tasks.map(t => t.priorAuth).filter(Boolean))];
            const priorAuth_ID = uniquePreAuths.length > 1 ? 'Multiple' :
                uniquePreAuths.length === 1 ? uniquePreAuths[0] : '';

            const uniqueDates = [...new Set(tasks.map(t => moment(t.empLocDate).format('YYYY-MM-DD')))];
            const service_date = uniqueDates.length > 1 ? 'Multiple' :
                uniqueDates.length === 1 ? moment(uniqueDates[0]).format('MM/DD/YYYY') : '';

            const outstanding = {
                Plan_Name: invoice.con_first_name + ' ' + invoice.con_last_name,
                Claim_ID: invoice.claim_ID,
                Patient_Name: invoice.patient_name,
                Service_Date: service_date,
                Status: invoice.status,
                Balance: invoice.ins_amount,
            };

            outstandingData.push(outstanding);

        }));

        let balTotal = 0
        for (let i = 0; i < outstandingData.length; i++) {
            balTotal += outstandingData[i].Balance
        }
        balTotal = Math.round(balTotal * 100) / 100

        //get invoice time based on company location using zip code
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        const reportData = {
            from: moment(req.query.start).format('MM/DD/YYYY'),
            to: moment(req.query.end).format('MM/DD/YYYY'),
            company: companyData[0],
            outstanding: outstandingData,
            balTotal: balTotal,
            datetime: datetime
        };

        if (claimData.length > 2000) {
            return res.status(200).json({
                tooLarge: true,
                claimData: reportData
            });
        }

        try {
            client.render({
                template: {
                    shortid: "yAodbEove",
                },
                data: reportData,
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id && req.query.start && req.query.end) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'Billing Outstanding Balance Report Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                            startDate: moment(req.query.start).format('MM/DD/YYYY'),
                            endDate: moment(req.query.end).format('MM/DD/YYYY'),
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
                console.log("success")
            }).catch((err) => {
                console.error('Error rendering Outstanding Balance Report:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Outstanding Balance Report try block:', err);
            res.status(500).send('Error generating report');
        }
    }
    catch (err) {
        res.sendStatus(204)
        console.log(err)
    }
}

exports.getPA_UtilizationReport = async (req, res) => {
    try {
        let com_id = JSON.parse(req.query.com_id);
        let employee_id = req.query.emp_id;

        const preAuthQuery = `SELECT * FROM preAuth pa 
        LEFT JOIN customer c ON c.DDDID = pa.DDDID AND c.cus_company_id = ${com_id}
        LEFT JOIN project pro ON pro.pro_customer_id = c.cus_id AND (pro.pro_is_active = 'True' OR (pro.pro_starts_on IS NULL OR pro.pro_ends_on IS NULL OR pro.pro_starts_on <= '1900-01-01'))
        LEFT JOIN task t ON t.tas_pro_id = pro.pro_id AND t.tas_start_date BETWEEN pa.startDate AND pa.endDate AND ((t.tas_mm_id IS NOT NULL AND tas_mm_status = 'Approved') OR tas_title = 'Initial Plan Task') AND t.tas_billable_by_default = 'True'
        where companyID = ${com_id} AND pa.startDate >= '${req.query.start}' AND pa.startDate <= '${req.query.end}'`
        let preAuthData = await DBSendResponse(preAuthQuery)

        let totAuthAmount = 0, totOtherAmount = 0, totAmountMatched = 0, totAmountNotMatched = 0;
        let totAmountApproved = 0, totAmountBilled = 0, totAmountPaid = 0, totAmountPending = 0;

        preAuthData.forEach((data) => {
            totAuthAmount += data.authAmount;

            if (data.tas_title) {
                totAmountMatched += data.authAmount
            }

            if (data.tas_mm_status === 'Approved') {
                totAmountApproved += data.authAmount
            }

            if (data.tas_preAuth_id) {
                totAmountBilled += data.authAmount
            }
        })

        totAmountNotMatched = totAuthAmount + totOtherAmount - totAmountMatched

        const claimQuery = `select * from [dbo].[Claim] where companyID = ${com_id} and Status = 'Processed as Primary' and startDate >= '${req.query.start}' and startDate <= '${req.query.end}'`
        let claimData = await DBSendResponse(claimQuery);

        claimData.forEach((claim) => {
            totAmountPaid += claim.authAmount
        })

        totAmountPending = totAmountBilled - totAmountPaid

        let unitTotal = 0, amountTotal = 0;
        for (let i = 0; i < preAuthData.length; i++) {
            unitTotal += preAuthData[i].authUnits;
            amountTotal += preAuthData[i].authAmount;
        }
        unitTotal = Math.round(unitTotal * 100) / 100
        amountTotal = Math.round(amountTotal * 100) / 100

        const companyQuery = `SELECT * from company as a,location as b
        where a.com_id =${com_id}  and b.loc_company_id =${com_id} and b.loc_type ='COMPANY'`
        companyData = await DBSendResponse(companyQuery);

        //get invoice time based on company location using zip code
        let datetime = getTimeZoneTime(companyData[0].loc_zip)

        const reportData = {
            company: companyData[0],
            datetime: datetime,
            expectedRevenue: (totAuthAmount + totOtherAmount).toFixed(2),
            totAuthAmount: totAuthAmount.toFixed(2),
            totOtherAmount: totOtherAmount.toFixed(2),
            totAmountMatched: totAmountMatched.toFixed(2),
            totAmountNotMatched: totAmountNotMatched.toFixed(2),
            totAmountApproved: totAmountApproved.toFixed(2),
            totAmountApprovedButNotBilled: (totAmountApproved - totAmountBilled).toFixed(2),
            totAmountBilled: totAmountBilled.toFixed(2),
            totAmountPaid: totAmountPaid.toFixed(2),
            totAmountPending: totAmountPending.toFixed(2),
            preAuth: preAuthData,
            unitTotal: unitTotal,
            amountTotal: amountTotal,
            from: moment(req.query.start).format('MM/DD/YYYY'),
            to: moment(req.query.end).format('MM/DD/YYYY')
        };

        if (preAuthData.length > 2000) {
            return res.status(200).json({
                tooLarge: true,
                claimData: reportData
            });
        }

        try {
            client.render({
                template: {
                    shortid: "lnz0D4gyK",
                },
                data: reportData,
                options: {
                    preview: true
                }
            }).then((response) => {
                if (com_id && employee_id && req.query.start && req.query.end) {
                    analytics.track({
                        userId: String(employee_id),
                        event: 'Prior Auth Utilization Report Generated',
                        context: {
                            groupId: com_id,
                        },
                        properties: {
                            companyId: com_id,
                            startDate: moment(req.query.start).format('MM/DD/YYYY'),
                            endDate: moment(req.query.end).format('MM/DD/YYYY'),
                        }
                    })
                    console.log("logged to segment successfully");
                }
                response.pipe((res))
                console.log("success")
            }).catch((err) => {
                console.error('Error rendering Prior Auth Utilization Report:', err);
                res.status(500).send('Error generating report');
            });
        } catch (err) {
            console.error('Error in Prior Auth Utilization Report try block:', err);
            res.status(500).send('Error generating report');
        }
    }
    catch (err) {
        res.sendStatus(204)
        console.log(err)
    }
}

exports.getPrivatePayerInvoice = async (req, res) => {
    const compID = req.query.compID;
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
    WHERE ppi.invoiceID = ${req.query.invoiceID}
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
        // Convert hex to base64
        const buffer = Buffer.from(companyData[0].logo, 'hex');
        logoBase64 = `data:image/jpeg;base64,${buffer.toString('base64')}`;
    }

    const customerAddresses = invoiceData[0].cus_address?.split(':');

    try {
        client.render({
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
                preview: true
            }
        }).then((response) => {
            response.pipe((res))
        }).catch((err) => {
            console.error('Error rendering Private Payer Invoice:', err);
            res.status(500).send('Error generating report');
        });
    } catch (err) {
        console.error('Error in Private Payer Invoice try block:', err);
        res.status(500).send('Error generating report');
    }
}

exports.getFavorites = async (req, res) => {
    const allFavorites = `SELECT id, report_id, status from userfavorites WHERE employee_id=${req.query.empID} AND status=1`;
    const allReportQuery = `SELECT report_id, report_name, report_type from fwreports`;
    const allReports = await DBSendResponse(allReportQuery);
    const favoritesData = await DBSendResponse(allFavorites);

    favoritesData.forEach(element => {
        const filteredResult = allReports.find((e) => e.report_id == element.report_id)
        element.report_details = filteredResult;
    });

    const responseData = {
        code: 200,
        favorites: favoritesData,
        count: favoritesData.length
    }
    res.json(responseData);

};

exports.getAllReports = async (req, res) => {
    const allReportQuery = `SELECT * from fwreports`;
    const allReports = await DBSendResponse(allReportQuery);

    const allFavorites = `SELECT report_id from userfavorites WHERE employee_id=${req.query.empID} AND status=1`;
    const favoritesData = await DBSendResponse(allFavorites);

    allReports.forEach(element => {
        const filteredResult = favoritesData.find((e) => e.report_id == element.report_id)
        if (filteredResult)
            element.status = 1;
        else
            element.status = 0;
    });

    const responseData = {
        code: 200,
        reports: allReports,
        count: allReports.length
    }
    res.json(responseData);
};

exports.markFavorite = async (req, res) => {
    const isExistedQuery = `SELECT COUNT(1) as isRecordPresent from userfavorites WHERE employee_id=${req.body.empID} AND report_id=${req.body.report_id}`;
    const isExisted = await DBSendResponse(isExistedQuery);
    let statusMessage = req.body.status === 1 ? 'Favorite added successfully' : 'Favorite removed successfully';

    if (isExisted && isExisted[0].isRecordPresent == 0) {
        const insertFavoriteQuery = `INSERT INTO userfavorites (report_id, employee_id, status, dateadded) VALUES (${req.body.report_id}, ${req.body.empID}, 1, CURRENT_TIMESTAMP);`;
        const query = await DBSendResponse(insertFavoriteQuery);
    } else {
        const updateFavoriteQuery = `UPDATE userfavorites SET status=${req.body.status}, dateupdated=CURRENT_TIMESTAMP WHERE employee_id=${req.body.empID} AND report_id=${req.body.report_id}`;
        const queryData = await DBSendResponse(updateFavoriteQuery);
    }

    const responseData = {
        code: 200,
        status_message: statusMessage
    }
    res.json(responseData);
};

function getTimeZoneTime(zip) {
    if (zip.length > 5) {
        zip = zip.substring(0, 5)
    }
    var tz = zipcode_to_timezone.lookup(zip);

    return moment().tz(tz ? tz : 'America/New_York').format('MMM DD YYYY, hh:mm A');
}

function isJSON(str) {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
}

function toHoursAndMinutes(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${padToTwoDigits(hours)}:${padToTwoDigits(minutes)}`;
}

function padToTwoDigits(num) {
    return num.toString().padStart(2, '0');
}

function appendHours(projectData) {
    for (let i = 0; i < projectData.length; i++) {
        let hoursWorked = moment(projectData[i].checkoutEmpDate).diff(moment(projectData[i].empLocdate), 'hours');
        let regHrs;
        let overtime = 0;
        if (hoursWorked > 40) {
            overtime = hoursWorked - 40;
            regHrs = 40;
        } else
            regHrs = hoursWorked

        projectData[i].hours_worked = hoursWorked;
        projectData[i].total_pay = (regHrs * projectData[i].compensation_rate) + (overtime * (projectData[i].compensation_rate * 1.5));
        projectData[i].reg_hrs = regHrs;
        projectData[i].overtime = overtime;
        projectData[i].project_hours = moment(projectData[i].pro_ends_on).diff(moment(projectData[i].pro_starts_on), 'hours');

    }
}

function compare(a, b) {
    if (a.emp_first_name < b.emp_last_name) {
        return -1;
    }
    if (a.emp_last_name > b.emp_last_name) {
        return 1;
    }
    return 0;
}

function getPayPeriod(payroll) {
    for (let i = 0; i < payroll.length; i++) {
        if (moment().isBetween(moment(payroll[i].start_date), moment(payroll[i].end_date))) {
            return payroll[i];
        }
    }
}