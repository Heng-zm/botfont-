// middleware/banCheck.js

const { isUserBanned } = require('../services/dbService');
const { logger } = require('../services/logger');

/**
 * Middleware function to check if a user is banned before processing any request.
 * @param {object} msg - The message or query object from Telegram.
 * @returns {Promise<boolean>} - True if the request should proceed, false if blocked.
 */
async function banCheck(msg) {
    if (!msg || !msg.from) {
        return true; // Proceed if we can't identify the user
    }

    const userId = msg.from.id;
    if (await isUserBanned(userId)) {
        logger.warn(`Blocked request from banned user: ${userId}`);
        return false; // Block the request
    }

    return true; // Allow the request
}

module.exports = { banCheck };