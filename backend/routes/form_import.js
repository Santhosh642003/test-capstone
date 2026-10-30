// AI form import routes, mounted by routes/task_form.js at /task_form/import.
// Kept in its own router so scripts/e2e-import.js can serve exactly these routes without loading the rest of FWAPI.
const express = require('express');
const multer = require('multer');

const router = express.Router();
const importHelpers = require('../helpers/form_import');

const upload = multer({ limits: { fileSize: 20 * 1024 * 1024 } }).single('file');
// multer's size-limit error becomes a clean 413 instead of a 500
const uploadFile = (req, res, next) => upload(req, res, (err) => (err ? res.status(413).json({ message: 'File is larger than 20 MB.' }) : next()));
// MIS administrators only: real MSAL token check (or the dev-only bypass, refused in production) + company must be the MIS company
const misOnly = [importHelpers.requireMisIdentity, importHelpers.requireMisAdmin];

router.route('/').post(misOnly, uploadFile, importHelpers.postImport);
router.route('/publish').post(misOnly, importHelpers.postPublish);
router.route('/:jobId').get(misOnly, importHelpers.getImportJob);

module.exports = router;
