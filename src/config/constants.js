const path = require('path');

module.exports = {
    SESSIONS_DIR: path.join(
        __dirname,
        '../../sessions'
    ),
    API_PREFIX: '/api',
    QR_STATUS: {
        GENERATED:'generated',
        EXPIRED:'expired',
        CONNECTED:'connected'

    }
};