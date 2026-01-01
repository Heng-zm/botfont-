// services/eventService.js
const EventEmitter = require('eventemitter3');

// สร้าง instance ของ EventEmitter ที่จะใช้ร่วมกันทั้งแอปพลิเคชัน
const eventEmitter = new EventEmitter();

module.exports = eventEmitter;