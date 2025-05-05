// routes/retention.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const EventRetentionService = require('../event-retention');

// Create retention service instance
const retentionService = new EventRetentionService({
    eventsFilePath: path.join(__dirname, '..', 'events-data.json'),
    imagesBasePath: path.join(__dirname, '..', 'public'),
    videosBasePath: path.join(__dirname, '..', 'public') // Correctly points to the parent directory of videos
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

// Fixed version of the debug/video-match endpoint in routes/retention.js

// @route   GET /api/retention/debug/video-match/:eventId
// @desc    Debug video matching for an event (admin only)
// @access  Admin
router.get('/debug/video-match/:eventId', adminMiddleware, async (req, res) => {
    try {
        const eventId = parseInt(req.params.eventId);

        // Read events
        const events = retentionService.readEventsData();

        // Find the event
        const event = events.find(e => e.id === eventId);
        if (!event) {
            return res.status(404).json({ error: 'Event not found' });
        }

        // Check if event has camera
        if (!event.camera) {
            return res.json({
                event,
                error: 'Event has no camera information',
                potentialVideos: []
            });
        }

        // Extract event date
        const eventDate = new Date(event.date);
        const eventYear = eventDate.getFullYear().toString();
        const eventMonth = (eventDate.getMonth() + 1).toString().padStart(2, '0');
        const eventDay = eventDate.getDate().toString().padStart(2, '0');

        // Try to extract timestamp from image if available
        let imageTimestamp = null;
        let imageDate = null;

        if (event.imagePath) {
            const imageMatch = event.imagePath.match(/\d+_\d+_(\d{14})/);
            if (imageMatch) {
                imageTimestamp = imageMatch[1];
                const year = parseInt(imageTimestamp.substr(0, 4));
                const month = parseInt(imageTimestamp.substr(4, 2)) - 1; // JS months are 0-based
                const day = parseInt(imageTimestamp.substr(6, 2));
                const hour = parseInt(imageTimestamp.substr(8, 2));
                const minute = parseInt(imageTimestamp.substr(10, 2));
                const second = parseInt(imageTimestamp.substr(12, 2));

                imageDate = new Date(year, month, day, hour, minute, second);
            }
        }

        // We'll look in 3 day directories: day before, event day, day after
        const datesToCheck = [
            { year: eventYear, month: eventMonth, day: eventDay },
        ];

        // If we have an image date and it's different from event date, add it
        if (imageDate) {
            const imageYear = imageDate.getFullYear().toString();
            const imageMonth = (imageDate.getMonth() + 1).toString().padStart(2, '0');
            const imageDay = imageDate.getDate().toString().padStart(2, '0');

            // Check if it's not already in the list
            if (!(imageYear === eventYear && imageMonth === eventMonth && imageDay === eventDay)) {
                datesToCheck.push({
                    year: imageYear,
                    month: imageMonth,
                    day: imageDay
                });
            }
        }

        // Add day before
        const dayBefore = new Date(eventDate);
        dayBefore.setDate(dayBefore.getDate() - 1);
        datesToCheck.push({
            year: dayBefore.getFullYear().toString(),
            month: (dayBefore.getMonth() + 1).toString().padStart(2, '0'),
            day: dayBefore.getDate().toString().padStart(2, '0')
        });

        // Add day after
        const dayAfter = new Date(eventDate);
        dayAfter.setDate(dayAfter.getDate() + 1);
        datesToCheck.push({
            year: dayAfter.getFullYear().toString(),
            month: (dayAfter.getMonth() + 1).toString().padStart(2, '0'),
            day: dayAfter.getDate().toString().padStart(2, '0')
        });

        // Get the event timestamp
        const eventTime = eventDate.getTime();
        const imageTime = imageDate ? imageDate.getTime() : null;

        // Track potential matches and debug information
        const potentialVideos = [];
        const debugInfo = {
            eventTimestamp: eventDate.toISOString(),
            eventUnixTime: eventTime,
            imageTimestamp: imageDate ? imageDate.toISOString() : null,
            imageUnixTime: imageTime,
            searchDirectories: [],
            allVideoFiles: []
        };

        // Check each potential date directory
        for (const dateToCheck of datesToCheck) {
            const { year, month, day } = dateToCheck;

            // Construct the video directory path
            const videoDirRelative = path.join('videos', year, month, day);
            const videoDir = path.join(retentionService.videosBasePath, videoDirRelative);

            const dirInfo = {
                directory: videoDirRelative,
                exists: false,
                files: []
            };

            // Check if directory exists
            if (fs.existsSync(videoDir)) {
                dirInfo.exists = true;

                try {
                    // Read all files in the directory
                    const files = fs.readdirSync(videoDir);

                    // Filter for files that match the camera pattern
                    const cameraFiles = files.filter(file =>
                        file.startsWith(event.camera) && file.toLowerCase().endsWith('.mp4')
                    );

                    dirInfo.allFiles = files.length;
                    dirInfo.cameraFiles = cameraFiles.length;

                    // Check each potential video file
                    for (const file of cameraFiles) {
                        const fileInfo = {
                            filename: file,
                            path: path.join(videoDirRelative, file),
                            timestamp: null,
                            timestampMatch: false,
                            timeDifference: null,
                            isMatch: false
                        };

                        debugInfo.allVideoFiles.push(file);

                        // Extract timestamp from filename
                        const match = file.match(/(\d{14})/);
                        if (match) {
                            const timestamp = match[1];

                            // FIXED: Correct timestamp parsing
                            const fileYear = parseInt(timestamp.substring(0, 4));
                            const fileMonth = parseInt(timestamp.substring(4, 2)) - 1; // JS months are 0-based
                            const fileDay = parseInt(timestamp.substring(6, 2));
                            const fileHour = parseInt(timestamp.substring(8, 2));
                            const fileMinute = parseInt(timestamp.substring(10, 2));
                            const fileSecond = parseInt(timestamp.substring(12, 2));

                            try {
                                const fileDate = new Date(fileYear, fileMonth, fileDay, fileHour, fileMinute, fileSecond);
                                const fileTime = fileDate.getTime();

                                fileInfo.timestamp = fileDate.toISOString();
                                fileInfo.extractedTimestamp = timestamp;

                                // Calculate time difference - check both event and image timestamps
                                const timeDiffEvent = Math.abs(fileTime - eventTime);
                                const timeDiffImage = imageTime ? Math.abs(fileTime - imageTime) : Infinity;

                                // Use the better match
                                const bestTimeDiff = Math.min(timeDiffEvent, timeDiffImage);
                                fileInfo.timeDifference = bestTimeDiff;
                                fileInfo.comparedTo = bestTimeDiff === timeDiffEvent ? "event date" : "image date";

                                // Use a larger time window
                                const timeWindowMs = 180 * 1000; // 3 minutes
                                if (bestTimeDiff <= timeWindowMs) {
                                    fileInfo.isMatch = true;
                                }

                                // Add to potential videos
                                potentialVideos.push(fileInfo);
                            } catch (err) {
                                fileInfo.error = `Invalid date: ${err.message}`;
                            }
                        } else {
                            fileInfo.error = 'No timestamp pattern found in filename';
                        }

                        dirInfo.files.push(fileInfo);
                    }
                } catch (err) {
                    dirInfo.error = err.message;
                }
            }

            debugInfo.searchDirectories.push(dirInfo);
        }

        // Sort potential videos by time difference
        potentialVideos.sort((a, b) => (a.timeDifference || Infinity) - (b.timeDifference || Infinity));

        // Return the debug information
        res.json({
            event,
            currentVideoPath: event.videoPath || null,
            debugInfo,
            potentialVideos: potentialVideos.slice(0, 10) // Limit to top 10 matches
        });

    } catch (error) {
        console.error('Error in video match debug endpoint:', error);
        res.status(500).json({
            error: 'Failed to debug video matching',
            details: error.message
        });
    }
});

// @route   GET /api/retention/debug/directory-structure
// @desc    Debug video directory structure (admin only)
// @access  Admin
router.get('/debug/directory-structure', adminMiddleware, (req, res) => {
    try {
        const videosBasePath = path.join(retentionService.videosBasePath, 'videos');

        // Check if base directory exists
        if (!fs.existsSync(videosBasePath)) {
            return res.status(404).json({
                error: 'Videos directory not found',
                path: videosBasePath
            });
        }

        // Get year directories
        const years = fs.readdirSync(videosBasePath)
            .filter(item => fs.statSync(path.join(videosBasePath, item)).isDirectory())
            .filter(item => /^\d{4}$/.test(item));

        // Build directory structure
        const structure = { base: videosBasePath, years: {} };

        years.forEach(year => {
            const yearPath = path.join(videosBasePath, year);

            // Get months
            const months = fs.readdirSync(yearPath)
                .filter(item => fs.statSync(path.join(yearPath, item)).isDirectory())
                .filter(item => /^\d{2}$/.test(item));

            structure.years[year] = {};

            months.forEach(month => {
                const monthPath = path.join(yearPath, month);

                // Get days
                const days = fs.readdirSync(monthPath)
                    .filter(item => fs.statSync(path.join(monthPath, item)).isDirectory())
                    .filter(item => /^\d{2}$/.test(item));

                structure.years[year][month] = {};

                days.forEach(day => {
                    const dayPath = path.join(monthPath, day);

                    // Get count of files instead of all filenames to avoid huge response
                    const files = fs.readdirSync(dayPath);
                    const videoFiles = files.filter(file => file.toLowerCase().endsWith('.mp4'));

                    // Get cameras in this directory
                    const cameras = new Set();
                    videoFiles.forEach(file => {
                        // Extract camera name from filename (before the timestamp)
                        const match = file.match(/^([^_]+(?:_\d+)?)/);
                        if (match) {
                            cameras.add(match[1]);
                        }
                    });

                    structure.years[year][month][day] = {
                        fileCount: files.length,
                        videoCount: videoFiles.length,
                        cameras: Array.from(cameras)
                    };

                    // Add sample filenames (up to 5)
                    if (videoFiles.length > 0) {
                        structure.years[year][month][day].sampleFiles = videoFiles.slice(0, 5);
                    }
                });
            });
        });

        res.json({
            structure,
            stats: {
                yearCount: Object.keys(structure.years).length,
                totalDays: Object.values(structure.years).reduce((total, months) => {
                    return total + Object.values(months).reduce((monthTotal, days) => {
                        return monthTotal + Object.keys(days).length;
                    }, 0);
                }, 0)
            }
        });
    } catch (error) {
        console.error('Error getting directory structure:', error);
        res.status(500).json({
            error: 'Failed to get directory structure',
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