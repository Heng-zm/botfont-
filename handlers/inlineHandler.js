// handlers/inlineHandler.js

const { getFontCache } = require('../services/fontService');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../services/logger');
const path = require('path');
const fs = require('fs');

const fileIdCache = new Map();

// Ensure these are loaded correctly
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const FONT_DIR = process.env.FONT_DIRECTORY;

module.exports = (bot) => async (query) => {
    const user = { id: query.from.id, username: query.from.username };
    const queryText = (query.query || '').toLowerCase().trim();

    // 1. Critical Environment Check
    if (!ADMIN_CHAT_ID || !FONT_DIR) {
        logger.error("Configuration Error: ADMIN_CHAT_ID or FONT_DIRECTORY is missing.");
        return bot.answerInlineQuery(query.id, [], { switch_pm_text: 'Bot Config Error', switch_pm_parameter: 'error' });
    }

    if (queryText.length < 2) {
        return bot.answerInlineQuery(query.id, [], { cache_time: 0 });
    }

    logger.info(`Processing inline_query: "${queryText}"`, { user });

    try {
        const allMatches = getFontCache().filter(font => font.toLowerCase().includes(queryText));
        const searchResults = allMatches.slice(0, 20); // Limit results
        const results = [];

        // Limit live uploads per query to prevent timeouts (Telegram gives ~10s for inline queries)
        let uploadCount = 0;
        const MAX_LIVE_UPLOADS = 3; 

        for (const font of searchResults) {
            let fileId = fileIdCache.get(font);
            const filePath = path.join(FONT_DIR, font);

            // If we don't have a file_id, we need to upload it to the Admin Chat
            if (!fileId) {
                if (!fs.existsSync(filePath)) {
                    logger.warn(`Skipping: File listed in cache but missing on disk: ${font}`);
                    continue;
                }

                if (uploadCount >= MAX_LIVE_UPLOADS) {
                    // Stop uploading to prevent timeout, but continue serving cached items
                    continue; 
                }

                try {
                    // 2. Upload to Admin Chat
                    const tempMsg = await bot.sendDocument(ADMIN_CHAT_ID, filePath, { 
                        caption: `Caching: ${font}`,
                        disable_notification: true
                    }, {
                        // 3. Fix for filename meta-data issues
                        filename: font,
                        contentType: 'application/octet-stream' 
                    });

                    if (tempMsg && tempMsg.document) {
                        fileId = tempMsg.document.file_id;
                        fileIdCache.set(font, fileId);
                        uploadCount++;
                        logger.info(`Generated file_id for ${font}`);

                        // 4. Delete the temp message to keep admin chat clean
                        bot.deleteMessage(ADMIN_CHAT_ID, tempMsg.message_id).catch(err => {
                            logger.warn(`Failed to delete temp msg in admin chat: ${err.message}`);
                        });
                    }
                } catch (uploadError) {
                    // 5. Specific Error logging for the "Chat not found" issue
                    if (uploadError.response && uploadError.response.statusCode === 400) {
                        logger.error(`TELEGRAM 400 ERROR: The bot cannot send files to ADMIN_CHAT_ID (${ADMIN_CHAT_ID}). Is the ID correct? Is the bot an admin there?`);
                        // Stop trying to upload other files if the chat ID is wrong
                        break; 
                    } else {
                        logger.error(`Failed to upload ${font}: ${uploadError.message}`);
                    }
                    continue;
                }
            }

            if (fileId) {
                results.push({
                    type: 'document',
                    id: uuidv4(),
                    title: font,
                    caption: font,
                    document_file_id: fileId
                });
            }
        }

        await bot.answerInlineQuery(query.id, results, { cache_time: 300, is_personal: false });

    } catch (error) {
        logger.error(`Inline Query Error for "${queryText}": ${error.message}`);
        // Try to return empty result to stop spinner
        try { await bot.answerInlineQuery(query.id, []); } catch (e) {}
    }
};