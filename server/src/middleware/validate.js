// Hand-rolled request validation. The payloads here are small and fixed,
// so a schema library would be more ceremony than the checks themselves.

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function requireString(body, field, { minLength = 1, maxLength = 500 } = {}) {
  const value = body[field];
  if (typeof value !== 'string') {
    throw new ValidationError(`"${field}" must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLength) {
    throw new ValidationError(
      minLength <= 1 ? `"${field}" must not be empty` : `"${field}" must be at least ${minLength} characters`
    );
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`"${field}" must be ${maxLength} characters or fewer`);
  }
  return trimmed;
}

function optionalString(body, field, opts = {}) {
  if (body[field] === undefined || body[field] === null || body[field] === '') return undefined;
  return requireString(body, field, opts);
}

function requireNumber(body, field, { min, max } = {}) {
  const value = Number(body[field]);
  if (Number.isNaN(value)) {
    throw new ValidationError(`"${field}" must be a number`);
  }
  if (min !== undefined && value < min) {
    throw new ValidationError(`"${field}" must be at least ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(`"${field}" must be at most ${max}`);
  }
  return value;
}

function optionalNumber(body, field, opts = {}) {
  if (body[field] === undefined || body[field] === null || body[field] === '') return undefined;
  return requireNumber(body, field, opts);
}

function requireDate(body, field) {
  const raw = body[field];
  if (!raw) {
    throw new ValidationError(`"${field}" is required`);
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`"${field}" must be a valid date`);
  }
  return date;
}

// Wraps a route handler so a thrown ValidationError becomes a clean 4xx
// instead of an unhandled rejection / generic 500.
function withValidation(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(err.status).json({ error: err.message });
      }
      next(err);
    }
  };
}

module.exports = {
  ValidationError,
  requireString,
  optionalString,
  requireNumber,
  optionalNumber,
  requireDate,
  withValidation,
};
