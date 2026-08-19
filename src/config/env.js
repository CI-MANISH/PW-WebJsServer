require('dotenv').config();

module.exports = {

    PORT: process.env.PORT,

    API_KEY: process.env.API_KEY,

    NODE_ENV: process.env.NODE_ENV,

    SF_WEBHOOK_URL: process.env.SF_WEBHOOK_URL,

    ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN,

    QR_EXPIRY_MS: Number(
        process.env.QR_EXPIRY_MS
    ),

    SESSION_TIMEOUT_MS: parseInt(process.env.SESSION_TIMEOUT_MS) || 86400000, // 24 hours
};