const express = require('express')
const router = express.Router()
const helpers = require('../helpers/ability_hub')

router.route('/')
    .post(helpers.inviteToAbilityHub)

router.route('/getInvites')
    .get(helpers.getInvites)

router.route('/getArtifacts')
    .get(helpers.getArtifacts)

router.route('/videocall/room')
    .post(helpers.startVideoCall)

router.route('/videocall/log')
    .post(helpers.logVideoCall)

router.route('/medicare')
    .get(helpers.getMedicareData)

router.route('/medicare/claim/:claimId')
    .get(helpers.getMedicareClaim)

module.exports = router