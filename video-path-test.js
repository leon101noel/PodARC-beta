// video-path-test.js
// A utility to test all video paths in your database and verify they exist

const fs = require('fs');
const path = require('path');

// Paths to adjust based on your system
const EVENTS_DATA_PATH = path.join(__dirname, 'events-data.json');
const BASE_DIR = __dirname;

// Load events data
function loadEvents() {
    try {
        const data = fs.readFileSync(EVENTS_DATA_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading events data:', error.message);
        return [];
    }
}

// Check if a file exists at a given path
function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch (error) {
        return false;
    }
}

// Get all possible path combinations for a video
function getAllPossiblePaths(videoPath) {
    // Remove leading /videos/ if present
    const relativePath = videoPath.replace(/^\/videos\//, '');

    // Try different path combinations
    return [
        // Path as stored
        {
            name: 'Original path',
            path: videoPath
        },
        // With public/videos prefix
        {
            name: 'With public/videos',
            path: path.join(BASE_DIR, 'public', 'videos', relativePath)
        },
        // With videos prefix
        {
            name: 'With videos',
            path: path.join(BASE_DIR, 'videos', relativePath)
        },
        // Just the relative path
        {
            name: 'With just relative path',
            path: path.join(BASE_DIR, relativePath)
        },
        // Current working directory
        {
            name: 'From CWD',
            path: path.join(process.cwd(), relativePath)
        },
        // From current working directory with videos prefix
        {
            name: 'From CWD with videos',
            path: path.join(process.cwd(), 'videos', relativePath)
        },
        // From current working directory with public/videos prefix
        {
            name: 'From CWD with public/videos',
            path: path.join(process.cwd(), 'public', 'videos', relativePath)
        }
    ];
}

// Main function
function run() {
    console.log('Video Path Testing Utility');
    console.log('=========================');
    console.log('Base directory:', BASE_DIR);
    console.log('Events data file:', EVENTS_DATA_PATH);
    console.log('Current working directory:', process.cwd());
    console.log('=========================\n');

    // Load events
    const events = loadEvents();
    console.log(`Loaded ${events.length} events`);

    // Filter events with video paths
    const eventsWithVideo = events.filter(event => event.videoPath);
    console.log(`Found ${eventsWithVideo.length} events with video paths`);

    if (eventsWithVideo.length === 0) {
        console.log('No video paths to test.');
        return;
    }

    let successCount = 0;

    // Check each video path
    eventsWithVideo.forEach((event, index) => {
        console.log(`\nEvent ${index + 1}/${eventsWithVideo.length}: ID ${event.id}`);
        console.log(`Subject: ${event.subject}`);
        console.log(`Date: ${new Date(event.date).toLocaleString()}`);
        console.log(`Video path: ${event.videoPath}`);

        // Try all possible path combinations
        const pathOptions = getAllPossiblePaths(event.videoPath);
        let found = false;

        pathOptions.forEach(option => {
            const exists = fileExists(option.path);
            console.log(`  ${option.name}: ${exists ? 'EXISTS' : 'NOT FOUND'}`);
            console.log(`    Path: "${option.path}"`);

            if (exists) {
                found = true;
            }
        });

        if (found) {
            console.log('✅ Video file found at least one path');
            successCount++;
        } else {
            console.log('❌ Video file not found at any path');
        }
        console.log('--------------------------');
    });

    console.log('\nSummary:');
    console.log(`Total events with video paths: ${eventsWithVideo.length}`);
    console.log(`Videos found: ${successCount} (${Math.round((successCount / eventsWithVideo.length) * 100)}%)`);
    console.log(`Videos not found: ${eventsWithVideo.length - successCount} (${Math.round(((eventsWithVideo.length - successCount) / eventsWithVideo.length) * 100)}%)`);
}

// Run the utility
run();