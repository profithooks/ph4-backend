/**
 * Request UID middleware
 * Generates a unique server-side ID for each HTTP request
 * Supports incoming X-Request-Id header for end-to-end tracing
 */
const {v4: uuidv4} = require('uuid');

const requestUid = (req, res, next) => {
  // Accept incoming X-Request-Id from client, or generate new one
  const incomingRequestId = req.headers['x-request-id'];
  
  // Generate or use incoming requestId (UUID v4 format)
  req.requestId = incomingRequestId && isValidUUID(incomingRequestId) 
    ? incomingRequestId 
    : uuidv4();

  // Attach to response header for client visibility
  res.setHeader('X-Request-Id', req.requestId);

  next();
};

/**
 * Basic UUID v4 validation
 */
function isValidUUID(str) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

module.exports = requestUid;
