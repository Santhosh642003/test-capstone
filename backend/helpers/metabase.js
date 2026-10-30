const { DBSendResponse, DBinsertSendID, generateInsertSQL, generateUpdateSQL } = require('../queries/commonQueries')
const { isActualText, parseSQLText, generateSQLText } = require('../utils/validation')
const moment = require('moment')
const jwt = require('jsonwebtoken');
const axios = require('axios');
const path = require('path');
const { env, CUSTOMERIO_API_KEY, BLOB_KEY, CONTAINER_NAME } = require('../config.js');
const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob')
const schedule = require('node-schedule');
const puppeteer = require('puppeteer');
const { APIClient, SendEmailRequest } = require("customerio-node");
const client = new APIClient(CUSTOMERIO_API_KEY);

// acount information
const account = 'fieldworkblob'
const accountKey = BLOB_KEY

// storage key and service client generation
const sharedKeyCredential = new StorageSharedKeyCredential(account, accountKey)
const blobServiceClient = new BlobServiceClient(
    `https://${account}.blob.core.windows.net`,
    sharedKeyCredential
)

// container information
const containerName = CONTAINER_NAME
const urlPrefix = `https://fieldworkblob.blob.core.windows.net/${containerName}/`

const METABASE_SITE_URL = "https://reportingserver-eteyfkh8g0f2ctag.eastus-01.azurewebsites.net";
const METABASE_SECRET_KEY = "09b116eed635e37cc1e2a0e105bb709460085427f4861efb1edbbec872fc660b";

const dashboardMap = {
    'Demographics Dashboard': env === 'prod' ? 20 : env === 'test' ? 14 : 6,
    'Operations Dashboard': env === 'prod' ? 19 : env === 'test' ? 13 : 7,
    'HR Dashboard': env === 'prod' ? 18 : env === 'test' ? 12 : 8,
    'Financial Dashboard': env === 'prod' ? 17 : env === 'test' ? 11 : 9,
    'Customer Dashboard': env === 'prod' ? 27 : env === 'test' ? 25 : 23,
    'Employee Dashboard': env === 'prod' ? 28 : env === 'test' ? 26 : 24,
    'Company Dashboard': env === 'prod' ? 42 : env === 'test' ? 41 : 31,
    'Units Dashboard': env === 'prod' ? 46 : env === 'test' ? 45 : 43,
    'EVV Dashboard': env === 'prod' ? 49 : env === 'test' ? 48 : 47
};

exports.getDemographicsDashboard = async (req, res) => {
    const payload = {
        resource: { dashboard: dashboardMap['Demographics Dashboard'] },
        params: {
            "companyid": req.query.companyID,
            "companyname": req.query.companyName,
            "todaysdate": `${moment().format('YYYY-MM-DD')}`
        },
        exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    res.json(iframeUrl);
};

exports.getOperationsDashboard = async (req, res) => {
    const payload = {
        resource: { dashboard: dashboardMap['Operations Dashboard'] },
        params: {
            "companyid": req.query.companyID,
            "companyname": req.query.companyName,
            "todaysdate": `${moment().format('YYYY-MM-DD')}`
        },
        exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    res.json(iframeUrl);
};

exports.getHRDashboard = async (req, res) => {
    const payload = {
        resource: { dashboard: dashboardMap['HR Dashboard'] },
        params: {
            "companyid": req.query.companyID,
            "companyname": req.query.companyName,
            "todaysdate": `${moment().format('YYYY-MM-DD')}`
        },
        exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    res.json(iframeUrl);
};

exports.getFinancialDashboard = async (req, res) => {
    const payload = {
        resource: { dashboard: dashboardMap['Financial Dashboard'] },
        params: {
            "companyid": req.query.companyID,
            "companyname": req.query.companyName,
            "todaysdate": `${moment().format('YYYY-MM-DD')}`
        },
        exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    res.json(iframeUrl);
};

exports.getCustomerDashboard = async (req, res) => {
    const getLastContactDate = `
    SELECT TOP 1 tas_created_at
    FROM task t
    JOIN project p ON p.pro_id = t.tas_pro_id
    JOIN customer c ON c.cus_id = p.pro_customer_id
    WHERE c.cus_id = ${req.query.customerID}
    ORDER BY t.tas_created_at DESC
    `;

    const getAverageTasks = `
    WITH DateRange AS (
        SELECT 
            DATEADD(MONTH, DATEDIFF(MONTH, 0, MIN(t.tas_created_at)), 0) AS StartMonth,
            DATEADD(MONTH, DATEDIFF(MONTH, 0, MAX(t.tas_created_at)), 0) AS EndMonth
        FROM task t
        JOIN project p ON p.pro_id = t.tas_pro_id
        JOIN customer c ON c.cus_id = p.pro_customer_id
        WHERE c.cus_id = ${req.query.customerID}
    ),
    Months AS (
        SELECT StartMonth AS MonthStart
        FROM DateRange
        UNION ALL
        SELECT DATEADD(MONTH, 1, MonthStart)
        FROM Months m
        JOIN DateRange r ON MonthStart < r.EndMonth
    ),
    MonthlyCounts AS (
        SELECT 
            DATEADD(MONTH, DATEDIFF(MONTH, 0, t.tas_created_at), 0) AS MonthStart,
            COUNT(*) AS TaskCount
        FROM task t
        JOIN project p ON p.pro_id = t.tas_pro_id
        JOIN customer c ON c.cus_id = p.pro_customer_id
        WHERE c.cus_id = ${req.query.customerID}
        GROUP BY DATEADD(MONTH, DATEDIFF(MONTH, 0, t.tas_created_at), 0)
    )
    SELECT 
        CAST(AVG(COALESCE(mc.TaskCount, 0) * 1.0) AS DECIMAL(10,2)) AS AvgTasksPerMonth
    FROM Months m
    LEFT JOIN MonthlyCounts mc ON m.MonthStart = mc.MonthStart
    OPTION (MAXRECURSION 0);
    `;

    const getTasksThisMonth = `
    SELECT COUNT(*) AS tasksThisMonth
    FROM task t
    JOIN project p ON p.pro_id = t.tas_pro_id
    JOIN customer c ON c.cus_id = p.pro_customer_id
    WHERE 
        c.cus_id = ${req.query.customerID}
        AND t.tas_created_at >= DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) - 1, 0)
        AND t.tas_created_at < DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()), 0);
    `;

    const getAverageComments = `
    WITH DateRange AS (
        SELECT 
            DATEADD(MONTH, DATEDIFF(MONTH, 0, MIN(created_at)), 0) AS StartMonth,
            DATEADD(MONTH, DATEDIFF(MONTH, 0, MAX(created_at)), 0) AS EndMonth
        FROM comments
        WHERE customer_id = ${req.query.customerID}
    ),
    Months AS (
        SELECT StartMonth AS MonthStart
        FROM DateRange
        UNION ALL
        SELECT DATEADD(MONTH, 1, MonthStart)
        FROM Months m
        JOIN DateRange r ON MonthStart < r.EndMonth
    ),
    MonthlyCounts AS (
        SELECT 
            DATEADD(MONTH, DATEDIFF(MONTH, 0, created_at), 0) AS MonthStart,
            COUNT(*) AS CommentCount
        FROM comments
        WHERE customer_id = ${req.query.customerID}
        GROUP BY DATEADD(MONTH, DATEDIFF(MONTH, 0, created_at), 0)
    )
    SELECT 
        CAST(AVG(COALESCE(mc.CommentCount, 0) * 1.0) AS DECIMAL(10,2)) AS AvgCommentsPerMonth
    FROM Months m
    LEFT JOIN MonthlyCounts mc ON m.MonthStart = mc.MonthStart
    OPTION (MAXRECURSION 0);
    `;

    const getCommentsThisMonth = `
    SELECT COUNT(*) AS commentsThisMonth
    FROM comments
    WHERE 
        customer_id = ${req.query.customerID}
        AND created_at >= DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) - 1, 0)
        AND created_at < DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()), 0);
    `;

    const getAverageArtifacts = `
    WITH DateRange AS (
        SELECT 
            DATEADD(MONTH, DATEDIFF(MONTH, 0, MIN(submitted)), 0) AS StartMonth,
            DATEADD(MONTH, DATEDIFF(MONTH, 0, MAX(submitted)), 0) AS EndMonth
        FROM artifacts
        WHERE customer_id = ${req.query.customerID}
    ),
    Months AS (
        SELECT StartMonth AS MonthStart
        FROM DateRange
        UNION ALL
        SELECT DATEADD(MONTH, 1, MonthStart)
        FROM Months m
        JOIN DateRange r ON MonthStart < r.EndMonth
    ),
    MonthlyCounts AS (
        SELECT 
            DATEADD(MONTH, DATEDIFF(MONTH, 0, submitted), 0) AS MonthStart,
            COUNT(*) AS ArtifactCount
        FROM artifacts
        WHERE customer_id = ${req.query.customerID}
        GROUP BY DATEADD(MONTH, DATEDIFF(MONTH, 0, submitted), 0)
    )
    SELECT 
        CAST(AVG(COALESCE(mc.ArtifactCount, 0) * 1.0) AS DECIMAL(10,2)) AS AvgArtifactsPerMonth
    FROM Months m
    LEFT JOIN MonthlyCounts mc ON m.MonthStart = mc.MonthStart
    OPTION (MAXRECURSION 0);
    `;

    const getArtifactsThisMonth = `
    SELECT COUNT(*) AS artifactsThisMonth
    FROM artifacts
    WHERE 
        customer_id = ${req.query.customerID}
        AND submitted >= DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) - 1, 0)
        AND submitted < DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()), 0);
    `;

    const getCustomerGoals = `SELECT * FROM customer_goal WHERE customer_id = ${req.query.customerID} AND goal_status != 3`;

    const getLastComment = `SELECT TOP 1 comment_text FROM comments WHERE customer_id = ${req.query.customerID} ORDER BY created_at DESC`;

    const getAssociatedEmployess = `
    SELECT emp.emp_first_name, emp.emp_last_name
    FROM projectEmployeeAssignment pea
    JOIN project p ON p.pro_id = pea.pea_pro_id
    JOIN customer c ON c.cus_id = p.pro_customer_id
    JOIN employee emp ON emp.emp_id = pea.pea_emp_id
    WHERE c.cus_id = ${req.query.customerID} AND pea.pea_is_active = 'True'
    `;

    try {
        const lastContactDate = await DBSendResponse(getLastContactDate);
        const averageTasks = await DBSendResponse(getAverageTasks);
        const tasksThisMonth = await DBSendResponse(getTasksThisMonth);
        const averageComments = await DBSendResponse(getAverageComments);
        const commentsThisMonth = await DBSendResponse(getCommentsThisMonth);
        const averageArtifacts = await DBSendResponse(getAverageArtifacts);
        const artifactsThisMonth = await DBSendResponse(getArtifactsThisMonth);
        const customerGoals = await DBSendResponse(getCustomerGoals);
        const lastCommentResult = await DBSendResponse(getLastComment);
        const lastComment = lastCommentResult.length > 0
            ? isJSON(lastCommentResult[0].comment_text)
                ? JSON.parse(lastCommentResult[0].comment_text)?.blocks.map(block => block.text).join(' ')
                : lastCommentResult[0].comment_text
            : 'No comments';
        const associatedEmployees = await DBSendResponse(getAssociatedEmployess);

        const sentence1 = `${lastContactDate.length > 0 ? moment(lastContactDate[0].tas_created_at).format('MMMM DD, YYYY') : 'N/A'}`;
        const sentence2 = `${tasksThisMonth[0].tasksThisMonth}`;
        const sentence3 = `${getComparison(tasksThisMonth[0].tasksThisMonth, averageTasks[0].AvgTasksPerMonth)}`;
        const sentence4 = `${averageTasks[0].AvgTasksPerMonth}`;
        const sentence5 = `${commentsThisMonth[0].commentsThisMonth}`;
        const sentence6 = `${getComparison(commentsThisMonth[0].commentsThisMonth, averageComments[0].AvgCommentsPerMonth)}`;
        const sentence7 = `${averageComments[0].AvgCommentsPerMonth}`;
        const sentence8 = `${artifactsThisMonth[0].artifactsThisMonth}`;
        const sentence9 = `${getComparison(artifactsThisMonth[0].artifactsThisMonth, averageArtifacts[0].AvgArtifactsPerMonth)}`;
        const sentence10 = `${averageArtifacts[0].AvgArtifactsPerMonth}`;
        const sentence11 = `${associatedEmployees.map(emp => `  \n• ${emp.emp_first_name} ${emp.emp_last_name}`).join('') || 'No associated employees'}`;
        const sentence12 = `${customerGoals.map(goal => `  \n• ${goal.goal_title}`).join('') || 'No active goals'}`;

        const payload = {
            resource: { dashboard: dashboardMap['Customer Dashboard'] },
            params: {
                "companyname": req.query.companyName,
                "customerid": req.query.customerID,
                "customername": req.query.customerName,
                "todaysdate": `${moment().format('YYYY-MM-DD')}`,
                "sentence1": sentence1,
                "sentence2": sentence2,
                "sentence3": sentence3,
                "sentence4": sentence4,
                "sentence5": sentence5,
                "sentence6": sentence6,
                "sentence7": sentence7,
                "sentence8": sentence8,
                "sentence9": sentence9,
                "sentence10": sentence10,
                "sentence11": sentence11,
                "sentence12": sentence12
            },
            exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
        };
        const token = jwt.sign(payload, METABASE_SECRET_KEY);

        const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

        res.json(iframeUrl);
    } catch (error) {
        console.error("Error generating Customer Dashboard:", error);
        res.json('');
    }
};

exports.getEmployeeDashboard = async (req, res) => {
    const payload = {
        resource: { dashboard: dashboardMap['Employee Dashboard'] },
        params: {
            "companyname": req.query.companyName,
            "employeeid": req.query.employeeID,
            "customerids": req.query.empType === 'Admin'
                ? 1
                : (req.query.associatedCustomers && req.query.associatedCustomers.length > 0) ? req.query.associatedCustomers : -1,
            "todaysdate": `${moment().format('YYYY-MM-DD')}`,
            "employeetype": req.query.empType
        },
        exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    res.json(iframeUrl);
};

exports.getCompanyDashboard = async (req, res) => {
    // const now = new Date();

    // // Calculate start and end of previous month
    // const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    // const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // // Convert to UNIX timestamps (seconds)
    // const start_ts = Math.floor(startOfPrevMonth.getTime() / 1000);
    // const end_ts = Math.floor(endOfPrevMonth.getTime() / 1000);

    // // "email" "webhook" "twilio" "slack" "push" "in_app"
    // const response = await axios
    //     .get(`https://api.customer.io/v1/messages`, {
    //         params: { type: 'email', limit: 1000, start_ts, end_ts },
    //         headers: { Authorization: `Bearer ${CUSTOMERIO_API_KEY}` }
    //     }).then((response) => {
    //         console.log(response.data.messages)
    //     }).catch((error) => {
    //         console.log(error);
    //     });

    const payload = {
        resource: { dashboard: dashboardMap['Company Dashboard'] },
        params: {
            "todaysdate": `${moment().format('YYYY-MM-DD')}`,
            "companyid": req.query.companyID,
            "companyname": req.query.companyName
        },
        exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    res.json(iframeUrl);
};

exports.getUnitsDashboard = async (req, res) => {
    const payload = {
        resource: { dashboard: dashboardMap['Units Dashboard'] },
        params: {
            "companyid": req.query.companyID,
            "companyname": req.query.companyName,
            "todaysdate": `${moment().format('YYYY-MM-DD')}`,
            "customerid": req.query.customerID ? req.query.customerID : -1,
            "customername": req.query.customerName ? req.query.customerName : 'All Customers',
            "procedure": req.query.procedure ? req.query.procedure : '-1',
            "fromdate": req.query.fromDate,
            "todate": req.query.toDate
        },
        exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    res.json(iframeUrl);
};

exports.getEVVDashboard = async (req, res) => {
    const payload = {
        resource: { dashboard: dashboardMap['EVV Dashboard'] },
        params: {
            "companyid": req.query.companyID,
            "companyname": req.query.companyName,
            "todaysdate": `${moment().format('YYYY-MM-DD')}`,
            "fromdate": req.query.fromDate,
            "todate": req.query.toDate
        },
        exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
    };
    const token = jwt.sign(payload, METABASE_SECRET_KEY);

    const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#bordered=false&titled=false";

    res.json(iframeUrl);
};

function getComparison(count, average) {
    if (count > average * 1.1) {
        return "more than";
    } else if (count < average * 0.9) {
        return "less than";
    } else {
        return "similar to";
    }
};

function isJSON(str) {
    try {
        JSON.parse(str);
        return true;
    } catch (e) {
        return false;
    }
};

exports.addYearEndArtifact = async () => {
    const cronExpressionTest = '* * * * *'; // every minute for testing purposes
    const cronExpression = { month: 11, date: 25, hour: 10, minute: 0, tz: 'America/New_York' }; // December 25th at 10 AM for production

    schedule.scheduleJob(cronExpressionTest, async function () {
        console.log(`| METABASE | Running year end artifact job at ${new Date()}`);

        try {
            // Fetch all report schedules
            const getEmployees = `
                WITH HourCounts AS (
                    SELECT employee_id, DATEPART(HOUR, systime AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS LoginHour, COUNT(*) AS LoginCount,
                        ROW_NUMBER() OVER (
                            PARTITION BY employee_id 
                            ORDER BY COUNT(*) DESC
                        ) AS rn
                    FROM fw_log
                    WHERE action_type = 'New Login' AND YEAR(systime AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') = YEAR(GETDATE())
                    GROUP BY employee_id, DATEPART(HOUR, systime AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time')
                ),
                DayCounts AS (
                    SELECT employee_id, DATENAME(WEEKDAY, systime AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') AS DayOfWeek, COUNT(*) AS LoginCount,
                        ROW_NUMBER() OVER (
                            PARTITION BY employee_id 
                            ORDER BY COUNT(*) DESC
                        ) AS rn
                    FROM fw_log
                    WHERE action_type = 'New Login' AND YEAR(systime AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time') = YEAR(GETDATE())
                    GROUP BY employee_id, DATENAME(WEEKDAY, systime AT TIME ZONE 'UTC' AT TIME ZONE 'Eastern Standard Time')
                )
                SELECT e.emp_id, e.emp_first_name, e.emp_last_name,
                    ISNULL(FORMAT(DATEADD(HOUR, hc.LoginHour, '00:00'), 'h tt'), '-') AS MostActiveHour, 
                    ISNULL(dc.DayOfWeek, '-') AS MostActiveDay
                FROM employee e
                JOIN company c ON c.com_id = e.emp_company_id
                LEFT JOIN HourCounts hc ON e.emp_id = hc.employee_id AND hc.rn = 1
                LEFT JOIN DayCounts dc ON e.emp_id = dc.employee_id AND dc.rn = 1
                WHERE e.emp_created_at < '2025-10-01' AND e.emp_is_active = 1 AND com_id NOT IN (2363, 2628) AND
                subscriptionEndDate > CURRENT_DATE AND (subscriptionPlan IS NULL OR subscriptionPlan <> -1) AND (subscriptionStartDate IS NULL OR subscriptionStartDate <= DATEADD(day, -30, CURRENT_DATE))
            `;
            const employees = await DBSendResponse(getEmployees);

            const browser = await puppeteer.launch({
                args: ['--no-sandbox']
            });

            console.log(`| METABASE | Employees to process: ${employees.length}`);

            for (const employee of employees) {
                console.log(`| METABASE | Processing employee ID: ${employee.emp_id}`);
                const payload = {
                    resource: { dashboard: 44 },
                    params: {
                        "employeeid": employee.emp_id,
                        "employeename": employee.emp_first_name === 'Unassigned' ? '-' : `${employee.emp_first_name} ${employee.emp_last_name}`,
                        "mostactivehour": employee.MostActiveHour,
                        "mostactiveday": employee.MostActiveDay
                    },
                    exp: Math.round(Date.now() / 1000) + (10 * 60) // 10 minute expiration
                };
                const token = jwt.sign(payload, METABASE_SECRET_KEY);

                const iframeUrl = METABASE_SITE_URL + "/embed/dashboard/" + token + "#theme=light&bordered=false&titled=false";

                const page = await browser.newPage();
                await page.setViewport({ width: 1675, height: 1450 });

                await page.goto(iframeUrl, { waitUntil: 'networkidle0' });

                await new Promise(resolve => setTimeout(resolve, 5000));

                const screenshot = await page.screenshot({ fullPage: true });

                await page.close();

                const IDQuery = 'SELECT MAX(id) FROM artifacts';
                let id = await DBinsertSendID(IDQuery);

                id += 1;
                id += '.png';

                const art_url = urlPrefix + id;

                const containerClient = blobServiceClient.getContainerClient(containerName);
                const blockBlobClient = containerClient.getBlockBlobClient(id);

                const options = { blobContentType: 'image/png' };
                const uploadBlobResponse = await blockBlobClient.upload(screenshot, screenshot.length, { blobHTTPHeaders: options });

                const insertArtifactQuery = `
                    INSERT INTO artifacts (url, employee_id, show, submitted, file_name, Status)
                    VALUES ('${art_url}', ${employee.emp_id}, 0, CURRENT_TIMESTAMP, 'Metabase - Year 2025', 1)
                `;
                await DBinsertSendID(insertArtifactQuery);
            }

            await browser.close();

            console.log(`| METABASE | Year end artifact job completed at ${new Date()}`);
        } catch (err) {
            console.error(`| METABASE | Error fetching employee data:`, err);
            return;
        };
    });
};

exports.sendYearEndEmail = async () => {
    const cronExpressionTest = '* * * * *'; // every minute for testing purposes
    const cronExpression = { month: 11, date: 25, hour: 10, minute: 0, tz: 'America/New_York' }; // December 25th at 10 AM for production

    schedule.scheduleJob(cronExpressionTest, async function () {
        console.log(`| METABASE | Running year end job at ${new Date()}`);

        try {
            // Fetch all Metabase artifacts
            const getEmployees = `
                SELECT a.url, e.emp_id, e.emp_first_name, e.emp_last_name, e.sec_email
                    FROM artifacts a
                    JOIN employee e ON e.emp_id = a.employee_id
                WHERE file_name = 'Metabase - Year 2025'
            `;
            const employees = await DBSendResponse(getEmployees);

            for (const employee of employees) {
                console.log(`| METABASE | Sending email to employee ID: ${employee.emp_id}`);
                if (!employee.sec_email) {
                    console.log(`| METABASE | Skipping employee ID: ${employee.emp_id} due to missing email`);
                    continue;
                }

                const request = new SendEmailRequest({
                    transactional_message_id: "year_end_message",
                    message_data: {
                        user_name: employee.emp_first_name === 'Unassigned' ? '' : `${employee.emp_first_name} ${employee.emp_last_name}`,
                        dashboard_image_url: employee.url
                    },
                    identifiers: {
                        id: employee.emp_id,
                    },
                    to: employee.sec_email,
                    subject: `Reflecting on a Successful 2025 — Excited for What's Next!`,
                });

                try {
                    const res = await client.sendEmail(request);
                    // console.log(res);
                } catch (err) {
                    console.log(err.statusCode, err.message);
                }
            }

            console.log(`| METABASE | Year end email job completed at ${new Date()}`);
        } catch (err) {
            console.error(`| METABASE | Error fetching employee data:`, err);
            return;
        };
    });
};