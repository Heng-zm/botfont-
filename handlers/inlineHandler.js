// handlers/inlineHandler.js

const { getFontCache } = require('../services/fontService');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../services/logger');
const path = require('path');

const fileIdCache = new Map();
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;

module.exports = (bot) => async (query) => {
    const user = { id: query.from.id };
    const queryText = query.query.toLowerCase() || '';

    logger.info(`Processing inline_query: "${queryText}"`, { user });

    let results = [];

    try {
        if (queryText.length > 1) {
            const searchResults = getFontCache().filter(font => font.toLowerCase().includes(queryText));
            const promises = searchResults.slice(0, 20).map(async (font) => {
                let fileId = fileIdCache.get(font);
                if (!fileId) {
                    try {
                        const filePath = path.join(process.env.FONT_DIRECTORY, font);
                        // Send to admin chat to get file_id without disturbing the user
                        const tempMsg = await bot.sendDocument(ADMIN_CHAT_ID, filePath, { caption: `Caching file_id for ${font}` });
                        if (tempMsg.document) {
                            fileId = tempMsg.document.file_id;
                            fileIdCache.set(font, fileId);
                            logger.info(`Cached new file_id for ${font}`);
                            // It's good practice to delete the temporary message from the admin chat
                            await bot.deleteMessage(ADMIN_CHAT_ID, tempMsg.message_id);
                        }
                    } catch (uploadError) {
                        logger.error(`Failed to pre-upload ${font} for inline mode: ${uploadError.message}`);
                        return null;
                    }
                }
                if (fileId) {
                    return { type: 'document', id: uuidv4(), title: font, document_file_id: fileId };
                }
                return null;
            });
            results = (await Promise.all(promises)).filter(r => r !== null);
        }
        bot.answerInlineQuery(query.id, results, { cache_time: 300, is_personal: true });
    } catch (error) {
        logger.error(`Error processing inline query for "${queryText}": ${error.message}`, { user });
        bot.answerInlineQuery(query.id, []);
    }
};
