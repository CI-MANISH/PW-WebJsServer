const express = require('express');
const cors = require('cors');
const { ALLOWED_ORIGIN } = require('./config/env');
const { registerRoutes } = require('./routes');

const app = express();

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


registerRoutes(app);

module.exports = app;