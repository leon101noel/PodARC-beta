// routes/stats.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { authMiddleware } = require('../middleware/auth');

// Helper function to read events data
function readEventsData() {
    try {
        const dataFilePath = path.join(__dirname, '..', 'events-data.json');
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading events data:', err);
        return [];
    }
}

// Helper function to read users data
function readUsersData() {
    try {
        const dataFilePath = path.join(__dirname, '..', 'users-data.json');
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading users data:', err);
        return [];
    }
}

// @route   GET /api/stats/summary
// @desc    Get response time statistics summary
// @access  Private (requires authentication)
router.get('/summary', authMiddleware, (req, res) => {
    try {
        const events = readEventsData();
        const users = readUsersData();

        // Get acknowledged events with response times
        const acknowledgedEvents = events.filter(
            event => event.acknowledged && event.responseTimeMinutes !== undefined
        );

        // Calculate total events and acknowledged count
        const totalEvents = events.length;
        const acknowledgedCount = acknowledgedEvents.length;

        // Calculate average response time
        let totalResponseTime = 0;
        acknowledgedEvents.forEach(event => {
            totalResponseTime += event.responseTimeMinutes;
        });
        const avgResponseTime = acknowledgedCount > 0
            ? (totalResponseTime / acknowledgedCount).toFixed(1)
            : 0;

        // Count late responses
        const lateResponses = acknowledgedEvents.filter(event => event.isLateResponse).length;

        // Calculate response rate
        const responseRate = totalEvents > 0
            ? Math.round((acknowledgedCount / totalEvents) * 100)
            : 0;

        // Group by event type
        const eventTypes = {};
        events.forEach(event => {
            const type = event.eventType || 'Unknown';
            eventTypes[type] = (eventTypes[type] || 0) + 1;
        });

        // Get response statistics by camera
        const cameraStats = {};
        acknowledgedEvents.forEach(event => {
            if (!event.camera) return;

            if (!cameraStats[event.camera]) {
                cameraStats[event.camera] = {
                    totalEvents: 0,
                    totalResponseTime: 0,
                    lateResponses: 0
                };
            }

            cameraStats[event.camera].totalEvents++;
            cameraStats[event.camera].totalResponseTime += event.responseTimeMinutes;

            if (event.isLateResponse) {
                cameraStats[event.camera].lateResponses++;
            }
        });

        // Calculate averages for each camera
        for (const camera in cameraStats) {
            const stats = cameraStats[camera];
            stats.avgResponseTime = stats.totalEvents > 0
                ? (stats.totalResponseTime / stats.totalEvents).toFixed(1)
                : 0;
            stats.lateResponsePercentage = stats.totalEvents > 0
                ? Math.round((stats.lateResponses / stats.totalEvents) * 100)
                : 0;
        }

        // Get user performance data
        const userPerformance = {};

        acknowledgedEvents.forEach(event => {
            if (!event.acknowledgedBy) return;

            const userId = event.acknowledgedBy.userId;

            if (!userPerformance[userId]) {
                // Find user data
                const user = users.find(u => u.id === userId) || {};

                userPerformance[userId] = {
                    userId,
                    name: event.acknowledgedBy.name || user.name || 'Unknown',
                    totalEvents: 0,
                    totalResponseTime: 0,
                    lateResponses: 0,
                    tags: {} // Add this for tracking tags
                };
            }

            userPerformance[userId].totalEvents++;
            userPerformance[userId].totalResponseTime += event.responseTimeMinutes;

            if (event.isLateResponse) {
                userPerformance[userId].lateResponses++;
            }

            // Count tags used by this user
            if (event.tags && Array.isArray(event.tags)) {
                event.tags.forEach(tag => {
                    userPerformance[userId].tags[tag] = (userPerformance[userId].tags[tag] || 0) + 1;
                });
            }
        });

        // Calculate averages for each user
        for (const userId in userPerformance) {
            const stats = userPerformance[userId];
            stats.avgResponseTime = stats.totalEvents > 0
                ? (stats.totalResponseTime / stats.totalEvents).toFixed(1)
                : 0;
            stats.lateResponsePercentage = stats.totalEvents > 0
                ? Math.round((stats.lateResponses / stats.totalEvents) * 100)
                : 0;
        }

        // Convert user performance to array for easier processing
        const userPerformanceArray = Object.values(userPerformance);

        // Count events by tag
        const tagStats = {};
        events.forEach(event => {
            if (event.tags && Array.isArray(event.tags)) {
                event.tags.forEach(tag => {
                    tagStats[tag] = (tagStats[tag] || 0) + 1;
                });
            }
        });

        // Return compiled statistics
        res.json({
            summary: {
                totalEvents,
                acknowledgedCount,
                avgResponseTime,
                lateResponses,
                responseRate
            },
            eventTypes,
            cameraStats,
            userPerformance: userPerformanceArray,
            tagStats
        });

    } catch (error) {
        console.error('Error generating statistics:', error);
        res.status(500).json({ error: 'Failed to generate statistics' });
    }
});

// @route   GET /api/stats/timeline
// @desc    Get response time data by day for timeline charts
// @access  Private (requires authentication)
router.get('/timeline', authMiddleware, (req, res) => {
    try {
        const events = readEventsData();
        const days = parseInt(req.query.days) || 30; // Default to 30 days

        // Calculate cutoff date
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);

        // Filter events by date
        const filteredEvents = events.filter(event => new Date(event.date) >= cutoffDate);

        // Group events by day
        const eventsByDay = {};

        filteredEvents.forEach(event => {
            const date = new Date(event.date).toLocaleDateString();

            if (!eventsByDay[date]) {
                eventsByDay[date] = {
                    date,
                    totalEvents: 0,
                    acknowledgedEvents: 0,
                    totalResponseTime: 0,
                    lateResponses: 0,
                    tags: {} // Add tag tracking by day
                };
            }

            eventsByDay[date].totalEvents++;

            // Track tags used each day
            if (event.tags && Array.isArray(event.tags)) {
                event.tags.forEach(tag => {
                    eventsByDay[date].tags[tag] = (eventsByDay[date].tags[tag] || 0) + 1;
                });
            }

            if (event.acknowledged && event.responseTimeMinutes !== undefined) {
                eventsByDay[date].acknowledgedEvents++;
                eventsByDay[date].totalResponseTime += event.responseTimeMinutes;

                if (event.isLateResponse) {
                    eventsByDay[date].lateResponses++;
                }
            }
        });

        // Calculate daily averages and convert to array
        const timelineData = Object.values(eventsByDay).map(day => {
            return {
                date: day.date,
                totalEvents: day.totalEvents,
                acknowledgedEvents: day.acknowledgedEvents,
                avgResponseTime: day.acknowledgedEvents > 0
                    ? (day.totalResponseTime / day.acknowledgedEvents).toFixed(1)
                    : 0,
                lateResponses: day.lateResponses,
                lateResponseRate: day.acknowledgedEvents > 0
                    ? Math.round((day.lateResponses / day.acknowledgedEvents) * 100)
                    : 0,
                tags: day.tags
            };
        });

        // Sort by date
        timelineData.sort((a, b) => new Date(a.date) - new Date(b.date));

        res.json(timelineData);

    } catch (error) {
        console.error('Error generating timeline data:', error);
        res.status(500).json({ error: 'Failed to generate timeline data' });
    }
});

// @route   GET /api/stats/recent-responses
// @desc    Get recent response data for the recent responses table
// @access  Private (requires authentication)
// In routes/stats.js
router.get('/recent-responses', authMiddleware, (req, res) => {
    try {
        const events = readEventsData();
        const limit = parseInt(req.query.limit) || 20; // Default to 20 events

        // Filter acknowledged events with response times
        const acknowledgedEvents = events.filter(
            event => event.acknowledged &&
                event.acknowledgedAt &&
                event.responseTimeMinutes !== undefined
        );

        // Sort by acknowledgement date (newest first)
        acknowledgedEvents.sort((a, b) => new Date(b.acknowledgedAt) - new Date(a.acknowledgedAt));

        // Limit to requested number
        const recentResponses = acknowledgedEvents.slice(0, limit).map(event => ({
            id: event.id,
            date: event.date,
            acknowledgedAt: event.acknowledgedAt,
            responseTimeMinutes: event.responseTimeMinutes,
            isLateResponse: event.isLateResponse || false,
            eventType: event.eventType || 'Unknown',
            camera: event.camera || 'Unknown',
            acknowledgedBy: event.acknowledgedBy || { name: 'Unknown' },
            // Include tags in the response
            tags: event.tags || []
        }));

        res.json(recentResponses);

    } catch (error) {
        console.error('Error fetching recent responses:', error);
        res.status(500).json({ error: 'Failed to fetch recent responses' });
    }
});

// @route   GET /api/stats/tag-usage
// @desc    Get statistics about tag usage
// @access  Private (requires authentication)
router.get('/tag-usage', authMiddleware, (req, res) => {
    try {
        const events = readEventsData();

        // Count tags
        const tagCounts = {};
        const tagsByEventType = {};
        const tagsByCamera = {};

        events.forEach(event => {
            const eventType = event.eventType || 'Unknown';
            const camera = event.camera || 'Unknown';

            // Initialize event type object if it doesn't exist
            if (!tagsByEventType[eventType]) {
                tagsByEventType[eventType] = {};
            }

            // Initialize camera object if it doesn't exist
            if (!tagsByCamera[camera]) {
                tagsByCamera[camera] = {};
            }

            // Count tags
            if (event.tags && Array.isArray(event.tags)) {
                event.tags.forEach(tag => {
                    // Overall count
                    tagCounts[tag] = (tagCounts[tag] || 0) + 1;

                    // Count by event type
                    tagsByEventType[eventType][tag] = (tagsByEventType[eventType][tag] || 0) + 1;

                    // Count by camera
                    tagsByCamera[camera][tag] = (tagsByCamera[camera][tag] || 0) + 1;
                });
            }
        });

        res.json({
            tagCounts,
            tagsByEventType,
            tagsByCamera
        });

    } catch (error) {
        console.error('Error generating tag usage statistics:', error);
        res.status(500).json({ error: 'Failed to generate tag usage statistics' });
    }
});

module.exports = router;