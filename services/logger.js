// services/logger.js

const winston = require('winston');
const { combine, timestamp, printf, colorize, errors, splat } = winston.format;
const eventEmitter = require('./eventService');

/**
 * Safely extracts and sanitizes user information into a clean POJO.
 * @param {object} update - The message, callbackQuery, or inlineQuery object.
 * @returns {object|null} A clean, sanitized user object or null.
 */
function getUserInfo(update) {
    if (!update) return null;
    const from = update.from || (update.message && update.message.from);
    if (!from) return null;

    return {
        id: from.id,
        is_bot: from.is_bot,
        first_name: from.first_name || '',
        last_name: from.last_name || '',
        username: from.username || '',
    };
}

/**
 * Escapes characters in a string for safe use in Telegram's HTML parse mode.
 * @param {string} text The text to escape.
 * @returns {string} The escaped text.
 */
function escapeHTML(text) {
    if (typeof text !== 'string') return '';
    return text
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>');
}


const logFormat = printf(({ level, message, timestamp, stack, ...metadata }) => {
    let log = `${timestamp} [${level}]`;
    if (metadata.user && metadata.user.id) {
        log += ` (User: ${metadata.user.id}, @${metadata.user.username || 'N/A'})`;
    }
    log += `: ${message}`;
    if (stack) {
        log += `\n${stack.split('\n').map(line => `    at ${line.trim().replace(/^at /, '')}`).join('\n')}`;
    }
    
    // Emit an event for every new log message
    eventEmitter.emit('newLog', log);

    return log;
});

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), splat(), logFormat),
    transports: [
        new winston.transports.Console({ format: combine(colorize(), logFormat) }),
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ],
    exceptionHandlers: [ new winston.transports.File({ filename: 'exceptions.log' }) ],
    exitOnError: false
});

module.exports = {
    logger,
    getUserInfo,
    escapeHTML, // Export the new helper function
};