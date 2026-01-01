// handlers/messageHandler.js

const fs = require('fs');
const path = require('path');
const { getFontCache, setUserSession } = require('../services/fontService');
const { sendOrEditFontListPage } = require('../ui/fontList');
const strings = require('../localization');
const { logger, getUserInfo, escapeHTML } = require('../services/logger'); // Import escapeHTML
const db = require('../services/dbService');
const eventEmitter = require('../services/eventService');

const PENDING_DIR = path.join(__dirname, '..', 'pending_fonts');
if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR);
const userUploadState = new Set();

/**
 * Handles incoming documents, checking if the user is in upload mode.
 */
async function handleDocument(bot, msg, user) {
    const chatId = user.id;
    if (!userUploadState.has(chatId)) {
        return bot.sendMessage(chatId, strings.mustUseUploadCommand);
    }

    const doc = msg.document;
    const fileName = doc.file_name;
    if (!/\.(ttf|otf)$/i.test(fileName)) {
        return bot.sendMessage(chatId, strings.uploadFailed);
    }
    
    logger.info(`Received font submission: ${fileName}`, { user });
    await bot.sendMessage(chatId, strings.uploadReceived);
    userUploadState.delete(chatId);

    try {
        const pendingFileName = `${Date.now()}_${user.id}_${fileName}`;
        const pendingFilePath = path.join(PENDING_DIR, pendingFileName);
        const fileStream = bot.getFileStream(doc.file_id);
        const writeStream = fs.createWriteStream(pendingFilePath);
        
        fileStream.pipe(writeStream);

        writeStream.on('finish', async () => {
            await db.logUpload(user.id, fileName, 'pending');
            
            // Sanitize user-provided data using escapeHTML for safe display
            const safeFileName = escapeHTML(fileName);
            const safeFirstName = escapeHTML(user.first_name);
            const safeUsername = user.username ? `@${escapeHTML(user.username)}` : `<code>${user.id}</code>`;

            const adminMessage = `<b>🔔 New Font Submission</b>\n\n` +
                                 `<b>From:</b> ${safeFirstName} (${safeUsername})\n` +
                                 `<b>File:</b> <code>${safeFileName}</code>\n\n` +
                                 `Use /pendinglist to manage.`;
            
            // Send notification to Admin using HTML parse mode
            bot.sendMessage(process.env.ADMIN_CHAT_ID, adminMessage, { parse_mode: 'HTML' })
                .catch(err => logger.error(`Failed to send notification to admin: ${err.message}`));
                
            logger.info(`Sent approval notification for ${fileName}`, { user });
            bot.sendMessage(chatId, strings.uploadComplete);

            eventEmitter.emit('dataChanged', { type: 'PENDING_FONTS' });
        });

        writeStream.on('error', (err) => {
            logger.error(`Failed to save pending font:`, { stack: err.stack, user });
            bot.sendMessage(chatId, strings.uploadFailed);
        });
    } catch (error) {
        logger.error(`Error during font submission process:`, { stack: error.stack, user });
        bot.sendMessage(chatId, strings.uploadFailed);
    }
}

/**
 * Handles public commands available to all users.
 */
async function handlePublicCommand(bot, user, command) {
    const chatId = user.id;
    const ProfileHandler = require('./profileHandler');
    
    switch (command) {
        case '/start':
            return bot.sendMessage(chatId, strings.welcome);
        case '/fonts':
            bot.sendChatAction(chatId, 'typing');
            setUserSession(chatId, getFontCache());
            return sendOrEditFontListPage(bot, chatId, 0);
        case '/uploadfont':
            logger.info(`User entered upload mode.`, { user });
            userUploadState.add(chatId);
            return bot.sendMessage(chatId, strings.uploadCommandPrompt);
        
        // New profile-related commands
        case '/profile':
            return ProfileHandler.handleProfile(bot, { chat: { id: chatId }, ...user });
        case '/mystats':
            return ProfileHandler.handleMyStats(bot, { chat: { id: chatId }, ...user });
        case '/achievements':
            return ProfileHandler.handleAchievements(bot, { chat: { id: chatId }, ...user });
        case '/rank':
            return ProfileHandler.handleRank(bot, { chat: { id: chatId }, ...user });
        case '/settings':
            return ProfileHandler.handleSettings(bot, { chat: { id: chatId }, ...user });
        case '/recommendations':
            return ProfileHandler.handleRecommendations(bot, { chat: { id: chatId }, ...user });
            
        default:
            // Check if it's a report command with parameters
            if (command.startsWith('/report')) {
                return ProfileHandler.handleReport(bot, { 
                    chat: { id: chatId }, 
                    text: command, 
                    ...user 
                });
            }
            return bot.sendMessage(chatId, strings.unknownCommand);
    }
}

/**
 * Handles regular text messages, interpreted as a font search.
 */
function handleSearch(bot, msg, user) {
    const chatId = user.id;
    const text = msg.text;
    bot.sendChatAction(chatId, 'typing');
    const query = text.toLowerCase();
    logger.info(`Performing search for query: "${query}"`, { user });
    const searchResults = getFontCache().filter(file => file.toLowerCase().includes(query));
    if (searchResults.length > 0) {
        setUserSession(chatId, searchResults);
        bot.sendMessage(chatId, strings.searchFound(searchResults.length, text), { parse_mode: 'Markdown' });
        sendOrEditFontListPage(bot, chatId, 0);
    } else {
        bot.sendMessage(chatId, `${strings.searchNotFound(text)}\n${strings.searchNotFoundPrompt}`, {
            reply_markup: {
                inline_keyboard: [[{ text: strings.btnBrowseAll, callback_data: 'browse_all' }]]
            }
        });
    }
}

/**
 * Main router for public/non-admin messages.
 */
module.exports = (bot) => async (msg) => {
    const user = getUserInfo(msg);
    if (!user) return;

    if (msg.document) {
        return handleDocument(bot, msg, user);
    }
    
    const text = msg.text || '';
    if (!text) return; // Ignore messages without text (stickers, locations, etc.)

    if (text.startsWith('/')) {
        const [command] = text.split(' ');
        return handlePublicCommand(bot, user, command);
    } 
    
    handleSearch(bot, msg, user);
};