// ui/fontList.js

const { getUserSession } = require('../services/fontService');
const strings = require('../localization');

const FONTS_PER_PAGE = 8; // Number of fonts to show per page

/**
 * Sends or edits a message to display a paginated list of fonts.
 * This function is now more robust and requires a chatId.
 * 
 * @param {TelegramBot} bot The bot instance.
 * @param {number} chatId The chat ID to send/edit the message in.
 * @param {number} page The page number to display (0-indexed).
 * @param {number|null} messageId The message ID to edit. If null, a new message is sent.
 */
function sendOrEditFontListPage(bot, chatId, page, messageId = null) {
    // Safeguard to prevent errors if chatId is missing
    if (!chatId) {
        console.error("CRITICAL: sendOrEditFontListPage was called without a chatId.");
        return;
    }

    const userFiles = getUserSession(chatId);
    if (!userFiles || userFiles.length === 0) {
        const text = strings.noFontsDisplay;
        // Edit the message if possible, otherwise send a new one
        messageId 
            ? bot.editMessageText(text, { chat_id: chatId, message_id: messageId, reply_markup: null }).catch(() => {})
            : bot.sendMessage(chatId, text);
        return;
    }

    // Paginate the files
    const startIndex = page * FONTS_PER_PAGE;
    const pageFiles = userFiles.slice(startIndex, startIndex + FONTS_PER_PAGE);

    // Create buttons for the fonts on the current page
    const fontButtons = pageFiles.map((file, index) => {
        const absoluteIndex = startIndex + index;
        return [{ text: file, callback_data: `get_${absoluteIndex}_${page}` }];
    });
    
    // Create navigation buttons (Previous/Next)
    const navButtons = [];
    if (page > 0) {
        navButtons.push({ text: strings.btnPrevious, callback_data: `page_${page - 1}` });
    }
    if (startIndex + FONTS_PER_PAGE < userFiles.length) {
        navButtons.push({ text: strings.btnNext, callback_data: `page_${page + 1}` });
    }
    
    // Combine all buttons
    const keyboard = [
        ...fontButtons,
        navButtons, // Add the navigation row
    ];

    const totalPages = Math.ceil(userFiles.length / FONTS_PER_PAGE);
    const messageText = strings.pageHeader(page + 1, totalPages);
    const options = { 
        chat_id: chatId, 
        message_id: messageId,
        reply_markup: { inline_keyboard: keyboard },
        parse_mode: 'Markdown' 
    };

    if (messageId) {
        // If a messageId is provided, edit the existing message
        bot.editMessageText(messageText, options).catch(err => {
            // Ignore "message is not modified" errors, but log others
            if (err.code !== 'ETELEGRAM' || !err.message.includes('message is not modified')) {
                console.error("Edit message error in fontList:", err.message);
            }
        });
    } else {
        // Otherwise, send a new message
        bot.sendMessage(chatId, messageText, { reply_markup: options.reply_markup });
    }
}

module.exports = { sendOrEditFontListPage };