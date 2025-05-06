const express = require('express');
const router = express.Router();
const { readLogs } = require('../audit-logs');
const { adminMiddleware } = require('../middleware/auth');

// Get all logs (admin only, with pagination)
router.get('/', adminMiddleware, (req, res) => {
  try {
    const logs = readLogs();
    
    // Support filtering and pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    
    // Filter logs based on query parameters
    let filteredLogs = logs;
    
    // Filter by user
    if (req.query.userId) {
      filteredLogs = filteredLogs.filter(log => log.userId === parseInt(req.query.userId));
    }
    
    // Filter by action type
    if (req.query.action) {
      filteredLogs = filteredLogs.filter(log => log.action === req.query.action);
    }
    
    // Filter by date range
    if (req.query.from) {
      const fromDate = new Date(req.query.from);
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= fromDate);
    }
    
    if (req.query.to) {
      const toDate = new Date(req.query.to);
      toDate.setHours(23, 59, 59, 999); // End of day
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= toDate);
    }
    
    // Sort by timestamp (newest first)
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Pagination
    const paginatedLogs = filteredLogs.slice(startIndex, endIndex);
    
    // Return logs with pagination info
    res.json({
      totalLogs: filteredLogs.length,
      totalPages: Math.ceil(filteredLogs.length / limit),
      currentPage: page,
      logs: paginatedLogs
    });
  } catch (error) {
    console.error('Error retrieving audit logs:', error);
    res.status(500).json({ error: 'Failed to retrieve audit logs' });
  }
});

// Export logs as CSV
router.get('/export', adminMiddleware, (req, res) => {
  try {
    const logs = readLogs();
    
    // Apply filters as in the GET route
    let filteredLogs = logs;
    
    // Filter by user
    if (req.query.userId) {
      filteredLogs = filteredLogs.filter(log => log.userId === parseInt(req.query.userId));
    }
    
    // Filter by action type
    if (req.query.action) {
      filteredLogs = filteredLogs.filter(log => log.action === req.query.action);
    }
    
    // Filter by date range
    if (req.query.from) {
      const fromDate = new Date(req.query.from);
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) >= fromDate);
    }
    
    if (req.query.to) {
      const toDate = new Date(req.query.to);
      toDate.setHours(23, 59, 59, 999); // End of day
      filteredLogs = filteredLogs.filter(log => new Date(log.timestamp) <= toDate);
    }
    
    // Sort by timestamp (newest first)
    filteredLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    // Convert to CSV
    const fields = ['timestamp', 'username', 'userRole', 'action', 'resource', 'resourceId', 'success', 'ipAddress'];
    let csv = fields.join(',') + '\n';
    
    filteredLogs.forEach(log => {
      const row = fields.map(field => {
        // Handle special cases and escape CSV values
        let value = log[field];
        if (field === 'timestamp') {
          value = new Date(value).toLocaleString();
        }
        if (typeof value === 'string' && value.includes(',')) {
          return `"${value}"`;
        }
        return value;
      });
      csv += row.join(',') + '\n';
    });
    
    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=audit_logs.csv');
    
    res.send(csv);
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

module.exports = router;