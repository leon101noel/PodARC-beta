// permission-check.js
// Utility to check file permissions for the application

const fs = require('fs');
const path = require('path');

// Paths to check - adjust based on your setup
const pathsToCheck = [
    { name: 'Base Directory', path: __dirname },
    { name: 'Public Directory', path: path.join(__dirname, 'public') },
    { name: 'Videos Directory', path: path.join(__dirname, 'public', 'videos') },
    { name: 'Images Directory', path: path.join(__dirname, 'public', 'images') },
    { name: 'Events Data File', path: path.join(__dirname, 'events-data.json') }
];

// Additional locations to check based on common patterns
const additionalPaths = [
    { name: 'Videos Directory (Alternative)', path: path.join(__dirname, 'videos') },
    { name: 'CWD', path: process.cwd() },
    { name: 'Videos from CWD', path: path.join(process.cwd(), 'videos') },
    { name: 'Public/Videos from CWD', path: path.join(process.cwd(), 'public', 'videos') }
];

// Function to check directory permissions
function checkDirectoryPermissions(dirPath) {
    try {
        // First check if path exists
        if (!fs.existsSync(dirPath)) {
            return {
                exists: false,
                readable: false,
                writable: false,
                executable: false,
                error: 'Path does not exist'
            };
        }

        // Check if it's a directory
        const stats = fs.statSync(dirPath);
        const isDirectory = stats.isDirectory();

        if (!isDirectory) {
            return {
                exists: true,
                isDirectory: false,
                readable: false,
                writable: false,
                executable: false,
                error: 'Path exists but is not a directory'
            };
        }

        // Check read permission by trying to read the directory
        let readable = false;
        try {
            fs.readdirSync(dirPath);
            readable = true;
        } catch (e) {
            // Cannot read directory
        }

        // Check write permission by trying to create a temporary file
        let writable = false;
        const tempFile = path.join(dirPath, `.temp-${Date.now()}`);
        try {
            fs.writeFileSync(tempFile, 'test');
            writable = true;
            // Clean up
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {
                // Cannot delete the file we just created
            }
        } catch (e) {
            // Cannot write to directory
        }

        // Check execute permission (ability to access files within directory)
        let executable = false;
        try {
            fs.accessSync(dirPath, fs.constants.X_OK);
            executable = true;
        } catch (e) {
            // Not executable
        }

        return {
            exists: true,
            isDirectory: true,
            readable,
            writable,
            executable
        };
    } catch (error) {
        return {
            exists: false,
            readable: false,
            writable: false,
            executable: false,
            error: error.message
        };
    }
}

// Function to check file permissions
function checkFilePermissions(filePath) {
    try {
        // First check if file exists
        if (!fs.existsSync(filePath)) {
            return {
                exists: false,
                readable: false,
                writable: false,
                error: 'File does not exist'
            };
        }

        // Check if it's a file
        const stats = fs.statSync(filePath);
        const isFile = stats.isFile();

        if (!isFile) {
            return {
                exists: true,
                isFile: false,
                readable: false,
                writable: false,
                error: 'Path exists but is not a file'
            };
        }

        // Check read permission
        let readable = false;
        try {
            fs.readFileSync(filePath);
            readable = true;
        } catch (e) {
            // Cannot read file
        }

        // Check write permission
        let writable = false;
        try {
            // Open file for writing without actually writing
            const fd = fs.openSync(filePath, 'a');
            fs.closeSync(fd);
            writable = true;
        } catch (e) {
            // Cannot write to file
        }

        return {
            exists: true,
            isFile: true,
            readable,
            writable,
            size: stats.size,
            modified: stats.mtime
        };
    } catch (error) {
        return {
            exists: false,
            readable: false,
            writable: false,
            error: error.message
        };
    }
}

// Function to check paths
function checkPaths() {
    console.log('File System Permission Check');
    console.log('===========================');
    console.log(`Node.js version: ${process.version}`);
    console.log(`Platform: ${process.platform}`);
    console.log(`Current working directory: ${process.cwd()}`);
    console.log(`__dirname: ${__dirname}`);
    console.log('===========================\n');

    // Check all paths
    const allPaths = [...pathsToCheck, ...additionalPaths];

    allPaths.forEach(item => {
        console.log(`Checking: ${item.name} (${item.path})`);

        // Determine if it's a file or directory
        if (fs.existsSync(item.path)) {
            const stats = fs.statSync(item.path);
            if (stats.isDirectory()) {
                const result = checkDirectoryPermissions(item.path);
                console.log(`  Type: Directory`);
                console.log(`  Exists: ${result.exists ? 'Yes' : 'No'}`);
                console.log(`  Readable: ${result.readable ? 'Yes' : 'No'}`);
                console.log(`  Writable: ${result.writable ? 'Yes' : 'No'}`);
                console.log(`  Executable: ${result.executable ? 'Yes' : 'No'}`);

                if (result.error) {
                    console.log(`  Error: ${result.error}`);
                }

                // If it's a directory and readable, list a few files
                if (result.readable) {
                    try {
                        const files = fs.readdirSync(item.path);
                        console.log(`  Contains ${files.length} items`);
                        if (files.length > 0) {
                            console.log(`  Sample items: ${files.slice(0, 5).join(', ')}${files.length > 5 ? '...' : ''}`);
                        }
                    } catch (e) {
                        console.log(`  Error listing directory contents: ${e.message}`);
                    }
                }
            } else {
                const result = checkFilePermissions(item.path);
                console.log(`  Type: File`);
                console.log(`  Exists: ${result.exists ? 'Yes' : 'No'}`);
                console.log(`  Readable: ${result.readable ? 'Yes' : 'No'}`);
                console.log(`  Writable: ${result.writable ? 'Yes' : 'No'}`);
                console.log(`  Size: ${result.size ? `${result.size} bytes` : 'Unknown'}`);
                console.log(`  Last Modified: ${result.modified ? result.modified.toLocaleString() : 'Unknown'}`);

                if (result.error) {
                    console.log(`  Error: ${result.error}`);
                }
            }
        } else {
            console.log(`  Exists: No`);
            console.log(`  Error: Path does not exist`);
        }

        console.log('--------------------------');
    });

    // Special check: Try to create and delete a test file in videos directory
    console.log('\nTesting video file creation/deletion:');

    const videosPaths = [
        path.join(__dirname, 'public', 'videos'),
        path.join(__dirname, 'videos'),
        path.join(process.cwd(), 'public', 'videos'),
        path.join(process.cwd(), 'videos')
    ];

    videosPaths.forEach(dirPath => {
        console.log(`\nTesting in: ${dirPath}`);

        if (!fs.existsSync(dirPath)) {
            console.log(`  Directory doesn't exist, skipping test`);
            return;
        }

        const testFile = path.join(dirPath, `test-file-${Date.now()}.txt`);

        try {
            // Try to create a file
            fs.writeFileSync(testFile, 'Test content');
            console.log(`  ✅ Created test file: ${testFile}`);

            // Try to delete the file
            fs.unlinkSync(testFile);
            console.log(`  ✅ Successfully deleted test file`);
        } catch (error) {
            console.log(`  ❌ Error in test: ${error.message}`);
        }
    });
}

// Run the checks
checkPaths();