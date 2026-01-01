// handlers/adminHandler.js

const db = require('../services/dbService');
const fs = require('fs');
const path = require('path');
const { initializeCache } = require('../services/fontService');
const { logger, getUserInfo, escapeMarkdown } = require('../services/logger');
const strings = require('../localization');
const eventEmitter = require('../services/eventService');

// Define paths for directories
const PENDING_DIR = path.join(__dirname, '..', 'pending_fonts');
const FONT_DIR = process.env.FONT_DIRECTORY;

/**
 * Handles all commands sent by the designated Admin.
 * This is the central control point for all administrative actions.
 * 
 * @param {TelegramBot} bot The bot instance.
 * @returns {function(object): Promise<void>} An async function that processes the message.
 */
module.exports = (bot) => async (msg) => {
    const user = getUserInfo(msg);
    const chatId = msg.chat.id;
    const [command, ...args] = msg.text.split(' ');

    logger.info(`Processing admin command: ${command}`, { user, args });

    switch (command) {
        // --- User Management ---
        case '/ban': {
            const targetId = parseInt(args[0], 10);
            if (!targetId) return bot.sendMessage(chatId, "Please use: /ban [user_id] [reason...]");
            
            const reason = args.slice(1).join(' ') || 'No reason provided';
            const success = await db.banUser(targetId, reason);
            
            const reply = success 
                ? `✅ Banned User ID: ${targetId}` 
                : `ℹ️ User ID: ${targetId} is already banned.`;
            
            logger.warn(`Admin action: BAN`, { admin: user, targetId, reason });
            eventEmitter.emit('dataChanged', { type: 'BANNED_USERS' });
            return bot.sendMessage(chatId, reply);
        }

        case '/unban': {
            const targetId = parseInt(args[0], 10);
            if (!targetId) return bot.sendMessage(chatId, "Please use: /unban [user_id]");

            const success = await db.unbanUser(targetId);
            const reply = success 
                ? `✅ Unbanned User ID: ${targetId}` 
                : `ℹ️ User ID: ${targetId} not found in ban list.`;

            logger.warn(`Admin action: UNBAN`, { admin: user, targetId });
            eventEmitter.emit('dataChanged', { type: 'BANNED_USERS' });
            return bot.sendMessage(chatId, reply);
        }

        case '/banlist': {
            const list = await db.getBanList();
            let reply = "🚫 **Banned User List:**\n\n";
            if (list.length > 0) {
                list.forEach(bannedUser => {
                    const safeReason = escapeMarkdown(bannedUser.reason);
                    reply += `*ID:* \`${bannedUser.id}\`\n*Reason:* ${safeReason}\n*Date:* ${new Date(bannedUser.date).toLocaleString()}\n----------\n`;
                });
            } else {
                reply = "ℹ️ No users are currently banned.";
            }
            return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        }
        
        // --- Font & System Management ---
        case '/refresh': {
            initializeCache();
            logger.warn(`Admin action: REFRESH_CACHE`, { admin: user });
            eventEmitter.emit('dataChanged', { type: 'FONTS' });
            return bot.sendMessage(chatId, strings.cacheRefreshed);
        }

        case '/pendinglist': {
            const pendingFiles = fs.readdirSync(PENDING_DIR);
            if (pendingFiles.length === 0) return bot.sendMessage(chatId, "ℹ️ No fonts are pending approval.");
            
            let reply = "🕒 **Pending Fonts for Approval:**\n\n";
            pendingFiles.forEach(fileName => {
                const originalFileName = escapeMarkdown(fileName.split('_').slice(2).join('_'));
                const uploaderId = fileName.split('_')[1];
                
                reply += `*File:* \`${originalFileName}\` (from \`${uploaderId}\`)\n`;
                reply += `📋 \`/approve ${fileName}\`\n`;
                reply += `🗑️ \`/reject ${fileName}\`\n`;
                reply += `----------\n`;
            });
            return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        }

        case '/approve': {
            const pendingFileName = args[0];
            if (!pendingFileName) return bot.sendMessage(chatId, "Please provide the pending file name from /pendinglist.");
            
            const pendingFilePath = path.join(PENDING_DIR, pendingFileName);
            if (!fs.existsSync(pendingFilePath)) return bot.sendMessage(chatId, "Error: This file is no longer pending or the name is incorrect.");
            
            const originalFileName = pendingFileName.split('_').slice(2).join('_');
            const uploaderId = pendingFileName.split('_')[1];
            
            fs.copyFileSync(pendingFilePath, path.join(FONT_DIR, originalFileName));
            fs.unlinkSync(pendingFilePath);
            
            initializeCache();
            await db.logUpload(uploaderId, originalFileName, 'approved');
            logger.warn(`Admin approved font: ${originalFileName}`, { admin: user });

            await bot.sendMessage(chatId, strings.approvalSuccess(escapeMarkdown(originalFileName)), { parse_mode: 'Markdown' });
            if (uploaderId) await db.addMessageToQueue(uploaderId, strings.fontApproved(escapeMarkdown(originalFileName)));

            eventEmitter.emit('dataChanged', { type: 'PENDING_FONTS' });
            return;
        }

        case '/reject': {
            const pendingFileName = args[0];
            if (!pendingFileName) return bot.sendMessage(chatId, "Please provide the pending file name from /pendinglist.");

            const pendingFilePath = path.join(PENDING_DIR, pendingFileName);
            if (!fs.existsSync(pendingFilePath)) return bot.sendMessage(chatId, "Error: This file is no longer pending or the name is incorrect.");

            const originalFileName = pendingFileName.split('_').slice(2).join('_');
            const uploaderId = pendingFileName.split('_')[1];

            fs.unlinkSync(pendingFilePath);
            await db.logUpload(uploaderId, originalFileName, 'rejected');
            logger.warn(`Admin rejected font: ${originalFileName}`, { admin: user });

            await bot.sendMessage(chatId, strings.rejectionSuccess(escapeMarkdown(originalFileName)), { parse_mode: 'Markdown' });
            if (uploaderId) await db.addMessageToQueue(uploaderId, strings.fontRejected(escapeMarkdown(originalFileName)));

            eventEmitter.emit('dataChanged', { type: 'PENDING_FONTS' });
            return;
        }

        // --- Communication & Stats ---
        case '/broadcast': {
            const message = args.join(' ');
            if (!message) return bot.sendMessage(chatId, "Please use: /broadcast [your message...]");
            
            logger.warn(`Admin action: QUEUE_BROADCAST`, { admin: user, message });
            await db.addMessageToQueue(null, message, true);
            return bot.sendMessage(chatId, `📢 Broadcast has been queued. Check the Admin Panel for status.`);
        }

        case '/stats': {
             const stats = await db.getStats();
             const reply = `📊 *Bot Statistics*\n\n` +
                           `👤 *Total Unique Users:* ${stats.totalUsers}\n` +
                           `🚫 *Banned Users:* ${stats.bannedCount}\n` +
                           `📂 *Available Fonts:* ${stats.totalFonts}`;
                           
             return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
        }

        // Delegate non-admin commands (like /start) to the public handler
        default: {
            // Lazy load to prevent potential circular dependency issues
            const messageHandler = require('./messageHandler');
            messageHandler(bot)(msg);
        }
    }
};