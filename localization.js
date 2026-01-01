// localization.js

module.exports = {
    // General
    welcome: "🤖 សូមស្វាគមន៍មកកាន់ X.Font!\n\n➡️ សរសេរ /fonts ឬ ឈ្មោះ Font ដើម្បីស្វែងរកពុម្ពអក្សរ។\n\n​➕ប្រើ /uploadfont សម្រាប់ upload  ពុម្ពអក្សរបន្ថែម\n💡ប្រើ /uploadfont រួចផ្ញើ File ពុម្ពអក្សរ ជា (.ttf ឬ .otf)​។",
    unknownCommand: "❌ ឈ្មោះមិនត្រឹមត្រូវ។",
    sessionExpired: "⌛ អ្នកបានផុតកំណត់។ សូមចាប់ផ្តើមម្តងទៀតដោយផ្ញើ /fonts ។",
    fileRemoved: "❌ កំហុស៖ ឯកសារនេះហាក់ដូចជាត្រូវបានដកចេញ។",
    sendingFile: (filename) => `📄 កំពុងផ្ញើឯកសារ *${filename}*`,
    processing: "⏳ កំពុងដំណើរការ...",

    // Search
    searchPrompt: (query) => `🔍 កំពុងស្វែងរកពាក្យ: *${query}*`,
    searchFound: (count, query) => `✅ បានរកឃើញពុម្ពអក្សរចំនួន *${count}* ដែលត្រូវនឹងពាក្យ «${query}»៖`,
    searchNotFound: (query) => `🤷‍♂️ រកមិនឃើញពុម្ពអក្សរដែលត្រូវនឹងពាក្យ «${query}» ទេ។`,
    searchNotFoundPrompt: "សាកល្បងឈ្មោះផ្សេង​ ដើម្បីស្វែងរក។",
    btnBrowseAll: "📂 ពុម្ពអក្សទាំងអស់",

    // Font List UI
    pageHeader: (page, totalPages) => `📂 ពុម្ពអក្សរ (ទំព័រ ${page} នៃ ${totalPages})`,
    btnNext: "បន្ទាប់ / NEXT ▶",
    btnPrevious: "◀ ត្រឡប់ក្រោយ / BACK",
    noFontsDisplay: "ℹ️ មិនមានពុម្ពអក្សរ។",

    generatingPreview: "🖼️ កំពុងបង្កើតរូបភាព សូមរង់ចាំ...",
    previewCaption: (filename) => `🖼️ រូបភាពពុម្ពអក្សរ *${filename}*`,
    btnDownload: "⬇️ ទាញយក / DOWNLOAD",
    btnBackToList: "◀️ ត្រឡប់ក្រោយ / BACK",
    btnDownloadMore: "📥 ទាយយកពុម្ភអក្សរបន្ទាប់ / DOWNLOAD MORE",
    downloadSuccess: "✅ បានទាញយកសម្រេច! តើអ្នកចង់ធ្វើអ្វីបន្ទាប់?", // Download successful! What would you like to do next?
    // អត្ថបទគំរូថ្មីដែលល្អជាងមុន
    previewTextKhmer: "ប្រាសាទព្រះវិហារ", 
    previewTextLatin: "Temple of Preah Vihear",
    previewWatermark: "@khfontbot", // ជំនួសដោយឈ្មោះបូតរបស់អ្នក
    errorImageText: (fontName) => `❌ មិនអាចដំណើរការពុម្ពអក្សរ\n${fontName}`,

    // Admin
    cacheRefreshed: "✅ ឃ្លាំងសម្ងាត់ (Cache) របស់ពុម្ពអក្សរត្រូវបានធ្វើឱ្យស្រស់ដោយជោគជ័យ!",

uploadCommandPrompt: "✅ សូមផ្ញើឯកសារពុម្ពអក្សរ (.ttf ឬ .otf) របស់អ្នកឥឡូវនេះ។",
    mustUseUploadCommand: "ℹ️ ដើម្បី Upload ពុម្ពអក្សរ, សូមប្រើពាក្យបញ្ជា /uploadfont ជាមុនសិន រួចផ្ញើ File ជា​ (.ttf ឬ .otf)។",
    uploadReceived: "📥 បានទទួលពុម្ពអក្សររបស់អ្នក! កំពុងដំណើរការ។",
    uploadFailed: "❌ ការអាប់ឡូតបរាជ័យ។ សូមប្រាកដថាវាជា File ttf ឬ .otf ។",
    uploadComplete: "✅ ការ Upload ពុម្ពអក្សរជោគជ័យ, រងចាំការ​ Approve។",
    adminNewFontNotification: (userInfo, fileName) => `🔔 ការស្នើសុំពុម្ពអក្សរថ្មី!\n\n*ពី:* ${userInfo.first_name || ''} (@${userInfo.username || userInfo.id})\n*ឯកសារ:* \`${fileName}\``,
    btnApprove: "✅ យល់ព្រម (Approve)",
    btnReject: "❌ បដិសេធ (Reject)",
    fontApproved: (fileName) => `🎉 សូមអបអរសាទរ! ពុម្ពអក្សរ *${fileName}* របស់អ្នកត្រូវបាន Approve បន្ថែមទៅក្នុង Bot ។`,
    fontRejected: (fileName) => `ℹ️ សូមអភ័យទោស។ បន្ទាប់ពីការត្រួតពិនិត្យ, ការស្នើសុំពុម្ពអក្សរ *${fileName}* របស់អ្នកត្រូវបានបដិសេធ។`,
    approvalSuccess: (fileName) => `✅ អ្នកបានយល់ព្រមលើពុម្ពអក្សរ *${fileName}* ។`,
    rejectionSuccess: (fileName) => `🗑️ អ្នកបានបដិសេធពុម្ពអក្សរ *${fileName}* ។ ឯកសារត្រូវបានលុបចោល។`,
    decisionAlreadyMade: "⚠️ ការសម្រេចចិត្តត្រូវបានធ្វើឡើងរួចហើយនេះ។"
};