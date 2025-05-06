const fs = require('fs');
const path = require('path');

const logsFilePath = path.join(__dirname, 'audit-logs.json');

// Initialize logs file if it doesn't exist
if (!fs.existsSync(logsFilePath)) {
  fs.writeFileSync(logsFilePath, JSON.stringify([], null, 2));
}

// Read logs from file
function readLogs() {
  try {
    const data = fs.readFileSync(logsFilePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading audit logs:', error);
    return [];
  }
}

// Write logs to file
function writeLogs(logs) {
  try {
    fs.writeFileSync(logsFilePath, JSON.stringify(logs, null, 2));
    return true;
  } catch (error) {
    console.error('Error writing audit logs:', error);
    return false;
  }
}

// Add new log entry
function addLogEntry(entry) {
  const logs = readLogs();
  logs.push(entry);
  
  // Optional: Keep logs under a certain size by removing oldest entries
  if (logs.length > 10000) {
    logs.splice(0, logs.length - 10000);
  }
  
  return writeLogs(logs);
}

module.exports = {
  readLogs,
  writeLogs,
  addLogEntry
};