// routes/retention.js
const express = require('express');
const router = express.Router();
const path = require('path');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const EventRetentionService = require('../event-retention');

// Create retention service instance
const retentionService = new EventRetentionService({
    eventsFilePath: path.join(__dirname, '..', 'events-data.json'),
    imagesBasePath: path.join(__dirname, '..', 'public'),
    videosBasePath: path.join(__dirname, '..')
});

// @route   POST /api/retention/cleanup
// @desc    Run cleanup process to delete old events (admin only)
// @access  Admin
router.post('/cleanup', adminMiddleware, async (req, res) => {
    try {
        // Optional override for retention days
        const retentionDays = req.body.retentionDays || undefined;
        if (retentionDays) {
            retentionService.retentionDays = retentionDays;
        }

        // Run cleanup process
        const stats = await retentionService.cleanupOldEvents();

        res.json({
            success: true,
            stats
        });
    } catch (error) {
        console.error('Error during cleanup process:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to run cleanup process',
            details: error.message
        });
    }
});

// @route   PUT /api/retention/events/:id/lock
// @desc    Lock an event to prevent deletion
// @access  Authenticated
router.put('/events/:id/lock', authMiddleware, (req, res) => {
    try {
        const eventId = parseInt(req.params.id);
        const { locked } = req.body;

        if (locked === undefined) {
            return res.status(400).json({ error: 'Locked status is required' });
        }

        const result = retentionService.toggleEventLock(eventId, locked);

        if (!result.success) {
            return res.status(404).json({ error: result.error });
        }

        res.json(result);
    } catch (error) {
        console.error('Error toggling event lock:', error);
        res.status(500).json({ error: 'Failed to update event lock status' });
    }
});

// @route   GET /api/retention/config
// @desc    Get retention configuration
// @access  Authenticated
router.get('/config', authMiddleware, (req, res) => {
    try {
        res.json({
            retentionDays: retentionService.retentionDays
        });
    } catch (error) {
        console.error('Error fetching retention config:', error);
        res.status(500).json({ error: 'Failed to fetch retention configuration' });
    }
});

// @route   PUT /api/retention/config
// @desc    Update retention configuration
// @access  Admin
router.put('/config', adminMiddleware, (req, res) => {
    try {
        const { retentionDays } = req.body;

        if (!retentionDays || typeof retentionDays !== 'number' || retentionDays < 1) {
            return res.status(400).json({ error: 'Valid retention days value is required (minimum: 1)' });
        }

        retentionService.retentionDays = retentionDays;

        res.json({
            success: true,
            message: 'Retention configuration updated',
            retentionDays
        });
    } catch (error) {
        console.error('Error updating retention config:', error);
        res.status(500).json({ error: 'Failed to update retention configuration' });
    }
});

module.exports = router;