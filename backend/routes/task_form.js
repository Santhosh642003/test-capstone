const express = require('express');

const router = express.Router();
const helpers = require('../helpers/task_form');
const { requireMsalIdentity } = require('../helpers/msalAuth');
const importHelpers = require('../helpers/form_import');
const packHelpers = require('../helpers/form_packs');

// MIS-only (ANALYTIQ administrators): AI form import, publishing, pack curation
const misOnly = [importHelpers.requireMisIdentity, importHelpers.requireMisAdmin];

router.route('/')
  .get(helpers.getRelationships)
  .post(helpers.postRelationships);

router.route('/forms')
  .get(helpers.getForms);

router.route('/form')
  .get(helpers.getForm);

router.route('/subscribed')
  .get(helpers.getSubscribedForms)
  .post(helpers.postSubscribedForms)
  .delete(helpers.deleteSubscribedForms);

router.route('/formBuilder')
  .get(helpers.getMaxFormID)
  .post(helpers.addForm)
  .put(helpers.editForm)
  .delete(helpers.deleteForm);

// AI form import + publish (MIS administrators): routes/form_import.js
router.use('/import', require('./form_import'));

// Pack curation (MIS)
router.route('/packs/admin')
  .get(misOnly, packHelpers.listPacksAdmin)
  .post(misOnly, packHelpers.createPack);

router.route('/packs/admin/forms')
  .get(misOnly, packHelpers.listCommunityForms);

router.route('/packs/admin/:id')
  .put(misOnly, packHelpers.updatePack);

router.route('/packs/admin/:id/publish')
  .post(misOnly, packHelpers.publishPack);

router.route('/packs/admin/:id/retire')
  .post(misOnly, packHelpers.retirePack);

router.route('/packs/sync')
  .post(misOnly, packHelpers.syncPack);

// Pack subscription (FieldWorker company admins; company comes from the verified token)
router.route('/packs/subscribed')
  .post(requireMsalIdentity, packHelpers.subscribePack)
  .delete(requireMsalIdentity, packHelpers.unsubscribePack);

router.route('/packs')
  .get(requireMsalIdentity, packHelpers.getCompanyPacks);

module.exports = router;