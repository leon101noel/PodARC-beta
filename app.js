const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bodyParser = require('body-parser');
const { simpleParser } = require('mailparser');
const https = require('https');
const { inspect } = require('util');
// Authentication-related imports
const session = require('express-session');
const { authMiddleware } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const statsRoutes = require('./routes/stats');
const { router: sitesRoutes, matchCameraToSite } = require('./routes/sites');
// Add the SMTP server import
const { initSmtpServer, processEmail } = require('./smtp-server');
// Add retention routes and service
const retentionRoutes = require('./routes/retention');
const EventRetentionService = require('./event-retention');
// Add operator logs routes
const operatorLogsRoutes = require('./routes/operator-logs');
// Add audit logs routes and middleware
const auditLogsRoutes = require('./routes/audit-logs');
const auditLoggerMiddleware = require('./middleware/audit-logger');
// Add cron for scheduled tasks
const CronJob = require('cron').CronJob;

const app = express();
const PORT = process.env.PORT || 3020;

// Store connected SSE clients
const sseClients = new Set();

// Email and application configuration
const config = {
    // SMTP server settings
    smtp: {
        enabled: true, // Enable the built-in SMTP server
        port: process.env.SMTP_PORT || 2525, // Port for the SMTP server
        host: process.env.SMTP_HOST || '0.0.0.0' // Listen on all interfaces
    },

    // Application settings
    lateResponseThresholdMinutes: 2, // Threshold for considering a response "late"
    retentionDays: process.env.RETENTION_DAYS || 7, // Default retention period in days
};

// Middleware - IMPORTANT: Apply body-parser and cors before auth middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Set up session middleware
app.use(session({
    secret: 'cctv-monitor-session-key-X8sPq3tRw9yZ7aVb2nM5',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // set to true if using HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// Authentication middleware
app.use(authMiddleware);

// Add audit logger middleware (after auth middleware but before routes)
// This needs to come AFTER authentication but BEFORE any routes
app.use(auditLoggerMiddleware);

// Add auth routes
app.use('/api/auth', authRoutes);

// Add stats routes
app.use('/api/stats', statsRoutes);

// Add sites routes
app.use('/api/sites', sitesRoutes);

// Add retention routes
app.use('/api/retention', retentionRoutes);

// Add operator logs routes
app.use('/api/operator-logs', operatorLogsRoutes);

// Add audit logs routes
app.use('/api/audit-logs', auditLogsRoutes);

// Data file path
const dataFilePath = path.join(__dirname, 'events-data.json');

// Helper function to read events data
function readEventsData() {
    try {
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading events data:', err);
        return [];
    }
}

// Helper function to write events data
function writeEventsData(events) {
    try {
        fs.writeFileSync(dataFilePath, JSON.stringify(events, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing events data:', err);
        return false;
    }
}

// Helper function to read settings data
function readSettingsData() {
    try {
        const dataFilePath = path.join(__dirname, 'settings-data.json');

        // Check if file exists, if not create it with default settings
        if (!fs.existsSync(dataFilePath)) {
            const defaultSettings = {
                tags: ['False Alarm', 'Intruder', 'Known Person', 'Animal', 'Vehicle', 'Other']
            };
            fs.writeFileSync(dataFilePath, JSON.stringify(defaultSettings, null, 2));
            return defaultSettings;
        }

        // Read existing file
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading settings data:', err);
        return { tags: ['False Alarm', 'Intruder', 'Known Person', 'Animal', 'Vehicle', 'Other'] };
    }
}

// Helper function to write settings data
function writeSettingsData(settings) {
    try {
        const dataFilePath = path.join(__dirname, 'settings-data.json');
        fs.writeFileSync(dataFilePath, JSON.stringify(settings, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing settings data:', err);
        return false;
    }
}

// Function to download an image from a URL
function downloadImage(url, imagePath) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(imagePath);
        https.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(imagePath, () => { }); // Delete the file if there's an error
            reject(err);
        });
    });
}

// Helper function to save email images from SMTP server
async function saveEmailImage(imageData, imagePath) {
    try {
        const fullPath = path.join(__dirname, 'public', imagePath);

        // Make sure the images directory exists
        const imagesDir = path.join(__dirname, 'public/images');
        if (!fs.existsSync(imagesDir)) {
            fs.mkdirSync(imagesDir, { recursive: true });
        }

        // If it's a URL that needs to be downloaded
        if (imageData && imageData.isUrl) {
            await downloadImage(imageData.url, fullPath);
            console.log(`Downloaded image from URL: ${fullPath}`);
            return true;
        }
        // If it's direct binary content
        else if (imageData) {
            fs.writeFileSync(fullPath, imageData);
            console.log(`Saved email image: ${fullPath}`);
            return true;
        }

        return false;
    } catch (error) {
        console.error('Error saving email image:', error);
        return false;
    }
}

// Helper function to notify all connected clients about new events
function notifyClients(data) {
    console.log(`Notifying ${sseClients.size} clients of new events`);
    sseClients.forEach(client => {
        try {
            client.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (error) {
            console.error('Error notifying client:', error);
            // Remove problematic client
            sseClients.delete(client);
        }
    });
}

// Function to process emails - replaced with stub for SMTP-only implementation
function processEmails() {
    console.log('IMAP checking is deprecated. Using built-in SMTP server instead.');
    return Promise.resolve({ newEvents: 0, error: null });
}

// Routes

// Serve the login page
app.get('/login', (req, res) => {
    // If already authenticated, redirect to home
    if (req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Also handle /login.html for direct access
app.get('/login.html', (req, res) => {
    // If already authenticated, redirect to home
    if (req.user) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve the statistics page
app.get('/statistics.html', (req, res) => {
    // If not authenticated, redirect to login
    if (!req.user) {
        return res.redirect('/login');
    }
    res.sendFile(path.join(__dirname, 'public', 'statistics.html'));
});

// Serve user management page (admin only)
app.get('/users', (req, res) => {
    // Check if authenticated and is admin
    if (!req.user) {
        return res.redirect('/login');
    }

    if (req.user.role !== 'admin') {
        return res.redirect('/');
    }

    res.sendFile(path.join(__dirname, 'public', 'user-management.html'));
});

// Serve settings page (admin only)
app.get('/settings', (req, res) => {
    // Check if authenticated and is admin
    if (!req.user) {
        return res.redirect('/login');
    }

    if (req.user.role !== 'admin') {
        return res.redirect('/');
    }

    res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

// Serve retention settings page (admin only)
app.get('/retention.html', (req, res) => {
    // Check if authenticated and is admin
    if (!req.user) {
        return res.redirect('/login');
    }

    if (req.user.role !== 'admin') {
        return res.redirect('/');
    }

    res.sendFile(path.join(__dirname, 'public', 'retention.html'));
});

// Serve the test events page
app.get('/test-events', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'test-events.html'));
});

// Get all events
app.get('/api/events', (req, res) => {
    try {
        const events = readEventsData();
        res.json(events);
    } catch (error) {
        console.error('Error fetching events:', error);
        res.status(500).json({ error: 'Failed to retrieve events' });
    }
});

// New API route to list video files from date-based directories
app.get('/api/videos/list', authMiddleware, (req, res) => {
    try {
        const camera = req.query.camera;
        const dateStr = req.query.date; // Format: YYYYMMDD
        const baseDir = path.join(__dirname, 'public', 'videos');

        // Make sure the base directory exists
        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
            return res.json([]); // No videos yet
        }

        let videoFiles = [];

        // If date is specified, only look in that directory
        if (dateStr && dateStr.length === 8) {
            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);

            const dateDir = path.join(baseDir, year, month, day);

            if (fs.existsSync(dateDir)) {
                try {
                    const files = fs.readdirSync(dateDir);

                    // Filter for MP4 files
                    files.filter(file => file.toLowerCase().endsWith('.mp4'))
                        .forEach(file => {
                            // Include full path relative to /videos
                            videoFiles.push(`${year}/${month}/${day}/${file}`);
                        });
                } catch (err) {
                    console.error(`Error reading directory ${dateDir}:`, err);
                }
            }
        } else {
            // No date specified, search all directories (last 7 days by default)
            const maxDays = 7; // Only search the last 7 days by default

            // Get current date and year directory
            const now = new Date();
            const yearDirs = [];

            // Try to read year directories
            try {
                const years = fs.readdirSync(baseDir);

                // Filter for valid year directories (4 digits)
                yearDirs.push(...years.filter(year => /^\d{4}$/.test(year)));
            } catch (err) {
                console.error(`Error reading base directory:`, err);
            }

            // Process found year directories
            for (const year of yearDirs) {
                const yearPath = path.join(baseDir, year);

                try {
                    const months = fs.readdirSync(yearPath);

                    // For each month directory
                    for (const month of months.filter(m => /^\d{2}$/.test(m))) {
                        const monthPath = path.join(yearPath, month);

                        try {
                            const days = fs.readdirSync(monthPath);

                            // For each day directory
                            for (const day of days.filter(d => /^\d{2}$/.test(d))) {
                                const dayPath = path.join(monthPath, day);

                                // Check if this date is within the last maxDays
                                const dirDate = new Date(`${year}-${month}-${day}`);
                                const daysDiff = Math.floor((now - dirDate) / (1000 * 60 * 60 * 24));

                                if (daysDiff <= maxDays) {
                                    try {
                                        const files = fs.readdirSync(dayPath);

                                        // Filter for MP4 files and add to results
                                        files.filter(file => file.toLowerCase().endsWith('.mp4'))
                                            .forEach(file => {
                                                // Include full path relative to /videos
                                                videoFiles.push(`${year}/${month}/${day}/${file}`);
                                            });
                                    } catch (err) {
                                        console.error(`Error reading day directory ${dayPath}:`, err);
                                    }
                                }
                            }
                        } catch (err) {
                            console.error(`Error reading month directory ${monthPath}:`, err);
                        }
                    }
                } catch (err) {
                    console.error(`Error reading year directory ${yearPath}:`, err);
                }
            }
        }

        // If camera is specified, filter by camera name
        if (camera) {
            videoFiles = videoFiles.filter(file => {
                // Get just the filename part
                const filename = path.basename(file);
                // Format: POD1_00_20250424153423.mp4
                return filename.startsWith(camera);
            });
        }

        res.json(videoFiles);
    } catch (error) {
        console.error('Error listing video files:', error);
        res.status(500).json({ error: 'Failed to list video files' });
    }
});

// Acknowledge an event - updated to include notes, tags, and locked status
app.post('/api/events/:id/acknowledge', (req, res) => {
    try {
        // Make sure user is authenticated
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        const eventId = parseInt(req.params.id);
        const { note, tags, locked } = req.body; // Get note, tags, and locked from request body
        const events = readEventsData();

        const eventIndex = events.findIndex(event => event.id === eventId);
        if (eventIndex === -1) {
            return res.status(404).json({ error: 'Event not found' });
        }
        
        // Store the previous state for audit log
        const previousState = { ...events[eventIndex] };

        // Get the current time for acknowledgment timestamp
        const acknowledgedAt = new Date().toISOString();

        // Calculate response time in milliseconds
        const eventDate = new Date(events[eventIndex].date);
        const ackDate = new Date(acknowledgedAt);
        const responseTimeMs = ackDate.getTime() - eventDate.getTime();

        // Convert to minutes for easier reading
        const responseTimeMinutes = Math.floor(responseTimeMs / (1000 * 60));

        // Check if response is late (greater than configured threshold)
        const isLateResponse = responseTimeMinutes > config.lateResponseThresholdMinutes;

        // Update the event with acknowledgment info
        events[eventIndex].acknowledged = true;
        events[eventIndex].acknowledgedAt = acknowledgedAt;
        events[eventIndex].responseTimeMinutes = responseTimeMinutes;

        // Add information about which user acknowledged the event
        events[eventIndex].acknowledgedBy = {
            userId: req.user.id,
            username: req.user.username,
            name: req.user.name
        };

        // Add note if provided
        if (note) {
            events[eventIndex].note = note;
        }

        // Add tags if provided
        if (tags && Array.isArray(tags) && tags.length > 0) {
            events[eventIndex].tags = tags;
        }

        // Update locked status if provided
        if (locked !== undefined) {
            events[eventIndex].locked = locked;
        }

        if (isLateResponse) {
            events[eventIndex].isLateResponse = true;
        }

        // Save the updated data
        const success = writeEventsData(events);
        if (!success) {
            return res.status(500).json({ error: 'Failed to update event' });
        }

        // Log the activity using the audit service
        const { ACTIONS, logUserActivity } = require('./audit-service');
        logUserActivity(
            req,
            ACTIONS.EVENT_ACKNOWLEDGE,
            'events',
            eventId,
            {
                previousState,
                newState: events[eventIndex],
                changes: {
                    note,
                    tags,
                    locked,
                    responseTimeMinutes,
                    isLateResponse
                }
            },
            true
        );

        res.json({
            success: true,
            event: events[eventIndex]
        });
    } catch (error) {
        console.error('Error acknowledging event:', error);
        res.status(500).json({ error: 'Failed to acknowledge event' });
    }
});

// Get all available tags (from settings)
app.get('/api/settings/tags', (req, res) => {
    try {
        // Read settings file
        const settings = readSettingsData();

        // Return tags array (or empty array if not set)
        res.json(settings.tags || []);
    } catch (error) {
        console.error('Error fetching tags:', error);
        res.status(500).json({ error: 'Failed to retrieve tags' });
    }
});

// Update tags settings (admin only)
app.post('/api/settings/tags', (req, res) => {
    try {
        // Make sure user is authenticated and is admin
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        const { tags } = req.body;

        // Validate tags
        if (!tags || !Array.isArray(tags)) {
            return res.status(400).json({ error: 'Invalid tags format' });
        }

        // Read current settings
        const settings = readSettingsData();

        // Update tags
        settings.tags = tags;

        // Save updated settings
        const success = writeSettingsData(settings);
        if (!success) {
            return res.status(500).json({ error: 'Failed to update tags' });
        }

        res.json({ success: true, tags });
    } catch (error) {
        console.error('Error updating tags:', error);
        res.status(500).json({ error: 'Failed to update tags' });
    }
});

// Server-Sent Events endpoint for real-time updates
app.get('/api/events/updates', (req, res) => {
    // Set headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        // These additional headers ensure compatibility across browsers and proxies
        'X-Accel-Buffering': 'no', // For Nginx
        'Access-Control-Allow-Origin': '*' // CORS for SSE
    });

    // Send an initial ping to establish the connection
    res.write('data: {"type":"connected"}\n\n');

    // Add client to the set
    sseClients.add(res);

    // Remove client when connection closes
    req.on('close', () => {
        sseClients.delete(res);
        console.log('Client disconnected from SSE stream, remaining clients:', sseClients.size);
    });

    console.log('Client connected to SSE stream, total clients:', sseClients.size);
});

// Modified check-emails endpoint - now just for testing
app.post('/api/check-emails', async (req, res) => {
    try {
        // If test parameter is true, create a test event
        if (req.query.test === 'true') {
            const events = readEventsData();

            // Create a new test event
            const newEvent = {
                id: Date.now(),
                messageId: `test-${Date.now()}`,
                date: new Date().toISOString(),
                subject: `Test Event at ${new Date().toLocaleTimeString()}`,
                imagePath: '/images/test.jpg',
                camera: 'Test Camera',
                eventType: 'Test Detection',
                device: 'Test Device',
                acknowledged: false,
                locked: false // Default to unlocked
            };

            // Add to events array
            events.push(newEvent);

            // Save updated events
            writeEventsData(events);

            // Notify connected clients
            notifyClients({
                type: 'new-events',
                count: 1,
                events: [newEvent]
            });

            return res.json({ success: true, newEvents: 1 });
        }

        // Just return a message that IMAP is disabled
        return res.json({
            success: true,
            newEvents: 0,
            message: 'IMAP checking is disabled. Using built-in SMTP server instead.'
        });
    } catch (error) {
        console.error('Error in check-emails endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Error in check-emails endpoint',
            details: error.message || 'Unknown error'
        });
    }
});

// Create a test event (for debugging)
app.post('/api/test/create-event', (req, res) => {
    try {
        const events = readEventsData();

        // Create a new test event
        const newEvent = {
            id: Date.now(),
            messageId: `test-${Date.now()}`,
            date: new Date().toISOString(),
            subject: `Test Event at ${new Date().toLocaleTimeString()}`,
            imagePath: '/images/test.jpg',
            camera: 'Test Camera',
            eventType: 'Test Detection',
            device: 'Test Device',
            acknowledged: false,
            locked: false // Default to unlocked
        };

        // Add to events array
        events.push(newEvent);

        // Save updated events
        writeEventsData(events);

        // Notify connected clients
        notifyClients({
            type: 'new-events',
            count: 1,
            events: [newEvent]
        });

        res.json({ success: true, event: newEvent });
    } catch (error) {
        console.error('Error creating test event:', error);
        res.status(500).json({ success: false, error: 'Failed to create test event' });
    }
});

// API endpoint to manually notify about a video upload
// This replaces the FTP server event notification
app.post('/api/videos/notify-upload', authMiddleware, (req, res) => {
    try {
        const { path, camera, timestamp } = req.body;

        if (!path || !camera) {
            return res.status(400).json({ error: 'Missing required fields: path and camera' });
        }

        // Notify all connected SSE clients
        if (sseClients.size > 0) {
            const notification = {
                type: 'video-uploaded',
                videoPath: path,
                camera: camera,
                timestamp: timestamp || new Date().toISOString()
            };

            notifyClients(notification);
        }

        res.json({ success: true, message: 'Upload notification sent' });
    } catch (error) {
        console.error('Error sending video upload notification:', error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

// @route   POST /api/events/update-video-path
// @desc    Update an event with the matched video path
// @access  Private (requires authentication)
app.post('/api/events/update-video-path', authMiddleware, (req, res) => {
    try {
        const { eventId, videoPath } = req.body;

        if (!eventId || !videoPath) {
            return res.status(400).json({
                success: false,
                error: 'Event ID and video path are required'
            });
        }

        console.log(`Updating event ${eventId} with video path: ${videoPath}`);

        // Read current events data
        const eventsFilePath = path.join(__dirname, 'events-data.json');
        let events;

        try {
            const data = fs.readFileSync(eventsFilePath, 'utf8');
            events = JSON.parse(data);
        } catch (readErr) {
            console.error('Error reading events data:', readErr);
            return res.status(500).json({
                success: false,
                error: 'Failed to read events data'
            });
        }

        // Find the event
        const eventIndex = events.findIndex(event => event.id === eventId);
        if (eventIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Event not found'
            });
        }

        // Check if the path is already set
        if (events[eventIndex].videoPath === videoPath) {
            console.log(`Event ${eventId} already has the same video path, no update needed`);
            return res.json({
                success: true,
                message: 'Event already has this video path',
                event: events[eventIndex]
            });
        }

        // Update the event with the video path
        events[eventIndex].videoPath = videoPath;

        // Save the updated events
        try {
            fs.writeFileSync(eventsFilePath, JSON.stringify(events, null, 2));
            console.log(`Successfully updated event ${eventId} with video path ${videoPath}`);
        } catch (writeErr) {
            console.error('Error writing events data:', writeErr);
            return res.status(500).json({
                success: false,
                error: 'Failed to write events data'
            });
        }

        res.json({
            success: true,
            message: 'Event updated with video path',
            event: events[eventIndex]
        });
    } catch (error) {
        console.error('Error updating event with video path:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update event with video path'
        });
    }
});

/**
 * Check if a video file exists for the given event
 * @param {Object} event - The event object
 * @returns {Promise<{found: boolean, videoPath: string|null}>} - Object with found status and path
 */
async function findMatchingVideo(event) {
    try {
        console.log(`Finding matching video for event ${event.id}...`);

        // Skip processing if no image path or camera
        if (!event.imagePath) {
            console.log('No image path available');
            return { found: false, videoPath: null };
        }

        // Try to extract timestamp from image filename
        // Format: 1745505272552_01_20250424153418000.jpg
        const imageMatch = event.imagePath.match(/\d+_\d+_(\d{14})/);
        if (!imageMatch) {
            console.log('No timestamp found in image path');
            return { found: false, videoPath: null };
        }

        const imageTimestamp = imageMatch[1]; // 20250424153418000
        const dateTimePart = imageTimestamp.substr(0, 14); // 20250424153418

        // Get camera name from event
        const cameraName = event.camera || '';
        if (!cameraName) {
            console.log('No camera name available');
            return { found: false, videoPath: null };
        }

        // Format date parts for comparison - CORRECTED
        const year = dateTimePart.substr(0, 4);
        const month = dateTimePart.substr(4, 2);
        const day = dateTimePart.substr(6, 2);
        const hour = dateTimePart.substr(8, 2);
        const minute = dateTimePart.substr(10, 2);
        const second = dateTimePart.substr(12, 2);

        console.log(`Image timestamp: ${year}-${month}-${day} ${hour}:${minute}:${second}`);

        // Create a date object for the image timestamp
        const imageDate = new Date(
            parseInt(year),
            parseInt(month) - 1, // JavaScript months are 0-based
            parseInt(day),
            parseInt(hour),
            parseInt(minute),
            parseInt(second)
        );

        console.log(`Image date: ${imageDate.toISOString()}`);

        // Check for video files within a window of time (e.g., 120 seconds before/after)
        // Increased from 30 to 120 seconds for better matching
        const timeWindowMs = 120 * 1000; // 120 seconds

        // Create date string for the API call (format: YYYYMMDD)
        const dateStr = `${year}${month}${day}`;

        // Get video files for this camera and date
        const response = await fetch(`/api/videos/list?camera=${encodeURIComponent(cameraName)}&date=${dateStr}`, {
            headers: {
                'x-auth-token': token
            }
        });

        if (!response.ok) {
            console.warn(`Failed to fetch video list: ${response.status}`);
            return { found: false, videoPath: null };
        }

        const videoFiles = await response.json();
        console.log(`Found ${videoFiles.length} videos for camera ${cameraName} on ${dateStr}`);

        // Find a video file with a timestamp close to the image timestamp
        let bestMatch = null;
        let minTimeDiff = Infinity;

        for (const videoPath of videoFiles) {
            // Extract the filename from the full path
            const filename = videoPath.split('/').pop();

            // Extract timestamp from video filename
            // Format: POD1_00_20250424153423.mp4
            // Format: POD1-02_20250424153423.mp4
            const videoMatch = filename.match(/(\d{14})/);
            if (!videoMatch) {
                console.log(`No timestamp found in filename: ${filename}`);
                continue;
            }

            const videoTimestamp = videoMatch[1];

            // Parse video date components - CORRECTED
            const vYear = parseInt(videoTimestamp.substr(0, 4));
            const vMonth = parseInt(videoTimestamp.substr(4, 2)) - 1; // JS months are 0-based
            const vDay = parseInt(videoTimestamp.substr(6, 2));
            const vHour = parseInt(videoTimestamp.substr(8, 2));
            const vMinute = parseInt(videoTimestamp.substr(10, 2));
            const vSecond = parseInt(videoTimestamp.substr(12, 2));

            console.log(`Video timestamp: ${vYear}-${vMonth + 1}-${vDay} ${vHour}:${vMinute}:${vSecond}`);

            // Create date object for video
            try {
                const fileDate = new Date(vYear, vMonth, vDay, vHour, vMinute, vSecond);
                const fileTime = fileDate.getTime();

                console.log(`Video date: ${fileDate.toISOString()}`);

                // Calculate time difference
                const timeDiff = Math.abs(fileTime - imageDate.getTime());

                console.log(`Video: ${filename}, Time diff: ${timeDiff}ms`);

                // Update best match if this video is closer in time
                if (timeDiff < minTimeDiff && timeDiff <= timeWindowMs) {
                    minTimeDiff = timeDiff;
                    bestMatch = videoPath;
                }
            } catch (e) {
                console.error(`Error parsing date for ${filename}:`, e);
            }
        }

        if (bestMatch) {
            const fullVideoPath = `/videos/${bestMatch}`;

            console.log(`Found matching video for event ${event.id}: ${fullVideoPath} (time diff: ${minTimeDiff}ms)`);

            // Store the video path in the event data immediately
            if (event.id) {
                try {
                    // Update the event with the video path
                    const updateResponse = await fetch('/api/events/update-video-path', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-auth-token': token
                        },
                        body: JSON.stringify({
                            eventId: event.id,
                            videoPath: fullVideoPath
                        })
                    });

                    if (updateResponse.ok) {
                        const result = await updateResponse.json();
                        console.log(`Successfully updated event ${event.id} with video path: ${fullVideoPath}`);
                        console.log('API response:', result);
                    } else {
                        console.error(`Failed to update event ${event.id} with video path: ${updateResponse.status}`);
                        const errorText = await updateResponse.text();
                        console.error('Error details:', errorText);
                    }
                } catch (error) {
                    console.error('Error updating event with video path:', error);
                }
            }

            return {
                found: true,
                videoPath: fullVideoPath,
                timeDifference: minTimeDiff
            };
        }

        // If we didn't find a match, try expanding search to all dates
        // This is useful if the event happens near midnight and the video
        // might be in the next day's directory
        if (videoFiles.length === 0) {
            console.log("No videos found for this date, expanding search to all dates");

            // Get all videos for this camera (without date restriction)
            const allResponse = await fetch(`/api/videos/list?camera=${encodeURIComponent(cameraName)}`, {
                headers: {
                    'x-auth-token': token
                }
            });

            if (!allResponse.ok) {
                return { found: false, videoPath: null };
            }

            const allVideoFiles = await allResponse.json();
            console.log(`Found ${allVideoFiles.length} videos for camera ${cameraName} across all dates`);

            // Same matching logic as above
            for (const videoPath of allVideoFiles) {
                const filename = videoPath.split('/').pop();
                const videoMatch = filename.match(/(\d{14})/);
                if (!videoMatch) continue;

                const videoTimestamp = videoMatch[1];

                // Parse video date components - CORRECTED
                const vYear = parseInt(videoTimestamp.substr(0, 4));
                const vMonth = parseInt(videoTimestamp.substr(4, 2)) - 1;
                const vDay = parseInt(videoTimestamp.substr(6, 2));
                const vHour = parseInt(videoTimestamp.substr(8, 2));
                const vMinute = parseInt(videoTimestamp.substr(10, 2));
                const vSecond = parseInt(videoTimestamp.substr(12, 2));

                // Create date object for video
                try {
                    const videoDate = new Date(
                        vYear, vMonth, vDay, vHour, vMinute, vSecond
                    );

                    // Calculate time difference
                    const timeDiff = Math.abs(videoDate.getTime() - imageDate.getTime());

                    console.log(`Extended search - Video: ${filename}, Time diff: ${timeDiff}ms`);

                    // Use a larger time window for extended search (2 minutes)
                    const extendedTimeWindow = 120 * 1000;

                    // Update best match if this video is closer in time
                    if (timeDiff < minTimeDiff && timeDiff <= extendedTimeWindow) {
                        minTimeDiff = timeDiff;
                        bestMatch = videoPath;
                    }
                } catch (e) {
                    console.error(`Error parsing date for ${filename}:`, e);
                }
            }

            if (bestMatch) {
                const fullVideoPath = `/videos/${bestMatch}`;

                console.log(`Found matching video in extended search for event ${event.id}: ${fullVideoPath} (time diff: ${minTimeDiff}ms)`);

                // Store the video path in the event data immediately
                if (event.id) {
                    try {
                        // Update the event with the video path
                        const updateResponse = await fetch('/api/events/update-video-path', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'x-auth-token': token
                            },
                            body: JSON.stringify({
                                eventId: event.id,
                                videoPath: fullVideoPath
                            })
                        });

                        if (updateResponse.ok) {
                            const result = await updateResponse.json();
                            console.log(`Successfully updated event ${event.id} with video path: ${fullVideoPath}`);
                            console.log('API response:', result);
                        } else {
                            console.error(`Failed to update event ${event.id} with video path: ${updateResponse.status}`);
                            const errorText = await updateResponse.text();
                            console.error('Error details:', errorText);
                        }
                    } catch (error) {
                        console.error('Error updating event with video path:', error);
                    }
                }

                return {
                    found: true,
                    videoPath: fullVideoPath,
                    timeDifference: minTimeDiff
                };
            }
        }

        return { found: false, videoPath: null };
    } catch (error) {
        console.error('Error finding matching video:', error);
        return { found: false, videoPath: null };
    }
}

/**
 * Updates an event with the matched video path
 * This uses a direct approach instead of the API endpoint to ensure paths are saved
 * @param {number} eventId - The ID of the event to update
 * @param {string} videoPath - The path to the video file
 * @returns {Promise<boolean>} - True if successful
 */
async function updateEventWithVideoPath(eventId, videoPath) {
    try {
        console.log(`Updating event ${eventId} with video path: ${videoPath}`);

        // Fetch all events directly
        const eventsResponse = await fetch('/api/events', {
            headers: {
                'x-auth-token': token
            }
        });

        if (!eventsResponse.ok) {
            throw new Error(`Failed to fetch events: ${eventsResponse.status}`);
        }

        const events = await eventsResponse.json();
        console.log(`Loaded ${events.length} events to update event ${eventId}`);

        // Find the event to update
        const eventIndex = events.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            throw new Error(`Event ${eventId} not found in events data`);
        }

        // Update the event with new video path
        if (events[eventIndex].videoPath !== videoPath) {
            console.log(`Setting video path for event ${eventId} from "${events[eventIndex].videoPath || 'none'}" to "${videoPath}"`);

            // Update the event object
            events[eventIndex].videoPath = videoPath;

            // Since we don't have direct file system access in the browser,
            // we'll use our API endpoint to update the event
            const updateResponse = await fetch('/api/events/update-video-path', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-auth-token': token
                },
                body: JSON.stringify({
                    eventId: eventId,
                    videoPath: videoPath
                })
            });

            if (!updateResponse.ok) {
                const errorText = await updateResponse.text();
                console.error(`Failed to update event via API: ${updateResponse.status}`, errorText);
                throw new Error(`API returned error ${updateResponse.status}: ${errorText}`);
            }

            const result = await updateResponse.json();
            console.log('Update API response:', result);

            if (result.success) {
                console.log(`Successfully updated event ${eventId} with video path via API`);
                return true;
            } else {
                console.error('API reported failure:', result);
                return false;
            }
        } else {
            console.log(`Event ${eventId} already has the same video path, no update needed`);
            return true;
        }
    } catch (error) {
        console.error(`Failed to update event ${eventId} with video path:`, error);
        return false;
    }
}

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);

    // Ensure events have acknowledged property, but only add it if it doesn't exist
    const events = readEventsData();
    let updated = false;

    events.forEach(event => {
        if (event.acknowledged === undefined) {
            event.acknowledged = false;
            updated = true;
        }

        // Add locked property if it doesn't exist
        if (event.locked === undefined) {
            event.locked = false;
            updated = true;
        }
    });

    if (updated) {
        writeEventsData(events);
        console.log('Updated events data with acknowledged and locked properties');
    }

    // Make sure the videos directory exists
    const videosDir = path.join(__dirname, 'public/videos');
    if (!fs.existsSync(videosDir)) {
        fs.mkdirSync(videosDir, { recursive: true });
        console.log('Created videos directory');
    }

    // Initialize the SMTP server
    if (config.smtp.enabled) {
        const smtpServer = initSmtpServer(async (emailData) => {
            console.log(`Received email via SMTP: ${emailData.subject}`);

            // Log authentication status
            if (emailData.authenticated) {
                console.log(`Email was sent by authenticated user: ${emailData.authenticatedUser}`);
            } else {
                console.log('Email was sent without authentication');
            }

            // Process the email to extract alarm event data
            const eventData = processEmail(emailData);

            if (eventData) {
                try {
                    // Read current events
                    const events = readEventsData();

                    // Check if this event already exists
                    const existingEvent = events.find(e => e.messageId === eventData.messageId);
                    if (existingEvent) {
                        console.log('Event already exists, skipping');
                        return;
                    }

                    // Save the image if available
                    if (eventData.imagePath && eventData.imageContent) {
                        await saveEmailImage(eventData.imageContent, eventData.imagePath);
                    }

                    // Check if camera matches a site
                    let siteInfo = null;
                    try {
                        siteInfo = matchCameraToSite(eventData.camera);
                        if (siteInfo) {
                            console.log(`Camera ${eventData.camera} matched to site ID ${siteInfo.id} (${siteInfo.name})`);
                        } else {
                            console.log(`No site match found for camera: ${eventData.camera}`);
                        }
                    } catch (siteError) {
                        console.error('Error matching camera to site:', siteError);
                    }

                    // Create a new event with a unique ID
                    const newEvent = {
                        id: Date.now(),
                        messageId: eventData.messageId,
                        date: eventData.date.toISOString(),
                        subject: eventData.subject,
                        imagePath: eventData.imagePath,
                        camera: eventData.camera,
                        eventType: eventData.eventType,
                        device: eventData.device,
                        authenticated: eventData.authenticated,
                        authenticatedUser: eventData.authenticatedUser,
                        acknowledged: false,
                        locked: false, // Default to unlocked
                        siteId: siteInfo ? siteInfo.id : null
                    };

                    // Add to events array
                    events.push(newEvent);
                    console.log('Added new event from SMTP:', newEvent);

                    // Save updated events
                    writeEventsData(events);

                    // Notify all connected clients
                    notifyClients({
                        type: 'new-events',
                        count: 1,
                        events: [newEvent]
                    });
                } catch (error) {
                    console.error('Error processing SMTP email:', error);
                }
            }
        });

        console.log(`SMTP server enabled on ${config.smtp.host}:${config.smtp.port} with authentication enabled`);
    } else {
        console.log('Warning: No email receiving method is enabled. Configure SMTP server settings.');
    }

    // Initialize retention service
    const retentionService = new EventRetentionService({
        retentionDays: config.retentionDays,
        eventsFilePath: path.join(__dirname, 'events-data.json'),
        imagesBasePath: path.join(__dirname, 'public'),
        videosBasePath: path.join(__dirname, 'public')
    });

    // Set up scheduled cleanup - run every day at 3 AM
    const cleanupJob = new CronJob('0 3 * * *', async function () {
        console.log('Running scheduled event cleanup...');
        try {
            const stats = await retentionService.cleanupOldEvents();
            console.log('Scheduled cleanup completed:', stats);
        } catch (error) {
            console.error('Error during scheduled cleanup:', error);
        }
    }, null, true);

    // Start the cleanup job
    cleanupJob.start();
    console.log('Scheduled event cleanup job initialized (runs daily at 3 AM)');

    console.log('Note: External FTP server should be configured separately to upload files to the videos directory');
});