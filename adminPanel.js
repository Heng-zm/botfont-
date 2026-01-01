// adminPanel.js

const express = require('express');
const http = require('http'); // Import the native http module
const { WebSocketServer } = require('ws'); // Import the WebSocket server
const fs = require('fs');
const path = require('path');
const { logger } = require('./services/logger');
const eventEmitter = require('./services/eventService');

/**
 * Starts a robust web dashboard with a real-time WebSocket connection for the bot admin.
 * @param {TelegramBot} bot The running bot instance, required for sending notifications via the message queue.
 */
function startAdminPanel(bot) {
    if (!bot) {
        logger.error("FATAL: Admin Panel was called without a bot instance. It cannot start.");
        return;
    }

    // Import services inside the function to ensure they are initialized correctly.
    const dbService = require('./services/dbService');
    const { initializeCache, getFontCache } = require('./services/fontService');
    
    const app = express();
    const server = http.createServer(app); // Create an HTTP server from the Express app
    const wss = new WebSocketServer({ server }); // Attach the WebSocket server to the HTTP server

    const PORT = process.env.ADMIN_PANEL_PORT || 3000;
    
    // Define paths directly for clarity and robustness.
    const FONT_DIR = process.env.FONT_DIRECTORY;
    const PENDING_DIR = path.join(__dirname, 'pending_fonts');
    const DB_PATH = path.join(__dirname, 'db.json');
    const LOG_PATH = path.join(__dirname, 'combined.log');

    // Middleware to parse JSON bodies from requests.
    app.use(express.json());

    // Ensure necessary directories exist at startup.
    if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR);
    if (!FONT_DIR || !fs.existsSync(FONT_DIR)) {
        logger.error(`FATAL: FONT_DIRECTORY in .env is not configured correctly or does not exist. Path: ${FONT_DIR}`);
    }

    // --- WebSocket Connection Handling ---
    wss.on('connection', ws => {
        logger.info('Admin Panel client connected via WebSocket.');
        ws.on('error', console.error);
        ws.on('close', () => logger.info('Admin Panel client disconnected.'));
    });
    
    const broadcastToClients = (data) => {
        const payload = JSON.stringify(data);
        wss.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
                client.send(payload);
            }
        });
    };

    // Listen to events from the bot logic and broadcast them to all connected clients
    eventEmitter.on('dataChanged', (data) => {
        logger.info(`Event '${data.type}' received. Broadcasting real-time update.`);
        broadcastToClients({ event: 'dataUpdate' });
    });
    eventEmitter.on('newLog', (logMessage) => {
        broadcastToClients({ event: 'newLog', message: logMessage });
    });
    
    // --- API Endpoints ---

    // GET /api/data: The main endpoint for the Dashboard view
    app.get('/api/data', async (req, res) => {
        try {
            const dbData = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) : {};
            const pendingFonts = fs.readdirSync(PENDING_DIR);
            let allLogs = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean) : [];
            const allUsers = await dbService.getAllUsers();
            
            const logQuery = (req.query.log_search || '').toLowerCase();
            if (logQuery) {
                allLogs = allLogs.filter(log => log.toLowerCase().includes(logQuery));
            }
            const finalLogs = allLogs.slice(-200).reverse();

            res.json({
                stats: {
                    totalFonts: getFontCache().length,
                    pendingCount: pendingFonts.length,
                    bannedCount: Object.keys(dbData.bannedUsers || {}).length,
                    totalUsers: allUsers.length,
                },
                bannedUsers: Object.entries(dbData.bannedUsers || {}).map(([id, data]) => ({ id, ...data })),
                pendingFonts: pendingFonts,
                logs: finalLogs,
            });
        } catch (error) {
            logger.error('Failed to read data for admin panel', { stack: error.stack });
            res.status(500).json({ error: "Internal Server Error while reading data files." });
        }
    });

    // GET /api/broadcast/status: Get the status of the last broadcast.
    app.get('/api/broadcast/status', (req, res) => {
        try {
            const status = dbService.getBroadcastStatus();
            res.json(status);
        } catch (error) {
            logger.error('Failed to get broadcast status:', { stack: error.stack });
            res.status(500).json({ error: 'Could not get broadcast status.' });
        }
    });

    // GET /api/users: Endpoint for the "All Users" tab with search.
    app.get('/api/users', async (req, res) => {
        try {
            const allUsers = await dbService.getAllUsers();
            const bannedList = await dbService.getBanList();
            const bannedIds = new Set(bannedList.map(u => u.id));
            let users = allUsers.map(user => ({ ...user, isBanned: bannedIds.has(user.id.toString()) }));
            const searchQuery = (req.query.search || '').toLowerCase();
            if (searchQuery) {
                users = users.filter(user => 
                    Object.values(user).some(val => String(val).toLowerCase().includes(searchQuery))
                );
            }
            users.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen));
            res.json({ users });
        } catch (error) {
            logger.error('Failed to get user list for admin panel', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve user list.' });
        }
    });

    // GET /api/user/:id: Find a single user.
    app.get('/api/user/:id', async (req, res) => {
        const user = dbService.findUserById(req.params.id);
        if (user) {
            const isBanned = await dbService.isUserBanned(req.params.id);
            res.json({ ...user, isBanned });
        } else {
            res.status(404).json({ error: 'User not found' });
        }
    });

    // POST endpoints for actions. These queue tasks for the bot to handle.
    app.post('/api/message', async (req, res) => {
        const { userId, message } = req.body;
        if (!userId || !message) return res.status(400).json({ error: 'userId and message are required' });
        await dbService.addMessageToQueue(userId, message);
        res.json({ success: true, message: `Message queued for user ${userId}` });
    });
    
    app.post('/api/broadcast', async (req, res) => {
        const { message } = req.body;
        if (!message) return res.status(400).json({ error: 'Message is required' });
        await dbService.addMessageToQueue(null, message, true);
        res.json({ success: true, message: `Broadcast has been queued!` });
    });

    app.post('/api/ban', async (req, res) => {
        const { userId, reason } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });
        await dbService.banUser(Number(userId), reason || 'Banned from Admin Panel');
        res.json({ success: true });
    });

    app.post('/api/unban', async (req, res) => {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'userId is required' });
        await dbService.unbanUser(Number(userId));
        res.json({ success: true });
    });

    app.post('/api/approve', async (req, res) => {
        const { fileName } = req.body;
        if (!fileName) return res.status(400).json({ error: 'fileName is required' });
        const pendingFilePath = path.join(PENDING_DIR, fileName);
        if (!fs.existsSync(pendingFilePath)) return res.status(404).json({ error: 'File not found in pending directory.' });
        const originalFileName = fileName.split('_').slice(2).join('_');
        const uploaderId = fileName.split('_')[1];
        try {
            fs.copyFileSync(pendingFilePath, path.join(FONT_DIR, originalFileName));
            fs.unlinkSync(pendingFilePath);
            initializeCache();
            await dbService.logUpload(uploaderId, originalFileName, 'approved');
            if (uploaderId) await dbService.addMessageToQueue(uploaderId, `🎉 ពុម្ពអក្សរ *${originalFileName}* របស់អ្នកត្រូវបាន Approve។`);
            res.json({ success: true, message: `Approved ${originalFileName}` });
        } catch (error) {
            logger.error(`ADMIN PANEL: Failed to approve font ${fileName}`, { stack: error.stack });
            res.status(500).json({ error: `Failed to move file. Check server permissions and paths. Details: ${error.message}` });
        }
    });

    app.post('/api/reject', async (req, res) => {
        const { fileName } = req.body;
        if (!fileName) return res.status(400).json({ error: 'fileName is required' });
        const pendingFilePath = path.join(PENDING_DIR, fileName);
        if (!fs.existsSync(pendingFilePath)) return res.status(404).json({ error: 'File not found' });
        const uploaderId = fileName.split('_')[1];
        const originalFileName = fileName.split('_').slice(2).join('_');
        try {
            fs.unlinkSync(pendingFilePath);
            await dbService.logUpload(uploaderId, originalFileName, 'rejected');
            logger.warn(`ADMIN PANEL ACTION: Rejected font ${originalFileName}`);
            if (uploaderId) await dbService.addMessageToQueue(uploaderId, `ℹ️ សូមអភ័យទោស, ការស្នើសុំពុម្ពអក្សរ *${originalFileName}* របស់អ្នកត្រូវបានបដិសេធ។`);
            res.json({ success: true, message: `Rejected ${originalFileName}` });
        } catch (error) {
            logger.error(`ADMIN PANEL: Failed to reject font ${fileName}`, { stack: error.stack });
            res.status(500).json({ error: 'Failed to delete file.' });
        }
    });

    // --- Enhanced Advanced API Endpoints ---
    
    // Import additional services for enhanced functionality
    const analyticsService = require('./services/analyticsService');
    const monitoringService = require('./services/monitoringService');
    const notificationService = require('./services/notificationService');
    const contentService = require('./services/contentService');
    const errorTrackingService = require('./services/errorTrackingService');
    
    // Notification Management
    app.get('/api/notifications/templates', async (req, res) => {
        try {
            const data = await dbService.getData();
            const templates = data.notifications?.templates || {};
            res.json({ templates: Object.values(templates) });
        } catch (error) {
            logger.error('Failed to get notification templates:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve templates.' });
        }
    });

    app.post('/api/notifications/templates', async (req, res) => {
        try {
            const { name, subject, content, variables = [], channels = ['telegram'] } = req.body;
            if (!name || !content) return res.status(400).json({ error: 'Name and content are required' });
            
            const data = await dbService.getData();
            if (!data.notifications) data.notifications = { templates: {}, scheduled: {}, sent: {} };
            
            const templateId = Date.now().toString();
            data.notifications.templates[templateId] = {
                id: templateId,
                name,
                subject,
                content,
                variables,
                channels,
                createdAt: new Date().toISOString(),
                active: true
            };
            
            await dbService.saveData(data);
            res.json({ success: true, templateId });
        } catch (error) {
            logger.error('Failed to create notification template:', { stack: error.stack });
            res.status(500).json({ error: 'Could not create template.' });
        }
    });

    app.get('/api/notifications/scheduled', async (req, res) => {
        try {
            const data = await dbService.getData();
            const scheduled = data.notifications?.scheduled || {};
            res.json({ scheduled: Object.values(scheduled) });
        } catch (error) {
            logger.error('Failed to get scheduled notifications:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve scheduled notifications.' });
        }
    });

    // System Monitoring
    app.get('/api/monitoring/system', async (req, res) => {
        try {
            const memUsage = process.memoryUsage();
            const uptime = process.uptime();
            
            res.json({
                cpu: '1.2%', // This would come from actual system monitoring in production
                memory: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
                diskUsage: '45%',
                uptime: Math.floor(uptime / 3600) + 'h',
                requestsPerMinute: 0, // Would be calculated from actual metrics
                activeUsers: 0,
                errorRate: '0%',
                avgResponseTime: '150ms'
            });
        } catch (error) {
            logger.error('Failed to get system metrics:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve system metrics.' });
        }
    });

    app.get('/api/monitoring/errors', async (req, res) => {
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
            } = req.query;

            const result = await errorTrackingService.getErrors({
                page: parseInt(page),
                limit: parseInt(limit),
                severity,
                type,
                resolved: resolved !== undefined ? resolved === 'true' : undefined,
                userId,
                search,
                since
            });
            
            res.json(result);
        } catch (error) {
            logger.error('Failed to get error logs:', { stack: error.stack });
            errorTrackingService.trackError(error, null, { 
                component: 'admin_panel',
                action: 'get_errors',
                severity: 'medium'
            });
            res.status(500).json({ error: 'Could not retrieve error logs.' });
        }
    });

    // Error Tracking Statistics
    app.get('/api/monitoring/error-stats', async (req, res) => {
        try {
            const stats = await errorTrackingService.getErrorStats();
            res.json(stats);
        } catch (error) {
            logger.error('Failed to get error stats:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve error statistics.' });
        }
    });

    // Get specific error details
    app.get('/api/monitoring/errors/:errorId', async (req, res) => {
        try {
            const { errorId } = req.params;
            const errorDetails = await errorTrackingService.getErrorById(errorId);
            
            if (!errorDetails) {
                return res.status(404).json({ error: 'Error not found.' });
            }
            
            res.json(errorDetails);
        } catch (error) {
            logger.error('Failed to get error details:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve error details.' });
        }
    });

    // Resolve error
    app.put('/api/monitoring/errors/:errorId/resolve', async (req, res) => {
        try {
            const { errorId } = req.params;
            const { resolution } = req.body;
            
            const success = await errorTrackingService.resolveError(errorId, resolution);
            
            if (success) {
                res.json({ success: true, message: 'Error resolved successfully.' });
            } else {
                res.status(404).json({ error: 'Error not found or already resolved.' });
            }
        } catch (error) {
            logger.error('Failed to resolve error:', { stack: error.stack });
            res.status(500).json({ error: 'Could not resolve error.' });
        }
    });

    // Manually track an error (for testing purposes)
    app.post('/api/monitoring/errors/track', async (req, res) => {
        try {
            const { message, type, severity, userId, context } = req.body;
            
            if (!message) {
                return res.status(400).json({ error: 'Error message is required.' });
            }
            
            await errorTrackingService.trackError(
                new Error(message),
                userId,
                {
                    severity: severity || 'medium',
                    component: 'admin_panel',
                    action: 'manual_track',
                    ...context
                }
            );
            
            res.json({ success: true, message: 'Error tracked successfully.' });
        } catch (error) {
            logger.error('Failed to manually track error:', { stack: error.stack });
            res.status(500).json({ error: 'Could not track error.' });
        }
    });

    // Content Management
    app.get('/api/content', async (req, res) => {
        try {
            const data = await dbService.getData();
            const content = data.content || {};
            const { type, status, search } = req.query;
            
            let contentItems = Object.values(content);
            
            if (type && type !== 'all') {
                contentItems = contentItems.filter(item => item.type === type);
            }
            
            if (status && status !== 'all') {
                contentItems = contentItems.filter(item => item.status === status);
            }
            
            if (search) {
                const searchLower = search.toLowerCase();
                contentItems = contentItems.filter(item => 
                    item.title?.toLowerCase().includes(searchLower) ||
                    item.content?.toLowerCase().includes(searchLower)
                );
            }
            
            res.json({ content: contentItems, total: contentItems.length });
        } catch (error) {
            logger.error('Failed to get content:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve content.' });
        }
    });

    app.post('/api/content', async (req, res) => {
        try {
            const { title, content, type = 'announcement', status = 'draft' } = req.body;
            if (!title || !content) return res.status(400).json({ error: 'Title and content are required' });
            
            const data = await dbService.getData();
            if (!data.content) data.content = {};
            
            const contentId = Date.now().toString();
            data.content[contentId] = {
                id: contentId,
                title,
                content,
                type,
                status,
                createdAt: new Date().toISOString(),
                views: 0,
                author: 'Admin'
            };
            
            await dbService.saveData(data);
            res.json({ success: true, contentId });
        } catch (error) {
            logger.error('Failed to create content:', { stack: error.stack });
            res.status(500).json({ error: 'Could not create content.' });
        }
    });

    // Security Events
    app.get('/api/security/events', async (req, res) => {
        try {
            const data = await dbService.getData();
            const securityEvents = data.securityEvents || [];
            const { type } = req.query;
            
            let events = [...securityEvents];
            if (type && type !== 'all') {
                events = events.filter(event => event.type === type);
            }
            
            events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            events = events.slice(0, 50); // Last 50 events
            
            res.json({ events });
        } catch (error) {
            logger.error('Failed to get security events:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve security events.' });
        }
    });

    app.get('/api/security/stats', async (req, res) => {
        try {
            const data = await dbService.getData();
            const securityEvents = data.securityEvents || [];
            
            const today = new Date().toDateString();
            const todayEvents = securityEvents.filter(event => 
                new Date(event.timestamp).toDateString() === today
            );
            
            const stats = {
                failedLoginAttempts: todayEvents.filter(e => e.type === 'failed_login').length,
                suspiciousActivity: todayEvents.filter(e => e.type === 'suspicious_activity').length,
                blockedRequests: todayEvents.filter(e => e.type === 'blocked_request').length
            };
            
            res.json(stats);
        } catch (error) {
            logger.error('Failed to get security stats:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve security stats.' });
        }
    });

    // Analytics Data
    app.get('/api/analytics/data', async (req, res) => {
        try {
            const data = await dbService.getData();
            const analytics = data.analytics || {};
            
            // Generate sample analytics data
            const analyticsData = {
                userGrowth: {
                    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'],
                    data: [12, 19, 23, 28, 32, 35, 42]
                },
                fontDownloads: {
                    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
                    data: [65, 59, 80, 81, 56, 55, 40]
                },
                popularFonts: [
                    { name: 'Arial.ttf', downloads: 234 },
                    { name: 'Helvetica.ttf', downloads: 189 },
                    { name: 'Times New Roman.ttf', downloads: 156 }
                ]
            };
            
            res.json(analyticsData);
        } catch (error) {
            logger.error('Failed to get analytics data:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve analytics data.' });
        }
    });

    // Font Management
    app.get('/api/fonts', async (req, res) => {
        try {
            const fonts = getFontCache();
            const { search, category, sortBy } = req.query;
            
            // Add file size and download stats for each font
            let fontStats = fonts.map(font => {
                const fontPath = path.join(FONT_DIR, font);
                let size = 0;
                if (fs.existsSync(fontPath)) {
                    const stats = fs.statSync(fontPath);
                    size = stats.size;
                }
                
                return {
                    name: font,
                    size: Math.round(size / 1024), // Size in KB
                    downloads: Math.floor(Math.random() * 500), // Mock download count
                    category: 'sans-serif' // Default category
                };
            });
            
            if (search) {
                const searchLower = search.toLowerCase();
                fontStats = fontStats.filter(font => 
                    font.name.toLowerCase().includes(searchLower)
                );
            }
            
            if (category && category !== 'all') {
                fontStats = fontStats.filter(font => font.category === category);
            }
            
            if (sortBy) {
                switch (sortBy) {
                    case 'name':
                        fontStats.sort((a, b) => a.name.localeCompare(b.name));
                        break;
                    case 'downloads':
                        fontStats.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
                        break;
                    case 'size':
                        fontStats.sort((a, b) => (a.size || 0) - (b.size || 0));
                        break;
                    case 'recent':
                        fontStats.sort((a, b) => new Date(b.addedDate || 0) - new Date(a.addedDate || 0));
                        break;
                }
            }
            
            res.json({ fonts: fontStats, total: fontStats.length });
        } catch (error) {
            logger.error('Failed to get fonts:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve fonts.' });
        }
    });

    // Font Operations
    app.delete('/api/fonts/:fontName', async (req, res) => {
        try {
            const fontName = req.params.fontName;
            const fontPath = path.join(FONT_DIR, fontName);
            
            if (fs.existsSync(fontPath)) {
                fs.unlinkSync(fontPath);
                initializeCache(); // Refresh font cache
                logger.info(`Font deleted: ${fontName}`);
                eventEmitter.emit('dataChanged', { type: 'FONTS' });
                res.json({ success: true, message: `Font ${fontName} deleted successfully.` });
            } else {
                res.status(404).json({ error: 'Font not found.' });
            }
        } catch (error) {
            logger.error('Failed to delete font:', { stack: error.stack });
            res.status(500).json({ error: 'Could not delete font.' });
        }
    });

    // System Operations
    app.post('/api/system/backup', async (req, res) => {
        try {
            const backupData = {
                users: await dbService.getAllUsers(),
                bannedUsers: await dbService.getBanList(),
                fonts: getFontCache(),
                timestamp: new Date().toISOString()
            };
            
            const backupPath = path.join(__dirname, `backup_${Date.now()}.json`);
            fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
            
            logger.info('Database backup created successfully.');
            res.json({ success: true, message: 'Backup created successfully.', backupPath });
        } catch (error) {
            logger.error('Failed to create backup:', { stack: error.stack });
            res.status(500).json({ error: 'Could not create backup.' });
        }
    });

    app.post('/api/system/cache/clear', async (req, res) => {
        try {
            initializeCache();
            logger.info('System cache cleared successfully.');
            eventEmitter.emit('dataChanged', { type: 'CACHE_CLEARED' });
            res.json({ success: true, message: 'Cache cleared successfully.' });
        } catch (error) {
            logger.error('Failed to clear cache:', { stack: error.stack });
            res.status(500).json({ error: 'Could not clear cache.' });
        }
    });

    app.get('/api/system/logs/export', (req, res) => {
        try {
            const logPath = path.join(__dirname, 'combined.log');
            if (fs.existsSync(logPath)) {
                res.download(logPath, 'system_logs.log');
            } else {
                res.status(404).json({ error: 'Log file not found.' });
            }
        } catch (error) {
            logger.error('Failed to export logs:', { stack: error.stack });
            res.status(500).json({ error: 'Could not export logs.' });
        }
    });

    // Notification Analytics
    app.get('/api/notifications/analytics', async (req, res) => {
        try {
            const data = await dbService.getData();
            const notifications = data.notifications || {};
            const sent = notifications.sent || {};
            
            const today = new Date().toDateString();
            const todaySent = Object.values(sent).filter(n => 
                new Date(n.sentAt).toDateString() === today
            ).length;
            
            const analytics = {
                sentToday: todaySent,
                delivered: Math.floor(todaySent * 0.95), // Mock delivery rate
                openRate: '78%', // Mock open rate
                activeTemplates: Object.keys(notifications.templates || {}).length
            };
            
            res.json(analytics);
        } catch (error) {
            logger.error('Failed to get notification analytics:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve notification analytics.' });
        }
    });

    // Enhanced Monitoring Endpoints
    app.get('/api/monitoring/performance', async (req, res) => {
        try {
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            // Generate mock performance data over time
            const timeLabels = [];
            const cpuData = [];
            const memoryData = [];
            
            for (let i = 23; i >= 0; i--) {
                const time = new Date(Date.now() - i * 60000); // Last 24 minutes
                timeLabels.push(time.toLocaleTimeString().slice(0, 5));
                cpuData.push(Math.random() * 15 + 5); // Mock CPU usage 5-20%
                memoryData.push(Math.random() * 200 + 100); // Mock memory usage 100-300MB
            }
            
            res.json({
                cpu: { labels: timeLabels, data: cpuData },
                memory: { labels: timeLabels, data: memoryData },
                currentStats: {
                    cpu: Math.round(Math.random() * 10 + 2) + '%',
                    memory: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
                    uptime: Math.floor(process.uptime() / 3600) + 'h ' + Math.floor((process.uptime() % 3600) / 60) + 'm'
                }
            });
        } catch (error) {
            logger.error('Failed to get performance data:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve performance data.' });
        }
    });

    // Content Management Operations
    app.put('/api/content/:contentId', async (req, res) => {
        try {
            const { contentId } = req.params;
            const { title, content, type, status } = req.body;
            
            const data = await dbService.getData();
            if (!data.content || !data.content[contentId]) {
                return res.status(404).json({ error: 'Content not found.' });
            }
            
            data.content[contentId] = {
                ...data.content[contentId],
                title: title || data.content[contentId].title,
                content: content || data.content[contentId].content,
                type: type || data.content[contentId].type,
                status: status || data.content[contentId].status,
                updatedAt: new Date().toISOString()
            };
            
            await dbService.saveData(data);
            res.json({ success: true, message: 'Content updated successfully.' });
        } catch (error) {
            logger.error('Failed to update content:', { stack: error.stack });
            res.status(500).json({ error: 'Could not update content.' });
        }
    });

    app.delete('/api/content/:contentId', async (req, res) => {
        try {
            const { contentId } = req.params;
            const data = await dbService.getData();
            
            if (!data.content || !data.content[contentId]) {
                return res.status(404).json({ error: 'Content not found.' });
            }
            
            delete data.content[contentId];
            await dbService.saveData(data);
            res.json({ success: true, message: 'Content deleted successfully.' });
        } catch (error) {
            logger.error('Failed to delete content:', { stack: error.stack });
            res.status(500).json({ error: 'Could not delete content.' });
        }
    });

    // Security Operations
    app.post('/api/security/block-ip', async (req, res) => {
        try {
            const { ip, reason } = req.body;
            if (!ip) return res.status(400).json({ error: 'IP address is required.' });
            
            const data = await dbService.getData();
            if (!data.blockedIPs) data.blockedIPs = {};
            
            data.blockedIPs[ip] = {
                blockedAt: new Date().toISOString(),
                reason: reason || 'Blocked from admin panel'
            };
            
            await dbService.saveData(data);
            logger.warn(`IP blocked: ${ip}`, { reason });
            res.json({ success: true, message: `IP ${ip} has been blocked.` });
        } catch (error) {
            logger.error('Failed to block IP:', { stack: error.stack });
            res.status(500).json({ error: 'Could not block IP.' });
        }
    });

    // Get blocked IPs
    app.get('/api/security/blocked-ips', async (req, res) => {
        try {
            const data = await dbService.getData();
            const blockedIPs = data.blockedIPs || {};
            
            const ipList = Object.entries(blockedIPs).map(([ip, details]) => ({
                ip,
                ...details
            }));
            
            res.json({ blockedIPs: ipList });
        } catch (error) {
            logger.error('Failed to get blocked IPs:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve blocked IPs.' });
        }
    });

    // Unblock IP
    app.delete('/api/security/blocked-ips/:ip', async (req, res) => {
        try {
            const { ip } = req.params;
            const data = await dbService.getData();
            
            if (!data.blockedIPs || !data.blockedIPs[ip]) {
                return res.status(404).json({ error: 'IP not found in blocked list.' });
            }
            
            delete data.blockedIPs[ip];
            await dbService.saveData(data);
            logger.info(`IP unblocked: ${ip}`);
            res.json({ success: true, message: `IP ${ip} has been unblocked.` });
        } catch (error) {
            logger.error('Failed to unblock IP:', { stack: error.stack });
            res.status(500).json({ error: 'Could not unblock IP.' });
        }
    });

    // Security scan for suspicious activity
    app.post('/api/security/scan', async (req, res) => {
        try {
            const allUsers = await dbService.getAllUsers();
            const securityEvents = [];
            const suspiciousUsers = [];
            
            // Check for suspicious user patterns
            for (const user of allUsers) {
                const suspiciousIndicators = [];
                
                // Check for rapid registration patterns (multiple accounts from same source)
                const recentRegistrations = allUsers.filter(u => 
                    u.lastSeen && new Date(u.lastSeen).getTime() > Date.now() - 86400000 // Last 24 hours
                );
                
                if (recentRegistrations.length > 10) {
                    suspiciousIndicators.push('Rapid registration pattern detected');
                }
                
                // Check for unusual activity patterns
                if (!user.username && !user.first_name && !user.last_name) {
                    suspiciousIndicators.push('Anonymous user profile');
                }
                
                if (suspiciousIndicators.length > 0) {
                    suspiciousUsers.push({
                        userId: user.id,
                        indicators: suspiciousIndicators,
                        lastSeen: user.lastSeen
                    });
                }
            }
            
            // Log security scan results
            logger.info(`Security scan completed. Found ${suspiciousUsers.length} suspicious users.`);
            
            // Store scan results
            const data = await dbService.getData();
            if (!data.securityScans) data.securityScans = [];
            
            data.securityScans.push({
                timestamp: new Date().toISOString(),
                suspiciousUsers: suspiciousUsers.length,
                totalUsers: allUsers.length,
                details: suspiciousUsers
            });
            
            // Keep only last 10 scans
            data.securityScans = data.securityScans.slice(-10);
            await dbService.saveData(data);
            
            res.json({ 
                success: true, 
                suspiciousUsers, 
                totalScanned: allUsers.length,
                message: `Security scan completed. Found ${suspiciousUsers.length} suspicious patterns.`
            });
        } catch (error) {
            logger.error('Failed to perform security scan:', { stack: error.stack });
            res.status(500).json({ error: 'Could not perform security scan.' });
        }
    });

    // Get security scan history
    app.get('/api/security/scans', async (req, res) => {
        try {
            const data = await dbService.getData();
            const scans = data.securityScans || [];
            res.json({ scans });
        } catch (error) {
            logger.error('Failed to get security scans:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve security scans.' });
        }
    });

    // Generate security report
    app.get('/api/security/report', async (req, res) => {
        try {
            const data = await dbService.getData();
            const allUsers = await dbService.getAllUsers();
            const bannedUsers = await dbService.getBanList();
            
            const now = new Date();
            const last24h = new Date(now.getTime() - 86400000);
            const last7d = new Date(now.getTime() - 7 * 86400000);
            
            // Security metrics
            const report = {
                overview: {
                    totalUsers: allUsers.length,
                    bannedUsers: bannedUsers.length,
                    blockedIPs: Object.keys(data.blockedIPs || {}).length,
                    securityEvents: (data.securityEvents || []).length
                },
                activity: {
                    activeUsers24h: allUsers.filter(u => 
                        u.lastSeen && new Date(u.lastSeen) > last24h
                    ).length,
                    activeUsers7d: allUsers.filter(u => 
                        u.lastSeen && new Date(u.lastSeen) > last7d
                    ).length,
                    newUsers24h: allUsers.filter(u => 
                        u.createdAt && new Date(u.createdAt) > last24h
                    ).length
                },
                security: {
                    failedLogins24h: (data.securityEvents || []).filter(e => 
                        e.type === 'failed_login' && new Date(e.timestamp) > last24h
                    ).length,
                    suspiciousActivity24h: (data.securityEvents || []).filter(e => 
                        e.type === 'suspicious_activity' && new Date(e.timestamp) > last24h
                    ).length,
                    blockedRequests24h: (data.securityEvents || []).filter(e => 
                        e.type === 'blocked_request' && new Date(e.timestamp) > last24h
                    ).length
                },
                trends: {
                    userGrowth: {
                        today: allUsers.filter(u => 
                            u.createdAt && new Date(u.createdAt).toDateString() === now.toDateString()
                        ).length,
                        yesterday: allUsers.filter(u => {
                            const yesterday = new Date(now.getTime() - 86400000);
                            return u.createdAt && new Date(u.createdAt).toDateString() === yesterday.toDateString();
                        }).length
                    },
                    banRate: {
                        current: bannedUsers.length / allUsers.length * 100,
                        target: 5 // 5% target ban rate
                    }
                },
                timestamp: now.toISOString()
            };
            
            res.json({ report });
        } catch (error) {
            logger.error('Failed to generate security report:', { stack: error.stack });
            res.status(500).json({ error: 'Could not generate security report.' });
        }
    });

    // Security configuration management
    app.get('/api/security/config', async (req, res) => {
        try {
            const data = await dbService.getData();
            const securityConfig = data.securityConfig || {
                twoFactorAuth: false,
                ipWhitelist: false,
                rateLimiting: true,
                sessionTimeout: 30,
                maxLoginAttempts: 5,
                lockoutDuration: 15,
                passwordMinLength: 8,
                requireSpecialChars: true
            };
            
            res.json({ config: securityConfig });
        } catch (error) {
            logger.error('Failed to get security config:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve security configuration.' });
        }
    });

    app.put('/api/security/config', async (req, res) => {
        try {
            const data = await dbService.getData();
            const newConfig = req.body;
            
            // Validate configuration
            const validSettings = [
                'twoFactorAuth', 'ipWhitelist', 'rateLimiting', 'sessionTimeout',
                'maxLoginAttempts', 'lockoutDuration', 'passwordMinLength', 'requireSpecialChars'
            ];
            
            const filteredConfig = {};
            for (const key of validSettings) {
                if (newConfig[key] !== undefined) {
                    filteredConfig[key] = newConfig[key];
                }
            }
            
            data.securityConfig = { ...data.securityConfig, ...filteredConfig };
            await dbService.saveData(data);
            
            logger.info('Security configuration updated', filteredConfig);
            res.json({ success: true, message: 'Security configuration updated successfully.' });
        } catch (error) {
            logger.error('Failed to update security config:', { stack: error.stack });
            res.status(500).json({ error: 'Could not update security configuration.' });
        }
    });

    // Security audit log
    app.get('/api/security/audit', async (req, res) => {
        try {
            const { page = 1, limit = 50, type, userId, dateFrom, dateTo } = req.query;
            const data = await dbService.getData();
            let auditLogs = data.auditLogs || [];
            
            // Filter by type
            if (type && type !== 'all') {
                auditLogs = auditLogs.filter(log => log.type === type);
            }
            
            // Filter by user
            if (userId) {
                auditLogs = auditLogs.filter(log => log.userId === userId);
            }
            
            // Filter by date range
            if (dateFrom) {
                auditLogs = auditLogs.filter(log => new Date(log.timestamp) >= new Date(dateFrom));
            }
            if (dateTo) {
                auditLogs = auditLogs.filter(log => new Date(log.timestamp) <= new Date(dateTo));
            }
            
            // Sort by timestamp (newest first)
            auditLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            // Pagination
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + parseInt(limit);
            const paginatedLogs = auditLogs.slice(startIndex, endIndex);
            
            res.json({
                logs: paginatedLogs,
                total: auditLogs.length,
                page: parseInt(page),
                totalPages: Math.ceil(auditLogs.length / limit)
            });
        } catch (error) {
            logger.error('Failed to get audit logs:', { stack: error.stack });
            res.status(500).json({ error: 'Could not retrieve audit logs.' });
        }
    });

    // Log security audit event
    app.post('/api/security/audit', async (req, res) => {
        try {
            const { type, action, userId, details } = req.body;
            if (!type || !action) {
                return res.status(400).json({ error: 'Type and action are required.' });
            }
            
            const data = await dbService.getData();
            if (!data.auditLogs) data.auditLogs = [];
            
            const auditEntry = {
                id: Date.now().toString(),
                timestamp: new Date().toISOString(),
                type,
                action,
                userId: userId || 'system',
                details: details || {},
                ip: req.ip || 'unknown'
            };
            
            data.auditLogs.push(auditEntry);
            
            // Keep only last 1000 audit entries
            data.auditLogs = data.auditLogs.slice(-1000);
            
            await dbService.saveData(data);
            res.json({ success: true, auditId: auditEntry.id });
        } catch (error) {
            logger.error('Failed to log audit event:', { stack: error.stack });
            res.status(500).json({ error: 'Could not log audit event.' });
        }
    });

    // Scheduled Notifications
    app.post('/api/notifications/schedule', async (req, res) => {
        try {
            const { templateId, schedule, recipients } = req.body;
            if (!templateId || !schedule) {
                return res.status(400).json({ error: 'Template ID and schedule are required.' });
            }
            
            const data = await dbService.getData();
            if (!data.notifications) data.notifications = { templates: {}, scheduled: {}, sent: {} };
            
            const scheduleId = Date.now().toString();
            data.notifications.scheduled[scheduleId] = {
                id: scheduleId,
                templateId,
                schedule,
                recipients: recipients || 'all',
                status: 'active',
                createdAt: new Date().toISOString()
            };
            
            await dbService.saveData(data);
            res.json({ success: true, scheduleId, message: 'Notification scheduled successfully.' });
        } catch (error) {
            logger.error('Failed to schedule notification:', { stack: error.stack });
            res.status(500).json({ error: 'Could not schedule notification.' });
        }
    });

    // Template Operations
    app.put('/api/notifications/templates/:templateId', async (req, res) => {
        try {
            const { templateId } = req.params;
            const { name, subject, content, active } = req.body;
            
            const data = await dbService.getData();
            if (!data.notifications?.templates?.[templateId]) {
                return res.status(404).json({ error: 'Template not found.' });
            }
            
            data.notifications.templates[templateId] = {
                ...data.notifications.templates[templateId],
                name: name || data.notifications.templates[templateId].name,
                subject: subject || data.notifications.templates[templateId].subject,
                content: content || data.notifications.templates[templateId].content,
                active: active !== undefined ? active : data.notifications.templates[templateId].active,
                updatedAt: new Date().toISOString()
            };
            
            await dbService.saveData(data);
            res.json({ success: true, message: 'Template updated successfully.' });
        } catch (error) {
            logger.error('Failed to update template:', { stack: error.stack });
            res.status(500).json({ error: 'Could not update template.' });
        }
    });

    app.delete('/api/notifications/templates/:templateId', async (req, res) => {
        try {
            const { templateId } = req.params;
            const data = await dbService.getData();
            
            if (!data.notifications?.templates?.[templateId]) {
                return res.status(404).json({ error: 'Template not found.' });
            }
            
            delete data.notifications.templates[templateId];
            await dbService.saveData(data);
            res.json({ success: true, message: 'Template deleted successfully.' });
        } catch (error) {
            logger.error('Failed to delete template:', { stack: error.stack });
            res.status(500).json({ error: 'Could not delete template.' });
        }
    });

    // --- Static File Serving & Server Start ---
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'admin.html'));
    });
    
    // Use server.listen() to start listening on both HTTP and WebSocket protocols
    server.listen(PORT, () => {
        logger.info(`Admin Panel (HTTP & WebSocket) is running at http://localhost:${PORT}`);
    });
}

module.exports = { startAdminPanel };