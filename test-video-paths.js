// test-video-paths.js
// A utility script to test video path resolution and verify file existence

const fs = require('fs');
const path = require('path');
const util = require('util');

// Make fs functions promise-based
const readFile = util.promisify(fs.readFile);
const stat = util.promisify(fs.stat);

// Configuration - adjust as needed
const EVENTS_FILE_PATH = path.join(__dirname, 'events-data.json');
const BASE_PATH = __dirname;
const PUBLIC_PATH = path.join(__dirname, 'public');
const VIDEOS_BASE_PATH = PUBLIC_PATH;

/**
 * Reads the events data file
 * @returns {Promise<Array>} The events array
 */
async function readEventsData() {
    try {
        const data = await readFile(EVENTS_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading events data:', err);
        return [];
    }
}

/**
 * Checks if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>} True if file exists
 */
async function fileExists(filePath) {
    try {
        await stat(filePath);
        return true;
    } catch (err) {
        return false;
    }
}

/**
 * Tests all possible path formats for a video file
 * @param {string} videoPath - Stored video path from the event
 * @returns {Promise<Object>} Results of path tests
 */
async function testPathFormats(videoPath) {
    // Remove leading /videos/ if present
    const relativePath = videoPath.replace(/^\/videos\//, '');

    // Test different path formats
    const pathFormats = [
        {
            name: 'public/videos format',
            path: path.join(PUBLIC_PATH, 'videos', relativePath)
        },
        {
            name: 'videos format (no public)',
            path: path.join(BASE_PATH, 'videos', relativePath)
        },
        {
            name: 'direct relative path',
            path: path.join(VIDEOS_BASE_PATH, relativePath)
        },
        {
            name: 'raw path',
            path: videoPath
        }
    ];

    // Test each path format
    const results = [];
    for (const format of pathFormats) {
        const exists = await fileExists(format.path);
        results.push({
            name: format.name,
            path: format.path,
            exists
        });
    }

    return results;
}

/**
 * Main function to test paths
 */
async function testVideoPaths() {
    try {
        console.log('Video Path Testing Utility');
        console.log('==========================');
        console.log(`Base directory: ${BASE_PATH}`);
        console.log(`Public directory: ${PUBLIC_PATH}`);
        console.log(`Videos base directory: ${VIDEOS_BASE_PATH}`);
        console.log(`Events file: ${EVENTS_FILE_PATH}`);
        console.log('==========================\n');

        // Read all events
        console.log('Reading events data...');
        const events = await readEventsData();
        console.log(`Found ${events.length} events in database`);

        // Get events with video paths
        const eventsWithVideos = events.filter(event => event.videoPath);
        console.log(`${eventsWithVideos.length} events have video paths (${Math.round((eventsWithVideos.length / events.length) * 100)}%)`);

        // Get count of acknowledged events
        const acknowledgedEvents = events.filter(event => event.acknowledged);
        console.log(`${acknowledgedEvents.length} events are acknowledged (${Math.round((acknowledgedEvents.length / events.length) * 100)}%)`);

        // Get all unique cameras
        const cameras = [...new Set(events.map(event => event.camera).filter(Boolean))];
        console.log(`Found ${cameras.length} unique cameras: ${cameras.join(', ')}`);

        console.log('\nTesting video paths...\n');

        let successCount = 0;
        let failureCount = 0;

        // Test each event with a video path
        for (const event of eventsWithVideos) {
            console.log(`Event ${event.id}: "${event.subject}" (${new Date(event.date).toLocaleString()})`);
            console.log(`Video path: ${event.videoPath}`);

            // Test all path formats
            const pathTests = await testPathFormats(event.videoPath);

            // Check if any path exists
            const anyPathExists = pathTests.some(test => test.exists);
            if (anyPathExists) {
                console.log('✅ Video file found:');
                successCount++;
            } else {
                console.log('❌ Video file not found at any path:');
                failureCount++;
            }

            // Show all test results
            for (const test of pathTests) {
                console.log(`  - ${test.name}: ${test.exists ? 'EXISTS' : 'NOT FOUND'} (${test.path})`);
            }

            console.log('----------------------------');
        }

        console.log('\nSummary:');
        console.log(`Total events with video paths: ${eventsWithVideos.length}`);
        console.log(`Videos found: ${successCount} (${Math.round((successCount / eventsWithVideos.length) * 100)}%)`);
        console.log(`Videos not found: ${failureCount} (${Math.round((failureCount / eventsWithVideos.length) * 100)}%)`);

        // Check video folders
        console.log('\nChecking videos folder structure...');

        // Check if videos directory exists
        const videosDir = path.join(PUBLIC_PATH, 'videos');
        if (await fileExists(videosDir)) {
            console.log(`✅ Videos directory exists: ${videosDir}`);

            // List years
            const years = fs.readdirSync(videosDir)
                .filter(item => fs.statSync(path.join(videosDir, item)).isDirectory())
                .filter(item => /^\d{4}$/.test(item));

            console.log(`Found ${years.length} year directories: ${years.join(', ')}`);

            // Check some sample paths
            if (years.length > 0) {
                const sampleYear = years[0];
                const yearDir = path.join(videosDir, sampleYear);

                // List months
                const months = fs.readdirSync(yearDir)
                    .filter(item => fs.statSync(path.join(yearDir, item)).isDirectory())
                    .filter(item => /^\d{2}$/.test(item));

                console.log(`Found ${months.length} month directories in ${sampleYear}: ${months.join(', ')}`);

                if (months.length > 0) {
                    const sampleMonth = months[0];
                    const monthDir = path.join(yearDir, sampleMonth);

                    // List days
                    const days = fs.readdirSync(monthDir)
                        .filter(item => fs.statSync(path.join(monthDir, item)).isDirectory())
                        .filter(item => /^\d{2}$/.test(item));

                    console.log(`Found ${days.length} day directories in ${sampleYear}-${sampleMonth}: ${days.join(', ')}`);

                    if (days.length > 0) {
                        const sampleDay = days[0];
                        const dayDir = path.join(monthDir, sampleDay);

                        // Count video files
                        const files = fs.readdirSync(dayDir);
                        const videoFiles = files.filter(file => file.toLowerCase().endsWith('.mp4'));

                        console.log(`Found ${videoFiles.length} video files in ${sampleYear}-${sampleMonth}-${sampleDay}`);

                        if (videoFiles.length > 0) {
                            // Show some sample video filenames
                            const sampleVideos = videoFiles.slice(0, 3);
                            console.log('Sample video files:');
                            sampleVideos.forEach(file => {
                                console.log(`  - ${file}`);
                            });
                        }
                    }
                }
            }
        } else {
            console.log(`❌ Videos directory does not exist: ${videosDir}`);
        }
    } catch (error) {
        console.error('Error in test script:', error);
    }
}

// Run the test
testVideoPaths().then(() => {
    console.log('\nTest completed.');
});