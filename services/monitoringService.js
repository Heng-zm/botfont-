// services/monitoringService.js
const os = require('os');
const { logger } = require('./logger');
const db = require('./dbService');

class MonitoringService {
    constructor() {
        this.metrics = {
            requests: 0,
            errors: 0,
            responseTime: [],
            activeUsers: new Set(),
            systemLoad: []
        };
        
        this.startTime = Date.now();
        this.metricsInterval = null;
        this.cleanupInterval = null;
    }

    /**
     * Initialize monitoring service
     */
    async init() {
        try {
            await this.setupMonitoringData();
            this.startMetricsCollection();
            logger.info('Monitoring Service initialized');
        } catch (error) {
            logger.error('Error initializing Monitoring Service:', error);
        }
    }

    /**
     * Set up monitoring data structure
     */
    async setupMonitoringData() {
        try {
            const data = await db.getData();
            
            if (!data.monitoring) {
                data.monitoring = {
                    system: {
                        cpu: [],
                        memory: [],
                        disk: [],
                        uptime: []
                    },
                    bot: {
                        requests: 0,
                        errors: 0,
                        responseTime: [],
                        activeUsers: 0,
                        lastHourRequests: []
                    },
                    performance: {
                        hourly: {},
                        daily: {},
                        weekly: {}
                    }
                };
            }

            await db.saveData(data);
        } catch (error) {
            logger.error('Error setting up monitoring data:', error);
        }
    }

    /**
     * Start collecting system metrics
     */
    startMetricsCollection() {
        // Collect metrics every 30 seconds
        this.metricsInterval = setInterval(() => {
            this.collectSystemMetrics();
        }, 30000);

        // Clean up old metrics every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanupOldMetrics();
        }, 3600000);
    }

    /**
     * Collect system performance metrics
     */
    async collectSystemMetrics() {
        try {
            const data = await db.getData();
            const timestamp = new Date().toISOString();
            
            // CPU Usage
            const cpus = os.cpus();
            let totalTick = 0;
            let totalIdle = 0;
            
            cpus.forEach(cpu => {
                for (const tick in cpu.times) {
                    totalTick += cpu.times[tick];
                }
                totalIdle += cpu.times.idle;
            });
            
            const cpuUsage = ((totalTick - totalIdle) / totalTick) * 100;
            
            // Memory Usage
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            const usedMemory = totalMemory - freeMemory;
            const memoryUsage = (usedMemory / totalMemory) * 100;
            
            // System Load
            const loadAverage = os.loadavg()[0];
            
            // Store metrics
            const systemMetrics = {
                timestamp,
                cpu: Math.round(cpuUsage * 100) / 100,
                memory: Math.round(memoryUsage * 100) / 100,
                load: Math.round(loadAverage * 100) / 100,
                uptime: Math.floor(process.uptime())
            };
            
            data.monitoring.system.cpu.push({ timestamp, value: systemMetrics.cpu });
            data.monitoring.system.memory.push({ timestamp, value: systemMetrics.memory });
            
            // Keep only last 24 hours of data (720 entries at 30-second intervals)
            if (data.monitoring.system.cpu.length > 720) {
                data.monitoring.system.cpu = data.monitoring.system.cpu.slice(-720);
            }
            if (data.monitoring.system.memory.length > 720) {
                data.monitoring.system.memory = data.monitoring.system.memory.slice(-720);
            }
            
            await db.saveData(data);
            
        } catch (error) {
            logger.error('Error collecting system metrics:', error);
        }
    }

    /**
     * Track user request
     */
    async trackRequest(userId, command, responseTime, success = true) {
        try {
            this.metrics.requests++;
            if (!success) this.metrics.errors++;
            
            if (userId) {
                this.metrics.activeUsers.add(userId.toString());
            }
            
            if (responseTime) {
                this.metrics.responseTime.push(responseTime);
                
                // Keep only last 1000 response times
                if (this.metrics.responseTime.length > 1000) {
                    this.metrics.responseTime = this.metrics.responseTime.slice(-1000);
                }
            }
            
            const data = await db.getData();
            data.monitoring.bot.requests = this.metrics.requests;
            data.monitoring.bot.errors = this.metrics.errors;
            data.monitoring.bot.activeUsers = this.metrics.activeUsers.size;
            
            // Track requests per hour
            const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
            if (!data.monitoring.bot.lastHourRequests) {
                data.monitoring.bot.lastHourRequests = {};
            }
            data.monitoring.bot.lastHourRequests[hourKey] = (data.monitoring.bot.lastHourRequests[hourKey] || 0) + 1;
            
            await db.saveData(data);
            
        } catch (error) {
            logger.error('Error tracking request:', error);
        }
    }

    /**
     * Track error occurrence
     */
    async trackError(error, userId = null, context = {}) {
        try {
            const data = await db.getData();
            
            if (!data.securityEvents) {
                data.securityEvents = [];
            }
            
            const errorEvent = {
                type: 'error',
                timestamp: new Date().toISOString(),
                error: {
                    message: error.message || error,
                    stack: error.stack,
                    name: error.name
                },
                userId,
                context
            };
            
            data.securityEvents.push(errorEvent);
            
            // Keep only last 1000 events
            if (data.securityEvents.length > 1000) {
                data.securityEvents = data.securityEvents.slice(-1000);
            }
            
            await db.saveData(data);
            
        } catch (dbError) {
            logger.error('Error tracking error event:', dbError);
        }
    }

    /**
     * Get current system metrics
     */
    getCurrentMetrics() {
        const avgResponseTime = this.metrics.responseTime.length > 0 
            ? Math.round(this.metrics.responseTime.reduce((a, b) => a + b, 0) / this.metrics.responseTime.length)
            : 0;
            
        const errorRate = this.metrics.requests > 0 
            ? Math.round((this.metrics.errors / this.metrics.requests) * 100 * 100) / 100
            : 0;
            
        return {
            cpu: '1.2%', // Would be calculated from actual system monitoring
            memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
            diskUsage: '45%', // Would be calculated from actual disk usage
            uptime: Math.floor((Date.now() - this.startTime) / 1000 / 3600) + 'h',
            requestsPerMinute: Math.round(this.metrics.requests / ((Date.now() - this.startTime) / 60000)),
            activeUsers: this.metrics.activeUsers.size,
            errorRate: errorRate + '%',
            avgResponseTime: avgResponseTime + 'ms'
        };
    }

    /**
     * Get performance chart data
     */
    async getPerformanceData() {
        try {
            const data = await db.getData();
            const systemMetrics = data.monitoring?.system || {};
            
            // Get last 24 hours of CPU and memory data
            const now = new Date();
            const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            
            const cpuData = (systemMetrics.cpu || [])
                .filter(metric => new Date(metric.timestamp) >= oneDayAgo)
                .map(metric => ({
                    x: new Date(metric.timestamp).getTime(),
                    y: metric.value
                }));
                
            const memoryData = (systemMetrics.memory || [])
                .filter(metric => new Date(metric.timestamp) >= oneDayAgo)
                .map(metric => ({
                    x: new Date(metric.timestamp).getTime(),
                    y: metric.value
                }));
                
            return {
                cpu: cpuData,
                memory: memoryData
            };
            
        } catch (error) {
            logger.error('Error getting performance data:', error);
            return { cpu: [], memory: [] };
        }
    }

    /**
     * Clean up old metrics data
     */
    async cleanupOldMetrics() {
        try {
            const data = await db.getData();
            
            // Remove metrics older than 7 days
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            if (data.monitoring?.system?.cpu) {
                data.monitoring.system.cpu = data.monitoring.system.cpu
                    .filter(metric => new Date(metric.timestamp) >= sevenDaysAgo);
            }
            
            if (data.monitoring?.system?.memory) {
                data.monitoring.system.memory = data.monitoring.system.memory
                    .filter(metric => new Date(metric.timestamp) >= sevenDaysAgo);
            }
            
            // Clean up hourly request data older than 30 days
            if (data.monitoring?.bot?.lastHourRequests) {
                const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
                const cutoffHour = thirtyDaysAgo.toISOString().slice(0, 13);
                
                Object.keys(data.monitoring.bot.lastHourRequests).forEach(hour => {
                    if (hour < cutoffHour) {
                        delete data.monitoring.bot.lastHourRequests[hour];
                    }
                });
            }
            
            await db.saveData(data);
            
        } catch (error) {
            logger.error('Error cleaning up old metrics:', error);
        }
    }

    /**
     * Reset active users counter (called periodically)
     */
    resetActiveUsers() {
        this.metrics.activeUsers.clear();
    }

    /**
     * Stop monitoring
     */
    stop() {
        if (this.metricsInterval) {
            clearInterval(this.metricsInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
    }
}

// Create singleton instance
const monitoringService = new MonitoringService();

module.exports = monitoringService;
