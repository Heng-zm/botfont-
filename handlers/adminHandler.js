// handlers/adminHandler.js

const db = require('../services/dbService');
const fs = require('fs');
const path = require('path');
const { initializeCache } = require('../services/fontService');
const { logger, getUserInfo, escapeMarkdown } = require('../services/logger');
const strings = require('../localization');
const eventEmitter = require('../services/eventService');

const PENDING_DIR = path.join(__dirname, '..', 'pending_fonts');
const FONT_DIR = process.env.FONT_DIRECTORY || path.join(__dirname, '..', 'fonts');

// Ensure directories exist
if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR, { recursive: true });
if (!fs.existsSync(FONT_DIR)) fs.mkdirSync(FONT_DIR, { recursive: true });

/**
 * Displays the admin welcome message and help commands.
 */
function sendAdminHelp(bot, chatId) {
    const helpMessage = `👋 *Welcome, Admin!*\n\n` +
                        `Here are your available commands:\n\n` +
                        `*User Management*\n` +
                        `\`/ban [user_id] [reason]\` - Ban a user\n` +
                        `\`/unban [user_id]\` - Unban a user\n` +
                        `\`/banlist\` - View all banned users\n\n` +
                        `*Font Management*\n` +
                        `\`/refresh\` - Refresh the font cache\n` +
                        `\`/pendinglist\` - List fonts pending approval\n` +
                        `\`/approve [file_name]\` - Approve a font\n` +
                        `\`/reject [file_name]\` - Reject a font\n\n` +
                        `*Communication & Stats*\n` +
                        `\`/broadcast [message]\` - Queue a global message\n` +
                        `\`/stats\` - View bot statistics\n`;
    bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
}

module.exports = (bot) => async (msg) => {
    const user = getUserInfo(msg);
    const chatId = msg.chat.id;
    const [command, ...args] = (msg.text || '').split(' ');

    logger.info(`Processing admin command: ${command}`, { user });

    switch (command) {
        case '/start':
            return sendAdminHelp(bot, chatId);

        // --- User Management ---
        case '/ban': {
            const targetId = parseInt(args[0], 10);
            if (!targetId || isNaN(targetId)) return bot.sendMessage(chatId, "⚠️ Syntax: `/ban [user_id] [reason...]`", { parse_mode: 'Markdown' });
            
            const reason = args.slice(1).join(' ') || 'No reason provided';
            
            try {
                const success = await db.banUser(targetId, reason);
                const reply = success 
                    ? `✅ *Banned User ID:* \`${targetId}\`\nReason: ${escapeMarkdown(reason)}` 
                    : `ℹ️ User ID: \`${targetId}\` is already banned.`;
                
                logger.warn(`Admin action: BAN`, { admin: user, targetId, reason });
                eventEmitter.emit('dataChanged', { type: 'BANNED_USERS' });
                return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error('Ban error:', err);
                return bot.sendMessage(chatId, "❌ Database error during ban.");
            }
        }

        case '/unban': {
            const targetId = parseInt(args[0], 10);
            if (!targetId || isNaN(targetId)) return bot.sendMessage(chatId, "⚠️ Syntax: `/unban [user_id]`", { parse_mode: 'Markdown' });
            
            try {
                const success = await db.unbanUser(targetId);
                const reply = success 
                    ? `✅ *Unbanned User ID:* \`${targetId}\`` 
                    : `ℹ️ User ID: \`${targetId}\` not found in ban list.`;
                
                logger.warn(`Admin action: UNBAN`, { admin: user, targetId });
                eventEmitter.emit('dataChanged', { type: 'BANNED_USERS' });
                return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error('Unban error:', err);
                return bot.sendMessage(chatId, "❌ Database error during unban.");
            }
        }

        case '/banlist': {
            try {
                const list = await db.getBanList();
                if (list.length === 0) return bot.sendMessage(chatId, "ℹ️ No users are currently banned.");
                
                let reply = "🚫 *Banned User List:*\n\n";
                list.forEach(bannedUser => {
                    const safeReason = escapeMarkdown(bannedUser.reason || 'N/A');
                    reply += `*ID:* \`${bannedUser.id}\`\n*Reason:* ${safeReason}\n*Date:* ${new Date(bannedUser.date).toLocaleDateString()}\n----------\n`;
                });
                return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error('Banlist error:', err);
                return bot.sendMessage(chatId, "❌ Error retrieving ban list.");
            }
        }
        
        // --- Font & System Management ---
        case '/refresh': {
            try {
                await initializeCache();
                logger.warn(`Admin action: REFRESH_CACHE`, { admin: user });
                eventEmitter.emit('dataChanged', { type: 'FONTS' });
                return bot.sendMessage(chatId, strings.cacheRefreshed || "✅ Font cache refreshed successfully.");
            } catch (err) {
                logger.error('Refresh error:', err);
                return bot.sendMessage(chatId, "❌ Error refreshing cache.");
            }
        }

        case '/pendinglist': {
            try {
                const pendingFiles = fs.readdirSync(PENDING_DIR).filter(f => !f.startsWith('.'));
                
                if (pendingFiles.length === 0) return bot.sendMessage(chatId, "ℹ️ No fonts are pending approval.");
                
                let reply = "🕒 *Pending Fonts:*\n\n";
                pendingFiles.forEach(fileName => {
                    // Extract parts: timestamp_userid_filename
                    const parts = fileName.split('_');
                    const uploaderId = parts.length > 1 ? parts[1] : 'Unknown';
                    const originalName = parts.length > 2 ? parts.slice(2).join('_') : fileName;
                    
                    // Escape for display, but keep raw for command code block
                    const displayFile = escapeMarkdown(originalName);
                    
                    reply += `📄 *File:* ${displayFile}\n`;
                    reply += `👤 *From:* \`${uploaderId}\`\n`;
                    reply += `👉 \`/approve ${fileName}\`\n`;
                    reply += `👉 \`/reject ${fileName}\`\n`;
                    reply += `----------\n`;
                });
                return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error('Pendinglist error:', err);
                return bot.sendMessage(chatId, "❌ Error reading pending directory.");
            }
        }

        case '/approve': {
            // BUG FIX: Join args to handle filenames with spaces
            const pendingFileName = args.join(' '); 
            
            if (!pendingFileName) return bot.sendMessage(chatId, "⚠️ Syntax: `/approve [file_name]`", { parse_mode: 'Markdown' });
            
            // SECURITY: Prevent directory traversal
            if (pendingFileName.includes('..') || pendingFileName.includes('/') || pendingFileName.includes('\\')) {
                return bot.sendMessage(chatId, "❌ Invalid filename.");
            }

            const pendingFilePath = path.join(PENDING_DIR, pendingFileName);
            
            if (!fs.existsSync(pendingFilePath)) {
                return bot.sendMessage(chatId, "❌ Error: File not found in pending folder.");
            }

            try {
                const parts = pendingFileName.split('_');
                const uploaderId = parts.length > 1 ? parts[1] : null;
                // Reconstruct original name (everything after the 2nd underscore)
                const originalFileName = parts.length > 2 ? parts.slice(2).join('_') : pendingFileName;

                // Move file
                fs.copyFileSync(pendingFilePath, path.join(FONT_DIR, originalFileName));
                fs.unlinkSync(pendingFilePath);

                // Update system
                await initializeCache();
                if (uploaderId) await db.logUpload(uploaderId, originalFileName, 'approved');
                
                logger.warn(`Admin approved font: ${originalFileName}`, { admin: user });
                
                bot.sendMessage(chatId, `✅ Approved: *${escapeMarkdown(originalFileName)}*`, { parse_mode: 'Markdown' });

                // Notify User
                if (uploaderId) {
                    const userMsg = strings.fontApproved 
                        ? strings.fontApproved(escapeMarkdown(originalFileName)) 
                        : `✅ Your font *${escapeMarkdown(originalFileName)}* has been approved!`;
                        
                    await db.addMessageToQueue(uploaderId, userMsg);
                }
                
                eventEmitter.emit('dataChanged', { type: 'PENDING_FONTS' });
            } catch (err) {
                logger.error('Approve error:', err);
                bot.sendMessage(chatId, `❌ Error approving font: ${err.message}`);
            }
            return;
        }

        case '/reject': {
            // BUG FIX: Join args to handle filenames with spaces
            const pendingFileName = args.join(' ');
            
            if (!pendingFileName) return bot.sendMessage(chatId, "⚠️ Syntax: `/reject [file_name]`", { parse_mode: 'Markdown' });

            // SECURITY
            if (pendingFileName.includes('..') || pendingFileName.includes('/') || pendingFileName.includes('\\')) {
                return bot.sendMessage(chatId, "❌ Invalid filename.");
            }

            const pendingFilePath = path.join(PENDING_DIR, pendingFileName);
            
            if (!fs.existsSync(pendingFilePath)) {
                return bot.sendMessage(chatId, "❌ Error: File not found in pending folder.");
            }

            try {
                const parts = pendingFileName.split('_');
                const uploaderId = parts.length > 1 ? parts[1] : null;
                const originalFileName = parts.length > 2 ? parts.slice(2).join('_') : pendingFileName;

                // Delete file
                fs.unlinkSync(pendingFilePath);
                
                if (uploaderId) await db.logUpload(uploaderId, originalFileName, 'rejected');
                
                logger.warn(`Admin rejected font: ${originalFileName}`, { admin: user });
                
                bot.sendMessage(chatId, `🗑️ Rejected: *${escapeMarkdown(originalFileName)}*`, { parse_mode: 'Markdown' });

                // Notify User
                if (uploaderId) {
                    const userMsg = strings.fontRejected 
                        ? strings.fontRejected(escapeMarkdown(originalFileName)) 
                        : `❌ Your font *${escapeMarkdown(originalFileName)}* was not approved.`;
                        
                    await db.addMessageToQueue(uploaderId, userMsg);
                }
                
                eventEmitter.emit('dataChanged', { type: 'PENDING_FONTS' });
            } catch (err) {
                logger.error('Reject error:', err);
                bot.sendMessage(chatId, `❌ Error rejecting font: ${err.message}`);
            }
            return;
        }

        // --- Communication & Stats ---
        case '/broadcast': {
            const message = args.join(' ');
            if (!message) return bot.sendMessage(chatId, "⚠️ Syntax: `/broadcast [your message...]`", { parse_mode: 'Markdown' });
            
            try {
                logger.warn(`Admin action: QUEUE_BROADCAST`, { admin: user, message });
                // Pass 'true' or appropriate flag if your DB service requires it for global broadcast
                await db.addMessageToQueue(null, message, true); 
                return bot.sendMessage(chatId, `📢 Broadcast has been queued successfully.`);
            } catch (err) {
                logger.error('Broadcast error:', err);
                return bot.sendMessage(chatId, "❌ Error queuing broadcast.");
            }
        }

        case '/stats': {
            try {
                const stats = await db.getStats();
                const reply = `📊 *Bot Statistics*\n\n` +
                            `👥 *Users:* ${stats.totalUsers || 0}\n` +
                            `🚫 *Banned:* ${stats.bannedCount || 0}\n` +
                            `🔠 *Fonts:* ${stats.totalFonts || 0}`;
                return bot.sendMessage(chatId, reply, { parse_mode: 'Markdown' });
            } catch (err) {
                logger.error('Stats error:', err);
                return bot.sendMessage(chatId, "❌ Error fetching statistics.");
            }
        }

        default: {
            if (command) { 
                bot.sendMessage(chatId, `Unknown command: \`${escapeMarkdown(command)}\`. Use /start to see available commands.`, { parse_mode: 'Markdown' });
            }
        }
    }
};