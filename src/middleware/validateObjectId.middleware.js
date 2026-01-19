/**
 * Validate MongoDB ObjectId in request params
 */
const mongoose = require('mongoose');

/**
 * Middleware to validate ObjectId in req.params.id
 * Returns 400 if invalid
 */
const validateObjectId = (paramName = 'id') => {
  return (req, res, next) => {
    const id = req.params[paramName];
    
    if (!id) {
      return res.status(400).json({
        success: false,
        message: `Missing required parameter: ${paramName}`,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid id',
      });
    }

    next();
  };
};

module.exports = {validateObjectId};
