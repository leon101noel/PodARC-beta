
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// JWT secret key - in production this should be in environment variables
const JWT_SECRET = 'cctv-monitor-jwt-H45nB9Kp2L7zX3vF8qRs6tYu4mWdE2jG';

// Read users data file
function readUsersData() {
    try {
        const dataFilePath = path.join(__dirname, '..', 'users-data.json');
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading users data:', err);
        return [];
    }
}

// Write to users data file
function writeUsersData(users) {
    try {
        const dataFilePath = path.join(__dirname, '..', 'users-data.json');
        fs.writeFileSync(dataFilePath, JSON.stringify(users, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing users data:', err);
        return false;
    }
}

// Authentication middleware
function authMiddleware(req, res, next) {
    // Get token from header or session
    const token = req.header('x-auth-token') || (req.session && req.session.token);

    // Check if no token
    if (!token) {
        // These paths are allowed without authentication
        const publicPaths = [
            '/login', 
            '/login.html',
            '/api/auth/login',
            '/styles.css',
            '/login-styles.css',
            '/app.js',
            '/user-management-styles.css',
            '/favicon.ico'
        ];
        
        if (publicPaths.includes(req.path) || req.path.startsWith('/public/') || 
            req.path.startsWith('/images/')) {
            return next();
        }
        
        // If it's an API request, return 401
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'No token, authorization denied' });
        }
        
        // For regular page requests, redirect to login
        console.log('Redirecting unauthenticated request to /login.html:', req.path);
        return res.redirect('/login.html');
    }

    try {
        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Add user to request
        req.user = decoded;
        next();
    } catch (err) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ error: 'Token is not valid' });
        }
        // Clear invalid session and redirect to login
        if (req.session) {
            req.session.destroy();
        }
        return res.redirect('/login');
    }
}

// Admin middleware - checks if user is an admin
function adminMiddleware(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authorized' });
    }

    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }

    next();
}

module.exports = {
    JWT_SECRET,
    authMiddleware,
    adminMiddleware,
    readUsersData,
    writeUsersData
};