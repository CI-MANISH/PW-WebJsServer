const router = require('express').Router();
const { callMainServerEngine } = require('../services/whatsappProxy.service');

router.post('/forward', async (req, res) => {
    try {
        const { mainServerUrl, endpoint, method = 'POST', data = {} } = req.body;

        if (!endpoint) {
            return res.status(400).json({ success: false, message: 'endpoint is required in body' });
        }

        const result = await callMainServerEngine(endpoint, method, data, mainServerUrl);
        return res.json(result);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;