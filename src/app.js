const express = require('express');
const cors = require('cors');
const { ALLOWED_ORIGIN } = require('./config/env');
const apiKey = require('./middleware/apiKey.middleware');
const rateLimiter = require('./middleware/rateLimit.middleware');
const errorHandler = require('./middleware/error.middleware');
const { registerRoutes } = require('./routes');

const app = express();

// ADD THIS LINE
app.set('trust proxy', 1);

app.use(
    cors({
        origin: [ALLOWED_ORIGIN]
    })
);

app.use(express.json({
    limit: '100mb'
}));

app.use(express.urlencoded({
    limit: '100mb',
    extended: true
}));

app.use(rateLimiter);
app.use(apiKey);

registerRoutes(app);

app.use(errorHandler);

module.exports = app;