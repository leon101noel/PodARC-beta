// event-retention.js
const fs = require('fs');
const path = require('path');
const util = require('util');

// Make fs.unlink promise-based
const unlinkAsync = util.promisify(fs.unlink);

/**
 * Service to handle event retention and cleanup of old events
 */
class EventRetentionService {
    /**
     * Initialize the service
     * @param {Object} options - Configuration options
     * @param {number} options.retentionDays - Number of days to keep events (default: 7)
     * @param {string} options.eventsFilePath - Path to events JSON file
     * @param {string} options.imagesBasePath - Base path to image files
     * @param {string} options.videosBasePath - Base path to video files
     */
    constructor(options = {}) {
        this.retentionDays = options.retentionDays || 7;
        this.eventsFilePath = options.eventsFilePath || path.join(__dirname, 'events-data.json');
        this.imagesBasePath = options.imagesBasePath || path.join(__dirname, 'public');
        this.videosBasePath = options.videosBasePath || path.join(__dirname, 'public');
    }

    /**
     * Read events data from file
     * @returns {Array} Array of events
     */
    readEventsData() {
        try {
            const data = fs.readFileSync(this.eventsFilePath, 'utf8');
            return JSON.parse(data);
        } catch (err) {
            console.error('Error reading events data:', err);
            return [];
        }
    }

    /**
     * Write events data to file
     * @param {Array} events - Array of events to save
     * @returns {boolean} Success status
     */
    writeEventsData(events) {
        try {
            fs.writeFileSync(this.eventsFilePath, JSON.stringify(events, null, 2));
            return true;
        } catch (err) {
            console.error('Error writing events data:', err);
            return false;
        }
    }

    /**
     * Run cleanup process to remove old events
     * @returns {Object} Cleanup statistics
     */
    async cleanupOldEvents() {
        console.log(`Starting cleanup of events older than ${this.retentionDays} days...`);

        // Read current events
        const events = this.readEventsData();
        const initialCount = events.length;

        // Calculate cutoff date (X days ago)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
        console.log(`Cutoff date: ${cutoffDate.toISOString()}`);

        // Track deletion statistics
        const stats = {
            processedEvents: initialCount,
            deletedEvents: 0,
            skippedLockedEvents: 0,
            deletedImages: 0,
            deletedVideos: 0,
            errors: []
        };

        // Filter events to keep (not old or locked)
        const eventsToKeep = [];
        const eventsToDelete = [];

        for (const event of events) {
            const eventDate = new Date(event.date);
            const isOld = eventDate < cutoffDate;

            if (isOld && !event.locked) {
                eventsToDelete.push(event);
            } else {
                eventsToKeep.push(event);

                // Count skipped events due to being locked
                if (isOld && event.locked) {
                    stats.skippedLockedEvents++;
                }
            }
        }

        // Process deletions
        for (const event of eventsToDelete) {
            try {
                // Try to delete associated image
                if (event.imagePath) {
                    try {
                        const fullImagePath = path.join(this.imagesBasePath, event.imagePath);
                        await unlinkAsync(fullImagePath);
                        stats.deletedImages++;
                        console.log(`Deleted image: ${fullImagePath}`);
                    } catch (imageErr) {
                        // Don't fail if image doesn't exist
                        if (imageErr.code !== 'ENOENT') {
                            console.error(`Error deleting image for event ${event.id}:`, imageErr);
                            stats.errors.push(`Failed to delete image for event ${event.id}: ${imageErr.message}`);
                        }
                    }
                }

                // Try to delete associated video file using the saved path if available
                if (event.videoPath) {
                    try {
                        // Handle relative path by joining with base path
                        // Remove the leading slash from videoPath if it exists
                        const relativePath = event.videoPath.replace(/^\/videos\//, '');
                        const fullVideoPath = path.join(this.videosBasePath, 'public/videos', relativePath);

                        console.log(`Attempting to delete video at path: ${fullVideoPath}`);

                        // Check if the file exists before trying to delete it
                        if (fs.existsSync(fullVideoPath)) {
                            await unlinkAsync(fullVideoPath);
                            stats.deletedVideos++;
                            console.log(`Deleted video: ${fullVideoPath}`);
                        } else {
                            console.log(`Video file does not exist at path: ${fullVideoPath}`);

                            // Try alternative path format (without public folder)
                            const alternativePath = path.join(this.videosBasePath, 'videos', relativePath);
                            if (fs.existsSync(alternativePath)) {
                                await unlinkAsync(alternativePath);
                                stats.deletedVideos++;
                                console.log(`Deleted video (alternative path): ${alternativePath}`);
                            } else {
                                console.log(`Video file does not exist at alternative path: ${alternativePath}`);
                                // Try one more path format
                                const thirdPath = path.join(this.videosBasePath, relativePath);
                                if (fs.existsSync(thirdPath)) {
                                    await unlinkAsync(thirdPath);
                                    stats.deletedVideos++;
                                    console.log(`Deleted video (third path attempt): ${thirdPath}`);
                                } else {
                                    console.log(`Video file not found at any expected path for event ${event.id}`);
                                }
                            }
                        }
                    } catch (videoErr) {
                        console.error(`Error deleting video for event ${event.id}:`, videoErr);
                        stats.errors.push(`Failed to delete video for event ${event.id}: ${videoErr.message}`);
                    }
                }
                // Fallback to the original matching method if no direct video path is saved
                else if (event.camera) {
                    try {
                        // Extract date from event to locate potential video directory
                        const eventDate = new Date(event.date);
                        const eventYear = eventDate.getFullYear().toString();
                        const eventMonth = (eventDate.getMonth() + 1).toString().padStart(2, '0');
                        const eventDay = eventDate.getDate().toString().padStart(2, '0');

                        // This matches how the frontend discovers videos
                        // We'll search in:
                        // 1. The exact date directory
                        // 2. One day before (for events near midnight)
                        // 3. One day after (for events near midnight)
                        const datesToCheck = [
                            { year: eventYear, month: eventMonth, day: eventDay },
                        ];

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

                        // Get the event timestamp to compare with video filenames
                        const eventTime = eventDate.getTime();

                        // Extract timestamp from image filename if possible
                        let imageTimestamp = null;
                        if (event.imagePath) {
                            const imageMatch = event.imagePath.match(/\d+_\d+_(\d{14})/);
                            if (imageMatch) {
                                imageTimestamp = imageMatch[1]; // 20250424153418000
                            }
                        }

                        // If we have an image timestamp, create an alternative compare date
                        let alternateCompareTime = null;
                        if (imageTimestamp) {
                            try {
                                const dateTimePart = imageTimestamp.substr(0, 14); // 20250424153418
                                const year = parseInt(dateTimePart.substr(0, 4));
                                const month = parseInt(dateTimePart.substr(4, 2)) - 1; // JS months are 0-based
                                const day = parseInt(dateTimePart.substr(6, 2));
                                const hour = parseInt(dateTimePart.substr(8, 2));
                                const minute = parseInt(dateTimePart.substr(10, 2));
                                const second = parseInt(dateTimePart.substr(12, 2));

                                const compareDate = new Date(year, month, day, hour, minute, second);
                                alternateCompareTime = compareDate.getTime();
                                console.log(`Using alternate compare time from image: ${compareDate.toISOString()}`);
                            } catch (e) {
                                console.error(`Error parsing image timestamp: ${e.message}`);
                            }
                        }

                        // Check each potential date directory
                        let foundVideo = false;
                        for (const dateToCheck of datesToCheck) {
                            const { year, month, day } = dateToCheck;

                            // Construct the video directory path
                            const videoDir = path.join(this.videosBasePath, 'public', 'videos', year, month, day);

                            // Check if directory exists
                            if (fs.existsSync(videoDir)) {
                                // Read all files in the directory
                                const files = fs.readdirSync(videoDir);

                                // Filter for files that match the camera pattern
                                const cameraFiles = files.filter(file =>
                                    file.startsWith(event.camera) && file.toLowerCase().endsWith('.mp4')
                                );

                                console.log(`Found ${cameraFiles.length} potential video files for event ${event.id} in directory ${videoDir}`);

                                // Check each potential video file
                                for (const file of cameraFiles) {
                                    // Extract timestamp from filename
                                    // Format: POD1_00_20250424153423.mp4
                                    const match = file.match(/(\d{14})/);
                                    if (match) {
                                        const timestamp = match[1];

                                        // Correctly parse the timestamp
                                        const fileYear = parseInt(timestamp.substring(0, 4));
                                        const fileMonth = parseInt(timestamp.substring(4, 2)) - 1; // JS months are 0-based
                                        const fileDay = parseInt(timestamp.substring(6, 2));
                                        const fileHour = parseInt(timestamp.substring(8, 2));
                                        const fileMinute = parseInt(timestamp.substring(10, 2));
                                        const fileSecond = parseInt(timestamp.substring(12, 2));

                                        // Create a Date object from the filename timestamp
                                        try {
                                            const fileDate = new Date(
                                                fileYear,
                                                fileMonth,
                                                fileDay,
                                                fileHour,
                                                fileMinute,
                                                fileSecond
                                            );
                                            const fileTime = fileDate.getTime();

                                            // Try both compare times with a larger window
                                            const timeWindowMs = 180 * 1000; // 3 minutes

                                            // Calculate time differences
                                            const timeDiff = Math.abs(fileTime - eventTime);
                                            const altTimeDiff = alternateCompareTime ?
                                                Math.abs(fileTime - alternateCompareTime) : Infinity;

                                            // Use the best match between the two compare times
                                            const bestTimeDiff = Math.min(timeDiff, altTimeDiff);

                                            if (bestTimeDiff <= timeWindowMs) {
                                                const fullVideoPath = path.join(videoDir, file);
                                                console.log(`Found matching video for event ${event.id}: ${fullVideoPath} (time diff: ${bestTimeDiff}ms)`);

                                                // Before deleting, store the video path in the event for future reference
                                                const videoPathForStorage = `/videos/${year}/${month}/${day}/${file}`;
                                                console.log(`Storing video path for future reference: ${videoPathForStorage}`);

                                                try {
                                                    await unlinkAsync(fullVideoPath);
                                                    stats.deletedVideos++;
                                                    console.log(`Deleted video: ${fullVideoPath}`);
                                                    foundVideo = true;
                                                } catch (unlinkErr) {
                                                    // Don't fail if video doesn't exist
                                                    if (unlinkErr.code !== 'ENOENT') {
                                                        console.error(`Error deleting video file ${fullVideoPath}:`, unlinkErr);
                                                        stats.errors.push(`Failed to delete video for event ${event.id}: ${unlinkErr.message}`);
                                                    }
                                                }
                                            }
                                        } catch (dateErr) {
                                            console.error(`Error parsing date from filename ${file}:`, dateErr);
                                        }
                                    }
                                }
                            } else {
                                console.log(`Video directory does not exist: ${videoDir}`);
                            }

                            // If we found and deleted a video, stop checking other directories
                            if (foundVideo) break;
                        }
                    } catch (videoErr) {
                        console.error(`Error processing videos for event ${event.id}:`, videoErr);
                        stats.errors.push(`Failed to process videos for event ${event.id}: ${videoErr.message}`);
                    }
                }

                // Count deleted event
                stats.deletedEvents++;

            } catch (eventErr) {
                console.error(`Error processing event ${event.id} for deletion:`, eventErr);
                stats.errors.push(`Failed to process event ${event.id}: ${eventErr.message}`);
            }
        }

        // Save updated events list
        if (stats.deletedEvents > 0) {
            const saveResult = this.writeEventsData(eventsToKeep);
            if (!saveResult) {
                stats.errors.push('Failed to save updated events data');
            }
        }

        console.log(`Cleanup complete. Deleted ${stats.deletedEvents} events, ${stats.deletedImages} images, and ${stats.deletedVideos} videos.`);
        console.log(`${stats.skippedLockedEvents} locked events were preserved.`);

        return stats;
    }

    /**
     * Lock or unlock an event
     * @param {number} eventId - ID of the event to lock/unlock
     * @param {boolean} locked - Whether to lock (true) or unlock (false) the event
     * @returns {Object} Result of the operation
     */
    toggleEventLock(eventId, locked) {
        // Read current events
        const events = this.readEventsData();

        // Find the event
        const eventIndex = events.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            return { success: false, error: 'Event not found' };
        }

        // Update locked status
        events[eventIndex].locked = locked;

        // Save updated events
        const saveResult = this.writeEventsData(events);
        if (!saveResult) {
            return { success: false, error: 'Failed to save events data' };
        }

        return {
            success: true,
            message: locked ? 'Event locked successfully' : 'Event unlocked successfully',
            event: events[eventIndex]
        };
    }

    /**
     * Store video path for an event
     * @param {number} eventId - ID of the event 
     * @param {string} videoPath - Path to the video
     * @returns {Object} Result of the operation
     */
    storeVideoPath(eventId, videoPath) {
        // Read current events
        const events = this.readEventsData();

        // Find the event
        const eventIndex = events.findIndex(e => e.id === eventId);
        if (eventIndex === -1) {
            return { success: false, error: 'Event not found' };
        }

        // Update video path
        events[eventIndex].videoPath = videoPath;

        // Save updated events
        const saveResult = this.writeEventsData(events);
        if (!saveResult) {
            return { success: false, error: 'Failed to save events data' };
        }

        return {
            success: true,
            message: 'Video path stored successfully',
            event: events[eventIndex]
        };
    }
}

module.exports = EventRetentionService;