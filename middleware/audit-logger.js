const { ACTIONS, logUserActivity } = require('../audit-service');

// Middleware to log all API requests
function auditLoggerMiddleware(req, res, next) {
  // Save original end method
  const originalEnd = res.end;
  
  // Override end method to capture response
  res.end = function(chunk, encoding) {
    // Restore original end method
    res.end = originalEnd;
    
    // Get response status
    const success = res.statusCode >= 200 && res.statusCode < 400;
    
    // Skip logging for paths we don't want to audit
    // 1. Skip all non-API paths
    // 2. Skip routine API endpoints that would create too much noise
    // 3. Skip OPTIONS requests
    if (
      !req.path.startsWith('/api/') ||  // Skip non-API paths
      req.path === '/api/auth/user' ||  // Skip frequent auth checks
      req.path === '/api/events' ||     // Skip routine event listing
      req.path === '/api/settings/tags' || // Skip routine tags retrieval
      req.path === '/api/check-emails' || // Skip routine email checks
      req.path === '/api/videos/list' ||  // Skip video listing
      req.path === '/login' ||
      req.path === '/login.html' ||
      req.path === '/login-styles.css' ||
      req.method === 'OPTIONS'
    ) {
      return res.end(chunk, encoding);
    }
    
    // We only want to audit specific actions, not every API call
    const auditActions = [
      '/api/auth/login',
      '/api/auth/logout',
      '/api/auth/users',         // User management
      '/api/events/acknowledge', // Event acknowledgment
      '/api/events/update-video-path', // Video path updates
      '/api/retention/events',   // Event locking/unlocking
      '/api/operator-logs',      // Operator logout logs
      '/api/settings'            // Settings changes
    ];
    
    // Check if this is an action we want to audit
    const shouldAudit = auditActions.some(action => req.path.includes(action));
    
    // Skip if this is not an action we want to audit, and it's not a specific HTTP method we care about
    if (!shouldAudit && !['POST', 'PUT', 'DELETE'].includes(req.method)) {
      return res.end(chunk, encoding);
    }
    
    // Determine action type based on path and method
    let action = 'API_REQUEST';
    let resource = req.path.split('/')[2] || 'unknown';
    let resourceId = req.params.id;
    
    // More specific action mapping
    if (req.path.includes('/api/auth/login') && req.method === 'POST') {
      // This is a login attempt - we want to log these
      action = success ? ACTIONS.LOGIN_SUCCESS : ACTIONS.LOGIN_FAILURE;
      resource = 'auth';
      
      // For successful logins, get the user info
      if (success && req.body) {
        try {
          // We want to know who logged in, but don't log passwords
          const { username } = req.body;
          resourceId = username; // Store username as resourceId
        } catch (err) {
          console.error('Error extracting login info:', err);
        }
      }
    } else if (req.path.includes('/api/auth/logout') && req.method === 'POST') {
      action = ACTIONS.LOGOUT;
      resource = 'auth';
      
      // Get the user info from the token
      if (req.user) {
        resourceId = req.user.username; // Store username
      }
    } else if (req.path.includes('/api/events') && req.path.includes('/acknowledge')) {
      action = ACTIONS.EVENT_ACKNOWLEDGE;
      resource = 'events';
      resourceId = req.params.id;
    } else if (req.path.includes('/api/retention/events') && req.path.includes('/lock') && req.method === 'PUT') {
      // Determine if this is a lock or unlock action
      // We need to examine the request body to know
      let isLocking = false;
      
      try {
        // The body might have already been parsed, or might be in the raw chunk
        if (req.body && req.body.locked !== undefined) {
          isLocking = req.body.locked;
        } else if (chunk) {
          // Try to parse the chunk as JSON
          const body = JSON.parse(chunk.toString());
          isLocking = body.locked;
        }
        
        action = isLocking ? ACTIONS.EVENT_LOCK : ACTIONS.EVENT_UNLOCK;
      } catch (err) {
        console.error('Error determining lock action:', err);
        action = 'EVENT_LOCK_CHANGE'; // Fallback
      }
      
      resource = 'events';
      resourceId = req.params.id;
    } else if (req.path === '/api/auth/users' && req.method === 'POST') {
      action = ACTIONS.USER_CREATE;
      resource = 'users';
      
      // Try to get the username that's being created
      if (req.body && req.body.username) {
        resourceId = req.body.username;
      }
    } else if (req.path.includes('/api/auth/users/') && req.method === 'PUT') {
      action = ACTIONS.USER_UPDATE;
      resource = 'users';
      resourceId = req.params.id;
      
      // Try to get more info about what's being updated
      let changes = [];
      if (req.body) {
        if (req.body.username) changes.push('username');
        if (req.body.name) changes.push('name');
        if (req.body.role) changes.push('role');
        if (req.body.isActive !== undefined) changes.push('status');
        if (req.body.password) changes.push('password');
      }
    } else if (req.path.includes('/api/auth/users/') && req.method === 'DELETE') {
      action = ACTIONS.USER_DELETE;
      resource = 'users';
      resourceId = req.params.id;
    }
    
    // Log the activity
    logUserActivity(
      req, 
      action, 
      resource, 
      resourceId, 
      { 
        method: req.method,
        path: req.path,
        query: req.query,
        // Don't log sensitive information like passwords
        body: sanitizeRequestBody(req.body)
      },
      success
    );
    
    // Continue with the original end
    return res.end(chunk, encoding);
  };
  
  next();
}

// Remove sensitive fields from request body
function sanitizeRequestBody(body) {
  if (!body) return {};
  
  const sanitized = { ...body };
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization'];
  
  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });
  
  return sanitized;
}

module.exports = auditLoggerMiddleware;