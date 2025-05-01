// ftp-server.js - Simple FTP server for CCTV camera video uploads with enhanced logging
const { FtpSrv } = require('ftp-srv');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { networkInterfaces } = require('os');

// Store event handler
let onUploadCompleteHandler = null;

// FTP Server Configuration - Single user implementation
const config = {
    host: process.env.FTP_HOST || '0.0.0.0',
    port: process.env.FTP_PORT || 2121, // Changed to 2121 to avoid conflicts
    // The base directory where videos will be stored (relative to app root)
    baseDir: path.join(__dirname, 'public', 'videos'),
    // FTP credentials - using the same as SMTP for consistency
    credentials: {
        username: 'cctv@cctv.com',
        password: 'cctv'
    },
    // Enable passive mode for NAT/firewall traversal
    pasvPortRangeStart: 50000,
    pasvPortRangeEnd: 50100,
    // NEW: Configure the passive mode IP address explicitly (can be set via environment variable)
    pasvIp: process.env.FTP_PASV_IP || null, // Will use auto-detection if null
    // Debug mode - set to true for verbose logging
    debug: process.env.FTP_DEBUG === 'true' || false
};

/**
 * Debug logging function that respects the debug flag
 * @param {string} message - The message to log
 * @param {any} data - Optional data to log
 */
function debugLog(message, data = null) {
    if (config.debug || true) { // Always log for now while troubleshooting
        const timestamp = new Date().toISOString();
        if (data) {
            console.log(`[FTP ${timestamp}] ${message}:`, data);
        } else {
            console.log(`[FTP ${timestamp}] ${message}`);
        }
    }
}

/**
 * Error logging function - always logs errors regardless of debug mode
 * @param {string} message - The error message
 * @param {Error} error - The error object
 */
function errorLog(message, error) {
    const timestamp = new Date().toISOString();
    console.error(`[FTP ERROR ${timestamp}] ${message}:`, error);

    // Log additional error details if available
    if (error && error.stack) {
        console.error(`[FTP ERROR STACK] ${error.stack}`);
    }
}

/**
 * Get the local IP address to use for passive mode
 * @returns {string} Local IP address
 */
function getLocalIpAddress() {
    debugLog('Getting local IP address for passive mode');

    // If a specific passive IP has been set in the config or ENV, use that
    if (config.pasvIp) {
        debugLog(`Using manually configured passive IP: ${config.pasvIp}`);
        return config.pasvIp;
    }

    const nets = networkInterfaces();
    const results = [];

    // First, print all available network interfaces for debugging
    debugLog('Available network interfaces:');
    for (const name of Object.keys(nets)) {
        debugLog(`Interface: ${name}`);
        for (const net of nets[name]) {
            debugLog(`  ${net.family} ${net.address} ${net.internal ? '(internal)' : '(external)'}`);
        }
    }

    // Preferred interfaces list (in order of preference)
    const preferredInterfaces = ['eth0', 'eth1', 'en0', 'en1', 'Ethernet', 'Wi-Fi', 'Wireless LAN adapter'];

    // First pass: Try to find preferred interfaces that are IPv4 and not internal
    for (const preferredName of preferredInterfaces) {
        for (const name of Object.keys(nets)) {
            // Check if this interface name matches or contains our preferred interface name
            if (name === preferredName || name.includes(preferredName)) {
                for (const net of nets[name]) {
                    if (net.family === 'IPv4' && !net.internal) {
                        debugLog(`Selected preferred network interface: ${name} with IP: ${net.address}`);
                        return net.address;
                    }
                }
            }
        }
    }

    // Second pass: collect all external IPv4 addresses
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            // Skip internal and non-ipv4 addresses
            if (net.family === 'IPv4' && !net.internal) {
                // Skip virtual adapters or docker/VM interfaces by name patterns
                if (name.includes('vEthernet') ||
                    name.includes('VMware') ||
                    name.includes('Virtual') ||
                    name.includes('vboxnet') ||
                    name.includes('docker')) {
                    debugLog(`Skipping likely virtual interface: ${name} with IP: ${net.address}`);
                    continue;
                }
                results.push({
                    name: name,
                    address: net.address
                });
            }
        }
    }

    // If we found at least one suitable address, use the first one
    if (results.length > 0) {
        debugLog(`Auto-selected network interface: ${results[0].name} with IP: ${results[0].address}`);
        return results[0].address;
    }

    // Third pass: If no suitable address found, accept any IPv4 address, even internal ones
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4') {
                debugLog(`Falling back to interface: ${name} with IP: ${net.address} (may be internal)`);
                return net.address;
            }
        }
    }

    // If all else fails, return localhost
    debugLog('No suitable network interface found, using localhost (127.0.0.1)');
    return '127.0.0.1';
}

/**
 * Initialize and start the FTP server
 * @returns {Object} FTP server instance with custom event emitter
 */
function initFtpServer() {
    debugLog('Initializing FTP server with base directory:', config.baseDir);

    // Ensure videos directory exists with proper permissions
    try {
        ensureDirectoryExists(config.baseDir);
    } catch (err) {
        errorLog('Failed to create videos directory', err);
        console.error('This is a critical error. Check file permissions and path.');
    }

    try {
        // Create custom event emitter
        const customEmitter = new EventEmitter();

        // Get local IP address for passive mode
        const localIp = getLocalIpAddress();
        debugLog(`Using local IP for passive mode: ${localIp}`);

        // Create FTP server with proper passive mode configuration
        const server = new FtpSrv({
            url: `ftp://${config.host}:${config.port}`,
            anonymous: false,
            pasv_url: localIp, // Set passive URL to local IP
            pasv_range: `${config.pasvPortRangeStart}-${config.pasvPortRangeEnd}`,
            greeting: 'Welcome to CCTV FTP server',
            blacklist: ['RMD', 'RNFR', 'RNTO'], // Optional: Disable these commands for security
            whitelist: undefined, // Allow all other commands
            file_format: 'binary',
            log: require('bunyan').createLogger({
                name: 'ftp-srv',
                level: config.debug ? 'debug' : 'error'
            }),
            // Add custom file formatter to fix the "Bad file stat formatter" issue
            fileSystem: (connection) => {
                return {
                    get: (path) => {
                        // Add standardized file stat handling
                        debugLog(`Handling file stat for: ${path}`);
                        // Use default file system with additional error handling
                        return fs.promises.stat(path)
                            .then(stats => {
                                // Normalize stats format
                                return {
                                    name: path.split('/').pop(),
                                    type: stats.isDirectory() ? 'd' : '-',
                                    size: stats.size,
                                    mtime: stats.mtime,
                                    mode: stats.mode
                                };
                            })
                            .catch(err => {
                                errorLog(`Error getting file stats for ${path}`, err);
                                // Return minimal stats that won't break the client
                                return {
                                    name: path.split('/').pop(),
                                    type: '-',
                                    size: 0,
                                    mtime: new Date(),
                                    mode: 0o644
                                };
                            });
                    }
                };
            }
        });

        // Handle authentication
        server.on('login', ({ username, password }, resolve, reject) => {
            debugLog(`Login attempt from user: ${username}`);

            // Check credentials
            if (username === config.credentials.username && password === config.credentials.password) {
                debugLog(`FTP: User ${username} logged in successfully`);

                // Return root directory with full permissions
                return resolve({ root: config.baseDir });
            }

            // Reject invalid login
            errorLog(`Failed login attempt with username: ${username}`, new Error('Invalid credentials'));
            return reject(new Error('Invalid username or password'));
        });

        // Handle server errors
        server.on('error', err => {
            errorLog('FTP server error', err);
            customEmitter.emit('error', err);
        });

        // Handle client connection
        server.on('client-connected', ({ connection, address }) => {
            debugLog(`New client connected: ${address.address}:${address.port}`);
        });

        // Handle client error
        server.on('client-error', ({ connection, context, error }) => {
            errorLog(`FTP client error. Context: ${context}`, error);
        });

        // Handle file upload completed
        server.on('STOR', ({ serverPath, connection, context }) => {
            debugLog(`File upload started for path: ${serverPath}`);
            debugLog(`Upload info - IP: ${connection.commandSocket.remoteAddress}, Name: ${path.basename(serverPath)}`);

            // Wait for the connection to close (upload completed)
            connection.once('close', () => {
                debugLog(`Connection closed for upload: ${serverPath}`);

                setTimeout(() => {
                    // Ensure the file exists before processing
                    if (fs.existsSync(serverPath)) {
                        const fileStats = fs.statSync(serverPath);
                        debugLog(`File uploaded: ${path.basename(serverPath)} (${formatBytes(fileStats.size)})`);

                        try {
                            // Process the file (move to date-based directory)
                            processUploadedFile(serverPath, customEmitter);
                        } catch (error) {
                            errorLog(`Error processing uploaded file: ${serverPath}`, error);
                        }
                    } else {
                        errorLog(`File not found after upload completed: ${serverPath}`, new Error('File missing after upload'));
                    }
                }, 500); // Small delay to ensure file write is complete
            });
        });

        // Handle directory creation
        server.on('MKD', ({ serverPath }) => {
            debugLog(`Directory created: ${serverPath}`);
        });

        // Handle change directory
        server.on('CWD', ({ serverPath }) => {
            debugLog(`Changed working directory: ${serverPath}`);
        });

        // Start the server
        server.listen()
            .then(() => {
                debugLog(`FTP server running on ${config.host}:${config.port}`);
                debugLog(`FTP credentials: ${config.credentials.username} / ${config.credentials.password}`);
                debugLog(`PASV mode enabled with IP ${localIp} and ports ${config.pasvPortRangeStart}-${config.pasvPortRangeEnd}`);

                // Check if firewall issues might be present
                if (process.platform === 'win32') {
                    console.log('⚠️ Running on Windows - make sure Windows Firewall allows incoming connections on ports:');
                    console.log(`  - Command channel: ${config.port}`);
                    console.log(`  - Passive port range: ${config.pasvPortRangeStart}-${config.pasvPortRangeEnd}`);
                } else {
                    console.log('⚠️ Make sure your firewall allows incoming connections on ports:');
                    console.log(`  - Command channel: ${config.port}`);
                    console.log(`  - Passive port range: ${config.pasvPortRangeStart}-${config.pasvPortRangeEnd}`);
                }
            })
            .catch(err => {
                errorLog('Error starting FTP server', err);

                // Try alternative port if the initial one fails
                if (err.code === 'EADDRINUSE' && config.port === 2121) {
                    config.port = 2122; // Try 2122 as a fallback
                    debugLog('Trying fallback port 2122...');

                    const newServer = new FtpSrv({
                        url: `ftp://${config.host}:${config.port}`,
                        anonymous: false,
                        pasv_url: localIp,
                        pasv_range: `${config.pasvPortRangeStart}-${config.pasvPortRangeEnd}`,
                        greeting: 'Welcome to CCTV FTP server (fallback)'
                    });

                    // Re-attach event handlers to the new server
                    newServer.on('login', server.listeners('login')[0]);
                    newServer.on('error', server.listeners('error')[0]);
                    newServer.on('client-error', server.listeners('client-error')[0]);
                    newServer.on('STOR', server.listeners('STOR')[0]);

                    newServer.listen()
                        .then(() => {
                            debugLog(`FTP server running on ${config.host}:${config.port} (fallback port)`);
                            debugLog(`FTP credentials: ${config.credentials.username} / ${config.credentials.password}`);
                            debugLog(`PASV mode enabled with IP ${localIp} and ports ${config.pasvPortRangeStart}-${config.pasvPortRangeEnd}`);

                            // Update the server reference in the emitter
                            customEmitter._server = newServer;
                        })
                        .catch(fallbackErr => {
                            errorLog('Error starting FTP server on fallback port', fallbackErr);
                        });
                }
            });

        // Store the server in the emitter
        customEmitter._server = server;

        return customEmitter;
    } catch (error) {
        errorLog('Failed to initialize FTP server', error);
        return null;
    }
}

/**
 * Process an uploaded file - move to date-based directory and emit event
 * @param {string} filePath - Path to the uploaded file
 * @param {EventEmitter} emitter - Event emitter for notifications
 */
function processUploadedFile(filePath, emitter) {
    try {
        debugLog(`Processing uploaded file: ${filePath}`);

        // Get file details
        const fileName = path.basename(filePath);
        const stats = fs.statSync(filePath);

        debugLog(`File details: Size=${formatBytes(stats.size)}, Name=${fileName}`);

        // Determine year/month/day based on current date for directory structure
        const now = new Date();
        const year = now.getFullYear().toString();
        const month = (now.getMonth() + 1).toString().padStart(2, '0');
        const day = now.getDate().toString().padStart(2, '0');

        // Extract camera name from filename (e.g., POD1_00_20250430113922.mp4)
        const cameraMatch = fileName.match(/^([^_]+)/);
        const camera = cameraMatch ? cameraMatch[1] : 'unknown';
        debugLog(`Extracted camera name: ${camera}`);

        // Extract timestamp from filename if available
        let timestamp = null;
        const timestampMatch = fileName.match(/(\d{14})/);
        if (timestampMatch) {
            timestamp = timestampMatch[1];
            debugLog(`Extracted timestamp: ${timestamp}`);
        }

        // Create target directory path
        const targetDir = path.join(config.baseDir, year, month, day);
        const targetPath = path.join(targetDir, fileName);
        debugLog(`Target directory: ${targetDir}`);
        debugLog(`Target path: ${targetPath}`);

        // Check if file needs to be moved
        if (filePath !== targetPath) {
            // Ensure target directory exists
            ensureDirectoryExists(targetDir);

            // Move the file to the correct directory
            try {
                debugLog(`Moving file from ${filePath} to ${targetPath}`);
                fs.renameSync(filePath, targetPath);
                debugLog(`Successfully moved ${fileName} to /${year}/${month}/${day}/ directory`);

                // Emit an event for the upload (to integrate with notification system)
                const relativeVideoPath = `${year}/${month}/${day}/${fileName}`;

                // Use process.nextTick to ensure this happens after the current execution completes
                process.nextTick(() => {
                    debugLog(`Emitting upload:complete event for ${relativeVideoPath}`);
                    emitter.emit('upload:complete', {
                        filename: fileName,
                        size: stats.size,
                        path: relativeVideoPath,
                        camera: camera,
                        timestamp: timestamp ? new Date() : new Date()
                    });
                });
            } catch (moveError) {
                errorLog(`Error moving file from ${filePath} to ${targetPath}`, moveError);
                debugLog(`Attempting copy + delete fallback method`);

                // Try copy + delete as a fallback if rename fails
                try {
                    const readStream = fs.createReadStream(filePath);
                    const writeStream = fs.createWriteStream(targetPath);

                    readStream.on('error', (readErr) => {
                        errorLog(`Error reading source file during copy fallback: ${filePath}`, readErr);
                    });

                    writeStream.on('error', (writeErr) => {
                        errorLog(`Error writing target file during copy fallback: ${targetPath}`, writeErr);
                    });

                    readStream.on('end', () => {
                        debugLog(`File copy completed, attempting to delete original`);
                        // Once copied, try to delete the original
                        try {
                            fs.unlinkSync(filePath);
                            debugLog(`Successfully copied and deleted ${fileName} to /${year}/${month}/${day}/ directory`);

                            // Emit the event after successful copy
                            const relativeVideoPath = `${year}/${month}/${day}/${fileName}`;
                            emitter.emit('upload:complete', {
                                filename: fileName,
                                size: stats.size,
                                path: relativeVideoPath,
                                camera: camera,
                                timestamp: new Date()
                            });
                        } catch (deleteError) {
                            errorLog(`Error deleting original file ${filePath} after copy`, deleteError);
                            // Still emit event even if we couldn't delete the original
                            const relativeVideoPath = `${year}/${month}/${day}/${fileName}`;
                            emitter.emit('upload:complete', {
                                filename: fileName,
                                size: stats.size,
                                path: relativeVideoPath,
                                camera: camera,
                                timestamp: new Date(),
                                warning: 'Original file could not be deleted'
                            });
                        }
                    });

                    readStream.pipe(writeStream);
                } catch (copyError) {
                    errorLog(`Error setting up copy fallback for file`, copyError);
                }
            }
        } else {
            debugLog(`File is already in the correct location: ${filePath}`);
            // File is already in the right place, just emit the event
            const relativeVideoPath = path.relative(config.baseDir, filePath).replace(/\\/g, '/');

            debugLog(`Emitting upload:complete event for ${relativeVideoPath}`);
            emitter.emit('upload:complete', {
                filename: fileName,
                size: stats.size,
                path: relativeVideoPath,
                camera: camera,
                timestamp: new Date()
            });
        }
    } catch (error) {
        errorLog('Error processing uploaded file', error);
        // Don't throw the error to avoid crashing the server
    }
}

/**
 * Create a directory if it doesn't exist
 * @param {string} dirPath - Path to check/create
 */
function ensureDirectoryExists(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) {
            // Create directory with explicit permissions
            debugLog(`Creating directory: ${dirPath}`);
            fs.mkdirSync(dirPath, { recursive: true, mode: 0o777 });
            debugLog(`Created directory ${dirPath} with full permissions`);

            // Double-check permissions on Windows
            try {
                fs.chmodSync(dirPath, 0o777);
            } catch (chmodError) {
                debugLog(`Note: chmod not fully supported on Windows, but directory created: ${dirPath}`);
            }

            // Test directory by writing a test file
            try {
                const testFilePath = path.join(dirPath, '.test_write_permissions');
                fs.writeFileSync(testFilePath, 'test', { mode: 0o666 });
                fs.unlinkSync(testFilePath);
                debugLog(`Successfully wrote test file to ${dirPath} - write permissions confirmed`);
            } catch (writeTestError) {
                errorLog(`Directory was created but we can't write to it! Check permissions for ${dirPath}`, writeTestError);
            }
        } else {
            // Directory exists, check if it's writable
            try {
                const testFilePath = path.join(dirPath, '.test_write_permissions');
                fs.writeFileSync(testFilePath, 'test', { mode: 0o666 });
                fs.unlinkSync(testFilePath);
                debugLog(`${dirPath} exists and is writable`);
            } catch (writeTestError) {
                errorLog(`Directory ${dirPath} exists but is not writable! Check permissions`, writeTestError);
            }
        }
    } catch (error) {
        errorLog(`Error creating directory ${dirPath}`, error);
        throw error; // Re-throw to handle at caller level
    }
}

/**
 * Format bytes to human-readable format
 * @param {number} bytes - Number of bytes
 * @returns {string} Formatted string
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Test connectivity by attempting to create a client connection to our own server
 * This can help diagnose if the server is actually accepting connections
 */
function testFtpConnectivity() {
    const FtpClient = require('ftp');
    const client = new FtpClient();

    debugLog('Testing FTP connectivity to our own server...');

    client.on('ready', () => {
        debugLog('✅ FTP connectivity test successful - connected to our own server');
        client.end();
    });

    client.on('error', (err) => {
        errorLog('❌ FTP connectivity test failed - could not connect to our own server', err);
        console.log('This could indicate a firewall issue or that the server is not running properly');
    });

    // Connect to our own server
    client.connect({
        host: 'localhost',
        port: config.port,
        user: config.credentials.username,
        password: config.credentials.password
    });
}

// Export the functions
module.exports = {
    initFtpServer,
    testFtpConnectivity, // Export the connectivity test
    config // Export config for external inspection
};