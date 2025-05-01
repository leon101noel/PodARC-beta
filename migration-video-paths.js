// migration-video-paths.js
// Run this script to scan through existing events and add video paths

const fs = require('fs');
const path = require('path');
const util = require('util');

// Make fs functions promise-based
const readdir = util.promisify(fs.readdir);
const stat = util.promisify(fs.stat);

// Path to events data file
const eventsFilePath = path.join(__dirname, 'events-data.json');
const videosBasePath = path.join(__dirname, 'public', 'videos');

// Helper function to read events data
function readEventsData() {
    try {
        const data = fs.readFileSync(eventsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading events data:', err);
        return [];
    }
}

// Helper function to write events data
function writeEventsData(events) {
    try {
        fs.writeFileSync(eventsFilePath, JSON.stringify(events, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing events data:', err);
        return false;
    }
}

/**
 * Find matching video for an event
 * @param {Object} event - Event data
 * @returns {Promise<string|null>} - Path to the matching video or null if not found
 */
async function findMatchingVideo(event) {
    try {
        // Skip events that already have a video path
        if (event.videoPath) {
            console.log(`Event ${event.id} already has video path: ${event.videoPath}`);
            return event.videoPath;
        }

        // Skip events without a camera name or image path
        if (!event.camera || !event.imagePath) {
            return null;
        }

        // Extract timestamp from image filename if possible
        // Format: 1745505272552_01_20250424153418000.jpg
        const imageMatch = event.imagePath.match(/\d+_\d+_(\d{14})/);
        if (!imageMatch) return null;

        const imageTimestamp = imageMatch[1]; // 20250424153418000
        const dateTimePart = imageTimestamp.substr(0, 14); // 20250424153418

        // Format date parts for comparison
        const year = dateTimePart.substr(0, 4);
        const month = dateTimePart.substr(4, 2);
        const day = dateTimePart.substr(6, 2);

        // Get event date
        let eventDate;
        try {
            eventDate = new Date(event.date);
        } catch (e) {
            console.error(`Error parsing event date ${event.date} for event ${event.id}:`, e);
            return null;
        }

        // Define dates to check (exact day, day before, day after)
        const datesToCheck = [
            { year, month, day }, // Exact date from image
            { // From event date
                year: eventDate.getFullYear().toString(),
                month: (eventDate.getMonth() + 1).toString().padStart(2, '0'),
                day: eventDate.getDate().toString().padStart(2, '0')
            }
        ];

        // Add day before event date
        const dayBefore = new Date(eventDate);
        dayBefore.setDate(dayBefore.getDate() - 1);
        datesToCheck.push({
            year: dayBefore.getFullYear().toString(),
            month: (dayBefore.getMonth() + 1).toString().padStart(2, '0'),
            day: dayBefore.getDate().toString().padStart(2, '0')
        });

        // Add day after event date
        const dayAfter = new Date(eventDate);
        dayAfter.setDate(dayAfter.getDate() + 1);
        datesToCheck.push({
            year: dayAfter.getFullYear().toString(),
            month: (dayAfter.getMonth() + 1).toString().padStart(2, '0'),
            day: dayAfter.getDate().toString().padStart(2, '0')
        });

        // Get the hour, minute, second from image timestamp for more precise matching
        let hour, minute, second;
        try {
            hour = parseInt(dateTimePart.substr(8, 2));
            minute = parseInt(dateTimePart.substr(10, 2));
            second = parseInt(dateTimePart.substr(12, 2));
        } catch (e) {
            console.log(`Using date from event record for ${event.id} due to parsing error`);
            hour = eventDate.getHours();
            minute = eventDate.getMinutes();
            second = eventDate.getSeconds();
        }

        // Create date object for comparison
        const compareDate = new Date(
            parseInt(year),
            parseInt(month) - 1,
            parseInt(day),
            hour,
            minute,
            second
        );
        const compareTime = compareDate.getTime();

        // Track best match
        let bestMatch = null;
        let minTimeDiff = Infinity;

        // Check each date directory
        for (const dateToCheck of datesToCheck) {
            const { year, month, day } = dateToCheck;
            const videoDir = path.join(videosBasePath, year, month, day);

            // Skip if directory doesn't exist
            if (!fs.existsSync(videoDir)) {
                continue;
            }

            try {
                // Get all mp4 files in the directory
                const files = fs.readdirSync(videoDir);
                const videoFiles = files.filter(file =>
                    file.toLowerCase().endsWith('.mp4') &&
                    file.startsWith(event.camera));

                // Check each video file for timestamp match
                for (const file of videoFiles) {
                    // Extract timestamp from filename
                    // Format examples:
                    // - POD1_00_20250424153423.mp4
                    // - POD1-02_20250424153423.mp4
                    const match = file.match(/(\d{14})/);
                    if (!match) continue;

                    const videoTimestamp = match[1];
                    const vYear = parseInt(videoTimestamp.substr(0, 4));
                    const vMonth = parseInt(videoTimestamp.substr(4, 6)) - 1; // JS months are 0-based
                    const vDay = parseInt(videoTimestamp.substr(6, 8));
                    const vHour = parseInt(videoTimestamp.substr(8, 10));
                    const vMinute = parseInt(videoTimestamp.substr(10, 12));
                    const vSecond = parseInt(videoTimestamp.substr(12, 14));

                    // Create video date for comparison
                    try {
                        const videoDate = new Date(vYear, vMonth, vDay, vHour, vMinute, vSecond);
                        const videoTime = videoDate.getTime();

                        // Calculate time difference
                        const timeDiff = Math.abs(videoTime - compareTime);

                        // Use a generous time window to ensure we find matches
                        const timeWindow = 120 * 1000; // 2 minutes

                        // Update best match if this video is closer in time
                        if (timeDiff < minTimeDiff && timeDiff <= timeWindow) {
                            minTimeDiff = timeDiff;
                            bestMatch = path.join('videos', year, month, day, file);

                            // Standardize path format with forward slash
                            bestMatch = bestMatch.replace(/\\/g, '/');

                            // Add leading slash if not present
                            if (!bestMatch.startsWith('/')) {
                                bestMatch = '/' + bestMatch;
                            }
                        }
                    } catch (dateErr) {
                        console.error(`Error parsing date from video filename ${file}:`, dateErr);
                    }
                }
            } catch (dirErr) {
                console.error(`Error reading directory ${videoDir}:`, dirErr);
            }
        }

        return bestMatch;
    } catch (error) {
        console.error(`Error finding matching video for event ${event.id}:`, error);
        return null;
    }
}

/**
 * Main migration function
 */
async function migrateVideoPaths() {
    console.log('Starting video path migration...');

    // Read all events
    const events = readEventsData();
    console.log(`Found ${events.length} events to process`);

    // Track statistics
    const stats = {
        total: events.length,
        updated: 0,
        skipped: 0,
        alreadyHadPath: 0,
        noMatch: 0
    };

    // Process each event
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        console.log(`Processing event ${i + 1}/${events.length}: ID ${event.id}`);

        // Skip events that already have a video path
        if (event.videoPath) {
            console.log(`  Already has video path: ${event.videoPath}`);
            stats.alreadyHadPath++;
            continue;
        }

        // Find matching video
        const videoPath = await findMatchingVideo(event);

        if (videoPath) {
            // Update the event
            console.log(`  Found matching video: ${videoPath}`);
            events[i].videoPath = videoPath;
            stats.updated++;
        } else {
            console.log(`  No matching video found`);
            stats.noMatch++;
        }

        // Save progress every 10 events or at the end
        if ((i + 1) % 10 === 0 || i === events.length - 1) {
            console.log(`Saving progress: ${i + 1}/${events.length}...`);
            writeEventsData(events);
        }
    }

    // Save final results
    const success = writeEventsData(events);

    // Print results
    console.log('\nMigration completed:');
    console.log(`Total events: ${stats.total}`);
    console.log(`Updated with video path: ${stats.updated}`);
    console.log(`Already had video path: ${stats.alreadyHadPath}`);
    console.log(`No matching video found: ${stats.noMatch}`);
    console.log(`Save ${success ? 'succeeded' : 'failed'}`);
}

// Run the migration
migrateVideoPaths().catch(error => {
    console.error('Migration failed:', error);
});