const express = require('express')
const router = express.Router()
const helpers = require('../helpers/monthlymonitoring')

router.route('/save-with-task')
  .post(helpers.saveWithTask)

router.route('/template/:type')
  .get(helpers.getTemplate)

router.route('/last/month')
  .get(helpers.prevMonthMT)

router.route('/last/quaterly-annual')
  .get(helpers.prevQuarterlyAnnual)

router.route('/')
  .post(helpers.postData)
  .put(helpers.putData)

router.route('/review')
  .put(helpers.reviewMT)

router.route('/follow-up-items/:id')
  .get(helpers.getFollowUpItems)
  .delete(helpers.deleteFollowUpItems)
  .post(helpers.postFollowUpItems)

router.route('/manager/data')
  .get(helpers.getManagerData)

router.route('/employee/all/:id')
  .get(helpers.getAllCustomerMTs)

router.route('/manager/all/:id')
  .get(helpers.getAllManagerMTs)

router.route('/initiate/mt')
  .post(helpers.initiateMT)

router.route('/downloaded/:id')
  .put(helpers.downloaded)

router.route('/customer/:cus_id')
  .get(helpers.getAllForCustomer)

router.route('/bulk_approve')
  .post(helpers.bulkUpdateData);

router.route('/:id')
  .get(helpers.getData)

module.exports = router
