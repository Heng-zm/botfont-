// adminPanel.js

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { logger } = require('./services/logger');
const eventEmitter = require('./services/eventService');

/**
 * Starts a web dashboard with a real-time WebSocket connection.
 * @param {TelegramBot} bot The running bot instance.
 */
function startAdminPanel(bot) {
    if (!bot) {
        logger.error("FATAL: Admin Panel was called without a bot instance. It cannot start.");
        return;
    }

    // Import services locally to avoid circular dependencies
    const dbService = require('./services/dbService');
    const { initializeCache, getFontCache } = require('./services/fontService');
    
    const app = express();
    const server = http.createServer(app);
    const wss = new WebSocketServer({ server });

    const PORT = process.env.ADMIN_PANEL_PORT || 3000;
    
    // --- PATH CONFIGURATION ---
    const FONT_DIR = process.env.FONT_DIRECTORY || path.join(__dirname, 'fonts');
    const PENDING_DIR = path.join(__dirname, 'pending_fonts');
    const DB_PATH = path.join(__dirname, 'db.json');
    const LOG_PATH = path.join(__dirname, 'combined.log');

    // Middleware
    app.use(express.json());

    // Ensure directories exist
    if (!fs.existsSync(PENDING_DIR)) fs.mkdirSync(PENDING_DIR);
    if (!fs.existsSync(FONT_DIR)) {
        try { fs.mkdirSync(FONT_DIR); } catch(e) {}
    }

    // --- WebSocket Connection Handling ---
    wss.on('connection', ws => {
        ws.on('error', console.error);
    });
    
    const broadcastToClients = (data) => {
        const payload = JSON.stringify(data);
        wss.clients.forEach(client => {
            if (client.readyState === client.OPEN) {
                client.send(payload);
            }
        });
    };

    eventEmitter.on('dataChanged', (data) => {
        broadcastToClients({ event: 'dataUpdate', type: data.type });
    });
    eventEmitter.on('newLog', (logMessage) => {
        broadcastToClients({ event: 'newLog', message: logMessage });
    });
    
    // --- API Endpoints ---

    // GET /api/data: Dashboard Overview
    app.get('/api/data', async (req, res) => {
        try {
            const dbData = fs.existsSync(DB_PATH) ? JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) : {};
            const bannedUsers = dbData.bannedUsers || {};
            const pendingFonts = fs.existsSync(PENDING_DIR) ? fs.readdirSync(PENDING_DIR).filter(f => !f.startsWith('.')) : [];
            
            let allLogs = fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf-8').split('\n').filter(Boolean) : [];
            if (req.query.log_search) {
                const q = req.query.log_search.toLowerCase();
                allLogs = allLogs.filter(log => log.toLowerCase().includes(q));
            }
            
            const allUsers = await dbService.getAllUsers();

            res.json({
                stats: {
                    totalFonts: getFontCache().length,
                    pendingCount: pendingFonts.length,
                    bannedCount: Object.keys(bannedUsers).length,
                    totalUsers: allUsers.length,
                },
                bannedUsers: Object.entries(bannedUsers).map(([id, data]) => ({ id, ...data })),
                pendingFonts: pendingFonts,
                logs: allLogs.slice(-50).reverse(),
            });
        } catch (error) {
            logger.error('API /data Error:', error);
            res.status(500).json({ error: "Failed to load data" });
        }
    });

    // GET /api/analytics
    app.get('/api/analytics', async (req, res) => {
        try {
            const allUsers = await dbService.getAllUsers();
            
            // Generate basic analytics
            const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            const growthData = [0, 0, 0, 0, 0, 0, 0];
            
            allUsers.forEach(u => {
                if(u.createdAt) {
                    const d = new Date(u.createdAt);
                    growthData[d.getDay()]++;
                }
            });

            // Mock download data (Replace with real DB aggregation if you have it)
            const downloadData = [10, 20, 15, 30, 25, 40, 35]; 

            res.json({
                userGrowth: {
                    labels: days,
                    datasets: [{ label: 'New Users', data: growthData, borderColor: '#3b82f6', tension: 0.4 }]
                },
                downloads: {
                    labels: days,
                    datasets: [{ label: 'Downloads', data: downloadData, backgroundColor: '#22c55e' }]
                }
            });
        } catch (error) {
            res.status(500).json({ error: "Analytics error" });
        }
    });

    // GET /api/monitoring
    app.get('/api/monitoring', (req, res) => {
        try {
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memUsage = Math.round((usedMem / totalMem) * 100);
            const uptime = os.uptime();
            const uptimeHrs = Math.floor(uptime / 3600);

            res.json({
                cpu: '10%', // Placeholder
                ram: `${Math.round(usedMem / 1024 / 1024)}MB`,
                uptime: `${uptimeHrs}h`,
                latency: '20ms',
                chartData: {
                    labels: ['1m', '2m', '3m', '4m', '5m'],
                    datasets: [{ label: 'RAM', data: [40, 42, 45, 44, memUsage], borderColor: '#3b82f6' }]
                }
            });
        } catch (error) {
            res.status(500).json({ error: "Monitoring error" });
        }
    });

    // GET /api/users
    app.get('/api/users', async (req, res) => {
        try {
            const allUsers = await dbService.getAllUsers();
            const bannedList = await dbService.getBanList();
            const bannedIds = new Set(bannedList.map(u => String(u.id)));

            let users = allUsers.map(u => ({
                id: u.id,
                first_name: u.first_name,
                username: u.username,
                lastSeen: u.lastSeen,
                isBanned: bannedIds.has(String(u.id))
            }));

            const q = (req.query.search || '').toLowerCase();
            if (q) {
                users = users.filter(u => 
                    String(u.id).includes(q) || 
                    (u.first_name && u.first_name.toLowerCase().includes(q))
                );
            }

            res.json({ users: users.slice(0, 100) });
        } catch (error) {
            res.status(500).json({ error: 'Could not retrieve users.' });
        }
    });

    // GET /api/user/:id
    app.get('/api/user/:id', async (req, res) => {
        try {
            const user = await dbService.findUserById(req.params.id);
            if (user) {
                const isBanned = await dbService.isUserBanned(req.params.id);
                res.json({ user: { ...user, isBanned } });
            } else {
                res.status(404).json({ error: 'User not found' });
            }
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // --- Actions ---

    app.post('/api/message', async (req, res) => {
        await dbService.addMessageToQueue(req.body.userId, req.body.message);
        res.json({ success: true });
    });
    
    app.post('/api/broadcast', async (req, res) => {
        await dbService.addMessageToQueue(null, req.body.message, true);
        res.json({ success: true });
    });

    app.post('/api/ban', async (req, res) => {
        await dbService.banUser(Number(req.body.userId), req.body.reason);
        res.json({ success: true });
    });

    app.post('/api/unban', async (req, res) => {
        await dbService.unbanUser(Number(req.body.userId));
        res.json({ success: true });
    });

    app.post('/api/approve', async (req, res) => {
        const { fileName } = req.body;
        const pendingPath = path.join(PENDING_DIR, fileName);
        if (!fs.existsSync(pendingPath)) return res.status(404).json({ error: 'File not found' });

        try {
            const parts = fileName.split('_');
            const uploaderId = parts[1];
            const originalName = parts.slice(2).join('_');
            
            fs.copyFileSync(pendingPath, path.join(FONT_DIR, originalName));
            fs.unlinkSync(pendingPath);
            
            initializeCache();
            await dbService.logUpload(uploaderId, originalName, 'approved');
            if (uploaderId) await dbService.addMessageToQueue(uploaderId, `✅ Your font *${originalName}* was approved!`);
            
            res.json({ success: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.post('/api/reject', async (req, res) => {
        const { fileName } = req.body;
        const pendingPath = path.join(PENDING_DIR, fileName);
        if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
        
        // Log rejection
        const uploaderId = fileName.split('_')[1];
        if (uploaderId) {
             const originalName = fileName.split('_').slice(2).join('_');
             await dbService.logUpload(uploaderId, originalName, 'rejected');
             await dbService.addMessageToQueue(uploaderId, `❌ Your font *${originalName}* was rejected.`);
        }

        res.json({ success: true });
    });

    // Font List
    app.get('/api/fonts', (req, res) => {
        const fonts = getFontCache().map(name => ({
            name,
            size: 'N/A', // Simple mock for size to improve speed
            downloads: 0
        }));
        
        let result = fonts;
        if(req.query.search) {
            result = fonts.filter(f => f.name.toLowerCase().includes(req.query.search.toLowerCase()));
        }

        res.json({ fonts: result });
    });

    app.delete('/api/fonts/:name', (req, res) => {
        const fontPath = path.join(FONT_DIR, req.params.name);
        if(fs.existsSync(fontPath)) {
            fs.unlinkSync(fontPath);
            initializeCache();
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    });

    app.post('/api/system/cache/clear', (req, res) => {
        initializeCache();
        res.json({ success: true });
    });
    
    app.post('/api/security/block', (req, res) => {
        // Logic to block IP would go here
        res.json({ success: true });
    });

    // --- STATIC FILE SERVING (FIXED FOR ROOT DIRECTORY) ---

    // 1. Serve admin.html from the root directory
    app.get('/', (req, res) => {
        const adminPath = path.join(__dirname, 'admin.html');
        if (fs.existsSync(adminPath)) {
            res.sendFile(adminPath);
        } else {
            res.status(404).send('admin.html not found in root directory.');
        }
    });

    // 2. Serve admin.css from the root directory
    app.get('/admin.css', (req, res) => {
        const cssPath = path.join(__dirname, 'admin.css');
        if (fs.existsSync(cssPath)) {
            res.sendFile(cssPath);
        } else {
            res.sendStatus(404);
        }
    });

    // 3. Serve assets folder (if you have images there)
    app.use('/assets', express.static(path.join(__dirname, 'assets')));

    // Start Server
    server.listen(PORT, () => {
        logger.info(`Admin Panel is running at http://localhost:${PORT}`);
    });
}

module.exports = { startAdminPanel };