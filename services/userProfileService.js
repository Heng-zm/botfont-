// services/userProfileService.js
const { logger } = require('./logger');
const db = require('./dbService');

class UserProfileService {
    constructor() {
        this.profileCache = new Map();
        this.CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Initialize user profile service
     */
    async init() {
        try {
            await this.setupProfileTables();
            logger.info('User Profile Service initialized');
        } catch (error) {
            logger.error('Error initializing User Profile Service:', error);
        }
    }

    /**
     * Set up database tables for user profiles
     */
    async setupProfileTables() {
        // Ensure database functions are available
        if (typeof db.getData !== 'function' || typeof db.saveData !== 'function') {
            throw new Error('Database service not properly initialized');
        }
        
        const data = await db.getData();
        
        if (!data.userProfiles) {
            data.userProfiles = {};
        }
        
        if (!data.userPreferences) {
            data.userPreferences = {};
        }

        if (!data.userStats) {
            data.userStats = {};
        }

        if (!data.userAchievements) {
            data.userAchievements = {};
        }

        await db.saveData(data);
    }

    /**
     * Get user profile with caching
     */
    async getUserProfile(userId) {
        const cacheKey = `profile_${userId}`;
        const cached = this.profileCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            return cached.profile;
        }

        try {
            const data = await db.getData();
            const profile = data.userProfiles[userId] || await this.createDefaultProfile(userId);
            
            // Cache the profile
            this.profileCache.set(cacheKey, {
                profile,
                timestamp: Date.now()
            });

            return profile;
        } catch (error) {
            logger.error('Error getting user profile:', error);
            return await this.createDefaultProfile(userId);
        }
    }

    /**
     * Create default profile for new users
     */
    async createDefaultProfile(userId) {
        const defaultProfile = {
            userId,
            displayName: null,
            bio: null,
            location: null,
            language: 'en',
            timezone: 'UTC',
            joinDate: new Date().toISOString(),
            lastActive: new Date().toISOString(),
            favoriteGenres: [],
            customizations: {
                theme: 'default',
                defaultFontSize: 24,
                defaultColor: '#000000',
                defaultBackground: '#FFFFFF',
                preferredFormat: 'png'
            },
            privacy: {
                showProfile: true,
                showStats: true,
                allowDirectMessages: true
            },
            notifications: {
                newFonts: true,
                updates: true,
                reminders: true
            }
        };

        await this.updateUserProfile(userId, defaultProfile);
        return defaultProfile;
    }

    /**
     * Update user profile
     */
    async updateUserProfile(userId, profileData) {
        try {
            const data = await db.getData();
            
            if (!data.userProfiles[userId]) {
                data.userProfiles[userId] = await this.createDefaultProfile(userId);
            }

            // Merge with existing profile
            data.userProfiles[userId] = {
                ...data.userProfiles[userId],
                ...profileData,
                lastModified: new Date().toISOString()
            };

            await db.saveData(data);

            // Update cache
            this.profileCache.delete(`profile_${userId}`);
            
            logger.debug('User profile updated:', { userId });
            return data.userProfiles[userId];
        } catch (error) {
            logger.error('Error updating user profile:', error);
            throw error;
        }
    }

    /**
     * Get user preferences
     */
    async getUserPreferences(userId) {
        try {
            const data = await db.getData();
            return data.userPreferences[userId] || {};
        } catch (error) {
            logger.error('Error getting user preferences:', error);
            return {};
        }
    }

    /**
     * Update user preferences
     */
    async updateUserPreferences(userId, preferences) {
        try {
            const data = await db.getData();
            
            if (!data.userPreferences[userId]) {
                data.userPreferences[userId] = {};
            }

            data.userPreferences[userId] = {
                ...data.userPreferences[userId],
                ...preferences,
                lastModified: new Date().toISOString()
            };

            await db.saveData(data);
            logger.debug('User preferences updated:', { userId });
        } catch (error) {
            logger.error('Error updating user preferences:', error);
            throw error;
        }
    }

    /**
     * Get user statistics
     */
    async getUserStats(userId) {
        try {
            const data = await db.getData();
            return data.userStats[userId] || {
                fontsUsed: 0,
                imagesGenerated: 0,
                totalRequests: 0,
                favoriteFont: null,
                streakDays: 0,
                lastUsed: null,
                joinDate: new Date().toISOString()
            };
        } catch (error) {
            logger.error('Error getting user stats:', error);
            return {};
        }
    }

    /**
     * Update user statistics
     */
    async updateUserStats(userId, statUpdates) {
        try {
            const data = await db.getData();
            
            if (!data.userStats[userId]) {
                data.userStats[userId] = {
                    fontsUsed: 0,
                    imagesGenerated: 0,
                    totalRequests: 0,
                    favoriteFont: null,
                    streakDays: 0,
                    lastUsed: null,
                    joinDate: new Date().toISOString()
                };
            }

            const currentStats = data.userStats[userId];
            const now = new Date();
            const today = now.toDateString();
            const lastUsed = currentStats.lastUsed ? new Date(currentStats.lastUsed).toDateString() : null;
            
            // Update streak
            if (lastUsed !== today) {
                if (lastUsed === new Date(now - 24 * 60 * 60 * 1000).toDateString()) {
                    currentStats.streakDays += 1;
                } else {
                    currentStats.streakDays = 1;
                }
                currentStats.lastUsed = now.toISOString();
            }

            // Apply updates
            Object.keys(statUpdates).forEach(key => {
                if (typeof statUpdates[key] === 'number' && typeof currentStats[key] === 'number') {
                    currentStats[key] += statUpdates[key];
                } else {
                    currentStats[key] = statUpdates[key];
                }
            });

            data.userStats[userId] = currentStats;
            await db.saveData(data);
            
            logger.debug('User stats updated:', { userId, updates: statUpdates });
            return currentStats;
        } catch (error) {
            logger.error('Error updating user stats:', error);
            throw error;
        }
    }

    /**
     * Award achievement to user
     */
    async awardAchievement(userId, achievementId, achievementData) {
        try {
            const data = await db.getData();
            
            if (!data.userAchievements[userId]) {
                data.userAchievements[userId] = {};
            }

            if (!data.userAchievements[userId][achievementId]) {
                data.userAchievements[userId][achievementId] = {
                    ...achievementData,
                    earnedAt: new Date().toISOString()
                };

                await db.saveData(data);
                logger.info('Achievement awarded:', { userId, achievementId });
                return true;
            }

            return false; // Already has this achievement
        } catch (error) {
            logger.error('Error awarding achievement:', error);
            return false;
        }
    }

    /**
     * Get user achievements
     */
    async getUserAchievements(userId) {
        try {
            const data = await db.getData();
            return data.userAchievements[userId] || {};
        } catch (error) {
            logger.error('Error getting user achievements:', error);
            return {};
        }
    }

    /**
     * Get leaderboard data
     */
    async getLeaderboard(metric = 'totalRequests', limit = 10) {
        try {
            const data = await db.getData();
            const stats = data.userStats || {};
            
            const leaderboard = Object.entries(stats)
                .map(([userId, userStats]) => ({
                    userId,
                    value: userStats[metric] || 0,
                    ...userStats
                }))
                .sort((a, b) => b.value - a.value)
                .slice(0, limit);

            return leaderboard;
        } catch (error) {
            logger.error('Error getting leaderboard:', error);
            return [];
        }
    }

    /**
     * Check and award achievements based on stats
     */
    async checkAndAwardAchievements(userId) {
        try {
            const stats = await this.getUserStats(userId);
            const achievements = await this.getUserAchievements(userId);
            const newAchievements = [];

            // Define achievement conditions
            const achievementConditions = [
                {
                    id: 'first_font',
                    condition: stats.fontsUsed >= 1 && !achievements.first_font,
                    data: { name: 'First Font', description: 'Used your first font!', icon: '🎨' }
                },
                {
                    id: 'font_explorer',
                    condition: stats.fontsUsed >= 10 && !achievements.font_explorer,
                    data: { name: 'Font Explorer', description: 'Used 10 different fonts!', icon: '🔍' }
                },
                {
                    id: 'font_master',
                    condition: stats.fontsUsed >= 50 && !achievements.font_master,
                    data: { name: 'Font Master', description: 'Used 50 different fonts!', icon: '👑' }
                },
                {
                    id: 'image_creator',
                    condition: stats.imagesGenerated >= 100 && !achievements.image_creator,
                    data: { name: 'Image Creator', description: 'Generated 100 images!', icon: '🖼️' }
                },
                {
                    id: 'streak_warrior',
                    condition: stats.streakDays >= 7 && !achievements.streak_warrior,
                    data: { name: 'Streak Warrior', description: '7-day usage streak!', icon: '🔥' }
                },
                {
                    id: 'power_user',
                    condition: stats.totalRequests >= 1000 && !achievements.power_user,
                    data: { name: 'Power User', description: 'Made 1000 requests!', icon: '⚡' }
                }
            ];

            // Check and award achievements
            for (const achievement of achievementConditions) {
                if (achievement.condition) {
                    const awarded = await this.awardAchievement(userId, achievement.id, achievement.data);
                    if (awarded) {
                        newAchievements.push(achievement.data);
                    }
                }
            }

            return newAchievements;
        } catch (error) {
            logger.error('Error checking achievements:', error);
            return [];
        }
    }

    /**
     * Clear cache for user
     */
    clearUserCache(userId) {
        this.profileCache.delete(`profile_${userId}`);
    }

    /**
     * Clear all cache
     */
    clearAllCache() {
        this.profileCache.clear();
    }
}

module.exports = new UserProfileService();
