const express = require('express')
const router = express.Router()
const helpers = require('../helpers/config')
const defaults = require('../helpers/defaults')
const settings = require('../helpers/settings')


router.route('/')
  .get(helpers.getConfig)
  .post(helpers.addConfig)
  .put(helpers.updateConfig)
  .delete(helpers.delConfig)

router.route('/defaults')
  .get(defaults.getDefaults)
  .post(defaults.addDefault)

router.route('/defaultsBulk')
  .post(defaults.addDefaultBulk)
  .put(defaults.delAllDefaults)
 

router.route('/settings')
  .get(settings.getSettings)
  .post(settings.addSettings)
  .put(settings.updateSettings)
  .delete(settings.delSettings)

router.route('/settings/replace')
  .put(settings.replaceSettings)

router.route('/settings/:emp_id')
  .get(settings.getIndividualSettings)
  .post(settings.addIndividualSettings)
  .put(settings.updateIndividualSettings)
  .delete(settings.delIndividualSettings)

module.exports = router
