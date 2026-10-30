const express = require('express');
const router = express.Router();
const helpers = require('../helpers/search');

router.route('/')
    .get(helpers.globalSearch);

module.exports = router;
