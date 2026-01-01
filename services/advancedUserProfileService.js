// services/advancedUserProfileService.js

const db = require('./dbService');
const { logger } = require('./logger');
const eventEmitter = require('./eventService');
const { Mutex } = require('async-mutex');

const mutex = new Mutex();

/**
 * Advanced User Profile Service
 * Provides comprehensive user management, analytics, and personalization features
 */
class AdvancedUserProfileService {
    constructor() {
        this.userPreferences = new Map(); // Cache for user preferences
        this.userStats = new Map(); // Cache for user statistics
        this.initialized = false;
    }

    /**
     * Initialize the service
     */
    async init() {
        try {
            await this.loadUserData();
            this.initialized = true;
            logger.info('Advanced User Profile Service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize Advanced User Profile Service:', error);
            throw error;
        }
    }

    /**
     * Load user data into cache
     */
    async loadUserData() {
        try {
            const users = db.getAllUsers();
            for (const user of users) {
                if (user.preferences) {
                    this.userPreferences.set(user.id.toString(), user.preferences);
                }
                if (user.stats) {
                    this.userStats.set(user.id.toString(), user.stats);
                }
            }
            logger.info(`Loaded data for ${users.length} users into cache`);
        } catch (error) {
            logger.error('Error loading user data:', error);
            throw error;
        }
    }

    /**
     * Get comprehensive user profile
     */
    async getUserProfile(userId) {
        const release = await mutex.acquire();
        try {
            const user = db.findUserById(userId);
            if (!user) return null;

            // Get user preferences
            const preferences = this.userPreferences.get(userId.toString()) || this.getDefaultPreferences();
            
            // Calculate user statistics
            const stats = await this.calculateUserStats(userId);
            
            // Get user activity history
            const activity = user.activity || { downloads: [], uploads: [] };
            
            // Get user rank and achievements
            const achievements = await this.getUserAchievements(userId, stats);
            const rank = await this.getUserRank(userId, stats);

            return {
                ...user,
                preferences,
                stats,
                activity,
                achievements,
                rank,
                profileCompleteness: this.calculateProfileCompleteness(user, preferences)
            };
        } catch (error) {
            logger.error('Error getting user profile:', error);
            return null;
        } finally {
            release();
        }
    }

    /**
     * Update user preferences
     */
    async updateUserPreferences(userId, preferences) {
        const release = await mutex.acquire();
        try {
            const user = db.findUserById(userId);
            if (!user) return false;

            const mergedPreferences = {
                ...this.getDefaultPreferences(),
                ...preferences,
                updatedAt: new Date().toISOString()
            };

            // Update database
            user.preferences = mergedPreferences;
            await db.addOrUpdateUser(user);

            // Update cache
            this.userPreferences.set(userId.toString(), mergedPreferences);

            logger.info(`Updated preferences for user ${userId}`);
            eventEmitter.emit('userPreferencesUpdated', { userId, preferences: mergedPreferences });
            return true;
        } catch (error) {
            logger.error('Error updating user preferences:', error);
            return false;
        } finally {
            release();
        }
    }

    /**
     * Get default user preferences
     */
    getDefaultPreferences() {
        return {
            language: 'khmer', // khmer or english
            downloadNotifications: true,
            approvalNotifications: true,
            weeklyDigest: true,
            fontPreviewSize: 'medium', // small, medium, large
            fontCategories: ['all'], // preferred font categories
            darkMode: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
    }

    /**
     * Calculate comprehensive user statistics
     */
    async calculateUserStats(userId) {
        try {
            const user = db.findUserById(userId);
            if (!user) return null;

            const activity = user.activity || { downloads: [], uploads: [] };
            const now = new Date();
            const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

            // Download statistics
            const totalDownloads = activity.downloads ? activity.downloads.length : 0;
            const weeklyDownloads = activity.downloads ? 
                activity.downloads.filter(d => new Date(d.date) > oneWeekAgo).length : 0;
            const monthlyDownloads = activity.downloads ? 
                activity.downloads.filter(d => new Date(d.date) > oneMonthAgo).length : 0;

            // Upload statistics
            const totalUploads = activity.uploads ? activity.uploads.length : 0;
            const approvedUploads = activity.uploads ? 
                activity.uploads.filter(u => u.status === 'approved').length : 0;
            const pendingUploads = activity.uploads ? 
                activity.uploads.filter(u => u.status === 'pending').length : 0;
            const rejectedUploads = activity.uploads ? 
                activity.uploads.filter(u => u.status === 'rejected').length : 0;

            // Usage patterns
            const favoriteCategories = this.analyzeFavoriteCategories(activity.downloads);
            const mostActiveHours = this.analyzeMostActiveHours(activity);
            const avgDownloadsPerSession = this.calculateAvgDownloadsPerSession(activity.downloads);

            // Streaks
            const currentDownloadStreak = this.calculateDownloadStreak(activity.downloads);
            const longestDownloadStreak = this.calculateLongestDownloadStreak(activity.downloads);

            const stats = {
                totalDownloads,
                weeklyDownloads,
                monthlyDownloads,
                totalUploads,
                approvedUploads,
                pendingUploads,
                rejectedUploads,
                approvalRate: totalUploads > 0 ? (approvedUploads / totalUploads * 100).toFixed(1) : 0,
                favoriteCategories,
                mostActiveHours,
                avgDownloadsPerSession,
                currentDownloadStreak,
                longestDownloadStreak,
                joinDate: user.firstSeen,
                lastActive: user.lastSeen,
                daysSinceJoin: Math.floor((now - new Date(user.firstSeen)) / (1000 * 60 * 60 * 24)),
                calculatedAt: now.toISOString()
            };

            // Update cache
            this.userStats.set(userId.toString(), stats);
            
            return stats;
        } catch (error) {
            logger.error('Error calculating user stats:', error);
            return null;
        }
    }

    /**
     * Get user achievements based on their activity
     */
    async getUserAchievements(userId, stats = null) {
        try {
            if (!stats) {
                stats = await this.calculateUserStats(userId);
            }
            
            const achievements = [];

            // Download achievements
            if (stats.totalDownloads >= 1) achievements.push({ 
                id: 'first_download', 
                name: 'First Download', 
                description: 'Downloaded your first font',
                icon: '🎯',
                earnedAt: stats.calculatedAt
            });
            
            if (stats.totalDownloads >= 10) achievements.push({ 
                id: 'frequent_user', 
                name: 'Font Explorer', 
                description: 'Downloaded 10 fonts',
                icon: '🗺️',
                earnedAt: stats.calculatedAt
            });
            
            if (stats.totalDownloads >= 50) achievements.push({ 
                id: 'power_user', 
                name: 'Font Collector', 
                description: 'Downloaded 50 fonts',
                icon: '📚',
                earnedAt: stats.calculatedAt
            });

            if (stats.totalDownloads >= 100) achievements.push({ 
                id: 'font_master', 
                name: 'Font Master', 
                description: 'Downloaded 100 fonts',
                icon: '👑',
                earnedAt: stats.calculatedAt
            });

            // Upload achievements
            if (stats.approvedUploads >= 1) achievements.push({ 
                id: 'contributor', 
                name: 'Font Contributor', 
                description: 'Had your first font approved',
                icon: '🤝',
                earnedAt: stats.calculatedAt
            });

            if (stats.approvedUploads >= 5) achievements.push({ 
                id: 'frequent_contributor', 
                name: 'Font Creator', 
                description: 'Had 5 fonts approved',
                icon: '🎨',
                earnedAt: stats.calculatedAt
            });

            if (stats.approvedUploads >= 10) achievements.push({ 
                id: 'font_designer', 
                name: 'Font Designer', 
                description: 'Had 10 fonts approved',
                icon: '💎',
                earnedAt: stats.calculatedAt
            });

            // Streak achievements
            if (stats.longestDownloadStreak >= 7) achievements.push({ 
                id: 'weekly_streak', 
                name: 'Weekly Warrior', 
                description: 'Downloaded fonts for 7 days in a row',
                icon: '🔥',
                earnedAt: stats.calculatedAt
            });

            if (stats.longestDownloadStreak >= 30) achievements.push({ 
                id: 'monthly_streak', 
                name: 'Monthly Master', 
                description: 'Downloaded fonts for 30 days in a row',
                icon: '🌟',
                earnedAt: stats.calculatedAt
            });

            // Special achievements
            if (stats.daysSinceJoin >= 365) achievements.push({ 
                id: 'veteran', 
                name: 'Veteran User', 
                description: 'Been with us for over a year',
                icon: '🏆',
                earnedAt: stats.calculatedAt
            });

            if (parseFloat(stats.approvalRate) >= 90 && stats.totalUploads >= 5) achievements.push({ 
                id: 'quality_contributor', 
                name: 'Quality Contributor', 
                description: 'High approval rate for uploads',
                icon: '✨',
                earnedAt: stats.calculatedAt
            });

            return achievements;
        } catch (error) {
            logger.error('Error getting user achievements:', error);
            return [];
        }
    }

    /**
     * Calculate user rank based on their activity
     */
    async getUserRank(userId, stats = null) {
        try {
            if (!stats) {
                stats = await this.calculateUserStats(userId);
            }

            // Calculate rank score based on various factors
            let score = 0;
            
            // Download activity (max 500 points)
            score += Math.min(stats.totalDownloads * 2, 500);
            
            // Upload contributions (max 300 points)
            score += stats.approvedUploads * 15;
            
            // Quality bonus (max 100 points)
            if (stats.totalUploads > 0) {
                score += (parseFloat(stats.approvalRate) / 100) * 100;
            }
            
            // Loyalty bonus (max 100 points)
            score += Math.min(stats.daysSinceJoin / 10, 100);
            
            // Streak bonus (max 50 points)
            score += Math.min(stats.longestDownloadStreak * 2, 50);

            // Determine rank based on score
            let rank = 'Bronze';
            let rankIcon = '🥉';
            let nextRank = 'Silver';
            let pointsToNext = 250 - score;

            if (score >= 750) {
                rank = 'Diamond';
                rankIcon = '💎';
                nextRank = null;
                pointsToNext = 0;
            } else if (score >= 500) {
                rank = 'Gold';
                rankIcon = '🥇';
                nextRank = 'Diamond';
                pointsToNext = 750 - score;
            } else if (score >= 250) {
                rank = 'Silver';
                rankIcon = '🥈';
                nextRank = 'Gold';
                pointsToNext = 500 - score;
            }

            return {
                rank,
                rankIcon,
                score: Math.floor(score),
                nextRank,
                pointsToNext: Math.max(pointsToNext, 0),
                percentToNext: nextRank ? Math.min((score % 250) / 250 * 100, 100) : 100
            };
        } catch (error) {
            logger.error('Error calculating user rank:', error);
            return {
                rank: 'Bronze',
                rankIcon: '🥉',
                score: 0,
                nextRank: 'Silver',
                pointsToNext: 250,
                percentToNext: 0
            };
        }
    }

    /**
     * Get user recommendations based on their activity
     */
    async getUserRecommendations(userId) {
        try {
            const stats = await this.calculateUserStats(userId);
            const profile = await this.getUserProfile(userId);
            
            if (!stats || !profile) return [];

            const recommendations = [];

            // Recommend based on download patterns
            if (stats.favoriteCategories.length > 0) {
                recommendations.push({
                    type: 'category_based',
                    title: 'More fonts you might like',
                    description: `Based on your downloads in ${stats.favoriteCategories.join(', ')}`,
                    action: 'browse_category',
                    data: stats.favoriteCategories[0]
                });
            }

            // Streak motivation
            if (stats.currentDownloadStreak > 0) {
                recommendations.push({
                    type: 'streak_motivation',
                    title: 'Keep your streak going!',
                    description: `You're on a ${stats.currentDownloadStreak}-day streak`,
                    action: 'browse_all',
                    data: null
                });
            }

            // Upload encouragement
            if (stats.totalUploads === 0 && stats.totalDownloads >= 5) {
                recommendations.push({
                    type: 'upload_encouragement',
                    title: 'Share your own fonts!',
                    description: 'Consider contributing to our font library',
                    action: 'upload_guide',
                    data: null
                });
            }

            // Achievement suggestions
            const nextAchievement = this.getNextAchievementSuggestion(stats);
            if (nextAchievement) {
                recommendations.push({
                    type: 'achievement_suggestion',
                    title: nextAchievement.title,
                    description: nextAchievement.description,
                    action: 'view_achievements',
                    data: nextAchievement
                });
            }

            return recommendations;
        } catch (error) {
            logger.error('Error getting user recommendations:', error);
            return [];
        }
    }

    /**
     * Generate user activity report
     */
    async generateActivityReport(userId, period = 'month') {
        try {
            const stats = await this.calculateUserStats(userId);
            const profile = await this.getUserProfile(userId);
            
            if (!stats || !profile) return null;

            const now = new Date();
            let startDate;
            
            switch (period) {
                case 'week':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case 'month':
                    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
                case 'year':
                    startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    startDate = new Date(profile.firstSeen);
            }

            // Filter activity by period
            const periodDownloads = profile.activity.downloads.filter(d => 
                new Date(d.date) >= startDate
            );
            
            const periodUploads = profile.activity.uploads.filter(u => 
                new Date(u.date || u.createdAt) >= startDate
            );

            return {
                period,
                startDate: startDate.toISOString(),
                endDate: now.toISOString(),
                summary: {
                    downloads: periodDownloads.length,
                    uploads: periodUploads.length,
                    daysActive: this.calculateActiveDays(periodDownloads, startDate, now),
                    averagePerDay: (periodDownloads.length / Math.max(Math.ceil((now - startDate) / (1000 * 60 * 60 * 24)), 1)).toFixed(1)
                },
                topFonts: this.getTopDownloadedFonts(periodDownloads, 5),
                activityGraph: this.generateActivityGraph(periodDownloads, startDate, now),
                achievements: profile.achievements.filter(a => 
                    new Date(a.earnedAt) >= startDate
                ),
                generatedAt: now.toISOString()
            };
        } catch (error) {
            logger.error('Error generating activity report:', error);
            return null;
        }
    }

    // Helper methods
    analyzeFavoriteCategories(downloads) {
        // Analyze download patterns to determine favorite categories
        // This would require font categorization data
        return ['serif', 'sans-serif']; // Placeholder
    }

    analyzeMostActiveHours(activity) {
        const hourCounts = Array(24).fill(0);
        
        [...(activity.downloads || []), ...(activity.uploads || [])].forEach(item => {
            const hour = new Date(item.date || item.createdAt).getHours();
            hourCounts[hour]++;
        });

        const maxCount = Math.max(...hourCounts);
        const mostActiveHour = hourCounts.indexOf(maxCount);
        
        return {
            hour: mostActiveHour,
            count: maxCount,
            period: mostActiveHour < 12 ? 'morning' : mostActiveHour < 18 ? 'afternoon' : 'evening'
        };
    }

    calculateAvgDownloadsPerSession(downloads) {
        if (!downloads || downloads.length === 0) return 0;
        
        // Group downloads by day to estimate sessions
        const dailyDownloads = {};
        downloads.forEach(download => {
            const day = new Date(download.date).toDateString();
            dailyDownloads[day] = (dailyDownloads[day] || 0) + 1;
        });

        const sessions = Object.keys(dailyDownloads).length;
        return sessions > 0 ? (downloads.length / sessions).toFixed(1) : 0;
    }

    calculateDownloadStreak(downloads) {
        if (!downloads || downloads.length === 0) return 0;
        
        const today = new Date();
        let streak = 0;
        let currentDate = new Date(today);
        
        while (true) {
            const dateStr = currentDate.toDateString();
            const hasDownload = downloads.some(d => 
                new Date(d.date).toDateString() === dateStr
            );
            
            if (hasDownload) {
                streak++;
                currentDate.setDate(currentDate.getDate() - 1);
            } else {
                break;
            }
        }
        
        return streak;
    }

    calculateLongestDownloadStreak(downloads) {
        if (!downloads || downloads.length === 0) return 0;
        
        // Sort downloads by date
        const sortedDownloads = downloads.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        let longestStreak = 0;
        let currentStreak = 0;
        let lastDate = null;
        
        for (const download of sortedDownloads) {
            const currentDate = new Date(download.date);
            
            if (lastDate) {
                const daysDiff = Math.floor((currentDate - lastDate) / (1000 * 60 * 60 * 24));
                
                if (daysDiff === 1) {
                    currentStreak++;
                } else if (daysDiff > 1) {
                    longestStreak = Math.max(longestStreak, currentStreak);
                    currentStreak = 1;
                }
            } else {
                currentStreak = 1;
            }
            
            lastDate = currentDate;
        }
        
        return Math.max(longestStreak, currentStreak);
    }

    calculateProfileCompleteness(user, preferences) {
        let completeness = 0;
        const maxPoints = 100;
        
        // Basic info (40 points)
        if (user.first_name) completeness += 20;
        if (user.username) completeness += 20;
        
        // Activity (30 points)
        const activity = user.activity || { downloads: [], uploads: [] };
        if (activity.downloads && activity.downloads.length > 0) completeness += 15;
        if (activity.uploads && activity.uploads.length > 0) completeness += 15;
        
        // Preferences (30 points)
        if (preferences.language !== 'khmer') completeness += 10; // Set non-default language
        if (preferences.fontCategories.length > 1) completeness += 10; // Customized categories
        if (!preferences.downloadNotifications || !preferences.approvalNotifications) completeness += 10; // Customized notifications
        
        return Math.min(completeness, maxPoints);
    }

    getNextAchievementSuggestion(stats) {
        // Suggest next achievable milestone
        if (stats.totalDownloads < 10) {
            return {
                title: 'Almost Font Explorer!',
                description: `Download ${10 - stats.totalDownloads} more fonts to unlock Font Explorer achievement`
            };
        }
        
        if (stats.totalDownloads < 50) {
            return {
                title: 'Getting closer to Font Collector!',
                description: `Download ${50 - stats.totalDownloads} more fonts to unlock Font Collector achievement`
            };
        }
        
        if (stats.approvedUploads === 0) {
            return {
                title: 'Become a contributor!',
                description: 'Upload your first font to unlock Font Contributor achievement'
            };
        }
        
        return null;
    }

    calculateActiveDays(downloads, startDate, endDate) {
        const activeDays = new Set();
        
        downloads.forEach(download => {
            const day = new Date(download.date).toDateString();
            activeDays.add(day);
        });
        
        return activeDays.size;
    }

    getTopDownloadedFonts(downloads, limit = 5) {
        const fontCounts = {};
        
        downloads.forEach(download => {
            const fontName = download.fontName;
            fontCounts[fontName] = (fontCounts[fontName] || 0) + 1;
        });
        
        return Object.entries(fontCounts)
            .sort(([,a], [,b]) => b - a)
            .slice(0, limit)
            .map(([font, count]) => ({ font, count }));
    }

    generateActivityGraph(downloads, startDate, endDate) {
        const days = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
        const graph = [];
        
        for (let i = 0; i < days; i++) {
            const date = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
            const dateStr = date.toDateString();
            const count = downloads.filter(d => 
                new Date(d.date).toDateString() === dateStr
            ).length;
            
            graph.push({
                date: date.toISOString().split('T')[0],
                downloads: count
            });
        }
        
        return graph;
    }
}

module.exports = new AdvancedUserProfileService();
