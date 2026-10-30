const express = require('express')
const router = express.Router()
const helpers = require('../helpers/audio_note')
const multer = require('multer')
const upload = multer().single('audio_note')

router.route('/')
    .get(helpers.getAudioNotes)
    .post(upload, helpers.addAudioNote)

module.exports = router