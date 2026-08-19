const express = require('express');
const router = express.Router();

const CallLogController = require('../controllers/callLogs.controller');

router.get('/syncCallLogs', CallLogController.syncCallLogs);

module.exports = router;