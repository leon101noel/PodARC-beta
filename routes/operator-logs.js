const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { adminMiddleware } = require('../middleware/auth');

// Path to operator logs data file
const operatorLogsFilePath = path.join(__dirname, '..', 'operator-logs.json');

// Helper function to read operator logs data
function readOperatorLogsData() {
    try {
        if (!fs.existsSync(operatorLogsFilePath)) {
            // Create the file with empty array if it doesn't exist
            fs.writeFileSync(operatorLogsFilePath, '[]', 'utf8');
            return [];
        }
        const data = fs.readFileSync(operatorLogsFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading operator logs data:', err);
        return [];
    }
}

// Helper function to write operator logs data
function writeOperatorLogsData(logs) {
    try {
        fs.writeFileSync(operatorLogsFilePath, JSON.stringify(logs, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error('Error writing operator logs data:', err);
        return false;
    }
}

// @route   GET /api/operator-logs
// @desc    Get all operator logs (admin only)
// @access  Admin
router.get('/', adminMiddleware, (req, res) => {
    try {
        const logs = readOperatorLogsData();
        res.json(logs);
    } catch (err) {
        console.error('Error getting operator logs:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   POST /api/operator-logs
// @desc    Add a new operator logout log
// @access  Private
router.post('/', (req, res) => {
    try {
        // Check if the user is an operator
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        if (req.user.role !== 'operator') {
            return res.status(403).json({ error: 'Only operator logs are recorded' });
        }

        const { unacknowledgedCount } = req.body;

        if (unacknowledgedCount === undefined) {
            return res.status(400).json({ error: 'Unacknowledged count is required' });
        }

        const logs = readOperatorLogsData();

        // Create new log entry
        const newLog = {
            id: Date.now(),
            userId: req.user.id,
            username: req.user.username,
            name: req.user.name,
            timestamp: new Date().toISOString(),
            unacknowledgedCount: unacknowledgedCount
        };

        // Add to logs array
        logs.push(newLog);

        // Save updated logs
        if (!writeOperatorLogsData(logs)) {
            return res.status(500).json({ error: 'Failed to save operator log' });
        }

        res.status(201).json({ success: true, log: newLog });
    } catch (err) {
        console.error('Error adding operator log:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;