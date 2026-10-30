const express = require('express')
const router = express.Router()
const helpers = require('../helpers/comment')
const guidanceHelpers = require('../helpers/casenote_guidance')

router.route('/')
  .get(helpers.getComments)
  .post(helpers.addComment)
  .put(helpers.updateComment)
  .delete(helpers.delComment)

router.route('/details')
  .get(helpers.getDetailedComments)

router.route('/home')
  .get(helpers.getRecentNotes)

router.route('/guidance')
  .post(guidanceHelpers.getGuidance)

module.exports = router
