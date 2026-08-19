const router = require('express').Router();
const multer = require('multer');
const { send, upload } = require('../controllers/message.controller');
const { verifyWebhookSignature } = require('../middleware/webhookAuth.middleware');

router.post('/send', verifyWebhookSignature, upload, send);

module.exports = router;