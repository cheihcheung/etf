const winston = require('winston');
const path = require('path');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: () => new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().replace(/T/, ' ').replace(/\..+/, '') }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
            return `[${timestamp}] [${level.toUpperCase()}] ${message} ${metaStr}`;
        })
    ),
    transports: [
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: () => new Date(new Date().getTime() + 8 * 3600 * 1000).toISOString().replace(/T/, ' ').replace(/\..+/, '') }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
                    return `[${timestamp}] [${level}] ${message} ${metaStr}`;
                })
            )
        }),
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/error.log'),
            level: 'error',
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5
        }),
        new winston.transports.File({
            filename: path.join(__dirname, '../../logs/combined.log'),
            maxsize: 10 * 1024 * 1024,
            maxFiles: 5
        })
    ]
});

module.exports = logger;
