const healthRoutes = require('./health.routes');
const sessionRoutes = require('./session.routes');
const messageRoutes = require('./message.routes');
const callRoutes = require('./callLogs.routes');

function registerRoutes(app) {
    app.use('/api/health', healthRoutes);
    app.use('/api/session', sessionRoutes);
    app.use('/api/message', messageRoutes);
    app.use('/api/call', callRoutes);
}

module.exports = {
    registerRoutes
};
