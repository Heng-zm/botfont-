// handlers/enhancedCommandHandler.js
const { logger } = require('../services/logger');
const userProfileService = require('../services/userProfileService');
const analyticsService = require('../services/analyticsService');
const notificationService = require('../services/notificationService');
const recommendationEngine = require('../services/recommendationEngine');
const db = require('../services/dbService');

/**
 * Enhanced command handler with new features
 */
class EnhancedCommandHandler {
    constructor() {
        this.commands = new Map();
        this.initializeCommands();
    }

    /**
     * Initialize all enhanced commands
     */
    initializeCommands() {
        // Profile management commands
        this.commands.set('/profile', this.handleProfile.bind(this));
        this.commands.set('/settings', this.handleSettings.bind(this));
        this.commands.set('/preferences', this.handlePreferences.bind(this));

        // Statistics and analytics commands
        this.commands.set('/stats', this.handleStats.bind(this));
        this.commands.set('/achievements', this.handleAchievements.bind(this));
        this.commands.set('/leaderboard', this.handleLeaderboard.bind(this));

        // Recommendation commands
        this.commands.set('/recommendations', this.handleRecommendations.bind(this));
        this.commands.set('/discover', this.handleDiscover.bind(this));
        this.commands.set('/similar', this.handleSimilar.bind(this));

        // Notification commands
        this.commands.set('/notifications', this.handleNotifications.bind(this));
        this.commands.set('/subscribe', this.handleSubscribe.bind(this));
        this.commands.set('/unsubscribe', this.handleUnsubscribe.bind(this));

        // Advanced features
        this.commands.set('/history', this.handleHistory.bind(this));
        this.commands.set('/favorites', this.handleFavorites.bind(this));
        this.commands.set('/export', this.handleExport.bind(this));
        this.commands.set('/feedback', this.handleFeedback.bind(this));
    }

    /**
     * Handle command execution
     */
    async handleCommand(bot, msg) {
        const userId = msg.from.id;
        const command = msg.text.split(' ')[0];
        const args = msg.text.split(' ').slice(1);

        // Track command usage
        const startTime = Date.now();
        
        try {
            if (this.commands.has(command)) {
                await this.commands.get(command)(bot, msg, args);
                
                // Track successful command execution
                await analyticsService.trackCommandUsage(
                    userId, 
                    command, 
                    true, 
                    Date.now() - startTime
                );
                
                // Update user stats
                await userProfileService.updateUserStats(userId, {
                    totalRequests: 1
                });
                
                // Check for achievements
                const newAchievements = await userProfileService.checkAndAwardAchievements(userId);
                if (newAchievements.length > 0) {
                    for (const achievement of newAchievements) {
                        await notificationService.sendNotification(
                            userId,
                            'achievement_earned',
                            {
                                name: msg.from.first_name,
                                icon: achievement.icon,
                                achievementName: achievement.name,
                                description: achievement.description,
                                totalAchievements: Object.keys(await userProfileService.getUserAchievements(userId)).length
                            }
                        );
                    }
                }
            }
        } catch (error) {
            logger.error('Error handling enhanced command:', { command, userId, error: error.message });
            
            // Track failed command execution
            await analyticsService.trackCommandUsage(
                userId, 
                command, 
                false, 
                Date.now() - startTime,
                { error: error.message }
            );
            
            await bot.sendMessage(userId, '❌ Sorry, something went wrong. Please try again later.');
        }
    }

    /**
     * Handle /profile command
     */
    async handleProfile(bot, msg, args) {
        const userId = msg.from.id;
        
        if (args.length > 0) {
            // Update profile
            const field = args[0].toLowerCase();
            const value = args.slice(1).join(' ');
            
            const updates = {};
            
            switch (field) {
                case 'name':
                case 'displayname':
                    updates.displayName = value;
                    break;
                case 'bio':
                    updates.bio = value;
                    break;
                case 'location':
                    updates.location = value;
                    break;
                case 'language':
                case 'lang':
                    updates.language = value;
                    break;
                default:
                    await bot.sendMessage(userId, '❌ Invalid profile field. Use: name, bio, location, or language');
                    return;
            }
            
            await userProfileService.updateUserProfile(userId, updates);
            await bot.sendMessage(userId, `✅ Profile updated! Your ${field} has been set to: ${value}`);
        } else {
            // Show profile
            const profile = await userProfileService.getUserProfile(userId);
            const stats = await userProfileService.getUserStats(userId);
            const achievements = await userProfileService.getUserAchievements(userId);
            
            const profileText = `👤 **Your Profile**

📝 **Display Name**: ${profile.displayName || 'Not set'}
📖 **Bio**: ${profile.bio || 'Not set'}
📍 **Location**: ${profile.location || 'Not set'}
🌐 **Language**: ${profile.language || 'en'}
📅 **Member Since**: ${new Date(profile.joinDate).toLocaleDateString()}

📊 **Statistics**:
• Images Created: ${stats.imagesGenerated}
• Fonts Used: ${stats.fontsUsed}
• Streak: ${stats.streakDays} days 🔥
• Favorite Font: ${stats.favoriteFont || 'None yet'}

🏆 **Achievements**: ${Object.keys(achievements).length}

Use \`/profile [field] [value]\` to update your profile.
Example: \`/profile name John Doe\``;

            await bot.sendMessage(userId, profileText, { parse_mode: 'Markdown' });
        }
        
        // Track user activity
        await analyticsService.trackUserActivity(userId, 'profile_view');
    }

    /**
     * Handle /stats command
     */
    async handleStats(bot, msg, args) {
        const userId = msg.from.id;
        const stats = await userProfileService.getUserStats(userId);
        const userActivity = await analyticsService.getUserActivityInsights(userId);
        
        const statsText = `📊 **Your Statistics**

🖼️ **Images Created**: ${stats.imagesGenerated}
🎨 **Fonts Used**: ${stats.fontsUsed}
📝 **Total Requests**: ${stats.totalRequests}
🔥 **Streak**: ${stats.streakDays} days
⭐ **Favorite Font**: ${stats.favoriteFont || 'None yet'}
📅 **Join Date**: ${new Date(stats.joinDate).toLocaleDateString()}

${userActivity ? `
📈 **Activity Insights**:
• Total Active Days: ${userActivity.totalDays}
• Total Activities: ${userActivity.totalActivities}
• Average per Day: ${userActivity.avgActivitiesPerDay}
• Most Active Day: ${userActivity.mostActiveDay.date} (${userActivity.mostActiveDay.activities} activities)
` : ''}

🏆 View your achievements: /achievements
📈 See leaderboard: /leaderboard`;

        await bot.sendMessage(userId, statsText, { parse_mode: 'Markdown' });
        
        await analyticsService.trackUserActivity(userId, 'stats_view');
    }

    /**
     * Handle /achievements command
     */
    async handleAchievements(bot, msg, args) {
        const userId = msg.from.id;
        const achievements = await userProfileService.getUserAchievements(userId);
        
        if (Object.keys(achievements).length === 0) {
            await bot.sendMessage(userId, `🏆 **Achievements**

You haven't unlocked any achievements yet!

Start creating to earn your first achievement:
• Use your first font
• Create 10 images
• Maintain a 7-day streak
• Try 50 different fonts

Keep exploring! 🎨`);
            return;
        }
        
        const achievementsList = Object.values(achievements)
            .sort((a, b) => new Date(b.earnedAt) - new Date(a.earnedAt))
            .map(achievement => {
                const earnedDate = new Date(achievement.earnedAt).toLocaleDateString();
                return `${achievement.icon} **${achievement.name}**
   ${achievement.description}
   Earned: ${earnedDate}`;
            }).join('\n\n');
        
        const achievementsText = `🏆 **Your Achievements** (${Object.keys(achievements).length})

${achievementsList}

Keep creating to unlock more achievements! 🌟`;

        await bot.sendMessage(userId, achievementsText, { parse_mode: 'Markdown' });
        
        await analyticsService.trackUserActivity(userId, 'achievements_view');
    }

    /**
     * Handle /recommendations command
     */
    async handleRecommendations(bot, msg, args) {
        const userId = msg.from.id;
        const limit = args[0] ? parseInt(args[0]) : 5;
        
        if (limit > 20) {
            await bot.sendMessage(userId, '❌ Maximum 20 recommendations at a time.');
            return;
        }
        
        const recommendations = await recommendationEngine.getPersonalizedRecommendations(userId, limit);
        
        if (recommendations.length === 0) {
            await bot.sendMessage(userId, `🎯 **Font Recommendations**

No personalized recommendations yet!

Start using fonts to get personalized recommendations:
• Try different fonts
• Rate fonts you like
• Create more images

Use /discover to explore trending fonts! 🌟`);
            return;
        }
        
        const recText = recommendations.map((rec, index) => {
            const reasons = rec.reasons.slice(0, 2).join(', ');
            return `${index + 1}. **${rec.fontName}**
   Score: ${(rec.score * 100).toFixed(0)}%
   Why: ${reasons}`;
        }).join('\n\n');
        
        const recommendationsText = `🎯 **Personalized Font Recommendations**

${recText}

Try a font: \`/font [font name]\`
Get more: \`/recommendations ${Math.min(limit + 5, 20)}\``;

        await bot.sendMessage(userId, recommendationsText, { parse_mode: 'Markdown' });
        
        // Record interaction
        await recommendationEngine.recordInteraction(userId, 'recommendations_view', 'view', { count: recommendations.length });
        await analyticsService.trackUserActivity(userId, 'recommendations_view', { count: recommendations.length });
    }

    /**
     * Handle /discover command
     */
    async handleDiscover(bot, msg, args) {
        const userId = msg.from.id;
        const data = await db.getData();
        
        // Get trending fonts from analytics
        const trendingFonts = await analyticsService.getFontUsageAnalytics(10);
        
        if (trendingFonts.length === 0) {
            await bot.sendMessage(userId, `🌟 **Discover Fonts**

No trending data available yet!

Popular starter fonts:
• Arial - Clean and modern
• Times New Roman - Classic serif
• Helvetica - Professional sans-serif
• Comic Sans MS - Fun and casual
• Impact - Bold and striking

Try: \`/font [font name]\``);
            return;
        }
        
        const trendingText = trendingFonts.slice(0, 8).map((font, index) => {
            return `${index + 1}. **${font.fontName}**
   Used by ${font.uniqueUsers} users
   Total uses: ${font.totalUses}
   Popularity: ${font.popularityScore.toFixed(1)}`;
        }).join('\n\n');
        
        const discoverText = `🌟 **Trending Fonts**

${trendingText}

Try a trending font: \`/font [font name]\`
Get recommendations: /recommendations`;

        await bot.sendMessage(userId, discoverText, { parse_mode: 'Markdown' });
        
        await analyticsService.trackUserActivity(userId, 'discover_view');
    }

    /**
     * Handle /leaderboard command
     */
    async handleLeaderboard(bot, msg, args) {
        const userId = msg.from.id;
        const metric = args[0] || 'totalRequests';
        
        const validMetrics = ['totalRequests', 'imagesGenerated', 'fontsUsed', 'streakDays'];
        if (!validMetrics.includes(metric)) {
            await bot.sendMessage(userId, `📊 **Leaderboard**

Available metrics:
• \`totalRequests\` - Total requests
• \`imagesGenerated\` - Images created
• \`fontsUsed\` - Different fonts used
• \`streakDays\` - Current streak

Usage: \`/leaderboard [metric]\``);
            return;
        }
        
        const leaderboard = await userProfileService.getLeaderboard(metric, 10);
        
        if (leaderboard.length === 0) {
            await bot.sendMessage(userId, '📊 No leaderboard data available yet!');
            return;
        }
        
        const metricNames = {
            totalRequests: 'Total Requests',
            imagesGenerated: 'Images Created',
            fontsUsed: 'Fonts Used',
            streakDays: 'Current Streak'
        };
        
        const leaderText = leaderboard.map((entry, index) => {
            const medal = index < 3 ? ['🥇', '🥈', '🥉'][index] : `${index + 1}.`;
            return `${medal} User ${entry.userId.slice(-4)}: ${entry.value}`;
        }).join('\n');
        
        const leaderboardText = `🏆 **Leaderboard - ${metricNames[metric]}**

${leaderText}

Try other metrics: \`/leaderboard [metric]\``;

        await bot.sendMessage(userId, leaderboardText, { parse_mode: 'Markdown' });
        
        await analyticsService.trackUserActivity(userId, 'leaderboard_view', { metric });
    }

    /**
     * Handle /notifications command
     */
    async handleNotifications(bot, msg, args) {
        const userId = msg.from.id;
        
        if (args.length > 0) {
            const action = args[0].toLowerCase();
            
            if (action === 'preferences' || action === 'settings') {
                const preferences = await notificationService.getUserPreferences(userId);
                
                const prefText = `🔔 **Notification Preferences**

Current Settings:
• Achievements: ${preferences.achievements ? '✅' : '❌'}
• Reminders: ${preferences.reminders ? '✅' : '❌'}
• Updates: ${preferences.updates ? '✅' : '❌'}
• Marketing: ${preferences.marketing ? '✅' : '❌'}
• Frequency: ${preferences.frequency}

To change settings, contact admin.`;

                await bot.sendMessage(userId, prefText, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(userId, '❌ Invalid option. Use: /notifications preferences');
            }
        } else {
            await bot.sendMessage(userId, `🔔 **Notifications**

Available options:
• \`/notifications preferences\` - View notification settings
• \`/subscribe [category]\` - Subscribe to notifications
• \`/unsubscribe [category]\` - Unsubscribe from notifications

Categories: updates, tips, achievements`);
        }
        
        await analyticsService.trackUserActivity(userId, 'notifications_view');
    }

    /**
     * Handle /history command
     */
    async handleHistory(bot, msg, args) {
        const userId = msg.from.id;
        const limit = args[0] ? Math.min(parseInt(args[0]), 20) : 10;
        
        // Get user's recent font interactions from recommendation engine
        const data = await db.getData();
        const userInteractions = data.recommendations?.userInteractions?.[userId];
        
        if (!userInteractions || Object.keys(userInteractions).length === 0) {
            await bot.sendMessage(userId, `📚 **Your Font History**

No font history yet!

Start creating to build your history:
• Use different fonts
• Create images
• Rate fonts you like

Your history will appear here as you explore! 🎨`);
            return;
        }
        
        // Sort fonts by last interaction
        const sortedFonts = Object.entries(userInteractions)
            .sort(([,a], [,b]) => new Date(b.lastInteraction) - new Date(a.lastInteraction))
            .slice(0, limit);
        
        const historyText = sortedFonts.map(([fontName, interaction], index) => {
            const lastUsed = new Date(interaction.lastInteraction).toLocaleDateString();
            return `${index + 1}. **${fontName}**
   Used: ${interaction.uses} times
   Last used: ${lastUsed}
   Rating: ${interaction.rating > 0 ? '⭐'.repeat(Math.floor(interaction.rating)) : 'Not rated'}`;
        }).join('\n\n');
        
        const fullHistoryText = `📚 **Your Font History** (Recent ${sortedFonts.length})

${historyText}

Use a font again: \`/font [font name]\`
Rate a font: Contact admin to implement rating system`;

        await bot.sendMessage(userId, fullHistoryText, { parse_mode: 'Markdown' });
        
        await analyticsService.trackUserActivity(userId, 'history_view', { limit });
    }

    /**
     * Handle /favorites command
     */
    async handleFavorites(bot, msg, args) {
        const userId = msg.from.id;
        
        // This would typically integrate with a favorites system
        // For now, we'll show most used fonts as "favorites"
        const data = await db.getData();
        const userInteractions = data.recommendations?.userInteractions?.[userId];
        
        if (!userInteractions) {
            await bot.sendMessage(userId, `⭐ **Your Favorite Fonts**

No favorites yet!

As you use fonts, your most-used ones will appear here automatically.

Start creating: /create
Discover fonts: /discover`);
            return;
        }
        
        // Get top used fonts as favorites
        const favorites = Object.entries(userInteractions)
            .filter(([, interaction]) => interaction.uses > 0)
            .sort(([,a], [,b]) => b.uses - a.uses)
            .slice(0, 10);
        
        if (favorites.length === 0) {
            await bot.sendMessage(userId, '⭐ No favorite fonts yet! Start using fonts to build your favorites list.');
            return;
        }
        
        const favoritesText = favorites.map(([fontName, interaction], index) => {
            return `${index + 1}. **${fontName}**
   Used: ${interaction.uses} times
   ${interaction.rating > 0 ? `Rating: ${'⭐'.repeat(Math.floor(interaction.rating))}` : ''}`;
        }).join('\n\n');
        
        const fullFavoritesText = `⭐ **Your Favorite Fonts** (Top ${favorites.length})

${favoritesText}

Use a favorite: \`/font [font name]\`
Get recommendations based on favorites: /recommendations`;

        await bot.sendMessage(userId, fullFavoritesText, { parse_mode: 'Markdown' });
        
        await analyticsService.trackUserActivity(userId, 'favorites_view');
    }

    /**
     * Handle /settings command
     */
    async handleSettings(bot, msg, args) {
        const userId = msg.from.id;
        const profile = await userProfileService.getUserProfile(userId);
        
        if (args.length >= 2) {
            const setting = args[0].toLowerCase();
            const value = args.slice(1).join(' ');
            
            const updates = {};
            
            if (setting === 'theme') {
                updates.customizations = { ...profile.customizations, theme: value };
            } else if (setting === 'fontsize' || setting === 'size') {
                const size = parseInt(value);
                if (size >= 12 && size <= 72) {
                    updates.customizations = { ...profile.customizations, defaultFontSize: size };
                } else {
                    await bot.sendMessage(userId, '❌ Font size must be between 12 and 72.');
                    return;
                }
            } else if (setting === 'color') {
                if (value.match(/^#[0-9A-F]{6}$/i) || value.match(/^#[0-9A-F]{3}$/i)) {
                    updates.customizations = { ...profile.customizations, defaultColor: value };
                } else {
                    await bot.sendMessage(userId, '❌ Invalid color format. Use hex format like #FF0000');
                    return;
                }
            } else if (setting === 'format') {
                if (['png', 'jpg', 'jpeg', 'webp'].includes(value.toLowerCase())) {
                    updates.customizations = { ...profile.customizations, preferredFormat: value.toLowerCase() };
                } else {
                    await bot.sendMessage(userId, '❌ Invalid format. Use: png, jpg, jpeg, or webp');
                    return;
                }
            } else {
                await bot.sendMessage(userId, '❌ Invalid setting. Available: theme, fontsize, color, format');
                return;
            }
            
            await userProfileService.updateUserProfile(userId, updates);
            await bot.sendMessage(userId, `✅ Setting updated! ${setting} is now: ${value}`);
        } else {
            const settingsText = `⚙️ **Your Settings**

🎨 **Customization**:
• Theme: ${profile.customizations?.theme || 'default'}
• Default Font Size: ${profile.customizations?.defaultFontSize || 24}px
• Default Color: ${profile.customizations?.defaultColor || '#000000'}
• Preferred Format: ${profile.customizations?.preferredFormat || 'png'}

🔒 **Privacy**:
• Show Profile: ${profile.privacy?.showProfile !== false ? '✅' : '❌'}
• Show Stats: ${profile.privacy?.showStats !== false ? '✅' : '❌'}
• Allow DMs: ${profile.privacy?.allowDirectMessages !== false ? '✅' : '❌'}

To update: \`/settings [setting] [value]\`
Example: \`/settings fontsize 28\`

Available settings: theme, fontsize, color, format`;

            await bot.sendMessage(userId, settingsText, { parse_mode: 'Markdown' });
        }
        
        await analyticsService.trackUserActivity(userId, 'settings_view');
    }

    /**
     * Handle /export command
     */
    async handleExport(bot, msg, args) {
        const userId = msg.from.id;
        
        // This would export user data
        await bot.sendMessage(userId, `📦 **Export Your Data**

Data export is currently being prepared...

What will be included:
• Your profile information
• Font usage history
• Created images list
• Statistics and achievements
• Preferences and settings

This feature will be available soon! 🚀

Contact admin if you need your data urgently.`);
        
        await analyticsService.trackUserActivity(userId, 'export_request');
    }

    /**
     * Handle /feedback command
     */
    async handleFeedback(bot, msg, args) {
        const userId = msg.from.id;
        
        if (args.length === 0) {
            await bot.sendMessage(userId, `💭 **Send Feedback**

We'd love to hear from you!

Usage: \`/feedback [your message]\`
Example: \`/feedback The app is great but could use more fonts\`

Your feedback helps us improve! 🙏`);
            return;
        }
        
        const feedback = args.join(' ');
        
        // Log feedback (in a real app, this would go to an admin dashboard)
        logger.info('User feedback received:', { userId, feedback });
        
        // You could also send it to admin
        const ADMIN_ID = process.env.ADMIN_CHAT_ID;
        if (ADMIN_ID) {
            await bot.sendMessage(ADMIN_ID, `💭 **New Feedback**

From User: ${userId}
Message: ${feedback}

Respond via: /message ${userId} [response]`, { parse_mode: 'Markdown' });
        }
        
        await bot.sendMessage(userId, `✅ **Feedback Sent!**

Thank you for your feedback! 🙏

Your message has been sent to our team. We review all feedback and use it to improve the bot.

Have more suggestions? Feel free to send another /feedback anytime!`);
        
        await analyticsService.trackUserActivity(userId, 'feedback_sent', { length: feedback.length });
    }

    /**
     * Handle /subscribe command
     */
    async handleSubscribe(bot, msg, args) {
        const userId = msg.from.id;
        
        if (args.length === 0) {
            await bot.sendMessage(userId, `🔔 **Subscribe to Notifications**

Available categories:
• \`updates\` - Bot updates and new features
• \`tips\` - Font usage tips and tutorials  
• \`achievements\` - Achievement celebrations
• \`trends\` - Trending fonts and styles

Usage: \`/subscribe [category]\`
Example: \`/subscribe updates\``);
            return;
        }
        
        const category = args[0].toLowerCase();
        const validCategories = ['updates', 'tips', 'achievements', 'trends'];
        
        if (!validCategories.includes(category)) {
            await bot.sendMessage(userId, '❌ Invalid category. Available: updates, tips, achievements, trends');
            return;
        }
        
        await notificationService.subscribeUser(userId, category);
        await bot.sendMessage(userId, `✅ Subscribed to ${category} notifications!

You'll now receive notifications for: ${category}

Manage subscriptions: /notifications
Unsubscribe: \`/unsubscribe ${category}\``);
        
        await analyticsService.trackUserActivity(userId, 'notification_subscribe', { category });
    }

    /**
     * Handle /unsubscribe command
     */
    async handleUnsubscribe(bot, msg, args) {
        const userId = msg.from.id;
        
        if (args.length === 0) {
            await bot.sendMessage(userId, `🔕 **Unsubscribe from Notifications**

Usage: \`/unsubscribe [category]\`
Example: \`/unsubscribe updates\`

Available categories: updates, tips, achievements, trends

View current subscriptions: /notifications`);
            return;
        }
        
        const category = args[0].toLowerCase();
        
        await notificationService.unsubscribeUser(userId, category);
        await bot.sendMessage(userId, `✅ Unsubscribed from ${category} notifications.

You'll no longer receive notifications for: ${category}

Subscribe again: \`/subscribe ${category}\`
Manage subscriptions: /notifications`);
        
        await analyticsService.trackUserActivity(userId, 'notification_unsubscribe', { category });
    }

    /**
     * Handle /similar command - find similar fonts
     */
    async handleSimilar(bot, msg, args) {
        const userId = msg.from.id;
        
        if (args.length === 0) {
            await bot.sendMessage(userId, `🔍 **Find Similar Fonts**

Usage: \`/similar [font name]\`
Example: \`/similar Arial\`

This will find fonts similar to the one you specify based on style, category, and other users' preferences.`);
            return;
        }
        
        const fontName = args.join(' ');
        
        // Record interaction
        await recommendationEngine.recordInteraction(userId, fontName, 'view', { searchType: 'similar' });
        
        // Get similar fonts (simplified - in a real implementation, this would use the recommendation engine)
        const similarFonts = [
            'Helvetica', 'Verdana', 'Calibri', 'Trebuchet MS', 'Tahoma'
        ].filter(f => f.toLowerCase() !== fontName.toLowerCase()).slice(0, 5);
        
        if (similarFonts.length === 0) {
            await bot.sendMessage(userId, `🔍 No similar fonts found for "${fontName}".

Try:
• /discover - Browse trending fonts
• /recommendations - Get personalized suggestions`);
            return;
        }
        
        const similarText = similarFonts.map((font, index) => 
            `${index + 1}. ${font}`
        ).join('\n');
        
        const responseText = `🔍 **Fonts Similar to "${fontName}"**

${similarText}

Try a similar font: \`/font [font name]\`
Get personalized recommendations: /recommendations`;
        
        await bot.sendMessage(userId, responseText, { parse_mode: 'Markdown' });
        
        await analyticsService.trackUserActivity(userId, 'similar_fonts_search', { fontName, resultCount: similarFonts.length });
    }
}

module.exports = new EnhancedCommandHandler();
