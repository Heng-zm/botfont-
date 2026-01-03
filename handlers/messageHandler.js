// handlers/messageHandler.js

const fs = require('fs');
const path = require('path');
const { getFontCache, setUserSession } = require('../services/fontService');
const { sendOrEditFontListPage } = require('../ui/fontList');
const strings = require('../localization');
const { logger, getUserInfo, escapeHTML } = require('../services/logger');
const db = require('../services/dbService');
const eventEmitter = require('../services/eventService');
const ProfileHandler = require('./profileHandler'); // Moved to top level for performance

const PENDING_DIR = path.join(__dirname, '..', 'pending_fonts');
if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
const userUploadState = new Set();

const GITHUB_URL = process.env.GITHUB_URL || 'https://t.me/m11mmm112';

/**
 * Sends the main welcome message with instructions and an image.
 */
function sendWelcomeMessage(bot, chatId) {
    const welcomeImageUrl = 'https://cdn.dribbble.com/userupload/37123922/file/original-2b78b87f87e0d6bde7f94f25ce2f996a.png';
    const welcomeMessage = `👋 *សូមស្វាគមន៍មកកាន់ KhFontBot!*\n\n` +
                           `ខ្ញុំអាចជួយអ្នកស្វែងរក និងចែករំលែកពុម្ពអក្សរខ្មែរបានយ៉ាងងាយស្រួល។ ខាងក្រោមនេះជារបៀបប្រើប្រាស់៖\n\n` +
                           `1️⃣ *ស្វែងរកពុម្ពអក្សរ* ដោយគ្រាន់តែវាយឈ្មោះពុម្ពអក្សរ។\n` +
                           `2️⃣ *មើលបញ្ជីពុម្ពអក្សរទាំងអស់* ដោយប្រើ /fonts ។\n` +
                           `3️⃣ 💡 *ចែករំលែក Font* ដោយប្រើ /uploadfont រួចផ្ញើ File ពុម្ពអក្សរ ជា (.ttf ឬ .otf) ។\n` +
                           `4️⃣ *ប្រើខ្ញុំនៅក្នុងការជជែកផ្សេងៗ* ដោយវាយ \`@khfontbot\` បន្ទាប់មកវាយឈ្មោះពុម្ពអក្សរ។\n\n`;

    // Changed from sendMessage to sendPhoto
    bot.sendPhoto(chatId, welcomeImageUrl, {
        caption: welcomeMessage,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [
                [{ text: '📂 មើលពុម្ពអក្សរទាំងអស់', callback_data: 'browse_all' }]
            ]
        }
    });
}

async function handleDocument(bot, msg, user) {
    const chatId = user.id;
    
    // Check if user intended to upload
    if (!userUploadState.has(chatId)) {
        // Optional: If you want to allow implicit uploads, remove this check.
        // Currently keeping it to prevent spam processing of random files.
        return bot.sendMessage(chatId, strings.mustUseUploadCommand || "សូមប្រើពាក្យបញ្ជា /uploadfont មុននឹងផ្ញើឯកសារ។");
    }

    const doc = msg.document;
    if (!/\.(ttf|otf)$/i.test(doc.file_name)) {
        return bot.sendMessage(chatId, strings.uploadFailed || "ប្រភេទឯកសារមិនត្រឹមត្រូវ។ សូមផ្ញើឯកសារ .ttf ឬ .otf ។");
    }

    logger.info(`Received font submission: ${doc.file_name}`, { user });
    await bot.sendMessage(chatId, strings.uploadReceived || "បានទទួលឯកសារ។ កំពុងដំណើរការ...");
    
    userUploadState.delete(chatId); // Clear state after receiving file

    try {
        const pendingFileName = `${Date.now()}_${user.id}_${doc.file_name}`;
        const pendingFilePath = path.join(PENDING_DIR, pendingFileName);
        
        const fileStream = bot.getFileStream(doc.file_id);
        const writeStream = fs.createWriteStream(pendingFilePath);
        
        fileStream.pipe(writeStream);
        
        writeStream.on('finish', async () => {
            await db.logUpload(user.id, doc.file_name, 'pending');
            
            const safeFileName = escapeHTML(doc.file_name);
            const safeFirstName = escapeHTML(user.first_name);
            const safeUsername = user.username ? `@${escapeHTML(user.username)}` : `<code>${user.id}</code>`;
            
            const adminMessage = `<b>🔔 New Font Submission</b>\n<b>From:</b> ${safeFirstName} (${safeUsername})\n<b>File:</b> <code>${safeFileName}</code>\n\nUse /pendinglist to manage.`;
            
            if (process.env.ADMIN_CHAT_ID) {
                bot.sendMessage(process.env.ADMIN_CHAT_ID, adminMessage, { parse_mode: 'HTML' })
                    .catch(err => logger.error(`Failed to send notification to admin: ${err.message}`));
            }

            logger.info(`Sent approval notification for ${doc.file_name}`, { user });
            bot.sendMessage(chatId, strings.uploadComplete || "ការដាក់ស្នើបានជោគជ័យ! សូមរង់ចាំការត្រួតពិនិត្យ។");
            eventEmitter.emit('dataChanged', { type: 'PENDING_FONTS' });
        });

        writeStream.on('error', err => {
            logger.error(`Failed to save pending font:`, { stack: err.stack, user });
            bot.sendMessage(chatId, strings.uploadFailed || "មានបញ្ហាក្នុងការរក្សាទុកឯកសារ។");
        });

    } catch (error) {
        logger.error(`Error during font submission process:`, { stack: error.stack, user });
        bot.sendMessage(chatId, strings.uploadFailed || "បរាជ័យក្នុងការដាក់ស្នើ។");
    }
}

async function handlePublicCommand(bot, msg, user) {
    const chatId = user.id;
    const [command, ...args] = (msg.text || '').split(' ');
    
    switch (command) {
        case '/start':
            return sendWelcomeMessage(bot, chatId);
        case '/fonts':
            bot.sendChatAction(chatId, 'typing');
            setUserSession(chatId, getFontCache());
            return sendOrEditFontListPage(bot, chatId, 0);
        case '/uploadfont':
            logger.info(`User entered upload mode.`, { user });
            userUploadState.add(chatId);
            return bot.sendMessage(chatId, strings.uploadCommandPrompt || "សូមផ្ញើឯកសារពុម្ពអក្សរ (TTF ឬ OTF) របស់អ្នកមកឥឡូវនេះ។");
        case '/search':
             const query = args.join(' ');
             if (!query) {
                 return bot.sendMessage(chatId, "សូមបញ្ចូលឈ្មោះពុម្ពអក្សរដែលអ្នកចង់ស្វែងរក។ ឧទាហរណ៍៖ `/search Limon`", { parse_mode: 'Markdown' });
             }
             msg.text = query; // Modify text to pass just the query to handleSearch
             return handleSearch(bot, msg, user);

        // Profile Commands
        case '/profile':
        case '/mystats':
        case '/achievements':
        case '/rank':
        case '/settings':
        case '/recommendations':
        case '/report':
            return ProfileHandler(bot, msg);
            
        default:
            return bot.sendMessage(chatId, strings.unknownCommand || "មិនស្គាល់ពាក្យបញ្ជានេះទេ។");
    }
}

function handleSearch(bot, msg, user) {
    const chatId = user.id;
    // If called from /search command, msg.text is already cleaned. 
    // If called from raw text, we use msg.text directly.
    const query = (msg.text || '').toLowerCase();
    
    if (!query) return;

    bot.sendChatAction(chatId, 'typing');
    logger.info(`Performing search for query: "${query}"`, { user });

    const searchResults = getFontCache().filter(file => file.toLowerCase().includes(query));

    if (searchResults.length > 0) {
        setUserSession(chatId, searchResults);
        // Assuming strings.searchFound handles placeholders like %s
        const foundMsg = strings.searchFound 
            ? strings.searchFound(searchResults.length, escapeHTML(query))
            : `រកឃើញពុម្ពអក្សរចំនួន <b>${searchResults.length}</b> សម្រាប់ពាក្យ "<b>${escapeHTML(query)}</b>"៖`;
            
        bot.sendMessage(chatId, foundMsg, { parse_mode: 'HTML' });
        sendOrEditFontListPage(bot, chatId, 0);
    } else {
        const notFoundMsg = strings.searchNotFound 
            ? strings.searchNotFound(escapeHTML(query))
            : `មិនរកឃើញពុម្ពអក្សរសម្រាប់ "<b>${escapeHTML(query)}</b>" ទេ។`;
            
        const promptMsg = strings.searchNotFoundPrompt || "តើអ្នកចង់មើលបញ្ជីពុម្ពអក្សរទាំងអស់វិញទេ?";

        bot.sendMessage(chatId, notFoundMsg + `\n\n` + promptMsg, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[{ text: '📂 មើលពុម្ពអក្សរទាំងអស់', callback_data: 'browse_all' }]]
            }
        });
    }
}

module.exports = (bot) => async (msg) => {
    const user = getUserInfo(msg);
    if (!user) return;

    // NOTE: 'msg.data' usually exists on callback_query, not message.
    // If you need to handle button clicks, ensure you have a separate bot.on('callback_query') handler.
    // However, if your setup routes callbacks here manually, keep this logic, otherwise it is ignored for text messages.
    // Assuming this handler is ONLY for messages based on standard API:
    
    // 1. Handle File Uploads
    if (msg.document) {
        return handleDocument(bot, msg, user);
    }
    
    const text = msg.text || '';
    if (!text) return;

    // 2. Handle Commands (starting with /)
    if (text.startsWith('/')) {
        return handlePublicCommand(bot, msg, user);
    } 
    
    // 3. Handle General Text (Search)
    handleSearch(bot, msg, user);
};