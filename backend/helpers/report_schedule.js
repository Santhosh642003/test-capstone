const db = require('../models/indexSQL.js');
const { DBinsertSendID, DBinsert, DBUpdate, DBSendResponse, DBinsertSendResponse, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries');
const { generateSQLText } = require('../utils/validation');
const { getAssociatedEmployeesAPI } = require('./employees.js');
const { env, CUSTOMERIO_API_KEY } = require('../config.js')
const jwt = require('jsonwebtoken');
const schedule = require('node-schedule');
const puppeteer = require('puppeteer');
const moment = require('moment');
const crypto = require('crypto');

const { APIClient, SendEmailRequest } = require("customerio-node");
const client = new APIClient(CUSTOMERIO_API_KEY);

const METABASE_SITE_URL = "https://reportingserver-eteyfkh8g0f2ctag.eastus-01.azurewebsites.net";
const METABASE_SECRET_KEY = "09b116eed635e37cc1e2a0e105bb709460085427f4861efb1edbbec872fc660b";

const dashboardMap = {
    'Demographics Overview': env === 'prod' ? 38 : env === 'test' ? 35 : 32,
    'Operations Overview': env === 'prod' ? 40 : env === 'test' ? 37 : 34,
    'HR Overview': env === 'prod' ? 39 : env === 'test' ? 36 : 33,
    'Financial': env === 'prod' ? 17 : env === 'test' ? 11 : 9,
    'Company': env === 'prod' ? 42 : env === 'test' ? 41 : 31,
};

exports.getReportSchedule = async function (req, res) {
    try {
        let associatedEmployees = await getAssociatedEmployeesAPI(req.query.empID);
        associatedEmployees = associatedEmployees.directlyManaged.concat(associatedEmployees.hr_managed).concat({ emp_id: req.query.empID });

        associatedEmployees = associatedEmployees.filter((obj, index, self) => {
            return index === self.findIndex((t) => (
                t.emp_id === obj.emp_id
            ));
        }).map((emp) => emp.emp_id).join(', ');

        let getReportSchedules = `
        SELECT rs.*, fwd.dashboard_name AS report_name, CONCAT(e1.emp_first_name, ' ', e1.emp_last_name) AS recipientName, CONCAT(e2.emp_first_name, ' ', e2.emp_last_name) AS createdBy
            FROM report_schedule rs
            JOIN fwdashboards fwd ON fwd.dashboard_id = rs.report_id
            JOIN employee e1 ON e1.emp_id = rs.schedule_recipient
            JOIN employee e2 ON e2.emp_id = rs.schedule_createdBy
        WHERE rs.schedule_companyID = ${req.query.compID}`;

        if (req.query.empType !== 'Admin') {
            getReportSchedules += ` AND e1.emp_id IN (${associatedEmployees})`;
        }

        const reportSchedules = await DBSendResponse(getReportSchedules);

        return res.status(200).json(reportSchedules);
    } catch (err) {
        console.log('QUERY FAILURE | getReportSchedule Query Failed:')
        console.log(err)
        return res.status(400).json({
            message: 'An unexpected error occured',
        })
    }
};

exports.addReportSchedule = async function (req, res) {
    try {
        const baseData = {
            report_id: isNaN(parseInt(req.body.report_id)) ? null : parseInt(req.body.report_id),
            schedule_frequency: generateSQLText(req.body.schedule_frequency, 512, null),
            schedule_companyID: isNaN(parseInt(req.body.schedule_companyID)) ? null : parseInt(req.body.schedule_companyID),
            schedule_createdBy: isNaN(parseInt(req.body.schedule_createdBy)) ? null : parseInt(req.body.schedule_createdBy),
            schedule_createdAt: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const insertedIds = [];

        if (req.body.schedule_recipient.length === 0) {
            const data = {
                ...baseData,
                schedule_recipient: isNaN(parseInt(req.body.schedule_recipient)) ? null : parseInt(req.body.schedule_recipient),
            };

            const query = generateInsertSQL('report_schedule', data) + 'SELECT SCOPE_IDENTITY()';
            const newReportScheduleId = await DBinsertSendID(query);

            insertedIds.push(newReportScheduleId);
        } else {
            for (const recipient of req.body.schedule_recipient) {
                const recipientId = isNaN(parseInt(recipient)) ? null : parseInt(recipient);

                const data = {
                    ...baseData,
                    schedule_recipient: recipientId,
                };

                const query = generateInsertSQL('report_schedule', data) + 'SELECT SCOPE_IDENTITY()';
                const newReportScheduleId = await DBinsertSendID(query);

                insertedIds.push(newReportScheduleId);
            }
        }

        res.status(200).json({
            ids: insertedIds
        })
    } catch (err) {
        console.log('QUERY FAILURE | addReportSchedule Query Failed:')
        console.log(err)
        res.status(400).json({
            message: 'An unexpected error occured'
        })
    }
};

exports.deleteReportSchedule = async function (req, res) {
    const query = `DELETE FROM report_schedule WHERE report_schedule_id = ${parseInt(req.query.report_schedule_id)}`;

    try {
        await DBSendResponse(query);
        res.status(200).json({
            message: 'Report Schedule deleted successfully'
        });
    } catch (err) {
        console.log('QUERY FAILURE | deleteReportSchedule Query Failed:');
        console.log(err);
        res.status(500).json({
            message: 'An unexpected error occurred'
        });
    }
};

exports.getSchedulableReports = async function (req, res) {
    try {
        const getSchedulableReports = `SELECT * FROM fwdashboards WHERE dashboard_schedulable = 1 ORDER BY dashboard_name`;
        const schedulableReports = await DBSendResponse(getSchedulableReports);

        return res.status(200).json(schedulableReports);
    } catch (err) {
        console.log('QUERY FAILURE | getSchedulableReports Query Failed:')
        console.log(err)
        return res.status(400).json({
            message: 'An unexpected error occured',
        })
    }
};

exports.sendReports = async () => {
    const cronExpressionTest = '* * * * *'; // every minute for testing purposes
    const cronExpression = { hour: 19, minute: 0, tz: 'America/New_York' };   // every day at 7 PM for production

    schedule.scheduleJob(cronExpression, async function () {
        await sleep(Math.floor(Math.random() * 600000));

        console.log(`| REPORT SCHEDULE | Running report schedule job at ${new Date()}`);

        const getScheduleLogs = `
        SELECT 1
        FROM report_schedule_log
        WHERE CAST(invocationTimestamp AS DATE) = CAST(GETUTCDATE() AS DATE)
        `;

        const scheduleLogs = await DBSendResponse(getScheduleLogs);

        if (scheduleLogs.length > 0) {
            console.log(`| REPORT SCHEDULE | Report schedule job has already run today. Exiting.`);
            return;
        }

        try {
            let noOfRecordsPicked = 0, noOfSuccessRecords = 0, noOfFailureRecords = 0;

            // Fetch all report schedules
            const getReportSchedules = `
            SELECT rs.*, fwd.dashboard_name AS report_name, e.sec_email, c.com_name
                FROM report_schedule rs
                JOIN fwdashboards fwd ON fwd.dashboard_id = rs.report_id
                JOIN employee e ON e.emp_id = rs.schedule_recipient
                JOIN company c ON c.com_id = rs.schedule_companyID
            `;
            const reportSchedules = await DBSendResponse(getReportSchedules);

            if (reportSchedules.length === 0) {
                console.log('| REPORT SCHEDULE | No report schedules to process');
                await addReportScheduleLog(noOfRecordsPicked, noOfSuccessRecords, noOfFailureRecords);
                return;
            }

            console.log(`| REPORT SCHEDULE | Found ${reportSchedules.length} report schedules to process`);

            // const uniqueCompanyIDs = [...new Set(reportSchedules.map(item => item.schedule_companyID))];

            const dailyReportSchedules = reportSchedules.filter(schedule => schedule.schedule_frequency === 'Daily');
            const weeklyReportSchedules = reportSchedules.filter(schedule => schedule.schedule_frequency === 'Weekly');
            const monthlyReportSchedules = reportSchedules.filter(schedule => schedule.schedule_frequency === 'Monthly');

            const now = moment();
            const weekEnd = moment().day(7).hour(19).minute(0).second(0);
            const monthEnd = moment().endOf('month').hour(19).minute(0).second(0);

            const browser = await puppeteer.launch({
                args: ['--no-sandbox']
            });

            async function processSchedules(schedules) {
                for (const schedule of schedules) {
                    noOfRecordsPicked += 1;

                    console.log(`| REPORT SCHEDULE | Processing Report Schedule ID: ${schedule.report_schedule_id}`);

                    if (!schedule.sec_email) {
                        noOfFailureRecords += 1;
                        console.log(`| REPORT SCHEDULE | No recipient email found for Report Schedule ID: ${schedule.report_schedule_id}`);
                        continue;
                    }

                    const isEmailSent = await sendEmail(browser, schedule);

                    if (isEmailSent) {
                        noOfSuccessRecords += 1;
                    } else {
                        noOfFailureRecords += 1;
                    }

                    console.log(`| REPORT SCHEDULE | Completed processing Report Schedule ID: ${schedule.report_schedule_id}`);
                }
            }

            await processSchedules(dailyReportSchedules);

            if (now.isSame(weekEnd, 'day')) {
                await processSchedules(weeklyReportSchedules);
            }

            if (now.isSame(monthEnd, 'day')) {
                await processSchedules(monthlyReportSchedules);
            }

            await addReportScheduleLog(noOfRecordsPicked, noOfSuccessRecords, noOfFailureRecords);
            await browser.close();
        } catch (err) {
            console.error(`| REPORT SCHEDULE | Error fetching report schedules:`, err);
            return;
        };
    });
};

async function sendEmail(browser, schedule) {
    const { report_schedule_id, schedule_companyID, report_name, schedule_recipient, sec_email, com_name } = schedule;

    const dashboardURL = await getDashboardURL(schedule_companyID, report_name, com_name);
    const pdfBuffer = await getPDFBuffer(browser, dashboardURL, report_name);

    if (!dashboardURL || !pdfBuffer) {
        console.error(`Error sending email: Dashboard URL or PDF Buffer not found.`);
        return false;
    }

    const request = new SendEmailRequest({
        transactional_message_id: "metabase_dashboard_email",
        message_data: {
            dashboardName: `${report_name} Dashboard`,
            dashboardURL: dashboardURL
        },
        identifiers: {
            id: schedule_recipient
        },
        to: sec_email,
        subject: `FieldWorker - ${report_name} Dashboard ${moment().format('MM/DD/YYYY')}`,
    });

    request.attach(`${report_name} Dashboard.pdf`, pdfBuffer);

    try {
        const res = await client.sendEmail(request);
        console.log(res);
        return true;
    } catch (err) {
        console.log(`Error sending email to Report Schedule ID ${report_schedule_id}:`, err.statusCode, err.message);
        return false;
    }
};

async function getDashboardURL(companyID, report_name, companyName) {
    if (!dashboardMap[report_name]) {
        console.error(`Invalid report_name: ${report_name}.`);
        return false;
    }

    const payload = {
        resource: { dashboard: dashboardMap[report_name] },
        params: {
            "companyid": companyID,
            "todaysdate": `${moment().format('YYYY-MM-DD')}`,
            "companyname": companyName,
        },
        exp: Math.round(Date.now() / 1000) + (24 * 60 * 60) // 24 hour expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const dashboardURL = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    return dashboardURL;
};

async function getPDFBuffer(browser, dashboardURL, report_name) {
    try {
        if (!dashboardURL) {
            console.error(`Dashboard URL not found.`);
            return false;
        }

        const page = await browser.newPage();

        // 'networkidle0' waits until there are no more than 0 network connections for 500ms.
        await page.goto(dashboardURL, { waitUntil: 'networkidle0' });

        await new Promise(resolve => setTimeout(resolve, 5000));

        const heightMap = {
            'Demographics Overview': '1400px',
            'Operations Overview': '1000px',
            'HR Overview': '1000px',
            'Financial': '1450px',
            'Company': '1700px',
        };

        const pdfBuffer = await page.pdf({
            width: '1230px',
            height: heightMap[report_name] || '2400px',
            printBackground: true,
        });

        await page.close();
        return pdfBuffer;
    } catch (err) {
        console.error("Error generating PDF:", err);
        return false;
    }
};

async function addReportScheduleLog(noOfRecordsPicked, noOfSuccessRecords, noOfFailureRecords) {
    try {
        const data = {
            noOfRecordsPicked: isNaN(parseInt(noOfRecordsPicked)) ? null : parseInt(noOfRecordsPicked),
            noOfSuccessRecords: isNaN(parseInt(noOfSuccessRecords)) ? null : parseInt(noOfSuccessRecords),
            noOfFailureRecords: isNaN(parseInt(noOfFailureRecords)) ? null : parseInt(noOfFailureRecords),
            invocationTimestamp: `${moment().format('YYYY-MM-DDTHH:mm:ss')}`,
        };

        const query = generateInsertSQL('report_schedule_log', data) + 'SELECT SCOPE_IDENTITY()';
        const newReportScheduleLogId = await DBinsertSendID(query);

        return newReportScheduleLogId;
    } catch (err) {
        console.log('QUERY FAILURE | addReportScheduleLog Query Failed:');
        console.log(err);
        return null;
    }
};

function sleep(ms) {
    console.log(`| REPORT SCHEDULE | Sleeping for ${ms / 1000} seconds`);
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}