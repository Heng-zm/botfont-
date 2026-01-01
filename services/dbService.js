// services/dbService.js

const path = require('path');
const { logger } = require('./logger');
const eventEmitter = require('./eventService');
const { Mutex } = require('async-mutex');

const dbPath = path.join(__dirname, '..', 'db.json');
const mutex = new Mutex(); // Prevent race conditions during database writes

const defaultData = {
    users: {},
    bannedUsers: {},
    messageQueue: [],
    fileIdCache: {},
    broadcastResults: null
};

let db;

/**
 * Initialize database with proper error handling and structure validation
 */
async function initializeDatabase() {
    const { Low } = await import('lowdb');
    const { JSONFile } = await import('lowdb/node');
    const adapter = new JSONFile(dbPath);
    db = new Low(adapter, defaultData);

    const release = await mutex.acquire();
    try {
        await db.read();
        
        // Ensure all required fields exist
        db.data = db.data || {};
        db.data.users = db.data.users || {};
        db.data.bannedUsers = db.data.bannedUsers || {};
        db.data.messageQueue = db.data.messageQueue || [];
        db.data.fileIdCache = db.data.fileIdCache || {};
        db.data.broadcastResults = db.data.broadcastResults || null;
        
        await db.write();
        logger.info('Database initialized and validated successfully.');
    } catch (error) {
        logger.error('Failed to initialize database:', { stack: error.stack });
        throw error;
    } finally {
        release();
    }
}

/**
 * Add or update user information with proper validation
 */
async function addOrUpdateUser(cleanUser) {
    if (!cleanUser || !cleanUser.id) {
        logger.warn('Invalid user data provided to addOrUpdateUser');
        return;
    }
    
    const release = await mutex.acquire();
    try {
        const userId = cleanUser.id.toString();
        const now = new Date().toISOString();
        const existingRecord = db.data.users[userId];
        
        db.data.users[userId] = {
            ...cleanUser,
            lastSeen: now,
            firstSeen: existingRecord ? existingRecord.firstSeen : now,
            activity: existingRecord ? existingRecord.activity : {
                downloads: [],
                uploads: []
            }
        };
        
        await db.write();
    } catch (error) {
        logger.error('Failed to add/update user:', { error: error.message, userId: cleanUser.id });
        throw error;
    } finally {
        release();
    }
}
/**
 * Get all users from database
 */
const getAllUsers = () => Object.values(db.data.users || {});

/**
 * Find user by ID
 */
const findUserById = (userId) => (db.data.users || {})[userId.toString()] || null;

/**
 * Ban a user with reason and proper error handling
 */
async function banUser(userId, reason = 'No reason provided') {
    const release = await mutex.acquire();
    try {
        const id = userId.toString();
        if (db.data.bannedUsers[id]) return false;
        
        db.data.bannedUsers[id] = {
            reason: reason.substring(0, 500), // Limit reason length
            date: new Date().toISOString()
        };
        
        await db.write();
        eventEmitter.emit('dataChanged', { type: 'BANNED_USERS' });
        return true;
    } catch (error) {
        logger.error('Failed to ban user:', { error: error.message, userId });
        throw error;
    } finally {
        release();
    }
}

/**
 * Unban a user
 */
async function unbanUser(userId) {
    const release = await mutex.acquire();
    try {
        const id = userId.toString();
        if (!db.data.bannedUsers[id]) return false;
        
        delete db.data.bannedUsers[id];
        await db.write();
        return true;
    } catch (error) {
        logger.error('Failed to unban user:', { error: error.message, userId });
        throw error;
    } finally {
        release();
    }
}

/**
 * Check if user is banned
 */
const isUserBanned = (userId) => !!(db.data.bannedUsers || {})[userId.toString()];

/**
 * Get list of banned users
 */
const getBanList = () => Object.entries(db.data.bannedUsers || {}).map(([id, data]) => ({ id, ...data }));

/**
 * Log user download activity with size limits
 */
async function logDownload(userId, fontName) {
    const release = await mutex.acquire();
    try {
        const id = userId.toString();
        if (!db.data.users[id]) return;
        
        // Ensure activity structure exists
        if (!db.data.users[id].activity) {
            db.data.users[id].activity = { downloads: [], uploads: [] };
        }
        if (!db.data.users[id].activity.downloads) {
            db.data.users[id].activity.downloads = [];
        }
        
        // Add new download and limit to 20 entries
        db.data.users[id].activity.downloads.unshift({
            fontName: fontName.substring(0, 200), // Limit font name length
            date: new Date().toISOString()
        });
        
        // Keep only latest 20 downloads
        db.data.users[id].activity.downloads = db.data.users[id].activity.downloads.slice(0, 20);
        
        await db.write();
    } catch (error) {
        logger.error('Failed to log download:', { error: error.message, userId, fontName });
    } finally {
        release();
    }
}

/**
 * Log user upload activity with status tracking
 */
async function logUpload(userId, fontName, status, decisionDate = null) {
    const release = await mutex.acquire();
    try {
        const id = userId.toString();
        if (!db.data.users[id]) return;
        
        // Ensure activity structure exists
        if (!db.data.users[id].activity) {
            db.data.users[id].activity = { downloads: [], uploads: [] };
        }
        if (!db.data.users[id].activity.uploads) {
            db.data.users[id].activity.uploads = [];
        }
        
        const existingUploadIndex = db.data.users[id].activity.uploads.findIndex(
            u => u.fontName === fontName && u.status === 'pending'
        );
        
        if (existingUploadIndex > -1) {
            // Update existing upload status
            db.data.users[id].activity.uploads[existingUploadIndex].status = status;
            db.data.users[id].activity.uploads[existingUploadIndex].decisionDate = 
                decisionDate || new Date().toISOString();
        } else {
            // Add new upload
            db.data.users[id].activity.uploads.unshift({
                fontName: fontName.substring(0, 200),
                status,
                date: new Date().toISOString()
            });
        }
        
        // Keep only latest 20 uploads
        db.data.users[id].activity.uploads = db.data.users[id].activity.uploads.slice(0, 20);
        
        await db.write();
    } catch (error) {
        logger.error('Failed to log upload:', { error: error.message, userId, fontName });
    } finally {
        release();
    }
}

/**
 * Get bot statistics
 */
async function getStats() {
    try {
        const { getFontCache } = require('./fontService');
        return {
            totalUsers: Object.keys(db.data.users || {}).length,
            bannedCount: Object.keys(db.data.bannedUsers || {}).length,
            totalFonts: getFontCache().length,
            queuedMessages: (db.data.messageQueue || []).length
        };
    } catch (error) {
        logger.error('Failed to get stats:', { error: error.message });
        return {
            totalUsers: 0,
            bannedCount: 0,
            totalFonts: 0,
            queuedMessages: 0
        };
    }
}

/**
 * Add message to queue with validation
 */
async function addMessageToQueue(chatId, text, isBroadcast = false) {
    if (!text || typeof text !== 'string') {
        logger.warn('Invalid message text provided to queue');
        return;
    }
    
    const release = await mutex.acquire();
    try {
        if (!Array.isArray(db.data.messageQueue)) {
            db.data.messageQueue = [];
        }
        
        // Limit message queue size to prevent memory issues
        if (db.data.messageQueue.length >= 1000) {
            logger.warn('Message queue is full, removing oldest messages');
            db.data.messageQueue = db.data.messageQueue.slice(-500);
        }
        
        db.data.messageQueue.push({
            chatId,
            text: text.substring(0, 4000), // Telegram message limit
            isBroadcast,
            timestamp: new Date().toISOString()
        });
        
        await db.write();
    } catch (error) {
        logger.error('Failed to add message to queue:', { error: error.message });
        throw error;
    } finally {
        release();
    }
}

/**
 * Pop all messages from queue atomically
 */
async function popAllMessagesFromQueue() {
    const release = await mutex.acquire();
    try {
        if (!Array.isArray(db.data.messageQueue)) return [];
        
        const messages = [...db.data.messageQueue];
        db.data.messageQueue = [];
        
        await db.write();
        return messages;
    } catch (error) {
        logger.error('Failed to pop messages from queue:', { error: error.message });
        return [];
    } finally {
        release();
    }
}

/**
 * Start broadcast logging with validation
 */
async function startBroadcastLog(message, totalUsers) {
    const release = await mutex.acquire();
    try {
        db.data.broadcastResults = {
            message: message.substring(0, 1000),
            total: Math.max(0, totalUsers),
            sent: 0,
            failed: 0,
            startedAt: new Date().toISOString(),
            completedAt: null,
            errors: []
        };
        
        await db.write();
    } catch (error) {
        logger.error('Failed to start broadcast log:', { error: error.message });
    } finally {
        release();
    }
}

/**
 * Log broadcast result with error limiting
 */
async function logBroadcastResult(success, chatId, errorMessage) {
    const release = await mutex.acquire();
    try {
        if (!db.data.broadcastResults) return;
        
        if (success) {
            db.data.broadcastResults.sent += 1;
        } else {
            db.data.broadcastResults.failed += 1;
            
            // Limit errors to prevent memory bloat
            if (db.data.broadcastResults.errors.length < 50) {
                db.data.broadcastResults.errors.push({
                    chatId,
                    error: errorMessage ? errorMessage.substring(0, 200) : 'Unknown error'
                });
            }
        }
        
        await db.write();
    } catch (error) {
        logger.error('Failed to log broadcast result:', { error: error.message });
    } finally {
        release();
    }
}

/**
 * End broadcast logging
 */
async function endBroadcastLog() {
    const release = await mutex.acquire();
    try {
        if (!db.data.broadcastResults) return;
        
        db.data.broadcastResults.completedAt = new Date().toISOString();
        await db.write();
    } catch (error) {
        logger.error('Failed to end broadcast log:', { error: error.message });
    } finally {
        release();
    }
}

/**
 * Get broadcast status
 */
const getBroadcastStatus = () => db.data.broadcastResults || null;

/**
 * Get cached file ID
 */
const getCachedFileId = (fontName) => (db.data.fileIdCache || {})[fontName] || null;

/**
 * Cache file ID with cleanup
 */
async function cacheFileId(fontName, fileId) {
    const release = await mutex.acquire();
    try {
        if (!db.data.fileIdCache) {
            db.data.fileIdCache = {};
        }
        
        // Cleanup old cache entries if too many
        const cacheKeys = Object.keys(db.data.fileIdCache);
        if (cacheKeys.length >= 1000) {
            // Remove oldest 200 entries (simple cleanup)
            const keysToRemove = cacheKeys.slice(0, 200);
            keysToRemove.forEach(key => delete db.data.fileIdCache[key]);
            logger.info('Cleaned up file ID cache');
        }
        
        db.data.fileIdCache[fontName] = fileId;
        await db.write();
    } catch (error) {
        logger.error('Failed to cache file ID:', { error: error.message, fontName });
    } finally {
        release();
    }
}

/**
 * Get raw database data (for compatibility with enhanced services)
 */
function getData() {
    return db.data;
}

/**
 * Save data to database (for compatibility with enhanced services)
 */
async function saveData(data) {
    const release = await mutex.acquire();
    try {
        db.data = data;
        await db.write();
    } catch (error) {
        logger.error('Failed to save data:', { error: error.message });
        throw error;
    } finally {
        release();
    }
}

module.exports = {
    initializeDatabase,
    addOrUpdateUser,
    getAllUsers,
    findUserById,
    banUser,
    unbanUser,
    isUserBanned,
    getBanList,
    getStats,
    addMessageToQueue,
    popAllMessagesFromQueue,
    getCachedFileId,
    cacheFileId,
    startBroadcastLog,
    logBroadcastResult,
    endBroadcastLog,
    getBroadcastStatus,
    logDownload,
    logUpload,
    getData,
    saveData
};
