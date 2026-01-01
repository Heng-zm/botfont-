// handlers/profileHandler.js

const advancedUserProfileService = require('../services/advancedUserProfileService');
const { logger, getUserInfo } = require('../services/logger');
const strings = require('../localization');

/**
 * Handle profile-related commands
 */
class ProfileHandler {
    
    /**
     * Handle /profile command - Show comprehensive user profile
     */
    static async handleProfile(bot, msg) {
        const user = getUserInfo(msg);
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const profile = await advancedUserProfileService.getUserProfile(user.id);
            if (!profile) {
                return bot.sendMessage(chatId, '❌ មិនអាចទាញយកព័ត៌មានប្រូហ្វាល់បានទេ។');
            }

            const message = this.formatProfileMessage(profile);
            const keyboard = [
                [
                    { text: '📊 សកម្មភាព / Activity', callback_data: 'profile_activity' },
                    { text: '🏆 ជោគជ័យ / Achievements', callback_data: 'profile_achievements' }
                ],
                [
                    { text: '⚙️ ការកំណត់ / Settings', callback_data: 'profile_settings' },
                    { text: '📈 របាយការណ៍ / Report', callback_data: 'profile_report' }
                ],
                [
                    { text: '💡 អនុសាសន៍ / Recommendations', callback_data: 'profile_recommendations' }
                ]
            ];

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            logger.error('Error in profile handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្ហាញប្រូហ្វាល់។');
        }
    }

    /**
     * Handle /mystats command - Show detailed user statistics
     */
    static async handleMyStats(bot, msg) {
        const user = getUserInfo(msg);
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const stats = await advancedUserProfileService.calculateUserStats(user.id);
            if (!stats) {
                return bot.sendMessage(chatId, '❌ មិនអាចទាញយកស្ថិតិបានទេ។');
            }

            const message = this.formatStatsMessage(stats);
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

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            logger.error('Error in stats handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្ហាញស្ថិតិ។');
        }
    }

    /**
     * Handle /achievements command - Show user achievements
     */
    static async handleAchievements(bot, msg) {
        const user = getUserInfo(msg);
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const achievements = await advancedUserProfileService.getUserAchievements(user.id);
            const stats = await advancedUserProfileService.calculateUserStats(user.id);
            
            const message = this.formatAchievementsMessage(achievements, stats);
            const keyboard = [
                [
                    { text: '🎯 គោលដៅបន្ទាប់ / Next Goals', callback_data: 'achievements_next' },
                    { text: '📈 ដំណើរការ / Progress', callback_data: 'achievements_progress' }
                ]
            ];

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            logger.error('Error in achievements handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្ហាញជោគជ័យ។');
        }
    }

    /**
     * Handle /rank command - Show user rank and progress
     */
    static async handleRank(bot, msg) {
        const user = getUserInfo(msg);
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const stats = await advancedUserProfileService.calculateUserStats(user.id);
            const rank = await advancedUserProfileService.getUserRank(user.id, stats);
            
            const message = this.formatRankMessage(rank, stats);
            const keyboard = [
                [
                    { text: '📊 លម្អិតបន្ថែម / More Details', callback_data: 'rank_details' },
                    { text: '🎯 វិធីកើនឡើង / How to Improve', callback_data: 'rank_improve' }
                ]
            ];

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            logger.error('Error in rank handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្ហាញឋានៈ។');
        }
    }

    /**
     * Handle /settings command - Show user settings
     */
    static async handleSettings(bot, msg) {
        const user = getUserInfo(msg);
        const chatId = msg.chat.id;
        
        try {
            const profile = await advancedUserProfileService.getUserProfile(user.id);
            if (!profile) {
                return bot.sendMessage(chatId, '❌ មិនអាចទាញយកការកំណត់បានទេ។');
            }

            const message = this.formatSettingsMessage(profile.preferences);
            const keyboard = [
                [
                    { text: '🌐 ភាសា / Language', callback_data: 'settings_language' },
                    { text: '🔔 ការជូនដំណឹង / Notifications', callback_data: 'settings_notifications' }
                ],
                [
                    { text: '🖼️ ទំហំរូបភាព / Preview Size', callback_data: 'settings_preview' },
                    { text: '🎨 រចនាបទ / Theme', callback_data: 'settings_theme' }
                ],
                [
                    { text: '📂 ប្រភេទពុម្ពអក្សរ / Font Categories', callback_data: 'settings_categories' }
                ]
            ];

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            logger.error('Error in settings handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្ហាញការកំណត់។');
        }
    }

    /**
     * Handle /recommendations command - Show personalized recommendations
     */
    static async handleRecommendations(bot, msg) {
        const user = getUserInfo(msg);
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const recommendations = await advancedUserProfileService.getUserRecommendations(user.id);
            
            if (recommendations.length === 0) {
                return bot.sendMessage(chatId, 'ℹ️ មិនមានអនុសាសន៍នៅពេលនេះទេ។ សាកល្បងប្រើប្រាស់បន្ថែមទៀត។');
            }

            const message = this.formatRecommendationsMessage(recommendations);
            const keyboard = recommendations.map((rec, index) => [
                { text: `${index + 1}. ${rec.title}`, callback_data: `rec_${rec.action}_${index}` }
            ]);

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            logger.error('Error in recommendations handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្ហាញអនុសាសន៍។');
        }
    }

    /**
     * Handle /report command - Generate activity report
     */
    static async handleReport(bot, msg) {
        const user = getUserInfo(msg);
        const chatId = msg.chat.id;
        const [, period] = msg.text.split(' ');
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const reportPeriod = period || 'month';
            const report = await advancedUserProfileService.generateActivityReport(user.id, reportPeriod);
            
            if (!report) {
                return bot.sendMessage(chatId, '❌ មិនអាចបង្កើតរបាយការណ៍បានទេ។');
            }

            const message = this.formatReportMessage(report);
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

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            logger.error('Error in report handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្កើតរបាយការណ៍។');
        }
    }

    // Formatting methods
    static formatProfileMessage(profile) {
        const completeness = '█'.repeat(Math.floor(profile.profileCompleteness / 10)) + 
                           '▒'.repeat(10 - Math.floor(profile.profileCompleteness / 10));
        
        return `👤 **ប្រូហ្វាល់របស់អ្នក / Your Profile**

🔸 **ឈ្មោះ / Name:** ${profile.first_name || 'N/A'} ${profile.last_name || ''}
🔸 **ឈ្មោះអ្នកប្រើ / Username:** @${profile.username || 'None'}
🔸 **ឋានៈ / Rank:** ${profile.rank.rankIcon} ${profile.rank.rank} (${profile.rank.score} points)
🔸 **ពិន្ទុ / Score:** ${profile.rank.score}/${profile.rank.nextRank ? profile.rank.score + profile.rank.pointsToNext : 'Max'}

📈 **ភាពពេញលេញ / Completeness:** ${profile.profileCompleteness}%
${completeness}

📊 **សកម្មភាពសរុប / Total Activity:**
• ទាញយក / Downloads: ${profile.stats.totalDownloads}
• បានផ្ទុកឡើង / Uploads: ${profile.stats.totalUploads}
• បានអនុម័ត / Approved: ${profile.stats.approvedUploads}

🏆 **ជោគជ័យ / Achievements:** ${profile.achievements.length}
🔥 **Streak បច្ចុប្បន្ន / Current Streak:** ${profile.stats.currentDownloadStreak} days

📅 **ចូលរួម / Joined:** ${new Date(profile.firstSeen).toLocaleDateString()}
⏰ **សកម្មភាពចុងក្រោយ / Last Active:** ${new Date(profile.lastSeen).toLocaleDateString()}`;
    }

    static formatStatsMessage(stats) {
        return `📊 **ស្ថិតិលម្អិត / Detailed Statistics**

📥 **ទាញយក / Downloads:**
• សរុប / Total: ${stats.totalDownloads}
• សប្តាហ៍នេះ / This Week: ${stats.weeklyDownloads}
• ខែនេះ / This Month: ${stats.monthlyDownloads}
• មធ្យមក្នុងមួយវគ្គ / Avg per Session: ${stats.avgDownloadsPerSession}

📤 **ការផ្ទុក / Uploads:**
• សរុប / Total: ${stats.totalUploads}
• បានអនុម័ត / Approved: ${stats.approvedUploads}
• កំពុងរង់ចាំ / Pending: ${stats.pendingUploads}
• បានបដិសេធ / Rejected: ${stats.rejectedUploads}
• អត្រាអនុម័ត / Approval Rate: ${stats.approvalRate}%

🔥 **Streaks:**
• បច្ចុប្បន្ន / Current: ${stats.currentDownloadStreak} days
• ច្រើនជាងគេ / Longest: ${stats.longestDownloadStreak} days

⏰ **ម៉ោងសកម្មបំផុត / Most Active Time:**
${stats.mostActiveHours.hour}:00 (${stats.mostActiveHours.period})

📅 **ពេលវេលា / Timeline:**
• ចូលរួម / Days Since Joined: ${stats.daysSinceJoin} days
• ការណនេះ / Last Updated: ${new Date(stats.calculatedAt).toLocaleString()}`;
    }

    static formatAchievementsMessage(achievements, stats) {
        let message = `🏆 **ជោគជ័យរបស់អ្នក / Your Achievements**\n\n`;
        
        if (achievements.length === 0) {
            message += 'ℹ️ អ្នកមិនទាន់មានជោគជ័យទេ។ ចាប់ផ្តើមទាញយកពុម្ពអក្សរដើម្បីដោះសោជោគជ័យ!\n\n';
        } else {
            achievements.forEach((achievement) => {
                message += `${achievement.icon} **${achievement.name}**\n`;
                message += `   ${achievement.description}\n\n`;
            });
        }

        // Add progress towards next achievements
        const nextAchievement = advancedUserProfileService.getNextAchievementSuggestion(stats);
        if (nextAchievement) {
            message += `🎯 **គោលដៅបន្ទាប់ / Next Goal:**\n`;
            message += `${nextAchievement.title}\n`;
            message += `${nextAchievement.description}\n`;
        }

        return message;
    }

    static formatRankMessage(rank, stats) {
        const progressBar = '█'.repeat(Math.floor(rank.percentToNext / 10)) + 
                          '▒'.repeat(10 - Math.floor(rank.percentToNext / 10));
        
        return `🏅 **ឋានៈរបស់អ្នក / Your Rank**

${rank.rankIcon} **${rank.rank}**
ពិន្ទុ / Score: **${rank.score}** points

${rank.nextRank ? `🎯 **គោលដៅបន្ទាប់ / Next Rank:** ${rank.nextRank}
ចាំបាច់ / Points Needed: **${rank.pointsToNext}** more points

📈 **ដំណើរការ / Progress:**
${progressBar} ${rank.percentToNext.toFixed(1)}%` : '🎉 **អ្នកបានដល់ឋានៈខ្ពស់បំផុត!**'}

💡 **វិធីកើនឡើង / How to Improve:**
• ទាញយកពុម្ពអក្សរបន្ថែម (+2 points/download)
• ផ្ទុកពុម្ពអក្សរថ្មី (+15 points/approved upload)
• រក្សាការប្រើប្រាស់ជាប្រចាំ (streak bonus)
• ការពេលវេលាយូរ (loyalty bonus)`;
    }

    static formatSettingsMessage(preferences) {
        return `⚙️ **ការកំណត់របស់អ្នក / Your Settings**

🌐 **ភាសា / Language:** ${preferences.language === 'khmer' ? 'ខ្មែរ / Khmer' : 'English'}

🔔 **ការជូនដំណឹង / Notifications:**
• ទាញយក / Download: ${preferences.downloadNotifications ? '✅' : '❌'}
• អនុម័ត / Approval: ${preferences.approvalNotifications ? '✅' : '❌'}
• សំបុត្រប្រចាំសប្តាហ៍ / Weekly Digest: ${preferences.weeklyDigest ? '✅' : '❌'}

🖼️ **ទំហំរូបភាព / Preview Size:** ${preferences.fontPreviewSize}
🎨 **រចនាបទ / Theme:** ${preferences.darkMode ? '🌙 Dark' : '☀️ Light'}

📂 **ប្រភេទពុម្ពអក្សរ / Font Categories:**
${preferences.fontCategories.join(', ')}

⏰ **ធ្វើបច្ចុប្បន្នភាពចុងក្រោយ / Last Updated:**
${new Date(preferences.updatedAt).toLocaleString()}`;
    }

    static formatRecommendationsMessage(recommendations) {
        let message = `💡 **អនុសាសន៍សម្រាប់អ្នក / Recommendations for You**\n\n`;
        
        recommendations.forEach((rec, index) => {
            message += `${index + 1}. **${rec.title}**\n`;
            message += `   ${rec.description}\n\n`;
        });

        return message;
    }

    static formatReportMessage(report) {
        return `📈 **របាយការណ៍សកម្មភាព / Activity Report**
📅 **រយៈពេល / Period:** ${report.period} (${new Date(report.startDate).toLocaleDateString()} - ${new Date(report.endDate).toLocaleDateString()})

📊 **សេចក្តីសង្ខេប / Summary:**
• ទាញយក / Downloads: ${report.summary.downloads}
• ផ្ទុកឡើង / Uploads: ${report.summary.uploads}
• ថ្ងៃសកម្ម / Active Days: ${report.summary.daysActive}
• មធ្យមក្នុងមួយថ្ងៃ / Average per Day: ${report.summary.averagePerDay}

🏆 **ជោគជ័យថ្មី / New Achievements:** ${report.achievements.length}

📂 **ពុម្ពអក្សរពេញនិយមបំផុត / Top Downloaded Fonts:**
${report.topFonts.map((font, index) => `${index + 1}. ${font.font} (${font.count}x)`).join('\n')}

📊 **បង្កើតនៅ / Generated at:** ${new Date(report.generatedAt).toLocaleString()}`;
    }
}

module.exports = ProfileHandler;
