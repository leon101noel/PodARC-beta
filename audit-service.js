const { addLogEntry } = require('./audit-logs');
const { v4: uuidv4 } = require('uuid');

const ACTIONS = {
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  EVENT_VIEW: 'EVENT_VIEW',
  EVENT_ACKNOWLEDGE: 'EVENT_ACKNOWLEDGE',
  EVENT_LOCK: 'EVENT_LOCK',
  EVENT_UNLOCK: 'EVENT_UNLOCK',
  USER_CREATE: 'USER_CREATE',
  USER_UPDATE: 'USER_UPDATE',
  USER_DELETE: 'USER_DELETE',
  SETTINGS_CHANGE: 'SETTINGS_CHANGE',
  DATA_EXPORT: 'DATA_EXPORT',
  SITE_VIEW: 'SITE_VIEW',
  SITE_UPDATE: 'SITE_UPDATE',
  API_REQUEST: 'API_REQUEST'
};

function logUserActivity(req, action, resource, resourceId, details = {}, success = true) {
  // If req is not provided, create a minimal default
  if (!req) {
    req = { 
      user: { id: null, username: 'system', role: 'system' },
      connection: { remoteAddress: '127.0.0.1' },
      headers: {}
    };
  }
  
  // Get user info from request
  const user = req.user || { id: null, username: 'anonymous', role: 'anonymous' };
  
  // Extract IP from request (handling proxies)
  const ipAddress = req.headers?.['x-forwarded-for'] || req.connection?.remoteAddress || '0.0.0.0';
  
  const logEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    userId: user.id,
    username: user.username,
    userRole: user.role,
    action,
    resource,
    resourceId: resourceId?.toString(),
    details,
    ipAddress,
    userAgent: req.headers?.['user-agent'] || 'Unknown',
    success,
    metadata: {}
  };
  
  // Add to logs asynchronously to avoid blocking the request
  process.nextTick(() => addLogEntry(logEntry));
  
  return logEntry;
}

module.exports = {
  ACTIONS,
  logUserActivity
};