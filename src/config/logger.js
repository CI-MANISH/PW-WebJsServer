const winston = require('winston');

module.exports = winston.createLogger({
    level:'info',
    format:winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(
            ({level,message,timestamp}) => {
                return `[${timestamp}] ${level}: ${message}`;
            }
        )
    ),
    transports:[
        new winston.transports.Console()
    ]
});