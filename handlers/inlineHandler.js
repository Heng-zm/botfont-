// handlers/inlineHandler.js

const { getFontCache } = require('../services/fontService');
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../services/logger');
const path = require('path');

const fileIdCache = new Map();

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
                        const tempMsg = await bot.sendDocument(query.from.id, filePath);
                        if (tempMsg.document) {
                            fileId = tempMsg.document.file_id;
                            fileIdCache.set(font, fileId);
                            logger.info(`Cached new file_id for ${font}`);
                        }
                        await bot.deleteMessage(query.from.id, tempMsg.message_id);
                    } catch (uploadError) {
                        logger.error(`Failed to pre-upload ${font} for inline mode: ${uploadError.message}`);
                        return null; // Skip this result if upload fails
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