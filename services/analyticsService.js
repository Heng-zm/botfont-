// services/analyticsService.js
const { logger } = require('./logger');
const db = require('./dbService');

class AnalyticsService {
    constructor() {
        this.metricsBuffer = [];
        this.BUFFER_SIZE = 100;
        this.FLUSH_INTERVAL = 60 * 1000; // 1 minute
        this.startFlushInterval();
    }

    /**
     * Initialize analytics service
     */
    async init() {
        try {
            await this.setupAnalyticsTables();
            logger.info('Analytics Service initialized');
        } catch (error) {
            logger.error('Error initializing Analytics Service:', error);
        }
    }

    /**
     * Set up database tables for analytics
     */
    async setupAnalyticsTables() {
        // Ensure database functions are available
        if (typeof db.getData !== 'function' || typeof db.saveData !== 'function') {
            throw new Error('Database service not properly initialized');
        }
        
        const data = await db.getData();
        
        if (!data.analytics) {
            data.analytics = {
                dailyStats: {},
                weeklyStats: {},
                monthlyStats: {},
                userActivity: {},
                fontUsage: {},
                commandUsage: {},
                errorLogs: {},
                performanceMetrics: {}
            };
        }

        await db.saveData(data);
    }

    /**
     * Track user activity
     */
    async trackUserActivity(userId, activity, metadata = {}) {
        const metric = {
            type: 'user_activity',
            userId,
            activity,
            metadata,
            timestamp: new Date().toISOString()
        };

        this.metricsBuffer.push(metric);
        
        if (this.metricsBuffer.length >= this.BUFFER_SIZE) {
            await this.flushMetrics();
        }
    }

    /**
     * Track font usage
     */
    async trackFontUsage(userId, fontName, fontSize, color, metadata = {}) {
        const metric = {
            type: 'font_usage',
            userId,
            fontName,
            fontSize,
            color,
            metadata,
            timestamp: new Date().toISOString()
        };

        this.metricsBuffer.push(metric);
    }

    /**
     * Track command usage
     */
    async trackCommandUsage(userId, command, success = true, executionTime = null, metadata = {}) {
        const metric = {
            type: 'command_usage',
            userId,
            command,
            success,
            executionTime,
            metadata,
            timestamp: new Date().toISOString()
        };

        this.metricsBuffer.push(metric);
    }

    /**
     * Track errors
     */
    async trackError(userId, errorType, errorMessage, stackTrace = null, metadata = {}) {
        const metric = {
            type: 'error',
            userId,
            errorType,
            errorMessage,
            stackTrace,
            metadata,
            timestamp: new Date().toISOString()
        };

        this.metricsBuffer.push(metric);
    }

    /**
     * Track performance metrics
     */
    async trackPerformance(metric, value, tags = {}) {
        const performanceMetric = {
            type: 'performance',
            metric,
            value,
            tags,
            timestamp: new Date().toISOString()
        };

        this.metricsBuffer.push(performanceMetric);
    }

    /**
     * Flush metrics buffer to database
     */
    async flushMetrics() {
        if (this.metricsBuffer.length === 0) return;

        try {
            const data = await db.getData();
            const metricsToFlush = [...this.metricsBuffer];
            this.metricsBuffer = [];

            for (const metric of metricsToFlush) {
                await this.processMetric(data, metric);
            }

            await db.saveData(data);
            logger.debug(`Flushed ${metricsToFlush.length} metrics to database`);
        } catch (error) {
            logger.error('Error flushing metrics:', error);
        }
    }

    /**
     * Process individual metric
     */
    async processMetric(data, metric) {
        const date = new Date(metric.timestamp);
        const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD
        const weekKey = this.getWeekKey(date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

        // Initialize date entries if needed
        if (!data.analytics.dailyStats[dateKey]) {
            data.analytics.dailyStats[dateKey] = {};
        }
        if (!data.analytics.weeklyStats[weekKey]) {
            data.analytics.weeklyStats[weekKey] = {};
        }
        if (!data.analytics.monthlyStats[monthKey]) {
            data.analytics.monthlyStats[monthKey] = {};
        }

        switch (metric.type) {
            case 'user_activity':
                await this.processUserActivity(data, metric, dateKey, weekKey, monthKey);
                break;
            case 'font_usage':
                await this.processFontUsage(data, metric, dateKey, weekKey, monthKey);
                break;
            case 'command_usage':
                await this.processCommandUsage(data, metric, dateKey, weekKey, monthKey);
                break;
            case 'error':
                await this.processError(data, metric, dateKey);
                break;
            case 'performance':
                await this.processPerformance(data, metric, dateKey);
                break;
        }
    }

    /**
     * Process user activity metric
     */
    async processUserActivity(data, metric, dateKey, weekKey, monthKey) {
        // Daily stats
        if (!data.analytics.dailyStats[dateKey].userActivity) {
            data.analytics.dailyStats[dateKey].userActivity = { total: 0, unique: new Set() };
        }
        data.analytics.dailyStats[dateKey].userActivity.total++;
        data.analytics.dailyStats[dateKey].userActivity.unique.add(metric.userId);

        // Weekly stats
        if (!data.analytics.weeklyStats[weekKey].userActivity) {
            data.analytics.weeklyStats[weekKey].userActivity = { total: 0, unique: new Set() };
        }
        data.analytics.weeklyStats[weekKey].userActivity.total++;
        data.analytics.weeklyStats[weekKey].userActivity.unique.add(metric.userId);

        // Monthly stats
        if (!data.analytics.monthlyStats[monthKey].userActivity) {
            data.analytics.monthlyStats[monthKey].userActivity = { total: 0, unique: new Set() };
        }
        data.analytics.monthlyStats[monthKey].userActivity.total++;
        data.analytics.monthlyStats[monthKey].userActivity.unique.add(metric.userId);

        // User-specific activity
        if (!data.analytics.userActivity[metric.userId]) {
            data.analytics.userActivity[metric.userId] = {};
        }
        if (!data.analytics.userActivity[metric.userId][dateKey]) {
            data.analytics.userActivity[metric.userId][dateKey] = [];
        }
        data.analytics.userActivity[metric.userId][dateKey].push({
            activity: metric.activity,
            timestamp: metric.timestamp,
            metadata: metric.metadata
        });
    }

    /**
     * Process font usage metric
     */
    async processFontUsage(data, metric, dateKey, weekKey, monthKey) {
        // Font usage tracking
        if (!data.analytics.fontUsage[metric.fontName]) {
            data.analytics.fontUsage[metric.fontName] = {
                totalUses: 0,
                uniqueUsers: new Set(),
                dailyUses: {}
            };
        }

        data.analytics.fontUsage[metric.fontName].totalUses++;
        data.analytics.fontUsage[metric.fontName].uniqueUsers.add(metric.userId);
        
        if (!data.analytics.fontUsage[metric.fontName].dailyUses[dateKey]) {
            data.analytics.fontUsage[metric.fontName].dailyUses[dateKey] = 0;
        }
        data.analytics.fontUsage[metric.fontName].dailyUses[dateKey]++;

        // Daily font stats
        if (!data.analytics.dailyStats[dateKey].fontUsage) {
            data.analytics.dailyStats[dateKey].fontUsage = {};
        }
        if (!data.analytics.dailyStats[dateKey].fontUsage[metric.fontName]) {
            data.analytics.dailyStats[dateKey].fontUsage[metric.fontName] = 0;
        }
        data.analytics.dailyStats[dateKey].fontUsage[metric.fontName]++;
    }

    /**
     * Process command usage metric
     */
    async processCommandUsage(data, metric, dateKey, weekKey, monthKey) {
        // Command usage tracking
        if (!data.analytics.commandUsage[metric.command]) {
            data.analytics.commandUsage[metric.command] = {
                totalUses: 0,
                successCount: 0,
                errorCount: 0,
                avgExecutionTime: 0,
                dailyUses: {}
            };
        }

        const commandStats = data.analytics.commandUsage[metric.command];
        commandStats.totalUses++;
        
        if (metric.success) {
            commandStats.successCount++;
        } else {
            commandStats.errorCount++;
        }

        if (metric.executionTime) {
            commandStats.avgExecutionTime = 
                (commandStats.avgExecutionTime * (commandStats.totalUses - 1) + metric.executionTime) / commandStats.totalUses;
        }

        if (!commandStats.dailyUses[dateKey]) {
            commandStats.dailyUses[dateKey] = 0;
        }
        commandStats.dailyUses[dateKey]++;
    }

    /**
     * Process error metric
     */
    async processError(data, metric, dateKey) {
        if (!data.analytics.errorLogs[dateKey]) {
            data.analytics.errorLogs[dateKey] = [];
        }

        data.analytics.errorLogs[dateKey].push({
            userId: metric.userId,
            errorType: metric.errorType,
            errorMessage: metric.errorMessage,
            stackTrace: metric.stackTrace,
            metadata: metric.metadata,
            timestamp: metric.timestamp
        });
    }

    /**
     * Process performance metric
     */
    async processPerformance(data, metric, dateKey) {
        if (!data.analytics.performanceMetrics[metric.metric]) {
            data.analytics.performanceMetrics[metric.metric] = {};
        }

        if (!data.analytics.performanceMetrics[metric.metric][dateKey]) {
            data.analytics.performanceMetrics[metric.metric][dateKey] = [];
        }

        data.analytics.performanceMetrics[metric.metric][dateKey].push({
            value: metric.value,
            tags: metric.tags,
            timestamp: metric.timestamp
        });
    }

    /**
     * Get analytics summary
     */
    async getAnalyticsSummary(period = 'daily', startDate = null, endDate = null) {
        try {
            const data = await db.getData();
            const analytics = data.analytics;
            
            let statsData;
            switch (period) {
                case 'daily':
                    statsData = analytics.dailyStats;
                    break;
                case 'weekly':
                    statsData = analytics.weeklyStats;
                    break;
                case 'monthly':
                    statsData = analytics.monthlyStats;
                    break;
                default:
                    statsData = analytics.dailyStats;
            }

            // Filter by date range if provided
            let filteredData = statsData;
            if (startDate || endDate) {
                filteredData = {};
                Object.keys(statsData).forEach(dateKey => {
                    const date = new Date(dateKey);
                    if ((!startDate || date >= new Date(startDate)) && 
                        (!endDate || date <= new Date(endDate))) {
                        filteredData[dateKey] = statsData[dateKey];
                    }
                });
            }

            return {
                period,
                startDate,
                endDate,
                totalPeriods: Object.keys(filteredData).length,
                data: filteredData,
                summary: this.calculateSummary(filteredData)
            };
        } catch (error) {
            logger.error('Error getting analytics summary:', error);
            return null;
        }
    }

    /**
     * Get font usage analytics
     */
    async getFontUsageAnalytics(limit = 20) {
        try {
            const data = await db.getData();
            const fontUsage = data.analytics.fontUsage;

            const sortedFonts = Object.entries(fontUsage)
                .map(([fontName, stats]) => ({
                    fontName,
                    totalUses: stats.totalUses,
                    uniqueUsers: stats.uniqueUsers ? stats.uniqueUsers.size : 0,
                    popularityScore: stats.totalUses * 0.7 + (stats.uniqueUsers ? stats.uniqueUsers.size : 0) * 0.3
                }))
                .sort((a, b) => b.popularityScore - a.popularityScore)
                .slice(0, limit);

            return sortedFonts;
        } catch (error) {
            logger.error('Error getting font usage analytics:', error);
            return [];
        }
    }

    /**
     * Get command usage analytics
     */
    async getCommandUsageAnalytics() {
        try {
            const data = await db.getData();
            const commandUsage = data.analytics.commandUsage;

            const sortedCommands = Object.entries(commandUsage)
                .map(([command, stats]) => ({
                    command,
                    totalUses: stats.totalUses,
                    successRate: stats.totalUses > 0 ? (stats.successCount / stats.totalUses * 100).toFixed(2) : 0,
                    avgExecutionTime: stats.avgExecutionTime ? stats.avgExecutionTime.toFixed(2) : 0,
                    errorCount: stats.errorCount
                }))
                .sort((a, b) => b.totalUses - a.totalUses);

            return sortedCommands;
        } catch (error) {
            logger.error('Error getting command usage analytics:', error);
            return [];
        }
    }

    /**
     * Get user activity insights
     */
    async getUserActivityInsights(userId) {
        try {
            const data = await db.getData();
            const userActivity = data.analytics.userActivity[userId];

            if (!userActivity) {
                return null;
            }

            const activityDates = Object.keys(userActivity).sort();
            const totalDays = activityDates.length;
            const firstActivity = activityDates[0];
            const lastActivity = activityDates[activityDates.length - 1];

            let totalActivities = 0;
            const activityTypes = {};

            activityDates.forEach(date => {
                userActivity[date].forEach(activity => {
                    totalActivities++;
                    if (!activityTypes[activity.activity]) {
                        activityTypes[activity.activity] = 0;
                    }
                    activityTypes[activity.activity]++;
                });
            });

            return {
                userId,
                totalDays,
                totalActivities,
                avgActivitiesPerDay: (totalActivities / totalDays).toFixed(2),
                firstActivity,
                lastActivity,
                activityBreakdown: activityTypes,
                mostActiveDay: this.findMostActiveDay(userActivity)
            };
        } catch (error) {
            logger.error('Error getting user activity insights:', error);
            return null;
        }
    }

    /**
     * Get system health metrics
     */
    async getSystemHealthMetrics() {
        try {
            const data = await db.getData();
            const now = new Date();
            const todayKey = now.toISOString().split('T')[0];
            
            const errorLogs = data.analytics.errorLogs[todayKey] || [];
            const performanceMetrics = data.analytics.performanceMetrics;

            return {
                date: todayKey,
                errorCount: errorLogs.length,
                errorTypes: this.groupBy(errorLogs, 'errorType'),
                recentErrors: errorLogs.slice(-10),
                performanceMetrics: this.getPerformanceSummary(performanceMetrics, todayKey)
            };
        } catch (error) {
            logger.error('Error getting system health metrics:', error);
            return null;
        }
    }

    /**
     * Calculate summary statistics
     */
    calculateSummary(data) {
        const dates = Object.keys(data);
        let totalUsers = 0;
        let totalActivity = 0;
        const uniqueUsers = new Set();

        dates.forEach(date => {
            if (data[date].userActivity) {
                totalActivity += data[date].userActivity.total || 0;
                if (data[date].userActivity.unique) {
                    data[date].userActivity.unique.forEach(userId => uniqueUsers.add(userId));
                }
            }
        });

        return {
            totalDays: dates.length,
            totalActivity,
            uniqueUsers: uniqueUsers.size,
            avgActivityPerDay: dates.length > 0 ? (totalActivity / dates.length).toFixed(2) : 0
        };
    }

    /**
     * Find most active day for a user
     */
    findMostActiveDay(userActivity) {
        let maxActivities = 0;
        let mostActiveDay = null;

        Object.entries(userActivity).forEach(([date, activities]) => {
            if (activities.length > maxActivities) {
                maxActivities = activities.length;
                mostActiveDay = date;
            }
        });

        return { date: mostActiveDay, activities: maxActivities };
    }

    /**
     * Group array by property
     */
    groupBy(array, property) {
        return array.reduce((groups, item) => {
            const key = item[property];
            if (!groups[key]) {
                groups[key] = 0;
            }
            groups[key]++;
            return groups;
        }, {});
    }

    /**
     * Get performance summary
     */
    getPerformanceSummary(performanceMetrics, dateKey) {
        const summary = {};

        Object.keys(performanceMetrics).forEach(metric => {
            const dayData = performanceMetrics[metric][dateKey];
            if (dayData && dayData.length > 0) {
                const values = dayData.map(d => d.value);
                summary[metric] = {
                    count: values.length,
                    min: Math.min(...values),
                    max: Math.max(...values),
                    avg: (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)
                };
            }
        });

        return summary;
    }

    /**
     * Get week key from date
     */
    getWeekKey(date) {
        const year = date.getFullYear();
        const firstDayOfYear = new Date(year, 0, 1);
        const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
        const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
        return `${year}-W${String(weekNumber).padStart(2, '0')}`;
    }

    /**
     * Start flush interval
     */
    startFlushInterval() {
        setInterval(() => {
            this.flushMetrics();
        }, this.FLUSH_INTERVAL);
    }

    /**
     * Convert Sets to Arrays for JSON serialization
     */
    prepareDataForSerialization(data) {
        const serializedData = JSON.parse(JSON.stringify(data, (key, value) => {
            if (value instanceof Set) {
                return Array.from(value);
            }
            return value;
        }));

        return serializedData;
    }

    /**
     * Clean up old analytics data
     */
    async cleanupOldData(retentionDays = 90) {
        try {
            const data = await db.getData();
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
            const cutoffKey = cutoffDate.toISOString().split('T')[0];

            let cleanedCount = 0;

            // Clean daily stats
            Object.keys(data.analytics.dailyStats).forEach(dateKey => {
                if (dateKey < cutoffKey) {
                    delete data.analytics.dailyStats[dateKey];
                    cleanedCount++;
                }
            });

            // Clean error logs
            Object.keys(data.analytics.errorLogs).forEach(dateKey => {
                if (dateKey < cutoffKey) {
                    delete data.analytics.errorLogs[dateKey];
                    cleanedCount++;
                }
            });

            // Clean performance metrics
            Object.keys(data.analytics.performanceMetrics).forEach(metric => {
                Object.keys(data.analytics.performanceMetrics[metric]).forEach(dateKey => {
                    if (dateKey < cutoffKey) {
                        delete data.analytics.performanceMetrics[metric][dateKey];
                        cleanedCount++;
                    }
                });
            });

            if (cleanedCount > 0) {
                await db.saveData(data);
                logger.info(`Cleaned up ${cleanedCount} old analytics records`);
            }

            return cleanedCount;
        } catch (error) {
            logger.error('Error cleaning up old analytics data:', error);
            return 0;
        }
    }
}

module.exports = new AnalyticsService();
