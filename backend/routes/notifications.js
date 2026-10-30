const helper = require('csvtojson')
const express = require('express')
const router = express.Router()
const helpers = require('../helpers/notifications')

router.route('/')
  // .get(helpers.getNotification)
  .get(helpers.getAllNotifications)
  // .post(helpers.addEmpCallNotif)// empToemp
  // .put(helpers.updateAllNotifications)
// .delete(helpers.delNotifications)

router.route('/:notif_id')
.get(helpers.getNotification)
.put(helpers.updateNotif)

router.route('/:notif_type')
  .post(helpers.addNotification)


module.exports = router
