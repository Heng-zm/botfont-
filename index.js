// index.js
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
const messageHandler = require('./handlers/messageHandler');
const callbackHandler = require('./handlers/callbackHandler');
const inlineHandler = require('./handlers/inlineHandler');
const adminHandler = require('./handlers/adminHandler');

const token = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_CHAT_ID;

if (!token || !ADMIN_ID) { logger.error("FATAL: Missing TELEGRAM_BOT_TOKEN or ADMIN_CHAT_ID in .env file!"); process.exit(1); }

async function main() {
    // Initialize database first
    await db.initializeDatabase();
    
    // Initialize font cache
    initializeCache();
    
    // Add a small delay to ensure database is fully ready
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Initialize enhanced services with error handling
    try {
        await userProfileService.init();
        logger.info('User Profile Service initialized successfully');
    } catch (error) {
        logger.warn('User Profile Service initialization failed:', error.message);
    }
    
    try {
        await analyticsService.init();
        logger.info('Analytics Service initialized successfully');
    } catch (error) {
        logger.warn('Analytics Service initialization failed:', error.message);
    }
    
    try {
        await notificationService.init();
        logger.info('Notification Service initialized successfully');
    } catch (error) {
        logger.warn('Notification Service initialization failed:', error.message);
    }
    
    try {
        await recommendationEngine.init();
        logger.info('Recommendation Engine initialized successfully');
    } catch (error) {
        logger.warn('Recommendation Engine initialization failed:', error.message);
    }
    
    const bot = new TelegramBot(token, { polling: true });
    
    // Enhanced Message Queue Worker with better error handling
    let isWorkerRunning = false;
    const QUEUE_INTERVAL = 5000; // 5 seconds
    const BROADCAST_DELAY = 300; // 300ms delay between broadcast messages
    
    setInterval(async () => {
        if (isWorkerRunning) return;
        isWorkerRunning = true;
        
        try {
            const messagesToSend = await db.popAllMessagesFromQueue();
            if (!messagesToSend || messagesToSend.length === 0) return;
            
            logger.debug(`Processing ${messagesToSend.length} queued messages`);
            
            const broadcastTask = messagesToSend.find(m => m.isBroadcast);
            if (broadcastTask) {
                // Handle broadcast messages
                await handleBroadcastMessage(bot, broadcastTask);
            } else {
                // Handle regular messages
                await handleRegularMessages(bot, messagesToSend);
            }
        } catch (error) {
            logger.error('CRITICAL Error in Message Queue Worker:', { 
                stack: error.stack,
                message: error.message
            });
            errorTrackingService.trackError(error, null, {
                component: 'message_queue',
                action: 'process_queue',
                severity: 'critical'
            });
        } finally {
            isWorkerRunning = false;
        }
    }, QUEUE_INTERVAL);
    
    /**
     * Handle broadcast message with proper error handling and rate limiting
     */
    async function handleBroadcastMessage(bot, broadcastTask) {
        try {
            const allUsers = await db.getAllUsers();
            const targets = allUsers.filter(u => 
                u.id.toString() !== ADMIN_ID && 
                !u.is_bot && 
                u.id // Ensure valid ID
            );
            
            await db.startBroadcastLog(broadcastTask.text, targets.length);
            logger.info(`Starting broadcast to ${targets.length} users`);
            
            let successCount = 0;
            let failCount = 0;
            
            for (const user of targets) {
                try {
                    // Validate user ID before sending
                    if (!user.id || isNaN(user.id)) {
                        logger.warn('Invalid user ID in broadcast', { userId: user.id });
                        continue;
                    }
                    
                    await bot.sendMessage(user.id, broadcastTask.text, { 
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    });
                    
                    await db.logBroadcastResult(true, user.id);
                    successCount++;
                    
                } catch (error) {
                    await db.logBroadcastResult(false, user.id, error.message);
                    failCount++;
                    
                    logger.warn('Failed to send broadcast message', {
                        userId: user.id,
                        error: error.message
                    });
                }
                
                // Rate limiting to avoid Telegram API limits
                await new Promise(resolve => setTimeout(resolve, BROADCAST_DELAY));
            }
            
            await db.endBroadcastLog();
            logger.info(`Broadcast completed: ${successCount} sent, ${failCount} failed`);
            
        } catch (error) {
            logger.error('Error in broadcast handling:', { stack: error.stack });
            await db.endBroadcastLog(); // Ensure broadcast log is closed
        }
    }
    
    /**
     * Handle regular queued messages with validation
     */
    async function handleRegularMessages(bot, messages) {
        for (const msg of messages) {
            try {
                // Validate message structure
                if (!msg.chatId || !msg.text) {
                    logger.warn('Invalid message in queue', { msg });
                    continue;
                }
                
                await bot.sendMessage(msg.chatId, msg.text, { 
                    parse_mode: 'Markdown',
                    disable_web_page_preview: true
                });
                
                logger.debug('Sent queued message', { chatId: msg.chatId });
                
            } catch (error) {
                logger.error('Failed to send queued message', {
                    chatId: msg.chatId,
                    error: error.message
                });
            }
            
            // Small delay between messages
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    startAdminPanel(bot);

    // Universal Middleware
    const withMiddleware = (handler) => async (updateObject) => {
        try {
            const user = getUserInfo(updateObject);
            if (!user || (user.is_bot && user.id.toString() !== ADMIN_ID)) return;
            if (await db.isUserBanned(user.id)) return logger.warn(`Blocked request from banned user`, { user });
            await db.addOrUpdateUser(user);
            handler(bot)(updateObject);
        } catch (error) { 
            logger.error(`Error in middleware:`, { stack: error.stack });
            errorTrackingService.trackError(error, user?.id, {
                component: 'middleware',
                action: 'process_update',
                severity: 'high'
            });
        }
    };
    
    // Route Handlers
    bot.on('message', withMiddleware((innerBot) => (msg) => { (msg.from.id.toString() === ADMIN_ID && msg.text?.startsWith('/')) ? adminHandler(innerBot)(msg) : messageHandler(innerBot)(msg); }));
    bot.on('callback_query', withMiddleware(callbackHandler));
    bot.on('inline_query', withMiddleware(inlineHandler));

    // Network Error Handling
    bot.on('polling_error', (error) => logger.error(`Polling Error: ${error.code} - ${error.message}`));
    bot.on('webhook_error', (error) => logger.error(`Webhook Error: ${error.code} - ${error.message}`));

    const shutdown = () => { logger.info("Shutting down..."); bot.stopPolling().then(() => process.exit(0)); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    logger.info('✅ Font Sharer Bot is fully operational.');
}

main().catch(err => logger.error('FATAL: Bot failed to start.', { stack: err.stack }));

setInterval(() => {}, 1 << 30);