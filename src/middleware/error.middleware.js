const logger = require('../config/logger');

module.exports = (err, req, res, next) => {
    logger.error(err.message);

    return res.status(500).json({
        success:false,
        message:'Internal Server Error'
    });
};