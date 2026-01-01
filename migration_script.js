const fs = require('fs');
const path = require('path');

console.log("🚀 Starting advanced migration script...");

// Define file paths
const backupPath = path.join(__dirname, 'backup.json'); // Your backup file
const dbPath = path.join(__dirname, 'db.json');         // The target database file

// 1. Define the NEW Database Structure
// This includes all fields required by the new Admin Panel
const newDbStructure = {
    users: {},
    bannedUsers: {},
    fonts: [],
    messageQueue: [],
    fileIdCache: {},
    broadcastResults: null,
    // Reset errors to fix the libuuid crash log
    errors: {}, 
    errorStats: { 
        total: 0, 
        byType: {}, 
        byDay: {}, 
        resolved: 0 
    },
    // New Advanced Admin Panel Fields
    userProfiles: {},
    userPreferences: {},
    userStats: {},
    userAchievements: {},
    analytics: {
        dailyStats: {},
        weeklyStats: {},
        monthlyStats: {},
        userActivity: {},
        fontUsage: {},
        commandUsage: {},
        errorLogs: {},
        performanceMetrics: {}
    },
    notifications: {
        templates: {},
        scheduled: {},
        sent: {},
        preferences: {},
        subscriptions: {},
        campaigns: {}
    },
    recommendations: {
        userInteractions: {},
        fontSimilarity: {},
        contentAnalysis: {},
        recommendations: {},
        models: {}
    },
    // Security Config
    securityConfig: {
        twoFactorAuth: false,
        ipWhitelist: false,
        rateLimiting: true,
        sessionTimeout: 30,
        maxLoginAttempts: 5
    },
    blockedIPs: {},
    securityEvents: [],
    auditLogs: []
};

try {
    // 2. Read the Backup File
    if (!fs.existsSync(backupPath)) {
        throw new Error("❌ backup.json not found! Please create a file named 'backup.json' and paste your backup data inside.");
    }
    
    console.log("📖 Reading backup data...");
    const rawData = fs.readFileSync(backupPath, 'utf-8');
    const backupData = JSON.parse(rawData);

    // 3. Migrate Users (Array -> Object)
    console.log("🔄 Migrating Users...");
    let userCount = 0;
    
    // Check if users exists and is an array (based on your backup structure)
    const sourceUsers = Array.isArray(backupData.users) ? backupData.users : Object.values(backupData.users || {});
    
    sourceUsers.forEach(user => {
        if (!user.id) return;
        
        const userId = String(user.id);
        
        // Map old fields to new fields if necessary, but keep existing data
        newDbStructure.users[userId] = {
            id: user.id,
            is_bot: user.is_bot || false,
            first_name: user.first_name || user.firstName || '',
            last_name: user.last_name || user.lastName || '',
            username: user.username || '',
            // Prefer existing lastSeen, fallback to lastActive, then Now
            lastSeen: user.lastSeen || user.lastActive || new Date().toISOString(),
            firstSeen: user.firstSeen || user.startedAt || new Date().toISOString(),
            // Preserve Activity (Downloads/Uploads)
            activity: user.activity || { downloads: [], uploads: [] }
        };
        userCount++;
    });
    console.log(`   ✅ Processed ${userCount} users.`);

    // 4. Migrate Banned Users (Array -> Object)
    console.log("🔄 Migrating Banned Users...");
    let banCount = 0;
    
    const sourceBans = Array.isArray(backupData.bannedUsers) ? backupData.bannedUsers : Object.values(backupData.bannedUsers || {});
    
    sourceBans.forEach(ban => {
        const banId = String(ban.id);
        newDbStructure.bannedUsers[banId] = {
            id: ban.id,
            reason: ban.reason || "Migrated ban",
            date: ban.date || new Date().toISOString()
        };
        banCount++;
    });
    console.log(`   ✅ Processed ${banCount} banned users.`);

    // 5. Migrate Fonts
    console.log("🔄 Migrating Fonts...");
    if (Array.isArray(backupData.fonts)) {
        newDbStructure.fonts = [...backupData.fonts];
        console.log(`   ✅ Restored ${newDbStructure.fonts.length} fonts.`);
    }

    // 6. Save New DB
    console.log("💾 Saving new database...");
    fs.writeFileSync(dbPath, JSON.stringify(newDbStructure, null, 2));

    console.log("==========================================");
    console.log(`🎉 SUCCESS! Database migrated to ${dbPath}`);
    console.log(`   - Users converted: ${userCount}`);
    console.log(`   - Bans converted:  ${banCount}`);
    console.log(`   - Fonts restored:  ${newDbStructure.fonts.length}`);
    console.log("   - New Admin Panel fields initialized.");
    console.log("==========================================");

} catch (error) {
    console.error("❌ Migration failed:", error.message);
}