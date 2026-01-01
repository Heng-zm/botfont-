// services/errorTrackingService.js

const { logger } = require('./logger');
const dbService = require('./dbService');
const eventEmitter = require('./eventService');

class ErrorTrackingService {
    constructor() {
        this.errors = new Map(); // In-memory cache for recent errors
        this.errorCount = 0;
        this.startTime = Date.now();
        
        // Set up global error handlers
        this.setupGlobalErrorHandlers();
        
        // Cleanup old errors periodically
        setInterval(() => this.cleanupOldErrors(), 60 * 60 * 1000); // Every hour
    }

    /**
     * Set up global error handlers to catch unhandled errors
     */
    setupGlobalErrorHandlers() {
        // Catch uncaught exceptions
        process.on('uncaughtException', (error) => {
            this.trackError(error, null, { 
                type: 'uncaught_exception',
                severity: 'critical'
            });
        });

        // Catch unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            this.trackError(reason, null, {
                type: 'unhandled_rejection',
                severity: 'high',
                promise: promise.toString()
            });
        });
    }

    /**
     * Track a new error
     * @param {Error|string} error - The error to track
     * @param {string|number} userId - Optional user ID associated with the error
     * @param {object} context - Additional context about the error
     */
    async trackError(error, userId = null, context = {}) {
        try {
            const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const timestamp = new Date().toISOString();
            
            // Normalize error object
            let errorInfo;
            if (error instanceof Error) {
                errorInfo = {
                    name: error.name,
                    message: error.message,
                    stack: error.stack
                };
            } else if (typeof error === 'string') {
                errorInfo = {
                    name: 'CustomError',
                    message: error,
                    stack: null
                };
            } else {
                errorInfo = {
                    name: 'UnknownError',
                    message: String(error),
                    stack: null
                };
            }

            const errorRecord = {
                id: errorId,
                timestamp,
                type: errorInfo.name,
                message: errorInfo.message,
                stack: errorInfo.stack,
                userId,
                context: {
                    severity: context.severity || 'medium',
                    component: context.component || 'unknown',
                    action: context.action || 'unknown',
                    userAgent: context.userAgent,
                    ip: context.ip,
                    ...context
                },
                fingerprint: this.generateFingerprint(errorInfo),
                resolved: false,
                count: 1,
                firstSeen: timestamp,
                lastSeen: timestamp
            };

            // Store in memory cache
            this.errors.set(errorId, errorRecord);
            this.errorCount++;

            // Store in database
            await this.persistError(errorRecord);

            // Emit event for real-time updates
            eventEmitter.emit('errorTracked', errorRecord);

            // Log the error
            logger.error(`Error tracked: ${errorInfo.message}`, {
                errorId,
                userId,
                context,
                stack: errorInfo.stack
            });

        } catch (trackingError) {
            // If error tracking fails, at least log it
            logger.error('Failed to track error:', trackingError);
        }
    }

    /**
     * Generate a fingerprint for error deduplication
     * @param {object} errorInfo - Error information
     * @returns {string} - Error fingerprint
     */
    generateFingerprint(errorInfo) {
        const key = `${errorInfo.name}:${errorInfo.message}`;
        // Simple hash function for fingerprinting
        let hash = 0;
        for (let i = 0; i < key.length; i++) {
            const char = key.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    /**
     * Persist error to database with deduplication
     * @param {object} errorRecord - Error record to persist
     */
    async persistError(errorRecord) {
        try {
            const data = await dbService.getData();
            
            if (!data.errors) {
                data.errors = {};
            }

            if (!data.errorStats) {
                data.errorStats = {
                    total: 0,
                    byType: {},
                    byDay: {},
                    resolved: 0
                };
            }

            // Check for duplicate errors by fingerprint
            const existingError = Object.values(data.errors)
                .find(err => err.fingerprint === errorRecord.fingerprint && !err.resolved);

            if (existingError) {
                // Update existing error
                existingError.count++;
                existingError.lastSeen = errorRecord.timestamp;
                
                // Update context if new information is available
                if (errorRecord.context && Object.keys(errorRecord.context).length > 0) {
                    existingError.context = { ...existingError.context, ...errorRecord.context };
                }
            } else {
                // Store new error
                data.errors[errorRecord.id] = errorRecord;
            }

            // Update statistics
            data.errorStats.total++;
            data.errorStats.byType[errorRecord.type] = (data.errorStats.byType[errorRecord.type] || 0) + 1;
            
            const dayKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            data.errorStats.byDay[dayKey] = (data.errorStats.byDay[dayKey] || 0) + 1;

            await dbService.saveData(data);

        } catch (error) {
            logger.error('Failed to persist error to database:', error);
        }
    }

    /**
     * Get recent errors with filtering and pagination
     * @param {object} options - Query options
     * @returns {object} - Error list with metadata
     */
    async getErrors(options = {}) {
        try {
            const {
                page = 1,
                limit = 50,
                severity,
                type,
                resolved,
                userId,
                search,
                since
            } = options;

            const data = await dbService.getData();
            let errors = Object.values(data.errors || {});

            // Apply filters
            if (severity) {
                errors = errors.filter(err => err.context?.severity === severity);
            }

            if (type && type !== 'all') {
                errors = errors.filter(err => err.type === type);
            }

            if (resolved !== undefined) {
                errors = errors.filter(err => err.resolved === resolved);
            }

            if (userId) {
                errors = errors.filter(err => err.userId?.toString() === userId.toString());
            }

            if (search) {
                const searchLower = search.toLowerCase();
                errors = errors.filter(err => 
                    err.message.toLowerCase().includes(searchLower) ||
                    err.type.toLowerCase().includes(searchLower)
                );
            }

            if (since) {
                const sinceDate = new Date(since);
                errors = errors.filter(err => new Date(err.timestamp) >= sinceDate);
            }

            // Sort by last seen (most recent first)
            errors.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));

            // Paginate
            const total = errors.length;
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            const paginatedErrors = errors.slice(startIndex, endIndex);

            return {
                errors: paginatedErrors,
                pagination: {
                    page,
                    limit,
                    total,
                    pages: Math.ceil(total / limit)
                }
            };

        } catch (error) {
            logger.error('Failed to get errors:', error);
            return { errors: [], pagination: { page: 1, limit, total: 0, pages: 0 } };
        }
    }

    /**
     * Get error statistics
     * @returns {object} - Error statistics
     */
    async getErrorStats() {
        try {
            const data = await dbService.getData();
            const errorStats = data.errorStats || { total: 0, byType: {}, byDay: {}, resolved: 0 };
            
            const now = new Date();
            const today = now.toISOString().split('T')[0];
            const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            
            // Calculate error rate (errors per hour over last 24 hours)
            const last24Hours = Object.entries(errorStats.byDay)
                .filter(([day]) => day >= yesterday)
                .reduce((sum, [, count]) => sum + count, 0);
            
            const errorRate = Math.round((last24Hours / 24) * 100) / 100;

            // Get top error types
            const topErrorTypes = Object.entries(errorStats.byType)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([type, count]) => ({ type, count }));

            return {
                total: errorStats.total,
                resolved: errorStats.resolved,
                unresolved: errorStats.total - errorStats.resolved,
                todayCount: errorStats.byDay[today] || 0,
                yesterdayCount: errorStats.byDay[yesterday] || 0,
                errorRate: errorRate + ' errors/hour',
                topTypes: topErrorTypes,
                uptime: Math.floor((Date.now() - this.startTime) / 1000 / 3600) + 'h'
            };

        } catch (error) {
            logger.error('Failed to get error stats:', error);
            return {
                total: 0,
                resolved: 0,
                unresolved: 0,
                todayCount: 0,
                yesterdayCount: 0,
                errorRate: '0 errors/hour',
                topTypes: [],
                uptime: '0h'
            };
        }
    }

    /**
     * Mark error as resolved
     * @param {string} errorId - Error ID to resolve
     * @param {string} resolution - Resolution notes
     */
    async resolveError(errorId, resolution = '') {
        try {
            const data = await dbService.getData();
            
            if (data.errors && data.errors[errorId]) {
                data.errors[errorId].resolved = true;
                data.errors[errorId].resolvedAt = new Date().toISOString();
                data.errors[errorId].resolution = resolution;
                
                // Update stats
                if (!data.errorStats) data.errorStats = { resolved: 0 };
                data.errorStats.resolved++;
                
                await dbService.saveData(data);
                
                // Remove from memory cache
                this.errors.delete(errorId);
                
                logger.info(`Error resolved: ${errorId}`, { resolution });
                eventEmitter.emit('errorResolved', { errorId, resolution });
                
                return true;
            }
            
            return false;

        } catch (error) {
            logger.error('Failed to resolve error:', error);
            return false;
        }
    }

    /**
     * Clean up old resolved errors
     */
    async cleanupOldErrors() {
        try {
            const data = await dbService.getData();
            if (!data.errors) return;

            const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            let cleanedCount = 0;

            Object.keys(data.errors).forEach(errorId => {
                const error = data.errors[errorId];
                if (error.resolved && new Date(error.resolvedAt) < thirtyDaysAgo) {
                    delete data.errors[errorId];
                    cleanedCount++;
                }
            });

            if (cleanedCount > 0) {
                await dbService.saveData(data);
                logger.info(`Cleaned up ${cleanedCount} old resolved errors`);
            }

        } catch (error) {
            logger.error('Failed to cleanup old errors:', error);
        }
    }

    /**
     * Get error details by ID
     * @param {string} errorId - Error ID
     * @returns {object|null} - Error details
     */
    async getErrorById(errorId) {
        try {
            const data = await dbService.getData();
            return data.errors?.[errorId] || null;
        } catch (error) {
            logger.error('Failed to get error by ID:', error);
            return null;
        }
    }
}

// Create singleton instance
const errorTrackingService = new ErrorTrackingService();

module.exports = errorTrackingService;
