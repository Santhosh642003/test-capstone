const dotenv = require('dotenv');

dotenv.config();

const express = require('express');
const bodyParser = require('body-parser');
const methodOverride = require('method-override');
const cors = require('cors');
const cron = require('node-cron');
const moment = require('moment-timezone');
const { CUSTOMERIO_API_KEY, IN_APP_MESSAGE_MISSED_CLOCK_IN_ID, IN_APP_MESSAGE_MISSED_CLOCK_OUT_ID } = require('./config.js');
const { APIClient, RegionUS, SendEmailRequest } = require('customerio-node');

const client = new APIClient(CUSTOMERIO_API_KEY);
const broadcastApi = new APIClient(CUSTOMERIO_API_KEY, { region: RegionUS });
const port = process.env.PORT || 4000;
const { loggerMiddleware, defaultLogger: logger } = require('./logger');
const { withRequestLogger } = require('./loggerContext');

const app = express();

app.use(loggerMiddleware);
app.use((req, res, next) => {
  const loggerWithReqId = req.log.child({});
  withRequestLogger(loggerWithReqId, next);
});
app.use(bodyParser.urlencoded({ limit: '200mb', extended: true }));
app.use(bodyParser.json({ limit: '200mb' }));
app.use(bodyParser.urlencoded({ limit: '200mb', extended: true }));
app.use(bodyParser.json({ limit: '200mb' }));
app.use(cors());
app.use(methodOverride('_method'));
app.use(express.static(__dirname + '/views'));
app.use(express.static(__dirname + '/public/stylesheets'));
app.set('view engine', 'ejs');


// *** Initializaztion Functions ***
// Vector DB (local pgvector) -- schema is assumed to already exist; see
// helpers/vectorDb.js (handles its own logging/failure behavior).
const { initVectorDB } = require('./helpers/vectorDb');

initVectorDB();

// EVV
var helpers = require('./helpers/evv');

helpers.sendEVVDataByScheduler();

// var AZ_helpers = require('./helpers/evv_AZ');
// AZ_helpers.sendEVV_AZ_Scheduler();

// Billing
const exclusionsList = require('./helpers/exclusionsList');

exclusionsList.updateList();
exclusionsList.getConsolidatedDebar();

var billables = require('./helpers/accountsReceivable');

billables.insertBillables();

var claim_md = require('./helpers/medicaid.js');

claim_md.getRecentERAListFromClaimMD();
claim_md.getClaimResponseFromClaimMD();

// Workflows
const workflows = require('./helpers/workflows.js');

workflows.workflowOrchestrator();

// Reports
const reportSchedule = require('./helpers/report_schedule.js');

reportSchedule.sendReports();

// RAG sync (ElliQ retrieval) -- nightly incremental refresh of the pgvector store.
const ragSync = require('./helpers/ragSync.js');

ragSync.scheduleNightlySync();

// QA sweep (compliance gaps) -- nightly deterministic + LLM narrative sweep.
const qaSweepJob = require('./helpers/qaSweepJob.js');

// TESTING: cron disabled while the manual "Run Sweep Now" button
// (routes/compliance.js POST /run-now) is in place. UNCOMMENT this line
// before merge, and remove the manual trigger route/button/handler per the
// TESTING ONLY comments in helpers/qaSweepJob.js, routes/compliance.js and
// ComplianceDashboard.js.
// qaSweepJob.scheduleNightlySweep();

// Year End Email
const yearEndEmail = require('./helpers/metabase.js');
// yearEndEmail.addYearEndArtifact();
// yearEndEmail.sendYearEndEmail();

// Tasks
var task_helper = require('./helpers/task');
var contact_helper = require('./helpers/contacts');
var setting_helper = require('./helpers/settings');

cron.schedule('*/1 * * * *', async () => {
  let dayList = await task_helper.getTasksAfterInterval({ query: { interval: 'DAY', time: '1', date: moment().tz('America/New_York').format('YYYY-MM-DDTHH:mm:00') } });
  let hourList = await task_helper.getTasksAfterInterval({ query: { interval: 'HOUR', time: '1', date: moment().tz('America/New_York').format('YYYY-MM-DDTHH:mm:00') } });

  let taskList = [
    ...dayList.map(task => ({ ...task, time: 'day' })),
    ...hourList.map(task => ({ ...task, time: 'hour' })),
  ];
  let companysSetting = [];
  let individualSettings = [];


  for (const task of taskList) {
    if (companysSetting.findIndex(company => company.comp_id === task.emp_company_id) === -1) {
      let setting = await setting_helper.getSettingsFunc({ query: { comp_id: task.emp_company_id } });
      console.log('setting', setting);
      if (individualSettings.findIndex(individualSetting => individualSetting.emp_id === task.emp_id) === -1) {
        let invidiualSetting = await setting_helper.getIndividualSettingsFunc({ params: { emp_id: task.emp_id }, query: {} });
        individualSettings.push({ emp_id: task.emp_id, setting: invidiualSetting });
      }
      companysSetting.push({ comp_id: task.emp_company_id, setting });
    }
  }

  await Promise.all(taskList.map(async (task) => {

    let settings = companysSetting.find(company => company.comp_id === task.emp_company_id).setting;
    let isSecureCommunicaion = settings.find(setting => setting.feature_id === 21);
    let isTaskReminder = settings.find(setting => (setting.feature_id === 63 && setting.feature_value === 'true') || (setting.feature_id === 64 && setting.feature_value === 'true') || (setting.feature_id === 65 && setting.feature_value === 'true'));
    let isCustomerContactReminder = settings.find(setting => setting.feature_id === 68 && setting.feature_value === 'true');

    let isTaskReminderEmployee = individualSettings.find(individualSetting => individualSetting.emp_id === task.emp_id).setting.find(setting => setting.feature_id === 5 && setting.feature_value === 'true');
    if (!isTaskReminderEmployee) {
      return;
    }

    let recipients = [];

    if (!isSecureCommunicaion) {
      return;
    }

    if (isTaskReminder) {
      recipients.push({ ...task, type: 'employee' });
    }

    if (isCustomerContactReminder) {
      let contacts = await contact_helper.getContactsByCustomer({ query: { comp_id: task.emp_company_id, customer_id: task.cus_id } });
      recipients.push(
        { ...task, type: 'customer' },
        ...contacts.map(contact => ({ ...task, type: 'contact', con_id: contact.con_id, con_email: contact.con_email }))
      );
    }

    recipients.forEach(async (recipient) => {
      let message_data = {
        customer_name: recipient.cus_name ? recipient.cus_name : undefined,
        employee_name: task.emp_first_name + ' ' + task.emp_last_name,
        contact_name: recipient.con_first_name ? recipient.con_first_name + ' ' + recipient.con_last_name : undefined,
        time: task.time,
        start_date: moment.tz(task.tas_start_time, 'YYYY-MM-DDTHH:mm:ss', 'America/New_York').format('MM/DD/YYYY hh:mm A'),
        end_date: moment.tz(task.tas_end_time, 'YYYY-MM-DDTHH:mm:ss', 'America/New_York').format('MM/DD/YYYY hh:mm A'),
        type: recipient.type,
        company_name: task.com_name,
      };

      try {
        let email = '';

        if (recipient.type === 'employee')
          email = recipient.sec_email;
        if (recipient.type === 'customer')
          email = recipient.cus_email;
        if (recipient.type === 'contact')
          email = recipient.con_email;
        if (!email)
          return;

        const request = new SendEmailRequest({
          transactional_message_id: 'task_reminder',
          message_data: message_data,
          identifiers: {
            id: task.emp_id
          },
          to: email
        });

        await client.sendEmail(request);
      } catch (error) {
        logger.error(error, 'Error occured in task_reminder cron job');
      }
    });
  }));
});

// Missed Clock-In / Clock-Out alerts (tasks + empLocate)
cron.schedule('*/1 * * * *', async () => {
  try {
    const { DBSendResponse } = require('./queries/commonQueries');

    const now = moment().tz('America/New_York');
    const today = now.format('YYYY-MM-DD');
    const fiveMinAgo = now.clone().subtract(5, 'minutes').format('YYYY-MM-DD HH:mm:ss');

    // Find companies that have active tasks today
    const companies = await DBSendResponse(`
      SELECT DISTINCT t.tas_com_id AS company_id
      FROM task t
      WHERE t.tas_is_active = 0
        AND (CAST(t.tas_start_time AS DATE) = '${today}'
          OR CAST(t.tas_end_time AS DATE) = '${today}')
    `);
    if (!companies || companies.length === 0) return;

    // Build settings cache — only keep companies with at least one alert enabled
    const settingsCache = [];
    for (const comp of companies) {
      const setting = await setting_helper.getSettingsFunc({ query: { comp_id: comp.company_id } });
      const hasMissedClockIn  = setting.find(s => s.feature_id === 83 && s.feature_value === 'true');
      const hasMissedClockOut = setting.find(s => s.feature_id === 84 && s.feature_value === 'true');
      if (hasMissedClockIn || hasMissedClockOut) settingsCache.push({ comp_id: comp.company_id, setting });
    }
    if (settingsCache.length === 0) return;

    // --- Missed Clock-In (feature_id 83) ---
    // Tasks whose start time was 5+ min ago with no empLocate check-in record
    const missedClockIns = await DBSendResponse(`
      SELECT t.tas_id, t.tas_title, t.tas_start_time,
             t.tas_com_id, t.tas_emp_id,
             e.emp_first_name, e.emp_last_name,
             c.cus_name
      FROM task t
      INNER JOIN employee e ON e.emp_id = t.tas_emp_id
      LEFT JOIN customer c ON c.cus_id = t.tas_cus_id
      WHERE t.tas_is_active = 0
        AND CAST(t.tas_start_time AS DATE) = '${today}'
        AND t.tas_start_time <= '${fiveMinAgo}'
        AND NOT EXISTS (
            SELECT 1 FROM empLocate el
            WHERE el.taskId = t.tas_id AND el.empLocdate IS NOT NULL
        )
        AND NOT EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.notif_type = 'missed_clockin'
              AND n.emp_id = t.tas_emp_id AND n.tas_id = t.tas_id
        )
    `);

    for (const row of (missedClockIns || [])) {
      const cs = settingsCache.find(c => c.comp_id === row.tas_com_id);
      if (!cs || !cs.setting.find(s => s.feature_id === 83 && s.feature_value === 'true')) continue;

      const checkinTime = moment(row.tas_start_time).tz('America/New_York').format('hh:mm A');
      const taskTitle   = (row.tas_title || 'Visit').replace(/'/g, '\'\'');
      const cusName     = (row.cus_name  || '').replace(/'/g, '\'\'');
      const notifText   = `Missed Clock-In: ${row.emp_first_name} ${row.emp_last_name} has not clocked in for ${taskTitle} (${cusName}) scheduled at ${checkinTime}`;

      await DBSendResponse(`INSERT INTO notifications VALUES (
        NULL, ${row.tas_emp_id}, CURRENT_TIMESTAMP,
        '${notifText.replace(/'/g, '\'\'')}', ${row.tas_emp_id}, NULL, ${row.tas_id},
        NULL, NULL, NULL, NULL, 'missed_clockin', 'false', 'NULL', NULL
      )`);

      try {
        await broadcastApi.triggerBroadcast(String(IN_APP_MESSAGE_MISSED_CLOCK_IN_ID),
          { task_name: row.tas_title || 'Visit', checkinTime },
          { ids: [String(row.tas_emp_id)] }
        );
      } catch (err) { logger.error(err, 'missed clock-in broadcast failed for emp ' + row.tas_emp_id); }

      const admins = await DBSendResponse(`
        SELECT emp_id FROM employee
        WHERE emp_company_id = ${row.tas_com_id} AND emp_is_active = 1
          AND role_id IN (1, 2) AND emp_id != ${row.tas_emp_id}
      `);
      const adminIds = [];
      for (const a of (admins || [])) {
        adminIds.push(String(a.emp_id));
        await DBSendResponse(`INSERT INTO notifications VALUES (
          NULL, ${a.emp_id}, CURRENT_TIMESTAMP,
          '${notifText.replace(/'/g, '\'\'')}', ${row.tas_emp_id}, NULL, ${row.tas_id},
          NULL, NULL, NULL, NULL, 'missed_clockin', 'false', 'NULL', NULL
        )`);
      }
      if (adminIds.length > 0) {
        try {
          await broadcastApi.triggerBroadcast(String(IN_APP_MESSAGE_MISSED_CLOCK_IN_ID),
            { task_name: row.tas_title || 'Visit', checkinTime },
            { ids: adminIds }
          );
        } catch (err) { logger.error(err, 'missed clock-in broadcast to admins failed'); }
      }
    }

    // --- Missed Clock-Out (feature_id 84) ---
    // Tasks whose end time was 5+ min ago, clocked in but not clocked out
    const missedClockOuts = await DBSendResponse(`
      SELECT t.tas_id, t.tas_title, t.tas_end_time,
             t.tas_com_id, t.tas_emp_id,
             e.emp_first_name, e.emp_last_name,
             c.cus_name
      FROM task t
      INNER JOIN employee e ON e.emp_id = t.tas_emp_id
      INNER JOIN empLocate el ON el.taskId = t.tas_id
      LEFT JOIN customer c ON c.cus_id = t.tas_cus_id
      WHERE t.tas_is_active = 0
        AND CAST(t.tas_end_time AS DATE) = '${today}'
        AND t.tas_end_time <= '${fiveMinAgo}'
        AND el.empLocdate IS NOT NULL
        AND el.checkoutEmpDate IS NULL
        AND NOT EXISTS (
            SELECT 1 FROM notifications n
            WHERE n.notif_type = 'missed_clockout'
              AND n.emp_id = t.tas_emp_id AND n.tas_id = t.tas_id
        )
    `);

    for (const row of (missedClockOuts || [])) {
      const cs = settingsCache.find(c => c.comp_id === row.tas_com_id);
      if (!cs || !cs.setting.find(s => s.feature_id === 84 && s.feature_value === 'true')) continue;

      const checkoutTime = moment(row.tas_end_time).tz('America/New_York').format('hh:mm A');
      const taskTitle    = (row.tas_title || 'Visit').replace(/'/g, '\'\'');
      const cusName      = (row.cus_name  || '').replace(/'/g, '\'\'');
      const notifText    = `Missed Clock-Out: ${row.emp_first_name} ${row.emp_last_name} has not clocked out for ${taskTitle} (${cusName}) that ended at ${checkoutTime}`;

      await DBSendResponse(`INSERT INTO notifications VALUES (
        NULL, ${row.tas_emp_id}, CURRENT_TIMESTAMP,
        '${notifText.replace(/'/g, '\'\'')}', ${row.tas_emp_id}, NULL, ${row.tas_id},
        NULL, NULL, NULL, NULL, 'missed_clockout', 'false', 'NULL', NULL
      )`);

      try {
        await broadcastApi.triggerBroadcast(String(IN_APP_MESSAGE_MISSED_CLOCK_OUT_ID),
          { task_name: row.tas_title || 'Visit', checkoutTime },
          { ids: [String(row.tas_emp_id)] }
        );
      } catch (err) { logger.error(err, 'missed clock-out broadcast failed for emp ' + row.tas_emp_id); }

      const admins = await DBSendResponse(`
        SELECT emp_id FROM employee
        WHERE emp_company_id = ${row.tas_com_id} AND emp_is_active = 1
          AND role_id IN (1, 2) AND emp_id != ${row.tas_emp_id}
      `);
      const adminIds = [];
      for (const a of (admins || [])) {
        adminIds.push(String(a.emp_id));
        await DBSendResponse(`INSERT INTO notifications VALUES (
          NULL, ${a.emp_id}, CURRENT_TIMESTAMP,
          '${notifText.replace(/'/g, '\'\'')}', ${row.tas_emp_id}, NULL, ${row.tas_id},
          NULL, NULL, NULL, NULL, 'missed_clockout', 'false', 'NULL', NULL
        )`);
      }
      if (adminIds.length > 0) {
        try {
          await broadcastApi.triggerBroadcast(String(IN_APP_MESSAGE_MISSED_CLOCK_OUT_ID),
            { task_name: row.tas_title || 'Visit', checkoutTime },
            { ids: adminIds }
          );
        } catch (err) { logger.error(err, 'missed clock-out broadcast to admins failed'); }
      }
    }
  } catch (error) {
    logger.error(error, 'Error in missed clock alerts cron job');
  }
});

// *** Routes ***
app.use('/api/fieldworker/case-summary-chat', require('./routes/caseSummaryChat'));
app.use('/api/fieldworker/jsreport', require('./routes/jsreport'));
app.use('/api/fieldworker/new', require('./routes/new'));
app.use('/api/fieldworker/project', require('./routes/projects'));
app.use('/api/fieldworker/update', require('./routes/update'));
app.use('/api/fieldworker/locate', require('./routes/empLocate'));
app.use('/api/fieldworker/delete', require('./routes/delete'));
app.use('/api/fieldworker/artifacts', require('./routes/artifacts'));
app.use('/api/fieldworker/team', require('./routes/team'));
app.use('/api/fieldworker/contacts', require('./routes/contacts'));
app.use('/api/fieldworker/home', require('./routes/home'));
app.use('/api/fieldworker/comments', require('./routes/comment'));
app.use('/api/fieldworker/customers', require('./routes/customers'));
app.use('/api/fieldworker/schema', require('./routes/schema'));
app.use('/api/fieldworker/projemployees', require('./routes/project_employee_assignment'));
app.use('/api/fieldworker/task', require('./routes/task'));
app.use('/api/fieldworker/location', require('./routes/location'));
app.use('/api/fieldworker/projcontact', require('./routes/project_contact'));
app.use('/api/fieldworker/employees', require('./routes/employees'));
app.use('/api/fieldworker/dropdowns', require('./routes/dropdowns'));
app.use('/api/fieldworker/config', require('./routes/config'));
app.use('/api/fieldworker/auth', require('./routes/auth'));
app.use('/api/fieldworker/company', require('./routes/company'));
app.use('/api/fieldworker/projlocations', require('./routes/projlocations'));
app.use('/api/fieldworker/calls', require('./routes/calls'));
app.use('/api/fieldworker/upload', require('./routes/csv_upload'));
app.use('/api/fieldworker/timesheets', require('./routes/timesheets'));
app.use('/api/fieldworker/reports', require('./routes/reports'));
app.use('/api/fieldworker/notifications', require('./routes/notifications'));
app.use('/api/fieldworker/messages', require('./routes/messages'));
app.use('/api/fieldworker/bulkupload', require('./routes/bulkupload'));
app.use('/api/fieldworker/payer', require('./routes/payer'));
app.use('/api/fieldworker/creds', require('./routes/creds'));
app.use('/api/fieldworker/pay_period', require('./routes/pay_period'));
app.use('/api/fieldworker/payroll', require('./routes/payroll'));
app.use('/api/fieldworker/time_sheet', require('./routes/time_sheet'));
app.use('/api/fieldworker/evv', require('./routes/evv'));
app.use('/api/fieldworker/monthlycontact', require('./routes/monthlycontact'));
app.use('/api/fieldworker/subtasks', require('./routes/subtasks'));
app.use('/api/fieldworker/bulkuploadEmployee', require('./routes/bulkuploadEmployee'));
app.use('/api/fieldworker/bulkuploadCustomer', require('./routes/bulkuploadCustomer'));
app.use('/api/fieldworker/documents', require('./routes/documents'));
app.use('/api/fieldworker/forms', require('./routes/forms'));
app.use('/api/fieldworker/invoice', require('./routes/invoice'));
app.use('/api/fieldworker/procedureCodes', require('./routes/procedureCodes'));
app.use('/api/fieldworker/medicaid', require('./routes/medicaid'));
app.use('/api/fieldworker/calendar', require('./routes/calendar-link'));
app.use('/api/fieldworker/search', require('./routes/search'));
app.use('/api/fieldworker/exclusions-list', require('./routes/exclusionsList'));
app.use('/api/fieldworker/preAuth', require('./routes/preAuth'));
app.use('/api/fieldworker/activity_log', require('./routes/activity_log'));
app.use('/api/fieldworker/shift_action_log', require('./routes/shift_action_log'));
app.use('/api/fieldworker/maps', require('./routes/maps'));
app.use('/api/fieldworker/monthlymonitoring', require('./routes/monthlymonitoring'));
app.use('/api/fieldworker/claims', require('./routes/claims'));
app.use('/api/fieldworker/claimCSV', require('./routes/claimCSV'));
app.use('/api/fieldworker/generateX12', require('./routes/generateX12'));
app.use('/api/fieldworker/directories', require('./routes/directories'));
app.use('/api/fieldworker/datagrid', require('./routes/datagrid'));
app.use('/api/fieldworker/utility', require('./routes/utility'));
app.use('/api/fieldworker/evv_AZ', require('./routes/evv_Arizona'));
app.use('/api/fieldworker/signature', require('./routes/signature'));
app.use('/api/fieldworker/customer_form', require('./routes/customer_form'));
app.use('/api/fieldworker/task_form', require('./routes/task_form'));
app.use('/api/fieldworker/audio_note', require('./routes/audio_note'));
app.use('/api/fieldworker/customer_goal', require('./routes/customer_goal'));
app.use('/api/fieldworker/accountsReceivable', require('./routes/accountsReceivable'));
app.use('/api/fieldworker/resources', require('./routes/resources'));
app.use('/api/fieldworker/sessions', require('./routes/sessions'));
app.use('/api/fieldworker/master_schedule', require('./routes/master_schedule'));
app.use('/api/fieldworker/customer_empl_need', require('./routes/customer_empl_need'));
app.use('/api/fieldworker/customer_assignment', require('./routes/customer_assignment'));
app.use('/api/fieldworker/customer_health_need', require('./routes/customer_health_need'));
app.use('/api/fieldworker/customer_support_need', require('./routes/customer_support_need'));
app.use('/api/fieldworker/customer_adl', require('./routes/customer_adl'));
app.use('/api/fieldworker/customer_medication', require('./routes/customer_medication'));
app.use('/api/fieldworker/customer_assessment', require('./routes/customer_assessment'));
app.use('/api/fieldworker/customer_incident', require('./routes/customer_incident'));
app.use('/api/fieldworker/customer_extension', require('./routes/customer_extension'));
app.use('/api/fieldworker/customer_vaccine', require('./routes/customer_vaccine'));
app.use('/api/fieldworker/system', require('./routes/system'));
app.use('/api/fieldworker/metabase', require('./routes/metabase'));
app.use('/api/fieldworker/associate_payer', require('./routes/companyPayerRel.js'));
app.use('/api/fieldworker/tokens', require('./routes/tokens'));
app.use('/api/fieldworker/gridLayout', require('./routes/gridLayout.js'));
app.use('/api/fieldworker/ability_hub', require('./routes/ability_hub.js'));
app.use('/api/fieldworker/ah_sync', require('./routes/ah_sync'));
app.use('/api/fieldworker/workflows', require('./routes/workflows'));
app.use('/api/fieldworker/billingrates', require('./routes/billingrates.js'));
app.use('/api/fieldworker/referralSettings', require('./routes/referralSettings'));
app.use('/api/fieldworker/referral', require('./routes/referral'));
app.use('/api/fieldworker/report_schedule', require('./routes/report_schedule.js'));
app.use('/api/fieldworker/sos', require('./routes/sos.js'));
app.use('/api/fieldworker/privatePayerBilling', require('./routes/privatePayerBilling.js'));
app.use('/api/fieldworker/elliq', require('./routes/elliq'));
app.use('/api/fieldworker/compliance', require('./routes/compliance'));
app.use('/api/fieldworker/caregiverPreferences', require('./routes/caregiverPreferences.js'));
app.use('/api/fieldworker/sdr', require('./routes/sdr.js'));
app.use('/api/fieldworker/households', require('./routes/households'));
app.use('/api/fieldworker/programs', require('./routes/programs'));

app.get('/:name', function (req, res) {
  req.log.info(req.params.name);
  res.send(req.params.name);
});

app.get('*', function (req, res) {
  res.send('Endpoint Undefined');
});

app.listen(port, function () {
  console.log('FieldworkerAPI running on port: ', port);
  logger.info('FieldworkerAPI running on port: ' + port);
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('App crashing error (was prevented) caught for: ' + req.url);
  console.error(err.stack);
  req.log.error(err, 'App crashing error (was prevented)');
  res.status(500).json({ error: 'Something went wrong!' });
});
