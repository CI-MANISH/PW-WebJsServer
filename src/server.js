const app = require('./app');
const { PORT } = require('./config/env');
const { bootstrap } = require('./bootstrap/server');

process.on('unhandledRejection', err => {
    console.error('Unhandled Rejection:', err.message || err);
});

process.on('uncaughtException', err => {
    console.error('Uncaught Exception:', err.message || err);
});

(async () => {
    try {
        await bootstrap();
        app.listen(
            PORT, () => {
                console.log(`Server running on ${PORT}`);
            }
        );
    } catch(error) {
        console.error('Failed to start server', error);
        process.exit(1);
    }

})();