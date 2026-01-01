// services/reminderScheduler.js

const schedule = require('node-schedule');
const db = require('./dbService');
const { logger } = require('./logger');

function startScheduler(bot) {
    schedule.scheduleJob('* * * * *', async () => {
        logger.info('Scheduler running: Checking for due reminders...');
        
        try {
            const dueReminders = await db.getDueReminders();

            if (dueReminders.length > 0) {
                logger.info(`Found ${dueReminders.length} due reminders to send.`);
                
                const reminderIdsToDelete = [];

                for (const reminder of dueReminders) {
                    const message = `⏰ **ការរំលឹក!** ⏰\n\nអ្នកបានកំណត់ការរំលឹកសម្រាប់:\n\n> ${reminder.message}`;
                    
                    await bot.sendMessage(reminder.userId, message, { parse_mode: 'Markdown' })
                        .catch(err => {
                            logger.error(`Failed to send reminder to user ${reminder.userId}. Maybe user blocked the bot. Error: ${err.message}`);
                        });
                    
                    reminderIdsToDelete.push(reminder.id);
                }

                await db.deleteRemindersByIds(reminderIdsToDelete);
                logger.info(`Deleted ${reminderIdsToDelete.length} sent reminders.`);
            }
        } catch (error) {
            logger.error('Error in reminder scheduler:', error);
        }
    });

    logger.info('⏰ Reminder scheduler started, will run every minute.');
}

module.exports = { startScheduler };