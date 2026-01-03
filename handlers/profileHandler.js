// handlers/profileHandler.js

const advancedUserProfileService = require('../services/advancedUserProfileService');
const { logger, getUserInfo } = require('../services/logger');

/**
 * Helper to generate progress bar
 */
function getProgressBar(current, total, length = 10) {
    const percent = Math.min(Math.max(current / total, 0), 1);
    const fill = Math.floor(percent * length);
    return '█'.repeat(fill) + '▒'.repeat(length - fill);
}

/**
 * Core logic for profile commands
 */
class ProfileActions {
    
    /**
     * Handle /profile command
     */
    static async handleProfile(bot, msg, user) {
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const profile = await advancedUserProfileService.getUserProfile(user.id);
            if (!profile) {
                return bot.sendMessage(chatId, '❌ មិនអាចទាញយកព័ត៌មានប្រូហ្វាល់បានទេ។ សូមព្យាយាមម្តងទៀត។');
            }

            const message = this.formatProfileMessage(profile);
            
            const keyboard = [
                [
                    { text: '📊 ស្ថិតិរបស់ខ្ញុំ', callback_data: 'profile_mystats' }, // Mapped to mystats
                    { text: '🏆 សមិទ្ធផល', callback_data: 'profile_achievements' }
                ],
                [
                    { text: '⚙️ ការកំណត់', callback_data: 'profile_settings' },
                    { text: '📈 របាយការណ៍', callback_data: 'profile_report' }
                ],
                [
                    { text: '💡 អនុសាសន៍សម្រាប់អ្នក', callback_data: 'profile_recommendations' }
                ]
            ];

            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });

        } catch (error) {
            logger.error('Error in profile handler:', error);
            bot.sendMessage(chatId, '❌ មានបញ្ហាក្នុងការបង្ហាញប្រូហ្វាល់។');
        }
    }

    /**
     * Handle /mystats command
     */
    static async handleMyStats(bot, msg, user) {
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const stats = await advancedUserProfileService.calculateUserStats(user.id);
            if (!stats) {
                return bot.sendMessage(chatId, '❌ មិនមានទិន្នន័យស្ថិតិទេ។');
            }

            const message = this.formatStatsMessage(stats);
            const keyboard = [
                [
                    { text: '📅 សប្តាហ៍នេះ', callback_data: 'stats_week' },
                    { text: '📆 ខែនេះ', callback_data: 'stats_month' }
                ],
                [
                    { text: '🔙 ត្រឡប់ក្រោយ', callback_data: 'back_to_profile' }
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
     * Handle /achievements command
     */
    static async handleAchievements(bot, msg, user) {
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const achievements = await advancedUserProfileService.getUserAchievements(user.id);
            const stats = await advancedUserProfileService.calculateUserStats(user.id);
            
            const message = this.formatAchievementsMessage(achievements, stats);
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { 
                    inline_keyboard: [[{ text: '🔙 ត្រឡប់ក្រោយ', callback_data: 'back_to_profile' }]] 
                }
            });

        } catch (error) {
            logger.error('Error in achievements handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្ហាញសមិទ្ធផល។');
        }
    }

    /**
     * Handle /rank command
     */
    static async handleRank(bot, msg, user) {
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const stats = await advancedUserProfileService.calculateUserStats(user.id);
            const rank = await advancedUserProfileService.getUserRank(user.id, stats);
            
            const message = this.formatRankMessage(rank);
            
            await bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown'
            });

        } catch (error) {
            logger.error('Error in rank handler:', error);
            bot.sendMessage(chatId, '❌ កំហុសក្នុងការបង្ហាញចំណាត់ថ្នាក់។');
        }
    }

    /**
     * Handle /settings command
     */
    static async handleSettings(bot, msg, user) {
        const chatId = msg.chat.id;
        
        try {
            const profile = await advancedUserProfileService.getUserProfile(user.id);
            if (!profile) return bot.sendMessage(chatId, '❌ មិនអាចចូលទៅកាន់ការកំណត់។');

            const message = this.formatSettingsMessage(profile.preferences);
            const keyboard = [
                [
                    { text: '🌐 ភាសា (Language)', callback_data: 'settings_language' },
                    { text: '🔔 ការជូនដំណឹង', callback_data: 'settings_notifications' }
                ],
                [
                    { text: '🔙 ត្រឡប់ក្រោយ', callback_data: 'back_to_profile' }
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
     * Handle /recommendations command
     */
    static async handleRecommendations(bot, msg, user) {
        const chatId = msg.chat.id;
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const recommendations = await advancedUserProfileService.getUserRecommendations(user.id);
            
            if (!recommendations || recommendations.length === 0) {
                return bot.sendMessage(chatId, 'ℹ️ មិនមានអនុសាសន៍នៅពេលនេះទេ។ សូមប្រើប្រាស់ Bot បន្ថែមទៀតដើម្បីទទួលបានការណែនាំ។');
            }

            const message = this.formatRecommendationsMessage(recommendations);
            
            // Generate buttons for recommendations if they have actions
            const keyboard = recommendations.map((rec, index) => [
                { text: `👉 ${index + 1}. មើល ${rec.title}`, callback_data: `rec_${rec.action}_${index}` }
            ]);
            keyboard.push([{ text: '🔙 ត្រឡប់ក្រោយ', callback_data: 'back_to_profile' }]);

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
     * Handle /report command
     */
    static async handleReport(bot, msg, user) {
        const chatId = msg.chat.id;
        const args = (msg.text || '').split(' ');
        const period = args[1] || 'month'; // Default to month
        
        try {
            bot.sendChatAction(chatId, 'typing');
            
            const report = await advancedUserProfileService.generateActivityReport(user.id, period);
            
            if (!report) {
                return bot.sendMessage(chatId, '❌ មិនអាចបង្កើតរបាយការណ៍បានទេ។');
            }

            const message = this.formatReportMessage(report);
            const keyboard = [
                [
                    { text: '📅 សប្តាហ៍', callback_data: 'report_week' },
                    { text: '📆 ខែ', callback_data: 'report_month' },
                    { text: '📊 ឆ្នាំ', callback_data: 'report_year' }
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

    // ================= FORMATTING METHODS =================

    static formatProfileMessage(profile) {
        const bar = getProgressBar(profile.profileCompleteness, 100);
        
        return `👤 **ប្រូហ្វាល់របស់អ្នក (User Profile)**

📛 **ឈ្មោះ:** ${profile.first_name || 'N/A'} ${profile.last_name || ''}
🆔 **ID:** \`${profile.userId}\`
🏅 **កម្រិត (Rank):** ${profile.rank.rankIcon} ${profile.rank.rank}
⭐ **ពិន្ទុ:** ${profile.rank.score} points

📈 **ភាពពេញលេញនៃគណនី:** ${profile.profileCompleteness}%
${bar}

📊 **សកម្មភាពសរុប:**
• 📥 ទាញយក: ${profile.stats.totalDownloads}
• 📤 ផ្ទុកឡើង: ${profile.stats.totalUploads} (${profile.stats.approvedUploads} approved)

🏆 **សមិទ្ធផល:** ${profile.achievements.length} badges
🔥 **Streak:** ${profile.stats.currentDownloadStreak} ថ្ងៃជាប់គ្នា

📅 **ថ្ងៃចូលរួម:** ${new Date(profile.firstSeen).toLocaleDateString()}
⏰ **សកម្មភាពចុងក្រោយ:** ${new Date(profile.lastSeen).toLocaleDateString()}`;
    }

    static formatStatsMessage(stats) {
        return `📊 **ស្ថិតិលម្អិត (Detailed Stats)**

📥 **ការទាញយក (Downloads):**
• សរុប: ${stats.totalDownloads}
• សប្តាហ៍នេះ: ${stats.weeklyDownloads}
• ខែនេះ: ${stats.monthlyDownloads}

📤 **ការផ្ទុកឡើង (Uploads):**
• សរុប: ${stats.totalUploads}
• ✅ អនុម័ត: ${stats.approvedUploads}
• ⏳ រង់ចាំ: ${stats.pendingUploads}
• ❌ បដិសេធ: ${stats.rejectedUploads}
• អត្រាជោគជ័យ: ${stats.approvalRate}%

🔥 **ភាពសកម្ម (Activity Streaks):**
• បច្ចុប្បន្ន: ${stats.currentDownloadStreak} ថ្ងៃ
• យូរបំផុត: ${stats.longestDownloadStreak} ថ្ងៃ

⏰ **ម៉ោងដែលសកម្មបំផុត:** ${stats.mostActiveHours ? stats.mostActiveHours.hour + ':00' : 'N/A'}
`;
    }

    static formatAchievementsMessage(achievements, stats) {
        let message = `🏆 **សមិទ្ធផល និង រង្វាន់ (Achievements)**\n\n`;
        
        if (achievements.length === 0) {
            message += 'ℹ️ អ្នកមិនទាន់មានសមិទ្ធផលទេ។ ចាប់ផ្តើមទាញយកឬផ្ទុកឡើងពុម្ពអក្សរដើម្បីទទួលបាន!\n\n';
        } else {
            achievements.forEach((achievement) => {
                message += `${achievement.icon} **${achievement.name}**\n`;
                message += `└ _${achievement.description}_\n\n`;
            });
        }

        const nextAchievement = advancedUserProfileService.getNextAchievementSuggestion ? advancedUserProfileService.getNextAchievementSuggestion(stats) : null;
        if (nextAchievement) {
            message += `🎯 **គោលដៅបន្ទាប់:**\n`;
            message += `**${nextAchievement.title}**\n`;
            message += `_${nextAchievement.description}_`;
        }

        return message;
    }

    static formatRankMessage(rank) {
        const bar = getProgressBar(rank.percentToNext, 100);
        
        return `🏅 **ចំណាត់ថ្នាក់របស់អ្នក (Rank)**

${rank.rankIcon} **${rank.rank}**
ពិន្ទុបច្ចុប្បន្ន: **${rank.score}**

${rank.nextRank ? `🎯 **គោលដៅបន្ទាប់:** ${rank.nextRank}
ត្រូវការ: **${rank.pointsToNext}** ពិន្ទុបន្ថែម

📈 **ដំណើរការ:**
${bar} ${rank.percentToNext.toFixed(1)}%` : '🎉 **សូមអបអរសាទរ! អ្នកនៅកម្រិតកំពូល។**'}

💡 **របៀបយកពិន្ទុ:**
• ទាញយកពុម្ពអក្សរ
• ផ្ទុកឡើងពុម្ពអក្សរថ្មី
• ប្រើប្រាស់ Bot ជារៀងរាល់ថ្ងៃ`;
    }

    static formatSettingsMessage(preferences) {
        return `⚙️ **ការកំណត់ (Settings)**

🌐 **ភាសា:** ${preferences.language === 'khmer' ? 'ខ្មែរ (Khmer)' : 'English'}

🔔 **ការជូនដំណឹង:**
• ទាញយក: ${preferences.downloadNotifications ? '✅ បើក' : '❌ បិទ'}
• ការអនុម័ត: ${preferences.approvalNotifications ? '✅ បើក' : '❌ បិទ'}

🎨 **រចនាបទ:** ${preferences.darkMode ? '🌙 ងងឹត (Dark)' : '☀️ ភ្លឺ (Light)'}

⏰ **កែប្រែចុងក្រោយ:**
${new Date(preferences.updatedAt).toLocaleString()}`;
    }

    static formatRecommendationsMessage(recommendations) {
        let message = `💡 **អនុសាសន៍សម្រាប់អ្នក (Recommendations)**\n\n`;
        
        recommendations.forEach((rec, index) => {
            message += `${index + 1}. **${rec.title}**\n`;
            message += `   _${rec.description}_\n\n`;
        });

        return message;
    }

    static formatReportMessage(report) {
        return `📈 **របាយការណ៍សកម្មភាព (Activity Report)**
📅 **រយៈពេល:** ${report.period}

📊 **សេចក្តីសង្ខេប:**
• ទាញយកសរុប: ${report.summary.downloads}
• ផ្ទុកឡើងសរុប: ${report.summary.uploads}
• ថ្ងៃសកម្ម: ${report.summary.daysActive} ថ្ងៃ

🏆 **សមិទ្ធផលថ្មី:** ${report.achievements.length}

📂 **ពុម្ពអក្សរដែលអ្នកពេញចិត្ត:**
${report.topFonts.map((font, index) => `${index + 1}. ${font.font} (${font.count} ដង)`).join('\n')}

_បង្កើតនៅ: ${new Date(report.generatedAt).toLocaleString()}_`;
    }
}

/**
 * Main export function to route commands
 */
module.exports = async (bot, msg) => {
    const user = getUserInfo(msg);
    if (!user) return;

    const command = (msg.text || '').split(' ')[0].toLowerCase();

    switch (command) {
        case '/profile':
            return ProfileActions.handleProfile(bot, msg, user);
        case '/mystats':
            return ProfileActions.handleMyStats(bot, msg, user);
        case '/achievements':
            return ProfileActions.handleAchievements(bot, msg, user);
        case '/rank':
            return ProfileActions.handleRank(bot, msg, user);
        case '/settings':
            return ProfileActions.handleSettings(bot, msg, user);
        case '/recommendations':
            return ProfileActions.handleRecommendations(bot, msg, user);
        case '/report':
            return ProfileActions.handleReport(bot, msg, user);
        default:
            // Fallback if needed, or do nothing
            break;
    }
};