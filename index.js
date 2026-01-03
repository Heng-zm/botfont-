// index.js
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { logger, getUserInfo } = require('./services/logger');
const db = require('./services/dbService');
const { initializeCache } = require('./services/fontService');
const { startAdminPanel } = require('./adminPanel'); // Ensure this file exists
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

if (!token || !ADMIN_ID) { 
    logger.error("FATAL: Missing TELEGRAM_BOT_TOKEN or ADMIN_CHAT_ID in .env file!"); 
    process.exit(1); 
}

async function main() {
    // 1. Initialize core database
    await db.initializeDatabase();
    
    // 2. Initialize file cache
    initializeCache();
    
    // 3. Initialize advanced services (Optional but recommended)
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

    // 4. Start Bot
    const bot = new TelegramBot(token, { polling: true });
    
    // 5. Message Queue Worker
    let isWorkerRunning = false;
    const QUEUE_INTERVAL = 5000; 
    
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
                    // Rate limit prevention
                    await new Promise(r => setTimeout(r, 100)); 
                } catch (e) {
                    logger.error(`Failed to send queued message to ${msg.chatId}: ${e.message}`);
                }
            }

            // Handle Broadcasts (One at a time)
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
            // Filter valid targets (not admin, not bots)
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
                    // Optional: remove invalid users from DB
                }
                // Strict rate limiting for broadcast (30 messages per second max globally)
                await new Promise(r => setTimeout(r, 50)); 
            }
            
            await db.endBroadcastLog();
            logger.info(`Broadcast finished. Success: ${success}, Fail: ${fail}`);
        } catch (e) {
            logger.error('Broadcast Error:', e);
        }
    }

    // 6. Start Admin Dashboard
    startAdminPanel(bot);

    // 7. Universal Middleware & Routing
    const handleUpdate = (type, handlerModule) => async (msg) => {
        try {
            const user = getUserInfo(msg);
            if (!user) return; // Ignore updates without user info

            // Update user activity in DB
            await db.addOrUpdateUser(user);

            // Ban Check
            if (await db.isUserBanned(user.id)) {
                logger.warn(`Blocked interaction from banned user: ${user.id}`);
                return;
            }

            // Route Logic
            if (type === 'message') {
                const text = msg.text || '';
                const isAdmin = user.id.toString() === ADMIN_ID;
                
                // If Admin sends a command, use Admin Handler
                if (isAdmin && text.startsWith('/')) {
                    return adminHandler(bot)(msg);
                }
                
                // Otherwise use Standard Message Handler
                return messageHandler(bot)(msg);
            } 
            else if (type === 'callback_query') {
                return handlerModule(bot)(msg);
            } 
            else if (type === 'inline_query') {
                return handlerModule(bot)(msg);
            }

        } catch (error) {
            logger.error(`Middleware Error (${type}):`, error);
            if(errorTrackingService) {
                errorTrackingService.trackError(error, null, { component: 'middleware', type });
            }
        }
    };

    // Register Event Listeners
    bot.on('message', handleUpdate('message', null));
    bot.on('callback_query', handleUpdate('callback_query', callbackHandler));
    bot.on('inline_query', handleUpdate('inline_query', inlineHandler));

    // Error Handlers
    bot.on('polling_error', (error) => logger.error(`Polling Error: ${error.message}`));
    bot.on('webhook_error', (error) => logger.error(`Webhook Error: ${error.message}`));

    // Graceful Shutdown
    const shutdown = () => { 
        logger.info("Shutting down bot..."); 
        bot.stopPolling().then(() => process.exit(0)); 
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('✅ Font Sharer Bot is fully operational.');
}

// Start Main Process
main().catch(err => logger.error('FATAL: Bot failed to start.', { stack: err.stack }));

// Keep process alive
setInterval(() => {}, 1 << 30);