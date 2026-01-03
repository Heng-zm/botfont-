// index.js

// 1. FIX DEPRECATION WARNING (Must be at the very top)
process.env.NTBA_FIX_350 = 1;

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { logger, getUserInfo } = require('./services/logger');
const db = require('./services/dbService');
const { initializeCache } = require('./services/fontService');
const { startAdminPanel } = require('./adminPanel');
const userProfileService = require('./services/userProfileService');
const analyticsService = require('./services/analyticsService');
const notificationService = require('./services/notificationService');
const recommendationEngine = require('./services/recommendationEngine');
const errorTrackingService = require('./services/errorTrackingService');

// Handlers
const messageHandler = require('./handlers/messageHandler');
const callbackHandler = require('./handlers/callbackHandler');
const inlineHandler = require('./handlers/inlineHandler');
const adminHandler = require('./handlers/adminHandler');

const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;

// 2. Critical Configuration Checks
if (!token || !ADMIN_ID) { 
    logger.error("FATAL: Missing TELEGRAM_BOT_TOKEN or ADMIN_CHAT_ID in .env file!"); 
    process.exit(1); 
}

// 3. ID Validation Warning
// If ID is numeric, not negative, and looks like a group ID (usually starts with -100)
if (!ADMIN_ID.startsWith('-') && ADMIN_ID.length > 10) {
    logger.warn(`⚠️ WARNING: Your ADMIN_CHAT_ID (${ADMIN_ID}) looks like a Group/Channel ID but is missing the negative sign.`);
    logger.warn(`   If this is a supergroup, it should probably be: -100${ADMIN_ID}`);
}

async function main() {
    // 4. Initialize Database
    await db.initializeDatabase();
    
    // 5. Initialize File Cache
    initializeCache();
    
    // 6. Initialize Advanced Services
    const initService = async (name, service) => {
        try {
            if (service && typeof service.init === 'function') {
                await service.init();
                logger.info(`${name} initialized successfully`);
            }
        } catch (error) {
            logger.warn(`${name} initialization failed:`, error.message);
        }
    };

    await initService('User Profile Service', userProfileService);
    await initService('Analytics Service', analyticsService);
    await initService('Notification Service', notificationService);
    await initService('Recommendation Engine', recommendationEngine);

    // 7. Start Bot
    const bot = new TelegramBot(token, { polling: true });
    
    // 8. Message Queue Worker (Rate Limit Handler)
    let isWorkerRunning = false;
    const QUEUE_INTERVAL = 2000; // Speed up slightly (2s)
    
    setInterval(async () => {
        if (isWorkerRunning) return;
        isWorkerRunning = true;
        
        try {
            const messagesToSend = await db.popAllMessagesFromQueue();
            if (!messagesToSend || messagesToSend.length === 0) {
                isWorkerRunning = false;
                return;
            }
            
            logger.debug(`Processing ${messagesToSend.length} queued messages`);
            
            // Separate broadcast vs regular messages
            const broadcastTasks = messagesToSend.filter(m => m.isBroadcast);
            const regularMessages = messagesToSend.filter(m => !m.isBroadcast);

            // Handle Regular Messages
            for (const msg of regularMessages) {
                try {
                    await bot.sendMessage(msg.chatId, msg.text, { parse_mode: 'Markdown', disable_web_page_preview: true });
                    await new Promise(r => setTimeout(r, 50)); 
                } catch (e) {
                    logger.error(`Failed to send queued message to ${msg.chatId}: ${e.message}`);
                }
            }

            // Handle Broadcasts
            for (const task of broadcastTasks) {
                await handleBroadcast(bot, task);
            }

        } catch (error) {
            logger.error('Message Queue Worker Error:', error);
        } finally {
            isWorkerRunning = false;
        }
    }, QUEUE_INTERVAL);

    // Helper: Broadcast Logic
    async function handleBroadcast(bot, task) {
        try {
            const allUsers = await db.getAllUsers();
            const targets = allUsers.filter(u => u.id && u.id.toString() !== ADMIN_ID && !u.is_bot);
            
            await db.startBroadcastLog(task.text, targets.length);
            logger.info(`Starting broadcast to ${targets.length} users...`);
            
            let success = 0, fail = 0;
            
            for (const user of targets) {
                try {
                    await bot.sendMessage(user.id, task.text, { parse_mode: 'Markdown' });
                    success++;
                } catch (e) {
                    fail++;
                }
                await new Promise(r => setTimeout(r, 40)); // Max 25 msgs/sec
            }
            
            await db.endBroadcastLog();
            logger.info(`Broadcast finished. Success: ${success}, Fail: ${fail}`);
        } catch (e) {
            logger.error('Broadcast Error:', e);
        }
    }

    // 9. Start Admin Dashboard
    startAdminPanel(bot);

    // 10. Central Update Handler
    // Used to route messages and log activity
    const handleUpdate = (type, handlerFn) => async (payload) => {
        try {
            // "payload" is either msg or query depending on event
            // Note: InlineQuery object structure is different from Message
            let user = null;
            if (type === 'inline_query') {
                user = { id: payload.from.id, username: payload.from.username, first_name: payload.from.first_name };
            } else {
                user = getUserInfo(payload); // Works for messages and callback_queries
            }

            if (!user) return; 

            // Update user activity in DB (Fire and forget)
            db.addOrUpdateUser(user).catch(e => logger.warn(`DB Update failed: ${e.message}`));

            // Ban Check
            if (await db.isUserBanned(user.id)) {
                logger.warn(`Blocked interaction from banned user: ${user.id}`);
                return;
            }

            // Route Logic
            if (type === 'message') {
                const text = payload.text || '';
                const isAdmin = user.id.toString() === ADMIN_ID;
                
                // Admin Commands
                if (isAdmin && text.startsWith('/')) {
                    return adminHandler(bot)(payload);
                }
                return messageHandler(bot)(payload);
            } 
            else if (type === 'callback_query') {
                return handlerFn(bot)(payload);
            } 
            else if (type === 'inline_query') {
                return handlerFn(bot)(payload);
            }

        } catch (error) {
            logger.error(`Middleware Error (${type}):`, error);
            if(errorTrackingService) {
                errorTrackingService.trackError(error, null, { component: 'middleware', type });
            }
        }
    };

    // 11. Register Event Listeners
    bot.on('message', handleUpdate('message', null));
    bot.on('callback_query', handleUpdate('callback_query', callbackHandler));
    bot.on('inline_query', handleUpdate('inline_query', inlineHandler));

    // Error Handlers
    bot.on('polling_error', (error) => {
        // Suppress common connection timeout errors to keep logs clean
        if (error.code !== 'ETIMEDOUT') {
            logger.error(`Polling Error: ${error.message}`);
        }
    });
    
    bot.on('webhook_error', (error) => logger.error(`Webhook Error: ${error.message}`));

    // Graceful Shutdown
    const shutdown = () => { 
        logger.info("Shutting down bot..."); 
        bot.stopPolling().then(() => process.exit(0)); 
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info(`✅ Font Sharer Bot is online. Admin ID: ${ADMIN_ID}`);
}

main().catch(err => logger.error('FATAL: Bot failed to start.', { stack: err.stack }));

// Keep process alive
setInterval(() => {}, 1 << 30);