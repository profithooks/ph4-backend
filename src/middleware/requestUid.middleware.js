/**
 * Request UID middleware
 * Generates a unique server-side ID for each HTTP request
 */
const requestUid = (req, res, next) => {
  // Generate unique server-side request ID
  req._reqUid = `srv_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

  // Attach to response header for client visibility (optional)
  res.setHeader('X-Server-ReqUid', req._reqUid);

  next();
};

module.exports = requestUid;
