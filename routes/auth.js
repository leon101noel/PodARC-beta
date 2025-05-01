const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { JWT_SECRET, readUsersData, writeUsersData, adminMiddleware } = require('../middleware/auth');

// @route   POST /api/auth/login
// @desc    Authenticate user & get token
// @access  Public
router.post('/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        // Check if username and password are provided
        if (!username || !password) {
            return res.status(400).json({ error: 'Please provide username and password' });
        }

        // Get users from data file
        const users = readUsersData();

        // Find the user
        const user = users.find(u => u.username === username && u.isActive);

        // Check if user exists
        if (!user) {
            return res.status(400).json({ error: 'Invalid credentials or inactive account' });
        }

        // Check if password matches
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        // Create payload for JWT
        const payload = {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role
        };

        // Sign token
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '12h' });

        // Set token in session if using sessions
        if (req.session) {
            req.session.token = token;
            req.session.user = {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role
            };
        }

        // Return token and user info
        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                name: user.name,
                role: user.role
            }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error during login' });
    }
});

// @route   POST /api/auth/logout
// @desc    Logout user
// @access  Private
router.post('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy(err => {
            if (err) {
                return res.status(500).json({ error: 'Error logging out' });
            }
            res.json({ success: true, message: 'Logged out successfully' });
        });
    } else {
        res.json({ success: true, message: 'Logged out successfully' });
    }
});

// @route   GET /api/auth/user
// @desc    Get current user
// @access  Private
router.get('/user', (req, res) => {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    res.json({ user: req.user });
});

// @route   GET /api/auth/users
// @desc    Get all users (admin only)
// @access  Admin
router.get('/users', adminMiddleware, (req, res) => {
    try {
        const users = readUsersData();

        // Don't return passwords
        const safeUsers = users.map(user => ({
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role,
            isActive: user.isActive
        }));

        res.json(safeUsers);
    } catch (err) {
        console.error('Error getting users:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   POST /api/auth/users
// @desc    Create new user (admin only)
// @access  Admin
router.post('/users', adminMiddleware, async (req, res) => {
    try {
        const { username, password, name, role, isActive } = req.body;

        // Validate input
        if (!username || !password || !name) {
            return res.status(400).json({ error: 'Please provide username, password and name' });
        }

        // Read current users
        const users = readUsersData();

        // Check if username already exists
        if (users.find(u => u.username === username)) {
            return res.status(400).json({ error: 'Username already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const newUser = {
            id: users.length > 0 ? Math.max(...users.map(u => u.id)) + 1 : 1,
            username,
            password: hashedPassword,
            name,
            role: role || 'user',
            isActive: isActive !== undefined ? isActive : true
        };

        // Add to users array
        users.push(newUser);

        // Save updated users
        if (!writeUsersData(users)) {
            return res.status(500).json({ error: 'Failed to save user' });
        }

        // Return user without password
        const { password: _, ...userWithoutPassword } = newUser;
        res.status(201).json(userWithoutPassword);
    } catch (err) {
        console.error('Error creating user:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   PUT /api/auth/users/:id
// @desc    Update user (admin only)
// @access  Admin
router.put('/users/:id', adminMiddleware, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { username, password, name, role, isActive } = req.body;

        // Read current users
        const users = readUsersData();

        // Find user index
        const userIndex = users.findIndex(u => u.id === userId);

        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Update user
        if (username) users[userIndex].username = username;
        if (name) users[userIndex].name = name;
        if (role) users[userIndex].role = role;
        if (isActive !== undefined) users[userIndex].isActive = isActive;

        // Update password if provided
        if (password) {
            const salt = await bcrypt.genSalt(10);
            users[userIndex].password = await bcrypt.hash(password, salt);
        }

        // Save updated users
        if (!writeUsersData(users)) {
            return res.status(500).json({ error: 'Failed to update user' });
        }

        // Return updated user without password
        const { password: _, ...userWithoutPassword } = users[userIndex];
        res.json(userWithoutPassword);
    } catch (err) {
        console.error('Error updating user:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// @route   DELETE /api/auth/users/:id
// @desc    Delete user (admin only)
// @access  Admin
router.delete('/users/:id', adminMiddleware, (req, res) => {
    try {
        const userId = parseInt(req.params.id);

        // Read current users
        const users = readUsersData();

        // Make sure we're not deleting the last admin
        if (userId === 1) {
            return res.status(400).json({ error: 'Cannot delete primary administrator account' });
        }

        // Find user
        const userIndex = users.findIndex(u => u.id === userId);

        if (userIndex === -1) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Remove user
        users.splice(userIndex, 1);

        // Save updated users
        if (!writeUsersData(users)) {
            return res.status(500).json({ error: 'Failed to delete user' });
        }

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        console.error('Error deleting user:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;