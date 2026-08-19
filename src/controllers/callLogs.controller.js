const registry = require('../services/whatsapp/sessionRegistry');
const CallLogService = require('../services/whatsapp/callLogSync.service');

exports.syncCallLogs = async (req, res) => {
    try {
        const { userId, syncDays = 1 } = req.query;
        const session = registry.get(userId);

        if (!session) {
            return res.status(404).json({
                success:false,
                message:'Session not found'
            });
        }

        await CallLogService.syncCallLogs(
            session.client,
            session.phoneNumber,
            session.webhookUrl,
            userId,
            syncDays
        );

        return res.json({
            success:true
        });
    } catch(err) {
        return res.status(500).json({
            success:false,
            error:err.message
        });
    }
};