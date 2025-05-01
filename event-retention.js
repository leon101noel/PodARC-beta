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

                // Try to find and delete associated video files
                // This is more complex as the video filename structure is not directly stored in the event
                if (event.camera) {
                    // Extract date from event to locate potential video directory
                    const eventDate = new Date(event.date);
                    const year = eventDate.getFullYear().toString();
                    const month = (eventDate.getMonth() + 1).toString().padStart(2, '0');
                    const day = eventDate.getDate().toString().padStart(2, '0');

                    // Construct the video directory path
                    const videoDir = path.join(this.videosBasePath, 'videos', year, month, day);

                    // Check if directory exists
                    if (fs.existsSync(videoDir)) {
                        try {
                            // Read all files in the directory
                            const files = fs.readdirSync(videoDir);

                            // Filter for files that match the camera pattern
                            const cameraFiles = files.filter(file =>
                                file.startsWith(event.camera) && file.toLowerCase().endsWith('.mp4')
                            );

                            // Get the event timestamp to compare with video filenames
                            const eventTime = eventDate.getTime();

                            // Delete matching video files (within a time window)
                            for (const file of cameraFiles) {
                                // Extract timestamp from filename format: POD1_00_20250424153423.mp4
                                const match = file.match(/(\d{14})/);
                                if (match) {
                                    const timestamp = match[1];
                                    const fileYear = parseInt(timestamp.substring(0, 4));
                                    const fileMonth = parseInt(timestamp.substring(4, 6)) - 1;
                                    const fileDay = parseInt(timestamp.substring(6, 8));
                                    const fileHour = parseInt(timestamp.substring(8, 10));
                                    const fileMinute = parseInt(timestamp.substring(10, 12));
                                    const fileSecond = parseInt(timestamp.substring(12, 14));

                                    const fileDate = new Date(fileYear, fileMonth, fileDay, fileHour, fileMinute, fileSecond);
                                    const fileTime = fileDate.getTime();

                                    // Check if file is within a 5-minute window of the event
                                    const timeDiff = Math.abs(fileTime - eventTime);
                                    if (timeDiff <= 5 * 60 * 1000) {
                                        const fullVideoPath = path.join(videoDir, file);
                                        await unlinkAsync(fullVideoPath);
                                        stats.deletedVideos++;
                                        console.log(`Deleted video: ${fullVideoPath}`);
                                    }
                                }
                            }
                        } catch (dirErr) {
                            console.error(`Error processing video directory for event ${event.id}:`, dirErr);
                            stats.errors.push(`Failed to process video directory for event ${event.id}: ${dirErr.message}`);
                        }
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
}

module.exports = EventRetentionService;