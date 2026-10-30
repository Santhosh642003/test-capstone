const db = require('../models/indexSQL.js')
const { DBinsertSendID, DBUpdate, DBinsertSendResponse, DBSendResponse } = require('../queries/commonQueries')
const moment = require('moment')
var { SEGMENT_API_KEY } = require("../config");
const { Analytics } = require('@segment/analytics-node')
const analytics = new Analytics({ writeKey: SEGMENT_API_KEY })
var cron = require('node-cron');
const schedule = require('node-schedule');
const crypto = require('crypto');

function sleep(ms) {
    console.log(`ACCOUNTS RECEIVALBLE | Sleeping for ${ms / 1000} seconds`);
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

exports.insertBillables = async () => {
    const cronExpressionTest = '* * * * *'; // every minute for testing purposes
    const cronExpression = { hour: 0, minute: 0, tz: 'America/New_York' }; // every midnight for production

    schedule.scheduleJob(cronExpression, async function () {
        const randomTime = crypto.randomInt(0, 1800000);

        console.log(`ACCOUNTS RECEIVALBLE | Starting the job after ${randomTime / 1000} seconds`);

        setTimeout(async () => {
            await addBillablesForSC();
            await addBillablesForNonSC();
        }, randomTime);
    });
}

async function addBillablesForSC() {
    try {
        // Fetch NJ SC companies subscribed to Financial Reporting
        const compQuery = `
            SELECT DISTINCT company_id
                FROM settings
            WHERE company_id IN (SELECT company_id FROM settings WHERE feature_id = 19)
            AND company_id IN (SELECT company_id FROM settings WHERE feature_value = 'primaryBusinessType' AND feature_id = 101)
            AND company_id IN (SELECT company_id FROM settings WHERE feature_id = 99 AND state_id = 'NJ')`;

        const compList = await DBSendResponse(compQuery);

        // Fetch the Billing Rates
        const rateQuery = `select * from billingrates`;

        const rateList = await DBSendResponse(rateQuery);

        let rateMap = {};
        rateList.forEach(item => {
            rateMap[item.procProcCode] = item.rate;
        });

        for (const company of compList) {
            await sleep(Math.floor(Math.random() * 60000));

            console.log(`ACCOUNTS RECEIVALBLE | Running for ${company?.company_id}`)

            // Fetch the entries present in the Database
            const billableQuery = `SELECT * FROM accounts_receivable WHERE YYYYMM = ${moment().format('YYYYMM')} AND company_id = ${company.company_id} `;
            let billablesInDB = await DBSendResponse(billableQuery) || [];

            const query = `SELECT c.cus_company_id, c.cus_id, c.dob, p.active_plan_creation_date, c.AgencyAssignDate, c.cus_status, c.TransferOutReason, c.TransferOutDate, p.pro_id, p.pro_starts_on, p.pro_ends_on, p.DDD_plan_id, p.Program
                FROM customer c
                INNER JOIN project p ON p.pro_customer_id = c.cus_id
                WHERE p.pro_is_active = 'True' AND c.cus_company_id = ${company.company_id} AND ((c.cus_status = 'Active') OR (c.cus_status = 'Dormant' AND c.TransferOutDate >= '${moment().startOf('month').format('MM/DD/YYYY')}' and c.TransferOutDate <= '${moment().endOf('month').format('MM/DD/YYYY')}'))`;

            let result = await DBSendResponse(query);

            let dormantResult = result.filter((res) => res.cus_status === 'Dormant');
            result = result.filter((res) => res.cus_status === 'Active');

            // Check if the record is already present in the Database
            await Promise.all(result.map(async (res) => {
                res.matched = false;
                for (const bill of billablesInDB) {
                    if (bill.company_id === res.cus_company_id && bill.customer_id === res.cus_id && bill.project_id === res.pro_id) {
                        res.matched = true;
                        // CASE (PLAN RENEWED): If the record is already present but plan dates changed
                        if (bill.account_code === 'PLAN TERMINATION' && moment(res.pro_ends_on).isAfter(moment().endOf('month')) && !(!res.pro_starts_on || !res.pro_ends_on || moment(res.pro_starts_on).isSameOrBefore("1900-01-01") || moment(res.pro_ends_on).isSameOrBefore("1900-01-01"))) {
                            let updateQuery = `UPDATE accounts_receivable SET plan_version = ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, plan_program = ${res.Program ? `'${res.Program}'` : 'NULL'}, post_date = CURRENT_TIMESTAMP, proc_code = 'T2024HI', unit = 1, rate = ${rateMap['T2024HI'] ? rateMap['T2024HI'] : 0}, account_code = 'PLAN RENEWED' WHERE billable_id = ${bill.billable_id}`;
                            await DBUpdate(updateQuery);
                        }
                        // CASE (PLAN CHANGE): If the record is already present and (plan_version or plan program) changed
                        else if (bill.plan_version !== res.DDD_plan_id || bill.plan_program !== res.Program) {
                            let updateQuery = `UPDATE accounts_receivable SET plan_version = ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, plan_program = ${res.Program ? `'${res.Program}'` : 'NULL'}, post_date = CURRENT_TIMESTAMP, proc_code = 'T2024HI:52', unit = ${Math.abs(moment().diff(moment().startOf('month'), 'days')) + 1}, rate = ${rateMap['T2024HI:52'] ? rateMap['T2024HI:52'] : 0}, account_code = 'PLAN CHANGE' WHERE billable_id = ${bill.billable_id}`;
                            await DBUpdate(updateQuery);

                            let insertQuery = `INSERT INTO accounts_receivable (company_id, YYYYMM, customer_id, project_id, plan_version, plan_program, post_date, proc_code, unit, rate, account_code) VALUES (${res.cus_company_id}, ${moment().format('YYYYMM')}, ${res.cus_id}, ${res.pro_id}, ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, ${res.Program ? `'${res.Program}'` : 'NULL'}, CURRENT_TIMESTAMP, 'T2024HI:52', ${Math.abs(moment().endOf('month').diff(moment(), 'days')) + 1}, ${rateMap['T2024HI:52'] ? rateMap['T2024HI:52'] : 0}, 'PLAN CHANGE')`;
                            await DBSendResponse(insertQuery);
                        } else {

                        }
                    }
                }
            }));

            // CASE (PLAN TERMINATION): Customer with status 'Dormant' and transferred out date in the current month
            await Promise.all(dormantResult.map(async (res) => {
                let resAlreadyPresent = billablesInDB.find((bill) => bill.company_id === res.cus_company_id && bill.customer_id === res.cus_id && bill.project_id === res.pro_id);
                let transferOutUnits = Math.abs(moment().startOf('month').diff(moment(res.TransferOutDate), 'days'));

                // For Transfer Out Reason = Individual Passed Away, we also take into account the Transfer Out Date, else take one day prior to the Transfer Out Date
                // If (Transfer Out Reason = Moved to MLTSS) or If (Transfer Out Reason = Switched Providers and Transfer Out Date is first of month), then no units for the whole month
                if ((res.TransferOutReason === 'Moved to MLTSS') || (res.TransferOutReason === 'Switched Providers' && moment(res.TransferOutDate).utc().date() === 1)) {
                    if (resAlreadyPresent) {
                        if (resAlreadyPresent.account_code !== 'PLAN TERMINATION') {
                            let updateQuery = `UPDATE accounts_receivable SET post_date = CURRENT_TIMESTAMP, proc_code = NULL, unit = 0, rate = 0, account_code = 'PLAN TERMINATION' WHERE billable_id = ${resAlreadyPresent.billable_id}`;
                            await DBUpdate(updateQuery);
                        }
                    } else {
                        let insertQuery = `INSERT INTO accounts_receivable (company_id, YYYYMM, customer_id, project_id, plan_version, plan_program, post_date, unit, rate, account_code) VALUES (${res.cus_company_id}, ${moment().format('YYYYMM')}, ${res.cus_id}, ${res.pro_id}, ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, ${res.Program ? `'${res.Program}'` : 'NULL'}, CURRENT_TIMESTAMP, 0, 0, 'PLAN TERMINATION')`;
                        await DBSendResponse(insertQuery);
                    }
                } else {
                    if (resAlreadyPresent) {
                        let updateQuery = `UPDATE accounts_receivable SET post_date = CURRENT_TIMESTAMP, proc_code = 'T2024HI:52', unit = ${res.TransferOutReason === 'Individual Passed Away' ? transferOutUnits + 2 : transferOutUnits + 1}, rate = ${rateMap['T2024HI:52'] ? rateMap['T2024HI:52'] : 0}, account_code = 'PLAN TERMINATION' WHERE billable_id = ${resAlreadyPresent.billable_id}`;
                        await DBUpdate(updateQuery);
                    } else {
                        let insertQuery = `INSERT INTO accounts_receivable (company_id, YYYYMM, customer_id, project_id, plan_version, plan_program, post_date, proc_code, unit, rate, account_code) VALUES (${res.cus_company_id}, ${moment().format('YYYYMM')}, ${res.cus_id}, ${res.pro_id}, ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, ${res.Program ? `'${res.Program}'` : 'NULL'}, CURRENT_TIMESTAMP, 'T2024HI:52', ${res.TransferOutReason === 'Individual Passed Away' ? transferOutUnits + 2 : transferOutUnits + 1}, ${rateMap['T2024HI:52'] ? rateMap['T2024HI:52'] : 0}, 'PLAN TERMINATION')`;
                        await DBSendResponse(insertQuery);
                    }
                }
            }));

            // CASE 1 (INITIAL PLAN): If record not present and active customer with an Initial Plan
            await Promise.all(result
                .filter((res) => !res.matched && (!res.pro_starts_on || !res.pro_ends_on || moment(res.pro_starts_on).isSameOrBefore("1900-01-01") || moment(res.pro_ends_on).isSameOrBefore("1900-01-01")))
                .map(async (res) => {
                    if (res.active_plan_creation_date && moment(res.active_plan_creation_date).isSame(moment(), 'month') && res.DDD_plan_id === '1.00') {
                        let insertQuery = `INSERT INTO accounts_receivable (company_id, YYYYMM, customer_id, project_id, plan_version, plan_program, post_date, proc_code, unit, rate, account_code) VALUES (${res.cus_company_id}, ${moment().format('YYYYMM')}, ${res.cus_id}, ${res.pro_id}, ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, ${res.Program ? `'${res.Program}'` : 'NULL'}, CURRENT_TIMESTAMP, 'T2024HI:52', ${Math.abs(moment().endOf('month').diff(moment(res.active_plan_creation_date), 'days')) + 1}, ${rateMap['T2024HI:52'] ? rateMap['T2024HI:52'] : 0}, 'INITIAL PLAN')`;
                        await DBSendResponse(insertQuery);
                    }
                }));

            // CASE 2 (ACTIVE PLAN): If record not present and project start date before the first of month and end date after the last of month
            await Promise.all(result
                .filter((res) => !res.matched && moment(res.pro_starts_on).isSameOrBefore(moment().startOf('month')) && moment(res.pro_ends_on).isSameOrAfter(moment().endOf('month')))
                .map(async (res) => {
                    let insertQuery = `INSERT INTO accounts_receivable (company_id, YYYYMM, customer_id, project_id, plan_version, plan_program, post_date, proc_code, unit, rate, account_code) VALUES (${res.cus_company_id}, ${moment().format('YYYYMM')}, ${res.cus_id}, ${res.pro_id}, ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, ${res.Program ? `'${res.Program}'` : 'NULL'}, CURRENT_TIMESTAMP, 'T2024HI', 1, ${rateMap['T2024HI'] ? rateMap['T2024HI'] : 0}, 'ACTIVE PLAN')`;
                    await DBSendResponse(insertQuery);
                }));

            // CASE 3 (INITIAL PLAN): If record not present and project start date after the first of month and end date after the last of month
            await Promise.all(result
                .filter((res) => !res.matched && moment(res.pro_starts_on).isAfter(moment().startOf('month')) && moment(res.pro_ends_on).isAfter(moment().endOf('month')))
                .map(async (res) => {
                    if (moment(res.pro_starts_on).isSame(moment(), 'month') && res.DDD_plan_id === '1.00') {
                        let insertQuery = `INSERT INTO accounts_receivable (company_id, YYYYMM, customer_id, project_id, plan_version, plan_program, post_date, proc_code, unit, rate, account_code) VALUES (${res.cus_company_id}, ${moment().format('YYYYMM')}, ${res.cus_id}, ${res.pro_id}, ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, ${res.Program ? `'${res.Program}'` : 'NULL'}, CURRENT_TIMESTAMP, 'T2024HI', 1, ${rateMap['T2024HI'] ? rateMap['T2024HI'] : 0}, 'INITIAL PLAN')`;
                        await DBSendResponse(insertQuery);
                    }
                }));

            // CASE 4 (PLAN TERMINATION): If record not present and project start date before the first of month and end date before the last of month
            await Promise.all(result
                .filter((res) => !res.matched && moment(res.pro_ends_on).isBefore(moment().endOf('month')) && !(!res.pro_starts_on || !res.pro_ends_on || moment(res.pro_starts_on).isSameOrBefore("1900-01-01") || moment(res.pro_ends_on).isSameOrBefore("1900-01-01")))
                .map(async (res) => {
                    if (moment(res.pro_ends_on).isSame(moment(), 'month')) {
                        let insertQuery = `INSERT INTO accounts_receivable (company_id, YYYYMM, customer_id, project_id, plan_version, plan_program, post_date, proc_code, unit, rate, account_code) VALUES (${res.cus_company_id}, ${moment().format('YYYYMM')}, ${res.cus_id}, ${res.pro_id}, ${res.DDD_plan_id ? `'${res.DDD_plan_id}'` : 'NULL'}, ${res.Program ? `'${res.Program}'` : 'NULL'}, CURRENT_TIMESTAMP, 'T2024HI:52', ${Math.abs(moment(res.pro_ends_on).diff(moment().startOf('month'), 'days')) + 1}, ${rateMap['T2024HI:52'] ? rateMap['T2024HI:52'] : 0}, 'PLAN TERMINATION')`;
                        await DBSendResponse(insertQuery);
                    }
                }));
        }
    } catch (err) {
        console.error("Error in addBillablesForSC:", err);
    }
};

async function addBillablesForNonSC() {
    try {
        // Fetch NJ Non-SC companies subscribed to Financial Reporting
        const compQuery = `
            SELECT DISTINCT company_id
                FROM settings
            WHERE company_id IN (SELECT company_id FROM settings WHERE feature_id = 19)
            AND company_id IN (SELECT company_id FROM settings WHERE feature_value = 'primaryBusinessType' AND feature_id IN (102, 104, 105))
            AND company_id IN (SELECT company_id FROM settings WHERE feature_id = 99 AND state_id = 'NJ')`;

        const compList = await DBSendResponse(compQuery);

        for (const company of compList) {
            await sleep(Math.floor(Math.random() * 60000));

            console.log(`ACCOUNTS RECEIVALBLE | Running for ${company?.company_id}`);

            const deleteQuery = `
            DELETE ar
                FROM accounts_receivable ar
                JOIN task t ON t.tas_id = ar.task_id
            WHERE t.tas_com_id = ${company.company_id} AND ar.YYYYMM = '${moment().format('YYYYMM')}' AND t.tas_is_active = 2
            `;

            await DBSendResponse(deleteQuery);

            const query = `
            SELECT c.cus_id, p.pro_id, t.tas_id, CONCAT(pc.procProcCode, ISNULL(br.procModifierCode, '')) AS fullProcCode, br.rate, ar.task_id AS ar_task_id, ar.unit AS ar_unit,
            CASE
                WHEN pc.procUnitOfService = '15 Minutes' THEN CEILING(DATEDIFF(MINUTE, el.empLocdate, el.checkoutEmpDate) / 15.0)
                WHEN pc.procUnitOfService = '1 Hour' THEN CEILING(DATEDIFF(MINUTE, el.empLocdate, el.checkoutEmpDate) / 60.0)
                ELSE 1
            END AS taskUnits
                FROM empLocate el
                JOIN task t ON t.tas_id = el.taskId
                JOIN project p ON p.pro_id = t.tas_pro_id
                JOIN customer c ON c.cus_id = p.pro_customer_id
                JOIN dropdowns dd ON dd.EntityValue = t.tas_type AND dd.CompanyID = t.tas_com_id
                JOIN TaskProcCodeMapping tpcm ON tpcm.dropdown_id = dd.ddID
                JOIN procedure_code pc ON pc.procCode_id = tpcm.procedure_code_id AND pc.state_id = 'NJ'
                CROSS APPLY (
                    SELECT TOP 1 *
                        FROM billingrates br2
                    WHERE br2.procProcCode = pc.procProcCode AND br2.tier = c.DDD_tier AND br2.deliveryMode = tpcm.deliveryMode
                ) br
                LEFT JOIN accounts_receivable ar ON ar.task_id = t.tas_id
                LEFT JOIN provider_identifier pi ON pi.prov_iden_id = tpcm.providerIdentifier
            WHERE t.tas_com_id = ${company.company_id}
                AND LEFT(CONVERT(VARCHAR(8), el.empLocdate, 112), 6) = '${moment().format('YYYYMM')}'
                AND t.tas_billable_by_default = 'True'
                AND t.tas_is_active != 2
                AND (pi.prov_name IS NULL OR pi.prov_name <> 'Contract for Private Payers' OR pi.prov_iden IS NULL OR pi.prov_iden <> '999999')
            `;

            const result = await DBSendResponse(query);

            for (const row of result) {
                const { cus_id, pro_id, tas_id, fullProcCode, rate, ar_task_id, ar_unit, taskUnits } = row;

                if (!ar_task_id) {
                    const insertQuery = `
                        INSERT INTO accounts_receivable (company_id, YYYYMM, customer_id, project_id, task_id, post_date, proc_code, unit, rate, account_code)
                        VALUES (${company.company_id}, '${moment().format("YYYYMM")}', ${cus_id}, ${pro_id}, ${tas_id}, CURRENT_TIMESTAMP, '${fullProcCode}', ${taskUnits}, ${rate ?? 0}, 'SERVICE PROVIDED')
                    `;

                    await DBSendResponse(insertQuery);
                }
                else if (ar_unit != taskUnits) {
                    const updateQuery = `
                        UPDATE accounts_receivable
                        SET unit = ${taskUnits}
                        WHERE task_id = ${ar_task_id}
                    `;

                    await DBUpdate(updateQuery);
                }
            }
        }
    } catch (err) {
        console.error("Error in addBillablesForNonSC:", err);
    }
};

exports.getAccountsReceivable = async (req, res) => {
    let companyID = JSON.parse(req.query.companyID);

    const query = `SELECT ar.billable_id, ar.YYYYMM, ar.customer_id, ar.project_id, ar.plan_version, ar.plan_program, ar.proc_code, ar.unit, ar.rate, ar.total, ar.account_code, ar.post_date, ar.prior_auth_status, ar.payment_status, c.DDDID, c.cus_name, c.cus_status, c.TransferOutDate, c.TransferOutReason, c.dob, p.active_plan_creation_date, c.AgencyAssignDate, p.pro_title, p.pro_starts_on, p.pro_ends_on, bn.billing_note_id, bn.billing_note,
                    (SELECT * FROM preAuth pa WHERE pa.DDDID = c.DDDID AND pa.companyId = ${companyID} AND pa.procedureCode = ar.proc_code AND pa.startDate >= '${moment(req.query.month).startOf('month').format('MM/DD/YYYY')}' and pa.endDate <= '${moment(req.query.month).endOf('month').format('MM/DD/YYYY')}' FOR JSON PATH) as PA_FOUND,
                    (SELECT * FROM Claim clm WHERE clm.DDDID = c.DDDID AND clm.startDate >= '${moment(req.query.month).startOf('month').format('MM/DD/YYYY')}' and clm.endDate <= '${moment(req.query.month).endOf('month').format('MM/DD/YYYY')}' FOR JSON PATH) as PAYMENT_FOUND
    FROM accounts_receivable ar
    INNER JOIN customer c ON c.cus_id = ar.customer_id AND c.cus_company_id = ${companyID}
    INNER JOIN project p ON p.pro_id = ar.project_id
    LEFT JOIN billing_notes bn ON bn.billable_id = ar.billable_id
    WHERE ar.company_id = ${companyID} AND ar.YYYYMM = '${req.query.month}'`

    let result = await DBSendResponse(query)

    result = result.map((ac) => {
        ac.PA_FOUND = JSON.parse(ac.PA_FOUND)
        ac.PAYMENT_FOUND = JSON.parse(ac.PAYMENT_FOUND)
        return ac
    })

    res.json(result)
}

exports.updatePriorAuth = async function (req, res) {
    const query = `UPDATE accounts_receivable SET prior_auth_status = 'On DDD Voucher' WHERE billable_id = ${req.body.billable_id}`;
    let preAuth_update_res = await DBUpdate(query);

    if (preAuth_update_res === 0) {
        return res.json({ code: 500, message: "PreAuth Update Failed" });
    }

    return res.json({
        code: 200,
        preAuth_data: {
            primary_ID: req.body.primary_ID,
            errDescription: "On DDD Voucher",
        },
        message: "PreAuth Update Success",
    });
}

exports.updateClaim = async function (req, res) {
    const query = `UPDATE accounts_receivable SET payment_status = '${req.body.payment_status}' WHERE billable_id = ${req.body.billable_id}`;
    let claim_update_res = await DBUpdate(query);

    if (claim_update_res === 0) {
        return res.json({ code: 500, message: "Claim Update Failed" });
    }

    if (req.body.claim_ID) {
        const today = moment().format('YYYY-MM-DD');
        await DBUpdate(`UPDATE Claim SET Status = 'Processed as Secondary', LastResponseDate = '${today}' WHERE claim_ID = ${req.body.claim_ID}`);
    }

    return res.json({
        code: 200,
        claim_data: {
            claim_ID: req.body.claim_ID,
            Status: "Voucher Payment Received",
        },
        message: "Claim Update Success",
    });
}

exports.updateBillingNote = async function (req, res) {
    const query = `UPDATE billing_notes SET billing_note = '${String(req.body.billing_note).replaceAll("'", "''")}', updated_at = CURRENT_TIMESTAMP, updated_by = ${req.body.empID} WHERE billing_note_id = ${req.body.billing_note_id}`;
    let note_update_res = await DBUpdate(query);

    if (note_update_res === 0) {
        return res.json({ code: 500, message: "Note Update Failed" });
    }

    return res.json({
        code: 200,
        note_data: {
            billing_note_id: req.body.billing_note_id,
            billing_note: req.body.billing_note,
        },
        message: "Note Update Success",
    });
}

exports.addBillingNote = async function (req, res) {
    try {
        let insertQuery = `INSERT INTO billing_notes (billing_note, billable_id, employee_id, created_at, updated_at, updated_by, isDeleted, claim_id, preAuth_id) 
                           VALUES (
                                '${String(req.body.billing_note).replaceAll("'", "''")}', 
                                ${req.body.billable_id ? req.body.billable_id : 'NULL'}, 
                                ${req.body.empID}, 
                                CURRENT_TIMESTAMP,
                                CURRENT_TIMESTAMP,
                                ${req.body.empID},
                                0,
                                ${req.body.claim_id ? req.body.claim_id : 'NULL'},
                                ${req.body.preAuth_id ? req.body.preAuth_id : 'NULL'}
                            ); SELECT SCOPE_IDENTITY();`;
        await DBSendResponse(insertQuery);

        return res.json({
            success: true,
            foundError: false,
            message: "Note Added Success"
        })
    } catch (err) {
        return handleCatchError(err, res)
    }
}