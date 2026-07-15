const express = require('express');
const { publicLegalConfig } = require('../config/legal');
const router = express.Router();

router.get('/current', (req, res) => res.json(publicLegalConfig()));

module.exports = router;
