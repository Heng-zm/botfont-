// services/recommendationEngine.js
const { logger } = require('./logger');
const db = require('./dbService');

class RecommendationEngine {
    constructor() {
        this.modelCache = new Map();
        this.CACHE_TTL = 60 * 60 * 1000; // 1 hour
        this.MIN_INTERACTIONS = 5; // Minimum interactions needed for recommendations
        this.SIMILARITY_THRESHOLD = 0.3;
    }

    /**
     * Initialize recommendation engine
     */
    async init() {
        try {
            await this.setupRecommendationTables();
            logger.info('Recommendation Engine initialized');
        } catch (error) {
            logger.error('Error initializing Recommendation Engine:', error);
        }
    }

    /**
     * Set up database tables for recommendations
     */
    async setupRecommendationTables() {
        const data = await db.getData();
        
        if (!data.recommendations) {
            data.recommendations = {
                userInteractions: {},
                fontSimilarity: {},
                contentAnalysis: {},
                recommendations: {},
                models: {}
            };
        }

        await db.saveData(data);
    }

    /**
     * Record user interaction with font
     */
    async recordInteraction(userId, fontName, interactionType, metadata = {}) {
        try {
            const data = await db.getData();
            
            if (!data.recommendations.userInteractions[userId]) {
                data.recommendations.userInteractions[userId] = {};
            }

            if (!data.recommendations.userInteractions[userId][fontName]) {
                data.recommendations.userInteractions[userId][fontName] = {
                    views: 0,
                    uses: 0,
                    favorites: 0,
                    shares: 0,
                    rating: 0,
                    totalInteractions: 0,
                    lastInteraction: null,
                    metadata: []
                };
            }

            const interaction = data.recommendations.userInteractions[userId][fontName];
            
            // Update interaction counts
            if (interactionType === 'view') {
                interaction.views++;
            } else if (interactionType === 'use') {
                interaction.uses++;
            } else if (interactionType === 'favorite') {
                interaction.favorites++;
            } else if (interactionType === 'share') {
                interaction.shares++;
            } else if (interactionType === 'rating') {
                interaction.rating = metadata.rating || 0;
            }

            interaction.totalInteractions++;
            interaction.lastInteraction = new Date().toISOString();
            interaction.metadata.push({
                type: interactionType,
                data: metadata,
                timestamp: new Date().toISOString()
            });

            // Keep only recent metadata (last 50 interactions)
            if (interaction.metadata.length > 50) {
                interaction.metadata = interaction.metadata.slice(-50);
            }

            await db.saveData(data);
            
            // Trigger recommendation update if enough interactions
            if (interaction.totalInteractions >= this.MIN_INTERACTIONS) {
                await this.updateUserRecommendations(userId);
            }

            logger.debug('User interaction recorded:', { userId, fontName, interactionType });
        } catch (error) {
            logger.error('Error recording user interaction:', error);
        }
    }

    /**
     * Get personalized font recommendations for user
     */
    async getPersonalizedRecommendations(userId, limit = 10, options = {}) {
        try {
            const cacheKey = `recommendations_${userId}_${limit}`;
            const cached = this.modelCache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < this.CACHE_TTL && !options.forceRefresh) {
                return cached.recommendations;
            }

            const recommendations = await this.generatePersonalizedRecommendations(userId, limit, options);
            
            // Cache the results
            this.modelCache.set(cacheKey, {
                recommendations,
                timestamp: Date.now()
            });

            return recommendations;
        } catch (error) {
            logger.error('Error getting personalized recommendations:', error);
            return [];
        }
    }

    /**
     * Generate personalized recommendations using multiple algorithms
     */
    async generatePersonalizedRecommendations(userId, limit, options) {
        const data = await db.getData();
        const userInteractions = data.recommendations.userInteractions[userId];

        if (!userInteractions || Object.keys(userInteractions).length === 0) {
            return await this.getFallbackRecommendations(limit, options);
        }

        // Get recommendations from different algorithms
        const collaborativeRecs = await this.getCollaborativeFilteringRecommendations(userId, data);
        const contentBasedRecs = await this.getContentBasedRecommendations(userId, data);
        const trendingRecs = await this.getTrendingRecommendations(data);
        const diversityRecs = await this.getDiversityRecommendations(userId, data);

        // Combine and score recommendations
        const combinedRecs = this.combineRecommendations([
            { recommendations: collaborativeRecs, weight: 0.4, source: 'collaborative' },
            { recommendations: contentBasedRecs, weight: 0.3, source: 'content-based' },
            { recommendations: trendingRecs, weight: 0.2, source: 'trending' },
            { recommendations: diversityRecs, weight: 0.1, source: 'diversity' }
        ]);

        // Apply filters and constraints
        const filteredRecs = this.applyRecommendationFilters(combinedRecs, userId, data, options);

        // Sort by score and return top results
        return filteredRecs
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    /**
     * Collaborative filtering recommendations
     */
    async getCollaborativeFilteringRecommendations(userId, data) {
        try {
            const userInteractions = data.recommendations.userInteractions;
            const targetUser = userInteractions[userId];
            
            if (!targetUser) return [];

            // Find similar users based on font preferences
            const similarUsers = [];
            
            for (const [otherUserId, otherInteractions] of Object.entries(userInteractions)) {
                if (otherUserId === userId) continue;

                const similarity = this.calculateUserSimilarity(targetUser, otherInteractions);
                if (similarity > this.SIMILARITY_THRESHOLD) {
                    similarUsers.push({ userId: otherUserId, similarity, interactions: otherInteractions });
                }
            }

            // Sort by similarity and take top similar users
            similarUsers.sort((a, b) => b.similarity - a.similarity);
            const topSimilarUsers = similarUsers.slice(0, 20);

            // Get font recommendations from similar users
            const recommendations = {};
            const targetUserFonts = new Set(Object.keys(targetUser));

            for (const similarUser of topSimilarUsers) {
                for (const [fontName, interaction] of Object.entries(similarUser.interactions)) {
                    if (targetUserFonts.has(fontName)) continue; // Skip fonts user already knows

                    if (!recommendations[fontName]) {
                        recommendations[fontName] = {
                            fontName,
                            score: 0,
                            reasons: [],
                            sources: []
                        };
                    }

                    // Weight by user similarity and interaction strength
                    const interactionScore = this.calculateInteractionScore(interaction);
                    const weightedScore = interactionScore * similarUser.similarity;
                    
                    recommendations[fontName].score += weightedScore;
                    recommendations[fontName].sources.push({
                        type: 'similar_user',
                        similarity: similarUser.similarity,
                        interactionScore
                    });
                }
            }

            return Object.values(recommendations);
        } catch (error) {
            logger.error('Error generating collaborative filtering recommendations:', error);
            return [];
        }
    }

    /**
     * Content-based recommendations
     */
    async getContentBasedRecommendations(userId, data) {
        try {
            const userInteractions = data.recommendations.userInteractions[userId];
            if (!userInteractions) return [];

            // Analyze user's font preferences
            const userProfile = this.buildUserProfile(userInteractions);
            
            // Get available fonts and their characteristics
            const availableFonts = await this.getFontCharacteristics(data);
            
            const recommendations = [];
            const userFonts = new Set(Object.keys(userInteractions));

            for (const font of availableFonts) {
                if (userFonts.has(font.name)) continue;

                const similarity = this.calculateContentSimilarity(userProfile, font);
                if (similarity > 0.1) {
                    recommendations.push({
                        fontName: font.name,
                        score: similarity,
                        reasons: this.generateContentReasons(userProfile, font),
                        sources: [{
                            type: 'content_similarity',
                            similarity,
                            matchingAttributes: this.getMatchingAttributes(userProfile, font)
                        }]
                    });
                }
            }

            return recommendations;
        } catch (error) {
            logger.error('Error generating content-based recommendations:', error);
            return [];
        }
    }

    /**
     * Trending font recommendations
     */
    async getTrendingRecommendations(data) {
        try {
            const userInteractions = data.recommendations.userInteractions;
            const fontPopularity = {};

            // Calculate font popularity scores
            for (const [userId, interactions] of Object.entries(userInteractions)) {
                for (const [fontName, interaction] of Object.entries(interactions)) {
                    if (!fontPopularity[fontName]) {
                        fontPopularity[fontName] = {
                            users: new Set(),
                            totalInteractions: 0,
                            recentInteractions: 0,
                            avgRating: 0,
                            ratingCount: 0
                        };
                    }

                    const fontPop = fontPopularity[fontName];
                    fontPop.users.add(userId);
                    fontPop.totalInteractions += interaction.totalInteractions;

                    // Count recent interactions (last 7 days)
                    const lastWeek = new Date();
                    lastWeek.setDate(lastWeek.getDate() - 7);
                    
                    if (interaction.lastInteraction && new Date(interaction.lastInteraction) > lastWeek) {
                        fontPop.recentInteractions += interaction.totalInteractions;
                    }

                    // Average rating
                    if (interaction.rating > 0) {
                        fontPop.avgRating = ((fontPop.avgRating * fontPop.ratingCount) + interaction.rating) / (fontPop.ratingCount + 1);
                        fontPop.ratingCount++;
                    }
                }
            }

            // Calculate trending scores
            const recommendations = [];
            for (const [fontName, stats] of Object.entries(fontPopularity)) {
                const trendingScore = this.calculateTrendingScore(stats);
                
                recommendations.push({
                    fontName,
                    score: trendingScore,
                    reasons: [`Popular with ${stats.users.size} users`, `${stats.recentInteractions} recent uses`],
                    sources: [{
                        type: 'trending',
                        uniqueUsers: stats.users.size,
                        totalInteractions: stats.totalInteractions,
                        recentInteractions: stats.recentInteractions,
                        avgRating: stats.avgRating
                    }]
                });
            }

            return recommendations.sort((a, b) => b.score - a.score).slice(0, 20);
        } catch (error) {
            logger.error('Error generating trending recommendations:', error);
            return [];
        }
    }

    /**
     * Diversity-based recommendations to prevent filter bubbles
     */
    async getDiversityRecommendations(userId, data) {
        try {
            const userInteractions = data.recommendations.userInteractions[userId];
            if (!userInteractions) return [];

            const userProfile = this.buildUserProfile(userInteractions);
            const availableFonts = await this.getFontCharacteristics(data);
            const userFonts = new Set(Object.keys(userInteractions));

            const recommendations = [];
            
            // Find fonts that are different from user's usual preferences
            for (const font of availableFonts) {
                if (userFonts.has(font.name)) continue;

                const similarity = this.calculateContentSimilarity(userProfile, font);
                const diversityScore = 1 - similarity; // Higher score for more different fonts

                if (diversityScore > 0.3) {
                    recommendations.push({
                        fontName: font.name,
                        score: diversityScore * 0.5, // Lower weight for diversity recommendations
                        reasons: ['Explore a different style', 'Expand your font palette'],
                        sources: [{
                            type: 'diversity',
                            diversityScore,
                            differentAttributes: this.getDifferentAttributes(userProfile, font)
                        }]
                    });
                }
            }

            return recommendations.slice(0, 10);
        } catch (error) {
            logger.error('Error generating diversity recommendations:', error);
            return [];
        }
    }

    /**
     * Fallback recommendations for new users
     */
    async getFallbackRecommendations(limit, options) {
        try {
            const fallbackFonts = [
                { name: 'Arial', category: 'sans-serif', popularity: 0.9 },
                { name: 'Times New Roman', category: 'serif', popularity: 0.85 },
                { name: 'Helvetica', category: 'sans-serif', popularity: 0.8 },
                { name: 'Georgia', category: 'serif', popularity: 0.75 },
                { name: 'Verdana', category: 'sans-serif', popularity: 0.7 },
                { name: 'Comic Sans MS', category: 'display', popularity: 0.6 },
                { name: 'Impact', category: 'display', popularity: 0.65 },
                { name: 'Trebuchet MS', category: 'sans-serif', popularity: 0.6 }
            ];

            return fallbackFonts
                .sort((a, b) => b.popularity - a.popularity)
                .slice(0, limit)
                .map(font => ({
                    fontName: font.name,
                    score: font.popularity,
                    reasons: ['Popular choice', 'Great for beginners'],
                    sources: [{ type: 'fallback', category: font.category }]
                }));
        } catch (error) {
            logger.error('Error generating fallback recommendations:', error);
            return [];
        }
    }

    /**
     * Calculate similarity between two users based on their font interactions
     */
    calculateUserSimilarity(user1Interactions, user2Interactions) {
        const user1Fonts = new Set(Object.keys(user1Interactions));
        const user2Fonts = new Set(Object.keys(user2Interactions));
        
        // Jaccard similarity
        const intersection = new Set([...user1Fonts].filter(x => user2Fonts.has(x)));
        const union = new Set([...user1Fonts, ...user2Fonts]);
        
        if (union.size === 0) return 0;
        
        let jaccardSimilarity = intersection.size / union.size;

        // Weighted by interaction strength
        let weightedSimilarity = 0;
        let totalWeight = 0;

        for (const font of intersection) {
            const user1Score = this.calculateInteractionScore(user1Interactions[font]);
            const user2Score = this.calculateInteractionScore(user2Interactions[font]);
            
            const weight = Math.min(user1Score, user2Score);
            weightedSimilarity += weight * this.cosineSimilarity(
                [user1Score],
                [user2Score]
            );
            totalWeight += weight;
        }

        if (totalWeight > 0) {
            weightedSimilarity /= totalWeight;
            return (jaccardSimilarity * 0.3) + (weightedSimilarity * 0.7);
        }

        return jaccardSimilarity;
    }

    /**
     * Calculate interaction score for a font
     */
    calculateInteractionScore(interaction) {
        const weights = {
            views: 0.1,
            uses: 0.4,
            favorites: 0.3,
            shares: 0.2
        };

        let score = 0;
        score += interaction.views * weights.views;
        score += interaction.uses * weights.uses;
        score += interaction.favorites * weights.favorites;
        score += interaction.shares * weights.shares;

        // Bonus for rating
        if (interaction.rating > 0) {
            score *= (interaction.rating / 5);
        }

        return Math.min(score, 10); // Cap at 10
    }

    /**
     * Build user profile from interactions
     */
    buildUserProfile(userInteractions) {
        const profile = {
            categories: {},
            styles: {},
            weights: {},
            avgRating: 0,
            totalRatings: 0,
            preferredUseCases: {},
            timePatterns: {}
        };

        let totalInteractions = 0;

        for (const [fontName, interaction] of Object.entries(userInteractions)) {
            const interactionScore = this.calculateInteractionScore(interaction);
            totalInteractions += interactionScore;

            // Analyze font characteristics (simplified)
            const characteristics = this.inferFontCharacteristics(fontName);
            
            // Update profile based on characteristics
            if (characteristics.category) {
                profile.categories[characteristics.category] = 
                    (profile.categories[characteristics.category] || 0) + interactionScore;
            }

            if (characteristics.style) {
                profile.styles[characteristics.style] = 
                    (profile.styles[characteristics.style] || 0) + interactionScore;
            }

            if (characteristics.weight) {
                profile.weights[characteristics.weight] = 
                    (profile.weights[characteristics.weight] || 0) + interactionScore;
            }

            // Rating analysis
            if (interaction.rating > 0) {
                profile.avgRating = ((profile.avgRating * profile.totalRatings) + interaction.rating) / (profile.totalRatings + 1);
                profile.totalRatings++;
            }

            // Use case analysis from metadata
            interaction.metadata.forEach(meta => {
                if (meta.data.useCase) {
                    profile.preferredUseCases[meta.data.useCase] = 
                        (profile.preferredUseCases[meta.data.useCase] || 0) + 1;
                }
            });
        }

        // Normalize scores
        for (const category in profile.categories) {
            profile.categories[category] /= totalInteractions;
        }
        for (const style in profile.styles) {
            profile.styles[style] /= totalInteractions;
        }
        for (const weight in profile.weights) {
            profile.weights[weight] /= totalInteractions;
        }

        return profile;
    }

    /**
     * Get font characteristics (simplified implementation)
     */
    async getFontCharacteristics(data) {
        // This would typically come from a font database or analysis service
        // For now, we'll use simplified heuristics
        const commonFonts = [
            { name: 'Arial', category: 'sans-serif', style: 'modern', weight: 'normal' },
            { name: 'Times New Roman', category: 'serif', style: 'traditional', weight: 'normal' },
            { name: 'Helvetica', category: 'sans-serif', style: 'modern', weight: 'normal' },
            { name: 'Georgia', category: 'serif', style: 'readable', weight: 'normal' },
            { name: 'Verdana', category: 'sans-serif', style: 'web', weight: 'normal' },
            { name: 'Comic Sans MS', category: 'display', style: 'casual', weight: 'normal' },
            { name: 'Impact', category: 'display', style: 'bold', weight: 'heavy' },
            { name: 'Trebuchet MS', category: 'sans-serif', style: 'modern', weight: 'normal' }
        ];

        return commonFonts;
    }

    /**
     * Infer font characteristics from name (simplified)
     */
    inferFontCharacteristics(fontName) {
        const name = fontName.toLowerCase();
        
        let category = 'sans-serif'; // default
        let style = 'modern';
        let weight = 'normal';

        if (name.includes('serif') || name.includes('times') || name.includes('georgia')) {
            category = 'serif';
            style = 'traditional';
        }
        
        if (name.includes('comic') || name.includes('marker') || name.includes('brush')) {
            category = 'display';
            style = 'casual';
        }

        if (name.includes('bold') || name.includes('black') || name.includes('heavy')) {
            weight = 'heavy';
        }

        if (name.includes('light') || name.includes('thin')) {
            weight = 'light';
        }

        return { category, style, weight };
    }

    /**
     * Calculate content similarity between user profile and font
     */
    calculateContentSimilarity(userProfile, font) {
        let similarity = 0;
        let totalWeight = 0;

        // Category similarity
        if (userProfile.categories[font.category]) {
            similarity += userProfile.categories[font.category] * 0.4;
            totalWeight += 0.4;
        }

        // Style similarity
        if (userProfile.styles[font.style]) {
            similarity += userProfile.styles[font.style] * 0.3;
            totalWeight += 0.3;
        }

        // Weight similarity
        if (userProfile.weights[font.weight]) {
            similarity += userProfile.weights[font.weight] * 0.3;
            totalWeight += 0.3;
        }

        return totalWeight > 0 ? similarity / totalWeight : 0;
    }

    /**
     * Calculate trending score for a font
     */
    calculateTrendingScore(stats) {
        const userPopularity = Math.log(stats.users.size + 1) / 10;
        const recentActivity = Math.log(stats.recentInteractions + 1) / 10;
        const totalActivity = Math.log(stats.totalInteractions + 1) / 20;
        const ratingBonus = stats.avgRating > 0 ? (stats.avgRating - 3) / 10 : 0;

        return userPopularity + recentActivity + totalActivity + ratingBonus;
    }

    /**
     * Cosine similarity calculation
     */
    cosineSimilarity(vectorA, vectorB) {
        if (vectorA.length !== vectorB.length) return 0;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vectorA.length; i++) {
            dotProduct += vectorA[i] * vectorB[i];
            normA += vectorA[i] * vectorA[i];
            normB += vectorB[i] * vectorB[i];
        }

        normA = Math.sqrt(normA);
        normB = Math.sqrt(normB);

        if (normA === 0 || normB === 0) return 0;

        return dotProduct / (normA * normB);
    }

    /**
     * Combine recommendations from different sources
     */
    combineRecommendations(sources) {
        const combined = new Map();

        for (const source of sources) {
            for (const rec of source.recommendations) {
                const key = rec.fontName;
                
                if (!combined.has(key)) {
                    combined.set(key, {
                        fontName: rec.fontName,
                        score: 0,
                        reasons: [],
                        sources: []
                    });
                }

                const existing = combined.get(key);
                existing.score += rec.score * source.weight;
                existing.reasons.push(...rec.reasons);
                existing.sources.push({
                    type: source.source,
                    weight: source.weight,
                    originalScore: rec.score,
                    ...rec.sources[0]
                });
            }
        }

        return Array.from(combined.values());
    }

    /**
     * Apply filters to recommendations
     */
    applyRecommendationFilters(recommendations, userId, data, options) {
        let filtered = recommendations;

        // Remove fonts user has already interacted with
        const userInteractions = data.recommendations.userInteractions[userId] || {};
        const userFonts = new Set(Object.keys(userInteractions));
        
        filtered = filtered.filter(rec => !userFonts.has(rec.fontName));

        // Apply category filter if specified
        if (options.category) {
            filtered = filtered.filter(rec => 
                rec.sources.some(source => source.category === options.category)
            );
        }

        // Apply minimum score threshold
        const minScore = options.minScore || 0.1;
        filtered = filtered.filter(rec => rec.score >= minScore);

        // Remove duplicates and limit reasons
        filtered = filtered.map(rec => ({
            ...rec,
            reasons: [...new Set(rec.reasons)].slice(0, 3)
        }));

        return filtered;
    }

    /**
     * Generate content-based reasons
     */
    generateContentReasons(userProfile, font) {
        const reasons = [];

        if (userProfile.categories[font.category] > 0.3) {
            reasons.push(`You like ${font.category} fonts`);
        }

        if (userProfile.styles[font.style] > 0.3) {
            reasons.push(`Matches your ${font.style} style preference`);
        }

        if (userProfile.weights[font.weight] > 0.3) {
            reasons.push(`Similar weight to your favorites`);
        }

        return reasons.length > 0 ? reasons : ['Similar to fonts you\'ve used'];
    }

    /**
     * Get matching attributes between user profile and font
     */
    getMatchingAttributes(userProfile, font) {
        const matching = [];

        if (userProfile.categories[font.category] > 0.2) {
            matching.push('category');
        }

        if (userProfile.styles[font.style] > 0.2) {
            matching.push('style');
        }

        if (userProfile.weights[font.weight] > 0.2) {
            matching.push('weight');
        }

        return matching;
    }

    /**
     * Get different attributes for diversity recommendations
     */
    getDifferentAttributes(userProfile, font) {
        const different = [];

        if ((userProfile.categories[font.category] || 0) < 0.1) {
            different.push('category');
        }

        if ((userProfile.styles[font.style] || 0) < 0.1) {
            different.push('style');
        }

        if ((userProfile.weights[font.weight] || 0) < 0.1) {
            different.push('weight');
        }

        return different;
    }

    /**
     * Update user recommendations in database
     */
    async updateUserRecommendations(userId) {
        try {
            const recommendations = await this.getPersonalizedRecommendations(userId, 20, { forceRefresh: true });
            
            const data = await db.getData();
            data.recommendations.recommendations[userId] = {
                recommendations,
                lastUpdated: new Date().toISOString(),
                version: 1
            };

            await db.saveData(data);
            logger.debug('User recommendations updated:', { userId, count: recommendations.length });
        } catch (error) {
            logger.error('Error updating user recommendations:', error);
        }
    }

    /**
     * Get recommendation explanation for a specific font
     */
    async getRecommendationExplanation(userId, fontName) {
        try {
            const recommendations = await this.getPersonalizedRecommendations(userId, 50);
            const recommendation = recommendations.find(rec => rec.fontName === fontName);
            
            if (!recommendation) {
                return null;
            }

            return {
                fontName,
                score: recommendation.score,
                reasons: recommendation.reasons,
                sources: recommendation.sources,
                explanation: this.generateDetailedExplanation(recommendation)
            };
        } catch (error) {
            logger.error('Error getting recommendation explanation:', error);
            return null;
        }
    }

    /**
     * Generate detailed explanation for recommendation
     */
    generateDetailedExplanation(recommendation) {
        const explanations = [];

        for (const source of recommendation.sources) {
            switch (source.type) {
                case 'collaborative':
                    explanations.push(`Users similar to you also liked this font (similarity: ${(source.similarity * 100).toFixed(0)}%)`);
                    break;
                case 'content-based':
                    explanations.push(`This font matches your preferences in ${source.matchingAttributes.join(', ')}`);
                    break;
                case 'trending':
                    explanations.push(`Currently trending with ${source.uniqueUsers} users and ${source.recentInteractions} recent uses`);
                    break;
                case 'diversity':
                    explanations.push(`Recommended to expand your style - different in ${source.differentAttributes.join(', ')}`);
                    break;
            }
        }

        return explanations;
    }

    /**
     * Get recommendation statistics
     */
    async getRecommendationStats() {
        try {
            const data = await db.getData();
            const userRecommendations = data.recommendations.recommendations || {};
            const userInteractions = data.recommendations.userInteractions || {};

            const stats = {
                totalUsers: Object.keys(userInteractions).length,
                usersWithRecommendations: Object.keys(userRecommendations).length,
                totalInteractions: 0,
                avgInteractionsPerUser: 0,
                mostPopularFonts: {},
                recommendationCoverage: 0
            };

            // Calculate total interactions
            for (const [userId, interactions] of Object.entries(userInteractions)) {
                for (const [fontName, interaction] of Object.entries(interactions)) {
                    stats.totalInteractions += interaction.totalInteractions;
                    
                    if (!stats.mostPopularFonts[fontName]) {
                        stats.mostPopularFonts[fontName] = 0;
                    }
                    stats.mostPopularFonts[fontName] += interaction.totalInteractions;
                }
            }

            if (stats.totalUsers > 0) {
                stats.avgInteractionsPerUser = stats.totalInteractions / stats.totalUsers;
            }

            stats.recommendationCoverage = (stats.usersWithRecommendations / stats.totalUsers) * 100;

            // Get top 10 most popular fonts
            stats.mostPopularFonts = Object.entries(stats.mostPopularFonts)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 10)
                .reduce((obj, [font, count]) => {
                    obj[font] = count;
                    return obj;
                }, {});

            return stats;
        } catch (error) {
            logger.error('Error getting recommendation stats:', error);
            return null;
        }
    }

    /**
     * Clear recommendation cache
     */
    clearCache(userId = null) {
        if (userId) {
            // Clear cache for specific user
            for (const key of this.modelCache.keys()) {
                if (key.includes(userId)) {
                    this.modelCache.delete(key);
                }
            }
        } else {
            // Clear all cache
            this.modelCache.clear();
        }
    }
}

module.exports = new RecommendationEngine();
