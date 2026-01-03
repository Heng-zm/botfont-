// handlers/callbackHandler.js

const fs = require('fs');
const path = require('path');
const { getUserSession, getFontCache, setUserSession } = require('../services/fontService');
const { generateFontPreview } = require('../services/imageService');
const { formatMetadataCaption, getFontMetadata } = require('../services/fontMetaService');
const { sendOrEditFontListPage } = require('../ui/fontList');
const strings = require('../localization');
const { logger } = require('../services/logger');

// Lazy load message handler to avoid circular dependency
let messageHandler;
function getMessageHandler() {
    if (!messageHandler) {
        messageHandler = require('./messageHandler');
    }
    return messageHandler;
}

const fontDirectory = process.env.FONT_DIRECTORY;
const tempDir = path.join(__dirname, '..', 'temp');

if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

module.exports = (bot) => (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;
    const user = { id: callbackQuery.from.id };

    logger.info(`Processing callback: "${data}"`, { user });

    const [action, ...params] = data.split('_');
    
    bot.answerCallbackQuery(callbackQuery.id);
    
    // Use a router for better organization
    switch (action) {
        case 'page': {
            const page = parseInt(params[0], 10);
            if (msg.photo) {
                bot.deleteMessage(chatId, msg.message_id)
                    .then(() => sendOrEditFontListPage(bot, chatId, page, null))
                    .catch(() => sendOrEditFontListPage(bot, chatId, page, null)); // Fallback if delete fails
            } else {
                bot.sendChatAction(chatId, 'typing');
                sendOrEditFontListPage(bot, chatId, page, msg.message_id);
            }
            return;
        }

        case 'browse': {
            if (params[0] === 'all') {
                bot.sendChatAction(chatId, 'typing');
                setUserSession(chatId, getFontCache());
                sendOrEditFontListPage(bot, chatId, 0, msg.photo ? null : msg.message_id);
            }
            return;
        }

        case 'help': {
            if (params[0] === 'menu') {
                 // Delegate to the message handler to show the help message
                 const handler = getMessageHandler();
                 handler(bot)({ ...msg, text: '/help' });
            }
            return;
        }

        case 'get':
        case 'download': {
            handleFontAction(bot, action, params, user, chatId, msg.message_id);
            return;
        }
        
        default: 
            logger.warn(`Unknown callback action: ${action}`, { user, data });
    }
};

/**
 * Handles 'get' (preview) and 'download' actions for a specific font.
 */
function handleFontAction(bot, action, params, user, chatId, message_id) {
    const userFiles = getUserSession(chatId);
    if (!userFiles) {
        bot.editMessageText(strings.sessionExpired, { chat_id: chatId, message_id: message_id, reply_markup: null })
           .catch(err => logger.warn(`Could not edit message for expired session: ${err.message}`, { user }));
        return;
    }
    
    const index = parseInt(params[0], 10);
    // Ensure fromPage is correctly extracted and defaults to 0 if not present
    const fromPage = params[1] ? parseInt(params[1], 10) : 0;
    const filename = userFiles[index];
    if (!filename) {
        logger.error(`Invalid font index ${index} for user session.`, { user });
        return;
    }

    const filePath = path.join(fontDirectory, filename);
    if (!fs.existsSync(filePath)) {
        bot.editMessageText(strings.fileRemoved, { chat_id: chatId, message_id: message_id, reply_markup: null })
           .catch(err => logger.warn(`Could not edit message for removed file: ${err.message}`, { user }));
        return;
    }

    if (action === 'get') {
        sendFontPreview(bot, { chatId, message_id, filename, filePath, index, fromPage, user });
    } else if (action === 'download') {
        sendFontDocument(bot, { chatId, filename, filePath, user, fromPage });
    }
}

/**
 * Generates and sends a font preview image.
 */
async function sendFontPreview(bot, { chatId, message_id, filename, filePath, index, fromPage, user }) {
    await bot.sendChatAction(chatId, 'upload_photo');
    
    const fontNameWithoutExt = path.basename(filename, path.extname(filename));
    const previewBuffer = generateFontPreview(filePath, fontNameWithoutExt);
    const tempPreviewPath = path.join(tempDir, `${Date.now()}_${fontNameWithoutExt}_preview.png`);

    const caption = strings.previewCaption(filename);
    const parse_mode = 'Markdown';
    const options = {
        reply_markup: { 
            inline_keyboard: [
                // Pass the fromPage parameter in the download callback
                [{ text: strings.btnDownload, callback_data: `download_${index}_${fromPage}` }], 
                [{ text: strings.btnBackToList, callback_data: `page_${fromPage}` }]
            ]
        }
    };

    try {
        await fs.promises.writeFile(tempPreviewPath, previewBuffer);

        const media = { type: 'photo', media: `attach://${path.basename(tempPreviewPath)}`, caption, parse_mode };
        
        await bot.editMessageMedia(media, {
            chat_id: chatId, 
            message_id: message_id, 
            ...options
        }, { 
            [path.basename(tempPreviewPath)]: previewBuffer 
        });

    } catch (err) {
        logger.warn(`editMessageMedia failed, falling back to send/delete. Error: ${err.message}`, { user });
        // Fallback: Delete the old message and send a new one
        await bot.deleteMessage(chatId, message_id).catch(() => {});
        await bot.sendPhoto(chatId, tempPreviewPath, { caption, parse_mode, ...options });
    } finally {
        // Cleanup the temp file
        await fs.promises.unlink(tempPreviewPath).catch(err => logger.error('Failed to delete temp preview file', { error: err.message }));
    }
}

/**
 * Sends the actual font file to the user.
 */
async function sendFontDocument(bot, { chatId, filename, filePath, user, fromPage }) {
    await bot.sendChatAction(chatId, 'upload_document');
    logger.info(`User requested to download font: "${filename}"`, { user });

    try {
        const metadata = getFontMetadata(filePath);
        const caption = formatMetadataCaption(filename, metadata);
        
        await bot.sendDocument(chatId, filePath, { 
            caption: caption, 
            parse_mode: 'Markdown' 
        });
        
        // Follow-up message after successful download
        await bot.sendMessage(chatId, strings.downloadSuccess, {
            reply_markup: {
                inline_keyboard: [
                    // Ensure the page number is used in the callback
                    [{ text: strings.btnBackToList, callback_data: `page_${fromPage}` }]
                ]
            }
        });
    } catch (err) {
        logger.error(`Failed to send font document: ${err.message}`, { user, filename });
        await bot.sendMessage(chatId, "Sorry, there was an error sending the font file.");
    }
}
