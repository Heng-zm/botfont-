// services/contentService.js
const { logger } = require('./logger');
const db = require('./dbService');

class ContentService {
    constructor() {
        this.contentTypes = {
            announcement: { name: 'Announcement', icon: '📢' },
            tutorial: { name: 'Tutorial', icon: '🎓' },
            tip: { name: 'Tip & Trick', icon: '💡' },
            update: { name: 'Update', icon: '🔄' },
            promotion: { name: 'Promotion', icon: '🎉' }
        };

        this.contentStatus = {
            draft: { name: 'Draft', color: '#6b7280' },
            published: { name: 'Published', color: '#22c55e' },
            scheduled: { name: 'Scheduled', color: '#3b82f6' },
            archived: { name: 'Archived', color: '#8b5cf6' }
        };
    }

    /**
     * Initialize content service
     */
    async init() {
        try {
            await this.setupContentData();
            logger.info('Content Service initialized');
        } catch (error) {
            logger.error('Error initializing Content Service:', error);
        }
    }

    /**
     * Set up content data structure
     */
    async setupContentData() {
        try {
            const data = await db.getData();
            
            if (!data.content) {
                data.content = {};
            }

            if (!data.contentSchedule) {
                data.contentSchedule = {};
            }

            if (!data.contentAnalytics) {
                data.contentAnalytics = {
                    views: {},
                    engagement: {},
                    popular: []
                };
            }

            await db.saveData(data);
        } catch (error) {
            logger.error('Error setting up content data:', error);
        }
    }

    /**
     * Create new content
     */
    async createContent(contentData) {
        try {
            const { title, content, type = 'announcement', status = 'draft', author = 'Admin', tags = [], scheduledFor = null } = contentData;
            
            if (!title || !content) {
                throw new Error('Title and content are required');
            }

            const data = await db.getData();
            const contentId = Date.now().toString();
            
            const newContent = {
                id: contentId,
                title,
                content,
                type,
                status,
                author,
                tags,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                publishedAt: status === 'published' ? new Date().toISOString() : null,
                scheduledFor,
                views: 0,
                engagement: {
                    likes: 0,
                    shares: 0,
                    comments: []
                },
                metadata: {
                    wordCount: content.split(' ').length,
                    readTime: Math.ceil(content.split(' ').length / 200) // ~200 words per minute
                }
            };

            data.content[contentId] = newContent;

            // If scheduled, add to schedule
            if (status === 'scheduled' && scheduledFor) {
                if (!data.contentSchedule) data.contentSchedule = {};
                data.contentSchedule[contentId] = {
                    contentId,
                    scheduledFor,
                    status: 'pending',
                    createdAt: new Date().toISOString()
                };
            }

            await db.saveData(data);
            
            logger.info(`Content created: ${title} (${type})`);
            return newContent;

        } catch (error) {
            logger.error('Error creating content:', error);
            throw error;
        }
    }

    /**
     * Update existing content
     */
    async updateContent(contentId, updates) {
        try {
            const data = await db.getData();
            
            if (!data.content[contentId]) {
                throw new Error('Content not found');
            }

            const existingContent = data.content[contentId];
            
            // Update content
            data.content[contentId] = {
                ...existingContent,
                ...updates,
                updatedAt: new Date().toISOString()
            };

            // If status changed to published, set publishedAt
            if (updates.status === 'published' && existingContent.status !== 'published') {
                data.content[contentId].publishedAt = new Date().toISOString();
            }

            await db.saveData(data);
            
            logger.info(`Content updated: ${contentId}`);
            return data.content[contentId];

        } catch (error) {
            logger.error('Error updating content:', error);
            throw error;
        }
    }

    /**
     * Delete content
     */
    async deleteContent(contentId) {
        try {
            const data = await db.getData();
            
            if (!data.content[contentId]) {
                throw new Error('Content not found');
            }

            const contentTitle = data.content[contentId].title;
            
            // Remove from content
            delete data.content[contentId];
            
            // Remove from schedule if exists
            if (data.contentSchedule && data.contentSchedule[contentId]) {
                delete data.contentSchedule[contentId];
            }

            await db.saveData(data);
            
            logger.info(`Content deleted: ${contentTitle}`);
            return true;

        } catch (error) {
            logger.error('Error deleting content:', error);
            throw error;
        }
    }

    /**
     * Get content with filters
     */
    async getContent(filters = {}) {
        try {
            const data = await db.getData();
            const { type, status, author, search, limit = 50, offset = 0 } = filters;
            
            let contentList = Object.values(data.content || {});

            // Apply filters
            if (type && type !== 'all') {
                contentList = contentList.filter(item => item.type === type);
            }

            if (status && status !== 'all') {
                contentList = contentList.filter(item => item.status === status);
            }

            if (author && author !== 'all') {
                contentList = contentList.filter(item => item.author === author);
            }

            if (search) {
                const searchLower = search.toLowerCase();
                contentList = contentList.filter(item =>
                    item.title?.toLowerCase().includes(searchLower) ||
                    item.content?.toLowerCase().includes(searchLower) ||
                    item.tags?.some(tag => tag.toLowerCase().includes(searchLower))
                );
            }

            // Sort by creation date (newest first)
            contentList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            // Apply pagination
            const total = contentList.length;
            contentList = contentList.slice(offset, offset + limit);

            return {
                content: contentList,
                total,
                page: Math.floor(offset / limit) + 1,
                totalPages: Math.ceil(total / limit)
            };

        } catch (error) {
            logger.error('Error getting content:', error);
            throw error;
        }
    }

    /**
     * Get content by ID
     */
    async getContentById(contentId) {
        try {
            const data = await db.getData();
            const content = data.content?.[contentId];
            
            if (!content) {
                throw new Error('Content not found');
            }

            // Increment view count
            content.views = (content.views || 0) + 1;
            data.content[contentId] = content;
            
            // Track analytics
            await this.trackContentView(contentId);
            
            await db.saveData(data);

            return content;

        } catch (error) {
            logger.error('Error getting content by ID:', error);
            throw error;
        }
    }

    /**
     * Schedule content for publishing
     */
    async scheduleContent(contentId, scheduledFor) {
        try {
            const data = await db.getData();
            
            if (!data.content[contentId]) {
                throw new Error('Content not found');
            }

            // Update content status
            data.content[contentId].status = 'scheduled';
            data.content[contentId].scheduledFor = scheduledFor;
            data.content[contentId].updatedAt = new Date().toISOString();

            // Add to schedule
            if (!data.contentSchedule) data.contentSchedule = {};
            data.contentSchedule[contentId] = {
                contentId,
                scheduledFor,
                status: 'pending',
                createdAt: new Date().toISOString()
            };

            await db.saveData(data);
            
            logger.info(`Content scheduled: ${data.content[contentId].title} for ${scheduledFor}`);
            return true;

        } catch (error) {
            logger.error('Error scheduling content:', error);
            throw error;
        }
    }

    /**
     * Get scheduled content
     */
    async getScheduledContent() {
        try {
            const data = await db.getData();
            const scheduled = data.contentSchedule || {};
            
            const scheduledContent = Object.values(scheduled)
                .filter(item => item.status === 'pending')
                .map(item => ({
                    ...item,
                    content: data.content[item.contentId]
                }))
                .sort((a, b) => new Date(a.scheduledFor) - new Date(b.scheduledFor));

            return scheduledContent;

        } catch (error) {
            logger.error('Error getting scheduled content:', error);
            throw error;
        }
    }

    /**
     * Process scheduled content (to be called periodically)
     */
    async processScheduledContent() {
        try {
            const data = await db.getData();
            const now = new Date();
            const scheduled = data.contentSchedule || {};
            
            const publishedContent = [];
            
            for (const [scheduleId, scheduleItem] of Object.entries(scheduled)) {
                if (scheduleItem.status === 'pending' && new Date(scheduleItem.scheduledFor) <= now) {
                    // Publish content
                    if (data.content[scheduleItem.contentId]) {
                        data.content[scheduleItem.contentId].status = 'published';
                        data.content[scheduleItem.contentId].publishedAt = now.toISOString();
                        
                        // Update schedule status
                        data.contentSchedule[scheduleId].status = 'published';
                        data.contentSchedule[scheduleId].publishedAt = now.toISOString();
                        
                        publishedContent.push(data.content[scheduleItem.contentId]);
                    }
                }
            }

            if (publishedContent.length > 0) {
                await db.saveData(data);
                logger.info(`Published ${publishedContent.length} scheduled content items`);
            }

            return publishedContent;

        } catch (error) {
            logger.error('Error processing scheduled content:', error);
            throw error;
        }
    }

    /**
     * Track content view for analytics
     */
    async trackContentView(contentId) {
        try {
            const data = await db.getData();
            
            if (!data.contentAnalytics) {
                data.contentAnalytics = { views: {}, engagement: {}, popular: [] };
            }
            
            const today = new Date().toISOString().split('T')[0];
            
            if (!data.contentAnalytics.views[today]) {
                data.contentAnalytics.views[today] = {};
            }
            
            if (!data.contentAnalytics.views[today][contentId]) {
                data.contentAnalytics.views[today][contentId] = 0;
            }
            
            data.contentAnalytics.views[today][contentId]++;
            
            // Don't save here to avoid frequent writes
            // This will be saved when the content is updated

        } catch (error) {
            logger.error('Error tracking content view:', error);
        }
    }

    /**
     * Get content analytics
     */
    async getContentAnalytics(period = '7d') {
        try {
            const data = await db.getData();
            const analytics = data.contentAnalytics || { views: {}, engagement: {}, popular: [] };
            
            // Calculate date range
            const endDate = new Date();
            const days = period === '30d' ? 30 : 7;
            const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
            
            // Get views for period
            const viewsData = [];
            const contentViews = {};
            
            for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                const dateKey = d.toISOString().split('T')[0];
                const dayViews = analytics.views[dateKey] || {};
                
                let totalViews = 0;
                Object.entries(dayViews).forEach(([contentId, views]) => {
                    totalViews += views;
                    contentViews[contentId] = (contentViews[contentId] || 0) + views;
                });
                
                viewsData.push({
                    date: dateKey,
                    views: totalViews
                });
            }
            
            // Get most popular content
            const popularContent = Object.entries(contentViews)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([contentId, views]) => ({
                    content: data.content[contentId],
                    views
                }))
                .filter(item => item.content);
            
            return {
                views: viewsData,
                popular: popularContent,
                totalViews: viewsData.reduce((sum, day) => sum + day.views, 0),
                totalContent: Object.keys(data.content || {}).length
            };

        } catch (error) {
            logger.error('Error getting content analytics:', error);
            throw error;
        }
    }

    /**
     * Get content statistics
     */
    async getContentStats() {
        try {
            const data = await db.getData();
            const content = data.content || {};
            
            const stats = {
                total: Object.keys(content).length,
                published: 0,
                draft: 0,
                scheduled: 0,
                archived: 0,
                byType: {},
                totalViews: 0,
                avgWordsPerContent: 0
            };
            
            let totalWords = 0;
            
            Object.values(content).forEach(item => {
                // Count by status
                stats[item.status] = (stats[item.status] || 0) + 1;
                
                // Count by type
                stats.byType[item.type] = (stats.byType[item.type] || 0) + 1;
                
                // Sum views
                stats.totalViews += item.views || 0;
                
                // Sum words
                totalWords += item.metadata?.wordCount || 0;
            });
            
            stats.avgWordsPerContent = stats.total > 0 ? Math.round(totalWords / stats.total) : 0;
            
            return stats;

        } catch (error) {
            logger.error('Error getting content stats:', error);
            throw error;
        }
    }
}

// Create singleton instance
const contentService = new ContentService();

module.exports = contentService;
