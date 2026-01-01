// services/fontService.js

const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

// Constants for performance tuning
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in milliseconds
const MAX_SESSIONS = 1000; // Maximum number of user sessions to keep
const CLEANUP_INTERVAL = 15 * 60 * 1000; // Run cleanup every 15 minutes

let fontCache = [];
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

// Enhanced user session storage with timestamps
let userSessionData = new Map();

/**
 * Cleans up expired user sessions to prevent memory leaks
 */
function cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [chatId, sessionData] of userSessionData) {
        if (now - sessionData.timestamp > SESSION_TIMEOUT) {
            userSessionData.delete(chatId);
            cleanedCount++;
        }
    }
    
    // If we still have too many sessions, remove the oldest ones
    if (userSessionData.size > MAX_SESSIONS) {
        const sortedSessions = Array.from(userSessionData.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        const toRemove = sortedSessions.slice(0, userSessionData.size - MAX_SESSIONS);
        toRemove.forEach(([chatId]) => {
            userSessionData.delete(chatId);
            cleanedCount++;
        });
    }
    
    if (cleanedCount > 0) {
        logger.info(`Cleaned up ${cleanedCount} expired user sessions`);
    }
}

/**
 * Reads the font directory, sorts the files, and updates the in-memory font cache.
 * This function is called on startup and on admin's /refresh command.
 * Includes intelligent caching to avoid unnecessary filesystem operations.
 */
function initializeCache() {
    const now = Date.now();
    
    // Skip cache refresh if recent update (unless forced)
    if (fontCache.length > 0 && (now - lastCacheUpdate) < CACHE_TTL) {
        logger.debug('Font cache is still fresh, skipping refresh');
        return fontCache;
    }
    
    logger.info("Refreshing font cache...");
    
    try {
        const fontDirectory = process.env.FONT_DIRECTORY;
        
        if (!fontDirectory) {
            logger.error('FONT_DIRECTORY environment variable is not set');
            fontCache = [];
            return fontCache;
        }
        
        if (!fs.existsSync(fontDirectory)) {
            logger.error(`Font directory not found: ${fontDirectory}`);
            fontCache = [];
            return fontCache;
        }
        
        const files = fs.readdirSync(fontDirectory);
        fontCache = files
            .filter(file => {
                // More strict font file validation
                const ext = path.extname(file).toLowerCase();
                return ext === '.ttf' || ext === '.otf';
            })
            .filter(file => {
                // Additional check: ensure file is readable
                try {
                    const filePath = path.join(fontDirectory, file);
                    const stats = fs.statSync(filePath);
                    return stats.isFile() && stats.size > 0;
                } catch (error) {
                    logger.warn(`Skipping unreadable font file: ${file}`, { error: error.message });
                    return false;
                }
            })
            .sort((a, b) => {
                // Natural sort with case-insensitive comparison
                return a.localeCompare(b, undefined, {
                    numeric: true,
                    sensitivity: 'base',
                    caseFirst: 'lower'
                });
            });
        
        lastCacheUpdate = now;
        logger.info(`Font cache updated successfully. Found ${fontCache.length} valid fonts.`);
        
        // Trigger session cleanup during cache refresh
        cleanupExpiredSessions();
        
    } catch (error) {
        logger.error('Failed to refresh font cache:', { stack: error.stack });
        // Don't clear cache on error, keep previous valid cache
        if (fontCache.length === 0) {
            fontCache = []; // Only clear if no previous cache exists
        }
    }
    
    return fontCache;
}

/**
 * Returns the full list of cached font filenames.
 * @returns {string[]} Array of font filenames
 */
function getFontCache() {
    // Ensure cache is fresh
    if (fontCache.length === 0 || (Date.now() - lastCacheUpdate) > CACHE_TTL) {
        initializeCache();
    }
    
    return [...fontCache]; // Return a copy to prevent external modifications
}

/**
 * Stores a list of fonts for a specific user's session with timestamp.
 * @param {number} chatId The chat ID
 * @param {string[]} files Array of font filenames
 */
function setUserSession(chatId, files) {
    if (!chatId || !Array.isArray(files)) {
        logger.warn('Invalid parameters for setUserSession', { chatId, filesType: typeof files });
        return;
    }
    
    userSessionData.set(chatId.toString(), {
        files: files.slice(0, 5000), // Limit to prevent memory issues
        timestamp: Date.now()
    });
    
    // Occasional cleanup to prevent memory bloat
    if (Math.random() < 0.1) { // 10% chance
        cleanupExpiredSessions();
    }
}

/**
 * Retrieves the list of fonts for a specific user's session.
 * @param {number} chatId The chat ID
 * @returns {string[]|null} Array of font filenames or null if session doesn't exist/expired
 */
function getUserSession(chatId) {
    if (!chatId) return null;
    
    const sessionData = userSessionData.get(chatId.toString());
    
    if (!sessionData) {
        return null;
    }
    
    // Check if session has expired
    if (Date.now() - sessionData.timestamp > SESSION_TIMEOUT) {
        userSessionData.delete(chatId.toString());
        return null;
    }
    
    // Update timestamp for active session
    sessionData.timestamp = Date.now();
    
    return sessionData.files;
}

/**
 * Clear a specific user session
 * @param {number} chatId The chat ID
 */
function clearUserSession(chatId) {
    if (chatId) {
        userSessionData.delete(chatId.toString());
    }
}

/**
 * Get session statistics for monitoring
 * @returns {object} Statistics about current sessions
 */
function getSessionStats() {
    return {
        totalSessions: userSessionData.size,
        fontsInCache: fontCache.length,
        lastCacheUpdate: new Date(lastCacheUpdate).toISOString(),
        cacheAge: Date.now() - lastCacheUpdate
    };
}

/**
 * Force refresh font cache (bypass TTL)
 */
function forceRefreshCache() {
    lastCacheUpdate = 0; // Reset timestamp to force refresh
    return initializeCache();
}

// Set up periodic cleanup of expired sessions
setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL);

// Initial cache load on startup
initializeCache();

module.exports = {
    initializeCache,
    getFontCache,
    setUserSession,
    getUserSession,
    clearUserSession,
    getSessionStats,
    forceRefreshCache,
    cleanupExpiredSessions
};
