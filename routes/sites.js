// routes/sites.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Helper function to read sites data
function readSitesData() {
    try {
        const dataFilePath = path.join(__dirname, '..', 'sites-data.json');

        // Check if file exists, if not create it with empty array
        if (!fs.existsSync(dataFilePath)) {
            fs.writeFileSync(dataFilePath, '[]');
            return [];
        }

        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('Error reading sites data:', err);
        return [];
    }
}

// Helper function to write sites data
function writeSitesData(sites) {
    try {
        const dataFilePath = path.join(__dirname, '..', 'sites-data.json');
        fs.writeFileSync(dataFilePath, JSON.stringify(sites, null, 2));
        return true;
    } catch (err) {
        console.error('Error writing sites data:', err);
        return false;
    }
}

// Match a camera name to a site based on prefix
function matchCameraToSite(cameraName) {
    if (!cameraName) return null;

    const sites = readSitesData();
    // Sort sites by prefix length (descending) to match the most specific prefix first
    sites.sort((a, b) => b.prefix.length - a.prefix.length);

    for (const site of sites) {
        // Check if the camera name starts with the prefix
        // followed by a hyphen (-) or is exactly the prefix
        if (cameraName === site.prefix ||
            cameraName.startsWith(site.prefix + '-')) {
            console.log(`Camera ${cameraName} matched to site ${site.name} (ID: ${site.id})`);
            return site;
        }
    }

    console.log(`No site found for camera: ${cameraName}`);
    return null;
}

// @route   GET /api/sites
// @desc    Get all sites
// @access  Private (requires authentication)
router.get('/', authMiddleware, (req, res) => {
    try {
        const sites = readSitesData();
        res.json(sites);
    } catch (error) {
        console.error('Error fetching sites:', error);
        res.status(500).json({ error: 'Failed to fetch sites' });
    }
});

// @route   GET /api/sites/match/:camera
// @desc    Match a camera to a site
// @access  Private (requires authentication)
router.get('/match/:camera', authMiddleware, (req, res) => {
    try {
        const cameraName = req.params.camera;
        const site = matchCameraToSite(cameraName);

        if (!site) {
            return res.status(404).json({ error: 'No matching site found for this camera' });
        }

        res.json(site);
    } catch (error) {
        console.error('Error matching camera to site:', error);
        res.status(500).json({ error: 'Failed to match camera to site' });
    }
});

// @route   GET /api/sites/:id
// @desc    Get site by ID
// @access  Private (requires authentication)
router.get('/:id', authMiddleware, (req, res) => {
    try {
        const siteId = parseInt(req.params.id);
        console.log(`Fetching site with ID: ${siteId}`);
        const sites = readSitesData();

        const site = sites.find(site => site.id === siteId);

        if (!site) {
            console.log(`Site with ID ${siteId} not found`);
            return res.status(404).json({ error: 'Site not found' });
        }

        console.log(`Found site: ${site.name}`);
        res.json(site);
    } catch (error) {
        console.error('Error fetching site:', error);
        res.status(500).json({ error: 'Failed to fetch site' });
    }
});

// @route   POST /api/sites
// @desc    Create a new site
// @access  Admin
router.post('/', adminMiddleware, (req, res) => {
    try {
        const { prefix, name, address, keyholders } = req.body;

        // Validate input
        if (!prefix || !name || !address) {
            return res.status(400).json({ error: 'Please provide prefix, name, and address' });
        }

        // Read current sites
        const sites = readSitesData();

        // Check if prefix already exists
        if (sites.find(site => site.prefix === prefix)) {
            return res.status(400).json({ error: 'A site with this prefix already exists' });
        }

        // Create new site
        const newSite = {
            id: sites.length > 0 ? Math.max(...sites.map(site => site.id)) + 1 : 1,
            prefix,
            name,
            address,
            keyholders: keyholders || Array(4).fill({ name: '', contact: '' })
        };

        // Add to sites array
        sites.push(newSite);

        // Save updated sites
        if (!writeSitesData(sites)) {
            return res.status(500).json({ error: 'Failed to save site' });
        }

        res.status(201).json(newSite);
    } catch (error) {
        console.error('Error creating site:', error);
        res.status(500).json({ error: 'Failed to create site' });
    }
});

// @route   PUT /api/sites/:id
// @desc    Update a site
// @access  Admin
router.put('/:id', adminMiddleware, (req, res) => {
    try {
        const siteId = parseInt(req.params.id);
        const { prefix, name, address, keyholders } = req.body;

        // Validate input
        if (!prefix || !name || !address) {
            return res.status(400).json({ error: 'Please provide prefix, name, and address' });
        }

        // Read current sites
        const sites = readSitesData();

        // Find site index
        const siteIndex = sites.findIndex(site => site.id === siteId);

        if (siteIndex === -1) {
            return res.status(404).json({ error: 'Site not found' });
        }

        // Check if prefix already exists (but ignore the current site)
        const duplicatePrefix = sites.find(site => site.prefix === prefix && site.id !== siteId);
        if (duplicatePrefix) {
            return res.status(400).json({ error: 'A site with this prefix already exists' });
        }

        // Update site
        sites[siteIndex] = {
            ...sites[siteIndex],
            prefix,
            name,
            address,
            keyholders: keyholders || sites[siteIndex].keyholders
        };

        // Save updated sites
        if (!writeSitesData(sites)) {
            return res.status(500).json({ error: 'Failed to update site' });
        }

        res.json(sites[siteIndex]);
    } catch (error) {
        console.error('Error updating site:', error);
        res.status(500).json({ error: 'Failed to update site' });
    }
});

// @route   DELETE /api/sites/:id
// @desc    Delete a site
// @access  Admin
router.delete('/:id', adminMiddleware, (req, res) => {
    try {
        const siteId = parseInt(req.params.id);

        // Read current sites
        const sites = readSitesData();

        // Find site index
        const siteIndex = sites.findIndex(site => site.id === siteId);

        if (siteIndex === -1) {
            return res.status(404).json({ error: 'Site not found' });
        }

        // Remove site
        sites.splice(siteIndex, 1);

        // Save updated sites
        if (!writeSitesData(sites)) {
            return res.status(500).json({ error: 'Failed to delete site' });
        }

        res.json({ success: true, message: 'Site deleted successfully' });
    } catch (error) {
        console.error('Error deleting site:', error);
        res.status(500).json({ error: 'Failed to delete site' });
    }
});

module.exports = {
    router,
    matchCameraToSite
};