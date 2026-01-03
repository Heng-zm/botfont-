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

// Ensure temp directory exists
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

module.exports = (bot) => async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;
    const user = { id: callbackQuery.from.id, username: callbackQuery.from.username };

    // Always answer the callback immediately to stop the button loading animation
    // We catch errors here in case the query is too old
    try {
        await bot.answerCallbackQuery(callbackQuery.id);
    } catch (e) { /* ignore */ }

    logger.info(`Processing callback: "${data}"`, { user });

    const [action, ...params] = data.split('_');

    try {
        switch (action) {
            case 'page': {
                const page = parseInt(params[0], 10);
                
                // If we are currently viewing a Photo (Preview mode), we must Delete and Send New Text
                // Telegram API does not allow editing a Photo Message into a Text Message
                if (msg.photo) {
                    try {
                        await bot.deleteMessage(chatId, msg.message_id);
                    } catch (e) { 
                        logger.warn(`Failed to delete preview message: ${e.message}`);
                    }
                    // Send new list message (pass null as messageId to force new send)
                    await sendOrEditFontListPage(bot, chatId, page, null);
                } else {
                    // We are already in List mode (Text), so just edit the text
                    // Show a typing indicator while processing
                    // bot.sendChatAction(chatId, 'typing').catch(() => {}); 
                    await sendOrEditFontListPage(bot, chatId, page, msg.message_id);
                }
                break;
            }

            case 'browse': {
                if (params[0] === 'all') {
                    // bot.sendChatAction(chatId, 'typing').catch(() => {});
                    setUserSession(chatId, getFontCache());
                    
                    // If coming from a photo message, we must delete and send new
                    if (msg.photo) {
                         try { await bot.deleteMessage(chatId, msg.message_id); } catch(e){}
                         await sendOrEditFontListPage(bot, chatId, 0, null);
                    } else {
                        await sendOrEditFontListPage(bot, chatId, 0, msg.message_id);
                    }
                }
                break;
            }

            case 'help': {
                if (params[0] === 'menu') {
                    const handler = getMessageHandler();
                    // Simulate a /help command
                    await handler(bot)({ ...msg, text: '/help', from: callbackQuery.from });
                }
                break;
            }

            case 'get':
            case 'download': {
                await handleFontAction(bot, action, params, user, chatId, msg);
                break;
            }

            default:
                logger.warn(`Unknown callback action: ${action}`, { user, data });
        }
    } catch (error) {
        logger.error(`Error processing callback ${data}: ${error.message}`, { user });
        // Optional: Send a user-friendly error toast
        // bot.answerCallbackQuery(callbackQuery.id, { text: 'An error occurred', show_alert: true }).catch(() => {});
    }
};

/**
 * Handles 'get' (preview) and 'download' actions.
 */
async function handleFontAction(bot, action, params, user, chatId, msg) {
    const userFiles = getUserSession(chatId);
    
    // 1. Validate Session
    if (!userFiles) {
        // If session expired, try to edit the message to inform user, or send new if it was a photo
        const text = strings.sessionExpired;
        if (msg.photo) {
            await bot.deleteMessage(chatId, msg.message_id).catch(()=>{});
            await bot.sendMessage(chatId, text);
        } else {
            await bot.editMessageText(text, { chat_id: chatId, message_id: msg.message_id, reply_markup: null }).catch(()=>{});
        }
        return;
    }

    const index = parseInt(params[0], 10);
    const fromPage = params[1] ? parseInt(params[1], 10) : 0;
    const filename = userFiles[index];

    // 2. Validate File Selection
    if (!filename) {
        logger.error(`Invalid font index ${index} request by user`, { user });
        return;
    }

    const filePath = path.join(fontDirectory, filename);

    // 3. Validate File Existence on Disk
    if (!fs.existsSync(filePath)) {
        const text = strings.fileRemoved;
        if (msg.photo) {
            await bot.deleteMessage(chatId, msg.message_id).catch(()=>{});
            await bot.sendMessage(chatId, text);
        } else {
            await bot.editMessageText(text, { chat_id: chatId, message_id: msg.message_id, reply_markup: null }).catch(()=>{});
        }
        return;
    }

    if (action === 'get') {
        await sendFontPreview(bot, { chatId, msg, filename, filePath, index, fromPage, user });
    } else if (action === 'download') {
        await sendFontDocument(bot, { chatId, filename, filePath, user, fromPage });
    }
}

/**
 * Generates and sends (or updates) a font preview image.
 */
async function sendFontPreview(bot, { chatId, msg, filename, filePath, index, fromPage, user }) {
    await bot.sendChatAction(chatId, 'upload_photo');

    const fontNameWithoutExt = path.basename(filename, path.extname(filename));
    const previewFilename = `${Date.now()}_${fontNameWithoutExt}_preview.png`;
    const tempPreviewPath = path.join(tempDir, previewFilename);
    
    const caption = strings.previewCaption(filename);
    const parse_mode = 'Markdown';
    
    // Keyboard: Download button + Back to specific page
    const reply_markup = {
        inline_keyboard: [
            [{ text: strings.btnDownload, callback_data: `download_${index}_${fromPage}` }],
            [{ text: strings.btnBackToList, callback_data: `page_${fromPage}` }]
        ]
    };

    try {
        // Generate Preview (CPU intensive, keep logic optimized)
        const previewBuffer = generateFontPreview(filePath, fontNameWithoutExt);
        await fs.promises.writeFile(tempPreviewPath, previewBuffer);

        // Logic: 
        // If current msg is TEXT -> Delete it, Send Photo (Cannot edit Text to Media)
        // If current msg is PHOTO -> Edit Media (Smoother)

        if (msg.photo) {
            // Edit existing photo
            try {
                await bot.editMessageMedia(
                    { 
                        type: 'photo', 
                        media: `attach://${previewFilename}`, 
                        caption: caption, 
                        parse_mode: parse_mode 
                    },
                    { 
                        chat_id: chatId, 
                        message_id: msg.message_id, 
                        reply_markup: reply_markup 
                    },
                    {
                        // File attachment for editMessageMedia
                        [previewFilename]: previewBuffer
                    }
                );
            } catch (editErr) {
                // If edit fails (e.g., message too old), fall back to delete + send
                logger.warn(`editMessageMedia failed: ${editErr.message}. Falling back to new message.`);
                await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
                await bot.sendPhoto(chatId, tempPreviewPath, { caption, parse_mode, reply_markup });
            }
        } else {
            // Previous message was Text (List view)
            await bot.deleteMessage(chatId, msg.message_id).catch(() => {});
            await bot.sendPhoto(chatId, tempPreviewPath, { caption, parse_mode, reply_markup });
        }

    } catch (err) {
        logger.error(`Error sending preview for ${filename}: ${err.message}`, { user });
        await bot.sendMessage(chatId, "⚠️ Could not generate preview.");
    } finally {
        // Always clean up temp file
        fs.promises.unlink(tempPreviewPath).catch(e => logger.warn(`Temp file cleanup failed: ${e.message}`));
    }
}

/**
 * Sends the actual font file to the user.
 */
async function sendFontDocument(bot, { chatId, filename, filePath, user, fromPage }) {
    await bot.sendChatAction(chatId, 'upload_document');
    logger.info(`User downloading: "${filename}"`, { user });

    try {
        const metadata = getFontMetadata(filePath);
        const caption = formatMetadataCaption(filename, metadata);

        // Attach the "Back" button to the file message itself
        // This keeps the chat cleaner than sending a separate "Success" message
        const reply_markup = {
            inline_keyboard: [
                [{ text: strings.btnBackToList, callback_data: `page_${fromPage}` }]
            ]
        };

        await bot.sendDocument(chatId, filePath, {
            caption: caption,
            parse_mode: 'Markdown',
            reply_markup: reply_markup
        }, {
            // Explicitly set filename and content type for NTBA compliance
            filename: filename,
            contentType: 'application/octet-stream'
        });

    } catch (err) {
        logger.error(`Failed to send font document: ${err.message}`, { user, filename });
        await bot.sendMessage(chatId, "❌ Sorry, I couldn't upload this file. It might be too large or corrupted.");
    }
}