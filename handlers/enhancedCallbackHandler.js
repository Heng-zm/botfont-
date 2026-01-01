// handlers/enhancedCallbackHandler.js

const advancedUserProfileService = require('../services/advancedUserProfileService');
const ProfileHandler = require('./profileHandler');
const { logger, getUserInfo } = require('../services/logger');
const { getFontCache, setUserSession } = require('../services/fontService');
const { sendOrEditFontListPage } = require('../ui/fontList');

/**
 * Enhanced callback handler for profile-related callbacks
 */
class EnhancedCallbackHandler {
    
    /**
     * Handle all profile-related callbacks
     */
    static async handleCallback(bot, callbackQuery) {
        const msg = callbackQuery.message;
        const chatId = msg.chat.id;
        const data = callbackQuery.data;
        const user = { id: callbackQuery.from.id };
        
        logger.info(`Processing enhanced callback: "${data}"`, { user });
        
        const [action, subAction, ...params] = data.split('_');
        
        // Answer callback query first
        bot.answerCallbackQuery(callbackQuery.id);
        
        try {
            switch (action) {
                case 'profile':
                    await this.handleProfileCallback(bot, chatId, subAction, params, user, msg.message_id);
                    break;
                    
                case 'stats':
                    await this.handleStatsCallback(bot, chatId, subAction, params, user, msg.message_id);
                    break;
                    
                case 'achievements':
                    await this.handleAchievementsCallback(bot, chatId, subAction, params, user, msg.message_id);
                    break;
                    
                case 'rank':
                    await this.handleRankCallback(bot, chatId, subAction, params, user, msg.message_id);
                    break;
                    
                case 'settings':
                    await this.handleSettingsCallback(bot, chatId, subAction, params, user, msg.message_id);
                    break;
                    
                case 'report':
                    await this.handleReportCallback(bot, chatId, subAction, params, user, msg.message_id);
                    break;
                    
                case 'rec':
                    await this.handleRecommendationCallback(bot, chatId, subAction, params, user, msg.message_id);
                    break;
                    
                default:
                    // Not a profile-related callback, return false to let other handlers process it
                    return false;
            }
            return true;
        } catch (error) {
            logger.error('Error in enhanced callback handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការដំណើរការសំណើ។');
            return true;
        }
    }
    
    /**
     * Handle profile-related callbacks
     */
    static async handleProfileCallback(bot, chatId, subAction, params, user, messageId) {
        switch (subAction) {
            case 'activity':
                await this.showProfileActivity(bot, chatId, user, messageId);
                break;
                
            case 'achievements':
                await this.showProfileAchievements(bot, chatId, user, messageId);
                break;
                
            case 'settings':
                await this.showProfileSettings(bot, chatId, user, messageId);
                break;
                
            case 'report':
                await this.showProfileReport(bot, chatId, user, messageId);
                break;
                
            case 'recommendations':
                await this.showProfileRecommendations(bot, chatId, user, messageId);
                break;
        }
    }
    
    /**
     * Handle stats-related callbacks
     */
    static async handleStatsCallback(bot, chatId, subAction, params, user, messageId) {
        const stats = await advancedUserProfileService.calculateUserStats(user.id);
        
        switch (subAction) {
            case 'week':
                await this.showWeeklyStats(bot, chatId, user, messageId, stats);
                break;
                
            case 'month':
                await this.showMonthlyStats(bot, chatId, user, messageId, stats);
                break;
                
            case 'graph':
                await this.showStatsGraph(bot, chatId, user, messageId, stats);
                break;
                
            case 'refresh':
                // Refresh stats and show updated version
                const updatedStats = await advancedUserProfileService.calculateUserStats(user.id);
                const message = ProfileHandler.formatStatsMessage(updatedStats);
                
                const keyboard = [
                    [
                        { text: '📅 សប្តាហ៍នេះ / This Week', callback_data: 'stats_week' },
                        { text: '📆 ខែនេះ / This Month', callback_data: 'stats_month' }
                    ],
                    [
                        { text: '📊 ក្រាហ្វិក / Graph', callback_data: 'stats_graph' },
                        { text: '🔄 ធ្វើបច្ចុប្បន្នភាព / Refresh', callback_data: 'stats_refresh' }
                    ]
                ];
                
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: keyboard }
                });
                break;
        }
    }
    
    /**
     * Handle achievements-related callbacks
     */
    static async handleAchievementsCallback(bot, chatId, subAction, params, user, messageId) {
        switch (subAction) {
            case 'next':
                await this.showNextAchievements(bot, chatId, user, messageId);
                break;
                
            case 'progress':
                await this.showAchievementProgress(bot, chatId, user, messageId);
                break;
        }
    }
    
    /**
     * Handle rank-related callbacks
     */
    static async handleRankCallback(bot, chatId, subAction, params, user, messageId) {
        switch (subAction) {
            case 'details':
                await this.showRankDetails(bot, chatId, user, messageId);
                break;
                
            case 'improve':
                await this.showRankImprovement(bot, chatId, user, messageId);
                break;
        }
    }
    
    /**
     * Handle settings-related callbacks
     */
    static async handleSettingsCallback(bot, chatId, subAction, params, user, messageId) {
        switch (subAction) {
            case 'language':
                await this.showLanguageSettings(bot, chatId, user, messageId);
                break;
                
            case 'notifications':
                await this.showNotificationSettings(bot, chatId, user, messageId);
                break;
                
            case 'preview':
                await this.showPreviewSettings(bot, chatId, user, messageId);
                break;
                
            case 'theme':
                await this.showThemeSettings(bot, chatId, user, messageId);
                break;
                
            case 'categories':
                await this.showCategorySettings(bot, chatId, user, messageId);
                break;
        }
    }
    
    /**
     * Handle report-related callbacks
     */
    static async handleReportCallback(bot, chatId, subAction, params, user, messageId) {
        let period = 'month';
        
        switch (subAction) {
            case 'week':
                period = 'week';
                break;
            case 'month':
                period = 'month';
                break;
            case 'year':
                period = 'year';
                break;
            case 'export':
                await this.exportReport(bot, chatId, user, messageId);
                return;
        }
        
        const report = await advancedUserProfileService.generateActivityReport(user.id, period);
        const message = ProfileHandler.formatReportMessage(report);
        
        const keyboard = [
            [
                { text: '📅 សប្តាហ៍ / Week', callback_data: 'report_week' },
                { text: '📆 ខែ / Month', callback_data: 'report_month' },
                { text: '📊 ឆ្នាំ / Year', callback_data: 'report_year' }
            ],
            [
                { text: '📄 ទាញយកPDF / Export PDF', callback_data: 'report_export' }
            ]
        ];
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    /**
     * Handle recommendation callbacks
     */
    static async handleRecommendationCallback(bot, chatId, subAction, params, user, messageId) {
        switch (subAction) {
            case 'browse':
                // Browse category or all fonts
                if (params[0] === 'all') {
                    setUserSession(chatId, getFontCache());
                    await sendOrEditFontListPage(bot, chatId, 0, null);
                }
                break;
                
            case 'upload':
                // Show upload guide
                const uploadGuide = `📝 **មគ្គុទ្ទេសន៍ការផ្ទុកពុម្ពអក្សរ / Font Upload Guide**

1️⃣ ប្រើពាក្យបញ្ជា /uploadfont
2️⃣ ផ្ញើឯកសារពុម្ពអក្សរ (.ttf ឬ .otf)
3️⃣ រង់ចាំការអនុម័តពីរដ្ឋបាល
4️⃣ ទទួលបានការជូនដំណឹងពេលបានអនុម័ត

💡 **គន្លឹះ / Tips:**
• ប្រាកដថាពុម្ពអក្សរមានគុណភាពល្អ
• ពុម្ពអក្សរគួរមានឈ្មោះច្បាស់លាស់
• មិនគួរផ្ទុកពុម្ពអក្សរដែលមានរួចហើយ
• សូមអរគុណសម្រាប់ការចែករំលែក!`;
                
                await bot.editMessageText(uploadGuide, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
                break;
                
            case 'view':
                // Show achievements page
                const achievements = await advancedUserProfileService.getUserAchievements(user.id);
                const stats = await advancedUserProfileService.calculateUserStats(user.id);
                const message = ProfileHandler.formatAchievementsMessage(achievements, stats);
                
                await bot.editMessageText(message, {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
                break;
        }
    }
    
    // Helper methods for specific functionality
    
    static async showProfileActivity(bot, chatId, user, messageId) {
        const stats = await advancedUserProfileService.calculateUserStats(user.id);
        const message = ProfileHandler.formatStatsMessage(stats);
        
        const keyboard = [
            [{ text: '◀️ ត្រឡប់ក្រោយ / Back', callback_data: 'profile_back' }]
        ];
        
        await bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    static async showWeeklyStats(bot, chatId, user, messageId, stats) {
        const weeklyMessage = `📅 **ស្ថិតិប្រចាំសប្តាហ៍ / Weekly Statistics**

📥 **ការទាញយក / Downloads:** ${stats.weeklyDownloads}
📈 **មធ្យមក្នុងមួយថ្ងៃ / Daily Average:** ${(stats.weeklyDownloads / 7).toFixed(1)}
🔥 **Streak បច្ចុប្បន្ន / Current Streak:** ${stats.currentDownloadStreak} days

⏰ **ម៉ោងសកម្មបំផុត / Most Active Time:**
${stats.mostActiveHours.hour}:00 (${stats.mostActiveHours.period})

📊 **ធៀបនឹងមុន / Compared to Previous:**
${stats.weeklyDownloads > (stats.monthlyDownloads / 4) ? '📈 កើនឡើង / Increasing' : '📉 កាត់បន្ថយ / Decreasing'}`;
        
        const keyboard = [
            [
                { text: '📆 ខែនេះ / This Month', callback_data: 'stats_month' },
                { text: '◀️ ត្រឡប់ក្រោយ / Back', callback_data: 'stats_refresh' }
            ]
        ];
        
        await bot.editMessageText(weeklyMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    static async showMonthlyStats(bot, chatId, user, messageId, stats) {
        const monthlyMessage = `📆 **ស្ថិតិប្រចាំខែ / Monthly Statistics**

📥 **ការទាញយកសរុប / Total Downloads:** ${stats.monthlyDownloads}
📈 **មធ្យមក្នុងមួយថ្ងៃ / Daily Average:** ${(stats.monthlyDownloads / 30).toFixed(1)}
📊 **មធ្យមក្នុងមួយសប្តាហ៍ / Weekly Average:** ${(stats.monthlyDownloads / 4).toFixed(1)}

🎯 **សកម្មភាពខ្ពស់បំផុត / Peak Activity:**
${stats.mostActiveHours.period} (${stats.mostActiveHours.count} actions)

📈 **ការវិវត្ត / Growth:**
• Streak ច្រើនបំផុត / Longest Streak: ${stats.longestDownloadStreak} days
• សកម្មភាពជាមធ្យម / Average Activity: ${stats.avgDownloadsPerSession} downloads/session`;
        
        const keyboard = [
            [
                { text: '📅 សប្តាហ៍នេះ / This Week', callback_data: 'stats_week' },
                { text: '◀️ ត្រឡប់ក្រោយ / Back', callback_data: 'stats_refresh' }
            ]
        ];
        
        await bot.editMessageText(monthlyMessage, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    static async showStatsGraph(bot, chatId, user, messageId, stats) {
        // Generate a simple text-based graph
        const report = await advancedUserProfileService.generateActivityReport(user.id, 'month');
        const graphData = report.activityGraph.slice(-7); // Last 7 days
        
        let graph = '📊 **ក្រាហ្វិកសកម្មភាព 7 ថ្ងៃចុងក្រោយ / Last 7 Days Activity Graph**\n\n';
        
        const maxDownloads = Math.max(...graphData.map(d => d.downloads));
        
        graphData.forEach(day => {
            const barLength = maxDownloads > 0 ? Math.floor((day.downloads / maxDownloads) * 10) : 0;
            const bar = '█'.repeat(barLength) + '▒'.repeat(10 - barLength);
            const date = new Date(day.date).toLocaleDateString('en-US', { weekday: 'short' });
            graph += `${date}: ${bar} ${day.downloads}\n`;
        });
        
        graph += `\n📈 **សរុប / Total:** ${graphData.reduce((sum, d) => sum + d.downloads, 0)} downloads`;
        graph += `\n📊 **មធ្យម / Average:** ${(graphData.reduce((sum, d) => sum + d.downloads, 0) / 7).toFixed(1)} downloads/day`;
        
        const keyboard = [
            [{ text: '◀️ ត្រឡប់ក្រោយ / Back', callback_data: 'stats_refresh' }]
        ];
        
        await bot.editMessageText(graph, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: { inline_keyboard: keyboard }
        });
    }
    
    static async exportReport(bot, chatId, user, messageId) {
        const report = await advancedUserProfileService.generateActivityReport(user.id, 'month');
        
        // Create a simple text report
        let textReport = `📈 របាយការណ៍សកម្មភាពលម្អិត / Detailed Activity Report\n\n`;
        textReport += `👤 អ្នកប្រើ / User: ${user.id}\n`;
        textReport += `📅 រយៈពេល / Period: ${report.period}\n`;
        textReport += `🕐 បង្កើតនៅ / Generated: ${new Date(report.generatedAt).toLocaleString()}\n\n`;
        
        textReport += `📊 សេចក្តីសង្ខេប / Summary:\n`;
        textReport += `• ទាញយក / Downloads: ${report.summary.downloads}\n`;
        textReport += `• ផ្ទុកឡើង / Uploads: ${report.summary.uploads}\n`;
        textReport += `• ថ្ងៃសកម្ម / Active Days: ${report.summary.daysActive}\n`;
        textReport += `• មធ្យមក្នុងមួយថ្ងៃ / Daily Average: ${report.summary.averagePerDay}\n\n`;
        
        if (report.topFonts.length > 0) {
            textReport += `🏆 ពុម្ពអក្សរពេញនិយមបំផុត / Top Fonts:\n`;
            report.topFonts.forEach((font, index) => {
                textReport += `${index + 1}. ${font.font} (${font.count}x)\n`;
            });
            textReport += '\n';
        }
        
        if (report.achievements.length > 0) {
            textReport += `🏅 ជោគជ័យថ្មី / New Achievements:\n`;
            report.achievements.forEach(achievement => {
                textReport += `• ${achievement.name}\n`;
            });
        }
        
        // Send as document
        const buffer = Buffer.from(textReport, 'utf-8');
        const fileName = `activity_report_${user.id}_${Date.now()}.txt`;
        
        await bot.sendDocument(chatId, buffer, {
            filename: fileName,
            caption: '📄 របាយការណ៍សកម្មភាពរបស់អ្នក / Your Activity Report'
        });
        
        await bot.answerCallbackQuery(callbackQuery.id, {
            text: '✅ របាយការណ៍ត្រូវបានទាញយកដោយជោគជ័យ!'
        });
    }
}

module.exports = EnhancedCallbackHandler;
