// migration_script.js

const fs = require('fs');
const path = require('path');

console.log("Starting migration script...");

// กำหนด path ไปยังไฟล์เก่าและไฟล์ใหม่
const oldDbPath = path.join(__dirname, 'old.json');
const newDbPath = path.join(__dirname, 'db.json');

// โครงสร้างข้อมูล default สำหรับ database ใหม่
const newDbStructure = {
    users: {},
    bannedUsers: {},
    messageQueue: [],
    fileIdCache: {},
};

try {
    // 1. อ่านข้อมูลจากไฟล์ database เก่า
    if (!fs.existsSync(oldDbPath)) {
        throw new Error("old_db.json not found! Please create it with your old data.");
    }
    const oldData = JSON.parse(fs.readFileSync(oldDbPath, 'utf-8'));

    // 2. ตรวจสอบว่าข้อมูลเก่าเป็น array หรือไม่
    if (!Array.isArray(oldData.users)) {
        throw new Error("The 'users' property in old_db.json is not an array.");
    }

    // 3. แปลงข้อมูลผู้ใช้
    let convertedCount = 0;
    oldData.users.forEach(oldUser => {
        if (!oldUser.id) {
            console.warn("Skipping user with no ID:", oldUser);
            return;
        }
        const userId = oldUser.id.toString();

        // สร้าง object ผู้ใช้ใหม่ที่สะอาด
        newDbStructure.users[userId] = {
            id: oldUser.id,
            is_bot: oldUser.is_bot || false, // ตั้งค่า default
            first_name: oldUser.firstName || '',
            last_name: oldUser.lastName || '',
            username: oldUser.username || '',
            // ใช้ lastActive เป็น lastSeen และ startedAt เป็น firstSeen
            lastSeen: oldUser.lastActive || new Date().toISOString(),
            firstSeen: oldUser.startedAt || oldUser.lastActive || new Date().toISOString(),
        };
        convertedCount++;
    });

    console.log(`Successfully processed ${convertedCount} user records.`);

    // 4. (ถ้ามี) แปลงข้อมูลผู้ใช้ที่ถูก ban (ตัวอย่าง)
    // หากคุณมี banned_users ในรูปแบบ array, คุณสามารถแปลงได้ที่นี่
    // if (Array.isArray(oldData.banned_users)) {
    //     oldData.banned_users.forEach(bannedId => {
    //         newDbStructure.bannedUsers[bannedId.toString()] = {
    //             reason: "Migrated from old system",
    //             date: new Date().toISOString()
    //         };
    //     });
    //     console.log(`Migrated ${oldData.banned_users.length} banned users.`);
    // }

    // 5. เขียนข้อมูลใหม่ลงในไฟล์ db.json
    fs.writeFileSync(newDbPath, JSON.stringify(newDbStructure, null, 2));

    console.log(`✅ Migration complete! New database created at ${newDbPath}`);

} catch (error) {
    console.error("❌ Migration failed:", error.message);
}