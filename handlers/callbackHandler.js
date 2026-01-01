// handlers/callbackHandler.js

const fs = require('fs');
const path = require('path');
const { getUserSession, getFontCache, setUserSession } = require('../services/fontService');
const { generateFontPreview } = require('../services/imageService');
const { formatMetadataCaption, getFontMetadata } = require('../services/fontMetaService');
const { sendOrEditFontListPage } = require('../ui/fontList');
const strings = require('../localization');
const { logger } = require('../services/logger');

const fontDirectory = process.env.FONT_DIRECTORY;

module.exports = (bot) => (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;
    const user = { id: callbackQuery.from.id };

    logger.info(`Processing callback: "${data}"`, { user });

    const [action, ...params] = data.split('_');
    
    bot.answerCallbackQuery(callbackQuery.id);

    if (action === 'page') {
        const page = parseInt(params[0], 10);
        if (msg.photo) {
            bot.deleteMessage(chatId, msg.message_id)
                .then(() => { sendOrEditFontListPage(bot, chatId, page, null); })
                .catch(err => {
                    logger.warn(`Could not delete photo message (it might be already gone): ${err.message}`, { user });
                    sendOrEditFontListPage(bot, chatId, page, null);
                });
        } else {
            bot.sendChatAction(chatId, 'typing');
            sendOrEditFontListPage(bot, chatId, page, msg.message_id);
        }
        return;
    }

    if (action === 'browse' && params[0] === 'all') {
        setUserSession(chatId, getFontCache());
        sendOrEditFontListPage(bot, chatId, 0, msg.message_id);
        return;
    }

    const userFiles = getUserSession(chatId);
    if (!userFiles) {
        bot.editMessageText(strings.sessionExpired, { chat_id: chatId, message_id: msg.message_id, reply_markup: null })
           .catch(err => logger.warn(`Could not edit message for expired session: ${err.message}`, { user }));
        return;
    }
    
    const index = parseInt(params[0], 10);
    const filename = userFiles[index];
    if (!filename) return;

    const filePath = path.join(fontDirectory, filename);
    if (!fs.existsSync(filePath)) {
        bot.editMessageText(strings.fileRemoved, { chat_id: chatId, message_id: msg.message_id, reply_markup: null })
           .catch(err => logger.warn(`Could not edit message for removed file: ${err.message}`, { user }));
        return;
    }

    switch (action) {
        case 'get':
            bot.sendChatAction(chatId, 'upload_photo');
            const fromPage = params[1] || 0;
            const fontNameWithoutExt = path.basename(filename, path.extname(filename));
            const previewBuffer = generateFontPreview(filePath, fontNameWithoutExt);
            
            const media = { type: 'photo', media: previewBuffer, caption: strings.previewCaption(filename), parse_mode: 'Markdown' };
            const options = {
                chat_id: chatId,
                message_id: msg.message_id,
                reply_markup: { inline_keyboard: [[{ text: strings.btnDownload, callback_data: `download_${index}` }], [{ text: strings.btnBackToList, callback_data: `page_${fromPage}` }]] }
            };
            
            bot.editMessageMedia(media, options)
                .catch(err => {
                    logger.warn(`EditMessageMedia failed. Falling back to delete/send. Error: ${err.message}`, { user });
                    bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                    bot.sendPhoto(chatId, previewBuffer, { caption: media.caption, parse_mode: media.parse_mode, reply_markup: options.reply_markup });
                });
            break;
        case 'download':
            bot.sendChatAction(chatId, 'upload_document');
            logger.info(`User requested to download font: "${filename}"`, { user });
            const metadata = getFontMetadata(filePath);
            const caption = formatMetadataCaption(filename, metadata);
            bot.sendDocument(chatId, filePath, { 
                caption: caption, 
                parse_mode: 'Markdown' 
            }).then(() => {
                // After sending the font, show the 'Download More' button
                bot.sendMessage(chatId, strings.downloadSuccess, {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: strings.btnDownloadMore, callback_data: 'browse_all' }]
                        ]
                    }
                });
            }).catch(err => {
                logger.error(`Failed to send font document: ${err.message}`, { user, filename });
            });
            break;
    }
};