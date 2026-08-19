const router = require('express').Router();
const { callAwsEngine } = require('../services/whatsappProxy.service');

router.post('/init', async (req, res) => {
    try {
        const result = await callAwsEngine('/api/session/init', 'POST', req.body);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/status/:userId', async (req, res) => {
    try {
        const result = await callAwsEngine(`/api/session/status/${req.params.userId}`, 'GET');
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

router.get('/qr/:userId', async (req, res) => {
    try {
        const result = await callAwsEngine(`/api/session/qr/${req.params.userId}`, 'GET');
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});


router.post('/logout', async (req, res) => {
    try {
        const result = await callAwsEngine('/api/session/logout', 'POST', req.body);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;