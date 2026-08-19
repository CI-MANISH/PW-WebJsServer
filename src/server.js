const app = require('./app');
const { PORT } = require('./config/env');
const { bootstrap } = require('./bootstrap/server');

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err.message || err);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message || err);
});

(async () => {
    try {
        await bootstrap();
        const serverPort = PORT || 3000;
        app.listen(serverPort, () => {
            console.log(`Proxy Middleware Server running on port ${serverPort}`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
})();