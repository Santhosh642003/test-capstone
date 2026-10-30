const express = require('express')
const router = express.Router()
const artifacts = require('../helpers/artifacts.js')

const multer = require('multer')
const upload = multer().single('snapshot')

router.route('/')
  .get(artifacts.getArtifact)
  .post(upload, artifacts.addArtifact)
  .delete(artifacts.delArtifacts)

router.route('/:id/directory')
  .put(artifacts.updateDirectory)

router.route('/json')
  .get(artifacts.getJsonArtifact)
  .post(artifacts.addJsonArtifact)
  .delete(artifacts.deleteJsonArtifact)

module.exports = router
