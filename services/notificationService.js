// services/notificationService.js
const { logger } = require('./logger');
const db = require('./dbService');
const schedule = require('node-schedule');

class NotificationService {
    constructor() {
        this.scheduledNotifications = new Map();
        this.templates = new Map();
        this.deliveryChannels = new Map();
        this.initializeTemplates();
    }

    /**
     * Initialize notification service
     */
    async init() {
        try {
            await this.setupNotificationTables();
            await this.loadScheduledNotifications();
            await this.registerDeliveryChannels();
            logger.info('Notification Service initialized');
        } catch (error) {
            logger.error('Error initializing Notification Service:', error);
        }
    }

    /**
     * Set up database tables for notifications
     */
    async setupNotificationTables() {
        // Ensure database functions are available
        if (typeof db.getData !== 'function' || typeof db.saveData !== 'function') {
            throw new Error('Database service not properly initialized');
        }
        
        const data = await db.getData();
        
        if (!data.notifications) {
            data.notifications = {
                templates: {},
                scheduled: {},
                sent: {},
                preferences: {},
                subscriptions: {},
                campaigns: {}
            };
        }

        await db.saveData(data);
    }

    /**
     * Initialize default notification templates
     */
    initializeTemplates() {
        this.templates.set('welcome', {
            id: 'welcome',
            name: 'Welcome Message',
            subject: '🎉 Welcome to Font Bot!',
            content: `Hello {{name}}!

Welcome to Font Bot! 🎨 I'm here to help you create beautiful text images with amazing fonts.

Here's what you can do:
• Browse hundreds of fonts
• Create custom text images
• Save your favorite fonts
• Get font recommendations
• Track your usage stats

Type /help to get started or /fonts to see available fonts.

Happy creating! ✨`,
            variables: ['name'],
            channels: ['telegram', 'queue']
        });

        this.templates.set('achievement_earned', {
            id: 'achievement_earned',
            name: 'Achievement Earned',
            subject: '🏆 New Achievement Unlocked!',
            content: `Congratulations {{name}}! 

You've unlocked a new achievement:
{{icon}} **{{achievementName}}**
{{description}}

Keep up the great work! 🌟

Your achievements: {{totalAchievements}}
View all: /achievements`,
            variables: ['name', 'icon', 'achievementName', 'description', 'totalAchievements'],
            channels: ['telegram', 'queue']
        });

        this.templates.set('font_of_the_day', {
            id: 'font_of_the_day',
            name: 'Font of the Day',
            subject: '✨ Today\'s Featured Font',
            content: `🎨 **Font of the Day**: {{fontName}}

{{fontDescription}}

Why we love it:
{{reasons}}

Try it now: /font {{fontName}}

Happy designing! 🌟`,
            variables: ['fontName', 'fontDescription', 'reasons'],
            channels: ['telegram', 'broadcast']
        });

        this.templates.set('reminder_daily', {
            id: 'reminder_daily',
            name: 'Daily Usage Reminder',
            subject: '📝 Don\'t forget to create today!',
            content: `Hi {{name}}! 👋

It's been a while since you last created something beautiful. Why not try:

• A motivational quote with your favorite font
• Your name in a fancy style
• Today's date in an elegant script

Your streak: {{streak}} days 🔥
Let's keep it going!

Quick start: /create`,
            variables: ['name', 'streak'],
            channels: ['telegram']
        });

        this.templates.set('system_maintenance', {
            id: 'system_maintenance',
            name: 'System Maintenance',
            subject: '⚙️ Scheduled Maintenance Notice',
            content: `📢 **Maintenance Notice**

We'll be performing scheduled maintenance:
🕐 **When**: {{maintenanceDate}} at {{maintenanceTime}}
⏱️ **Duration**: Approximately {{duration}}
🔧 **What**: {{maintenanceDescription}}

During this time, the bot may be temporarily unavailable.

Thank you for your patience! 🙏`,
            variables: ['maintenanceDate', 'maintenanceTime', 'duration', 'maintenanceDescription'],
            channels: ['telegram', 'broadcast']
        });

        this.templates.set('weekly_summary', {
            id: 'weekly_summary',
            name: 'Weekly Activity Summary',
            subject: '📊 Your Weekly Summary',
            content: `🗓️ **Your Week in Review**

Here's what you accomplished this week:

📊 **Stats**:
• Images created: {{imagesCreated}}
• Fonts tried: {{fontsUsed}}
• Favorite font: {{favoriteFont}}
• Active days: {{activeDays}}/7

🏆 **Highlights**:
{{highlights}}

🎯 **Next week's goal**: Try {{nextWeekGoal}}

Keep creating! 🎨`,
            variables: ['imagesCreated', 'fontsUsed', 'favoriteFont', 'activeDays', 'highlights', 'nextWeekGoal'],
            channels: ['telegram']
        });
    }

    /**
     * Register delivery channels
     */
    async registerDeliveryChannels() {
        // Telegram channel
        this.deliveryChannels.set('telegram', {
            name: 'Telegram Direct',
            handler: async (userId, notification) => {
                return await db.addMessageToQueue(userId, notification.content);
            }
        });

        // Queue channel (for batch processing)
        this.deliveryChannels.set('queue', {
            name: 'Message Queue',
            handler: async (userId, notification) => {
                return await db.addMessageToQueue(userId, notification.content);
            }
        });

        // Broadcast channel
        this.deliveryChannels.set('broadcast', {
            name: 'Broadcast',
            handler: async (userId, notification) => {
                return await db.addBroadcastToQueue(notification.content);
            }
        });
    }

    /**
     * Create notification template
     */
    async createTemplate(templateData) {
        try {
            const template = {
                id: templateData.id,
                name: templateData.name,
                subject: templateData.subject,
                content: templateData.content,
                variables: templateData.variables || [],
                channels: templateData.channels || ['telegram'],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            const data = await db.getData();
            data.notifications.templates[template.id] = template;
            await db.saveData(data);

            this.templates.set(template.id, template);
            
            logger.info('Notification template created:', { templateId: template.id });
            return template;
        } catch (error) {
            logger.error('Error creating notification template:', error);
            throw error;
        }
    }

    /**
     * Send immediate notification
     */
    async sendNotification(userId, templateId, variables = {}, channels = null) {
        try {
            const template = this.templates.get(templateId);
            if (!template) {
                throw new Error(`Template not found: ${templateId}`);
            }

            const notification = await this.renderTemplate(template, variables);
            const targetChannels = channels || template.channels;
            
            const results = [];
            for (const channel of targetChannels) {
                const channelHandler = this.deliveryChannels.get(channel);
                if (channelHandler) {
                    try {
                        const result = await channelHandler.handler(userId, notification);
                        results.push({ channel, success: true, result });
                    } catch (error) {
                        results.push({ channel, success: false, error: error.message });
                        logger.error(`Failed to send notification via ${channel}:`, error);
                    }
                } else {
                    results.push({ channel, success: false, error: 'Channel not found' });
                }
            }

            // Log the sent notification
            await this.logSentNotification(userId, templateId, notification, results);

            return results;
        } catch (error) {
            logger.error('Error sending notification:', error);
            throw error;
        }
    }

    /**
     * Schedule notification
     */
    async scheduleNotification(userId, templateId, variables, cronExpression, options = {}) {
        try {
            const notificationId = `${userId}_${templateId}_${Date.now()}`;
            
            const scheduledNotification = {
                id: notificationId,
                userId,
                templateId,
                variables,
                cronExpression,
                channels: options.channels,
                enabled: options.enabled !== false,
                createdAt: new Date().toISOString(),
                lastSent: null,
                nextRun: null
            };

            // Save to database
            const data = await db.getData();
            data.notifications.scheduled[notificationId] = scheduledNotification;
            await db.saveData(data);

            // Schedule with node-schedule
            const job = schedule.scheduleJob(notificationId, cronExpression, async () => {
                await this.executeScheduledNotification(notificationId);
            });

            if (job) {
                scheduledNotification.nextRun = job.nextInvocation().toISOString();
                this.scheduledNotifications.set(notificationId, {
                    ...scheduledNotification,
                    job
                });

                // Update next run in database
                data.notifications.scheduled[notificationId] = scheduledNotification;
                await db.saveData(data);

                logger.info('Notification scheduled:', { notificationId, cronExpression });
                return scheduledNotification;
            } else {
                throw new Error('Failed to schedule notification');
            }
        } catch (error) {
            logger.error('Error scheduling notification:', error);
            throw error;
        }
    }

    /**
     * Execute scheduled notification
     */
    async executeScheduledNotification(notificationId) {
        try {
            const scheduledNotification = this.scheduledNotifications.get(notificationId);
            if (!scheduledNotification || !scheduledNotification.enabled) {
                return;
            }

            const result = await this.sendNotification(
                scheduledNotification.userId,
                scheduledNotification.templateId,
                scheduledNotification.variables,
                scheduledNotification.channels
            );

            // Update last sent time
            const data = await db.getData();
            if (data.notifications.scheduled[notificationId]) {
                data.notifications.scheduled[notificationId].lastSent = new Date().toISOString();
                data.notifications.scheduled[notificationId].nextRun = 
                    scheduledNotification.job.nextInvocation()?.toISOString() || null;
                await db.saveData(data);
            }

            logger.debug('Scheduled notification executed:', { notificationId, result });
        } catch (error) {
            logger.error('Error executing scheduled notification:', error);
        }
    }

    /**
     * Cancel scheduled notification
     */
    async cancelScheduledNotification(notificationId) {
        try {
            const scheduledNotification = this.scheduledNotifications.get(notificationId);
            if (scheduledNotification && scheduledNotification.job) {
                scheduledNotification.job.cancel();
            }

            this.scheduledNotifications.delete(notificationId);

            // Remove from database
            const data = await db.getData();
            delete data.notifications.scheduled[notificationId];
            await db.saveData(data);

            logger.info('Scheduled notification cancelled:', { notificationId });
            return true;
        } catch (error) {
            logger.error('Error cancelling scheduled notification:', error);
            return false;
        }
    }

    /**
     * Load scheduled notifications from database
     */
    async loadScheduledNotifications() {
        try {
            const data = await db.getData();
            const scheduledNotifications = data.notifications.scheduled || {};

            for (const [notificationId, notification] of Object.entries(scheduledNotifications)) {
                if (notification.enabled) {
                    const job = schedule.scheduleJob(notificationId, notification.cronExpression, async () => {
                        await this.executeScheduledNotification(notificationId);
                    });

                    if (job) {
                        this.scheduledNotifications.set(notificationId, {
                            ...notification,
                            job
                        });

                        // Update next run time
                        notification.nextRun = job.nextInvocation()?.toISOString() || null;
                    }
                }
            }

            if (Object.keys(scheduledNotifications).length > 0) {
                await db.saveData(data);
            }

            logger.info(`Loaded ${this.scheduledNotifications.size} scheduled notifications`);
        } catch (error) {
            logger.error('Error loading scheduled notifications:', error);
        }
    }

    /**
     * Render notification template with variables
     */
    async renderTemplate(template, variables = {}) {
        let content = template.content;
        let subject = template.subject;

        // Replace variables in content and subject
        for (const [key, value] of Object.entries(variables)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            content = content.replace(regex, value);
            subject = subject.replace(regex, value);
        }

        return {
            id: template.id,
            subject,
            content,
            renderedAt: new Date().toISOString()
        };
    }

    /**
     * Log sent notification
     */
    async logSentNotification(userId, templateId, notification, results) {
        try {
            const data = await db.getData();
            const logEntry = {
                userId,
                templateId,
                notification,
                results,
                sentAt: new Date().toISOString()
            };

            const dateKey = new Date().toISOString().split('T')[0];
            if (!data.notifications.sent[dateKey]) {
                data.notifications.sent[dateKey] = [];
            }

            data.notifications.sent[dateKey].push(logEntry);
            await db.saveData(data);
        } catch (error) {
            logger.error('Error logging sent notification:', error);
        }
    }

    /**
     * Set user notification preferences
     */
    async setUserPreferences(userId, preferences) {
        try {
            const data = await db.getData();
            
            const userPreferences = {
                ...preferences,
                userId,
                updatedAt: new Date().toISOString()
            };

            data.notifications.preferences[userId] = userPreferences;
            await db.saveData(data);

            logger.debug('User notification preferences updated:', { userId });
            return userPreferences;
        } catch (error) {
            logger.error('Error setting user notification preferences:', error);
            throw error;
        }
    }

    /**
     * Get user notification preferences
     */
    async getUserPreferences(userId) {
        try {
            const data = await db.getData();
            return data.notifications.preferences[userId] || {
                achievements: true,
                reminders: true,
                updates: true,
                marketing: false,
                frequency: 'daily'
            };
        } catch (error) {
            logger.error('Error getting user notification preferences:', error);
            return {};
        }
    }

    /**
     * Subscribe user to notification category
     */
    async subscribeUser(userId, category) {
        try {
            const data = await db.getData();
            
            if (!data.notifications.subscriptions[category]) {
                data.notifications.subscriptions[category] = [];
            }

            if (!data.notifications.subscriptions[category].includes(userId)) {
                data.notifications.subscriptions[category].push(userId);
                await db.saveData(data);
                logger.debug('User subscribed to category:', { userId, category });
            }

            return true;
        } catch (error) {
            logger.error('Error subscribing user:', error);
            return false;
        }
    }

    /**
     * Unsubscribe user from notification category
     */
    async unsubscribeUser(userId, category) {
        try {
            const data = await db.getData();
            
            if (data.notifications.subscriptions[category]) {
                const index = data.notifications.subscriptions[category].indexOf(userId);
                if (index > -1) {
                    data.notifications.subscriptions[category].splice(index, 1);
                    await db.saveData(data);
                    logger.debug('User unsubscribed from category:', { userId, category });
                }
            }

            return true;
        } catch (error) {
            logger.error('Error unsubscribing user:', error);
            return false;
        }
    }

    /**
     * Create notification campaign
     */
    async createCampaign(campaignData) {
        try {
            const campaign = {
                id: campaignData.id || `campaign_${Date.now()}`,
                name: campaignData.name,
                templateId: campaignData.templateId,
                targetUsers: campaignData.targetUsers || [],
                targetCategories: campaignData.targetCategories || [],
                variables: campaignData.variables || {},
                channels: campaignData.channels || ['telegram'],
                scheduledFor: campaignData.scheduledFor,
                status: 'scheduled',
                createdAt: new Date().toISOString(),
                stats: {
                    sent: 0,
                    delivered: 0,
                    failed: 0
                }
            };

            const data = await db.getData();
            data.notifications.campaigns[campaign.id] = campaign;
            await db.saveData(data);

            // Schedule campaign if needed
            if (campaign.scheduledFor) {
                const scheduledDate = new Date(campaign.scheduledFor);
                schedule.scheduleJob(campaign.id, scheduledDate, async () => {
                    await this.executeCampaign(campaign.id);
                });
            }

            logger.info('Campaign created:', { campaignId: campaign.id });
            return campaign;
        } catch (error) {
            logger.error('Error creating campaign:', error);
            throw error;
        }
    }

    /**
     * Execute notification campaign
     */
    async executeCampaign(campaignId) {
        try {
            const data = await db.getData();
            const campaign = data.notifications.campaigns[campaignId];
            
            if (!campaign || campaign.status !== 'scheduled') {
                return;
            }

            campaign.status = 'running';
            campaign.startedAt = new Date().toISOString();
            await db.saveData(data);

            // Get target users
            let targetUsers = [...campaign.targetUsers];
            
            // Add users from categories
            for (const category of campaign.targetCategories) {
                const categoryUsers = data.notifications.subscriptions[category] || [];
                targetUsers = [...targetUsers, ...categoryUsers];
            }

            // Remove duplicates
            targetUsers = [...new Set(targetUsers)];

            // Send notifications
            const results = [];
            for (const userId of targetUsers) {
                try {
                    const result = await this.sendNotification(
                        userId,
                        campaign.templateId,
                        campaign.variables,
                        campaign.channels
                    );
                    
                    results.push({ userId, success: true, result });
                    campaign.stats.sent++;
                    
                    if (result.some(r => r.success)) {
                        campaign.stats.delivered++;
                    } else {
                        campaign.stats.failed++;
                    }
                } catch (error) {
                    results.push({ userId, success: false, error: error.message });
                    campaign.stats.failed++;
                }
            }

            campaign.status = 'completed';
            campaign.completedAt = new Date().toISOString();
            campaign.results = results;

            await db.saveData(data);
            
            logger.info('Campaign executed:', { 
                campaignId, 
                sent: campaign.stats.sent,
                delivered: campaign.stats.delivered,
                failed: campaign.stats.failed
            });

            return campaign;
        } catch (error) {
            logger.error('Error executing campaign:', error);
            
            // Mark campaign as failed
            const data = await db.getData();
            if (data.notifications.campaigns[campaignId]) {
                data.notifications.campaigns[campaignId].status = 'failed';
                data.notifications.campaigns[campaignId].error = error.message;
                await db.saveData(data);
            }
        }
    }

    /**
     * Get notification statistics
     */
    async getNotificationStats(period = 'daily') {
        try {
            const data = await db.getData();
            const sentLogs = data.notifications.sent || {};
            
            const stats = {
                totalSent: 0,
                totalDelivered: 0,
                totalFailed: 0,
                byTemplate: {},
                byChannel: {},
                byDate: {}
            };

            Object.entries(sentLogs).forEach(([date, logs]) => {
                stats.byDate[date] = {
                    sent: logs.length,
                    delivered: 0,
                    failed: 0
                };

                logs.forEach(log => {
                    stats.totalSent++;
                    
                    // Count by template
                    if (!stats.byTemplate[log.templateId]) {
                        stats.byTemplate[log.templateId] = 0;
                    }
                    stats.byTemplate[log.templateId]++;

                    // Count delivery success/failure
                    const hasSuccess = log.results.some(r => r.success);
                    if (hasSuccess) {
                        stats.totalDelivered++;
                        stats.byDate[date].delivered++;
                    } else {
                        stats.totalFailed++;
                        stats.byDate[date].failed++;
                    }

                    // Count by channel
                    log.results.forEach(result => {
                        if (!stats.byChannel[result.channel]) {
                            stats.byChannel[result.channel] = { sent: 0, delivered: 0, failed: 0 };
                        }
                        stats.byChannel[result.channel].sent++;
                        if (result.success) {
                            stats.byChannel[result.channel].delivered++;
                        } else {
                            stats.byChannel[result.channel].failed++;
                        }
                    });
                });
            });

            return stats;
        } catch (error) {
            logger.error('Error getting notification stats:', error);
            return null;
        }
    }

    /**
     * Clean up old notification logs
     */
    async cleanupOldLogs(retentionDays = 30) {
        try {
            const data = await db.getData();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            const cutoffKey = cutoffDate.toISOString().split('T')[0];

            let cleanedCount = 0;

            // Clean sent logs
            Object.keys(data.notifications.sent).forEach(dateKey => {
                if (dateKey < cutoffKey) {
                    cleanedCount += data.notifications.sent[dateKey].length;
                    delete data.notifications.sent[dateKey];
                }
            });

            if (cleanedCount > 0) {
                await db.saveData(data);
                logger.info(`Cleaned up ${cleanedCount} old notification logs`);
            }

            return cleanedCount;
        } catch (error) {
            logger.error('Error cleaning up old notification logs:', error);
            return 0;
        }
    }
}

module.exports = new NotificationService();
