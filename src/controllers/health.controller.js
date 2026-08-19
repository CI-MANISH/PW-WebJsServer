const registry = require('../services/whatsapp/sessionRegistry');

exports.health = (req, res) => {
    const sessions = registry.all();
    const connected = Array.from(sessions.values()).filter(s => s.connected).length;
    const total = sessions.size;
    
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        sessions: {
            total,
            connected,
            disconnected: total - connected
        }
    });
};