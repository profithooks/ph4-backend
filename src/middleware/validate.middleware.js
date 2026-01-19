/**
 * Joi validation middleware
 */

/**
 * Validate request body against Joi schema
 * @param {object} schema - Joi schema object
 * @returns {function} Express middleware
 */
const validate = (schema) => {
  return (req, res, next) => {
    const {error, value} = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
      }));

      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors,
      });
    }

    // Replace req.body with validated value (stripped unknown fields)
    req.body = value;
    next();
  };
};

module.exports = {validate};
