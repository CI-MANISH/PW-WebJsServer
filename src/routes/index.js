const sessionRoutes = require('./session.routes');

function registerRoutes(app) {
    app.use('/api/session', sessionRoutes);
}

module.exports = { registerRoutes };
