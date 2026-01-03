// middleware/banCheck.js

const { isUserBanned } = require('../services/dbService');
const { logger } = require('../services/logger');

/**
 * Middleware function to check if a user is banned before processing any request.
 * @param {object} msg - The message or query object from Telegram.
 * @returns {Promise<boolean>} - True if the request should proceed, false if blocked.
 */
async function banCheck(msg) {
    // robustly get the user object (works for messages and callback queries)
    const user = msg.from;

    if (!user) {
        // If we can't identify the user (e.g. anonymous channel post), we allow it.
        return true; 
    }

    const userId = user.id;

    try {
        const banned = await isUserBanned(userId);

        if (banned) {
            const userInfo = user.username ? `@${user.username}` : (user.first_name || 'Unknown');
            logger.warn(`🚫 Blocked interaction from banned user: ${userId} (${userInfo})`);
            
            // Return false to stop the bot from processing the command
            return false; 
        }

        return true; // User is not banned, proceed
    } catch (error) {
        logger.error(`⚠️ Error verifying ban status for user ${userId}:`, error);
        // If DB fails, we usually default to true (allow) to prevent blocking everyone during a glitch,
        // or false (block) if security is high priority. defaulting to allow:
        return true;
    }
}

module.exports = { banCheck };